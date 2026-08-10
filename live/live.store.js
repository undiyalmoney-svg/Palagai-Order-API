/**
 * Multi-user Server Live store — one worker session per site userId.
 * Does not touch /api/kite HTTP controllers; workers call kite.service directly.
 */
const crypto = require('crypto');
const {
  APP_BUILD,
  APP_VERSION,
  DAILY_3K_PRESET,
  deskRiskLots,
  profitLockMoneyRs,
  strictStopMoneyRs,
  riskStatusLabels,
  normalizeStartConfig,
  DAY_PROFIT_LOCK_RS,
  STRICT_DAY_STOP_RS,
} = require('./daily-desk-defaults');

const STALE_SEC = 180;

/** @type {import('mongodb').Db | null} */
let mongoDb = null;

/** @type {Map<string, UserLiveSession>} */
const sessions = new Map();

/**
 * @typedef {object} UserLiveSession
 * @property {string} userId
 * @property {string} status
 * @property {string} message
 * @property {string|null} startedAt
 * @property {string|null} stoppedAt
 * @property {string|null} lastHeartbeatAt
 * @property {object|null} config
 * @property {Array<{at:string,action:string,detail:string}>} events
 * @property {object|null} auth
 * @property {ReturnType<typeof setInterval>|null} tickTimer
 * @property {import('./live.worker').LiveWorker|null} worker
 */

function getEncKey() {
  const raw = process.env.LIVE_AUTH_SECRET || process.env.MONGODB_PASSWORD || 'palagai-dev-only';
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function enc(plain) {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encBuf = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encBuf]).toString('base64');
}

function dec(payload) {
  const buf = Buffer.from(String(payload), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function createSession(userId) {
  /** @type {UserLiveSession} */
  const s = {
    userId: String(userId),
    status: 'stopped',
    message: 'Server Live idle — push Kite token, then Start',
    startedAt: null,
    stoppedAt: null,
    lastHeartbeatAt: null,
    config: null,
    events: [],
    auth: null,
    tickTimer: null,
    worker: null,
  };
  return s;
}

function getSession(userId) {
  const id = String(userId || 'anonymous');
  if (!sessions.has(id)) {
    sessions.set(id, createSession(id));
  }
  return sessions.get(id);
}

function pushEvent(session, action, detail) {
  session.events.unshift({
    at: new Date().toISOString(),
    action,
    detail,
  });
  session.events = session.events.slice(0, 200);
}

function heartbeat(session, message) {
  session.lastHeartbeatAt = new Date().toISOString();
  if (message) session.message = message;
}

function statusPayload(session) {
  const ageSec = session.lastHeartbeatAt
    ? Math.round((Date.now() - Date.parse(session.lastHeartbeatAt)) / 1000)
    : null;
  const cfg = session.config || DAILY_3K_PRESET;
  const lots = deskRiskLots(cfg);
  return {
    status: session.status,
    message: session.message,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    lastHeartbeatAt: session.lastHeartbeatAt,
    heartbeatAgeSec: ageSec,
    stale: ageSec == null ? session.status === 'running' : ageSec > STALE_SEC,
    config: session.config,
    defaults: DAILY_3K_PRESET,
    risk: {
      dayProfitLockRsBase: DAY_PROFIT_LOCK_RS,
      strictDayStopRsBase: STRICT_DAY_STOP_RS,
      riskLots: lots,
      profitLockMoneyRs: profitLockMoneyRs(lots),
      strictStopMoneyRs: strictStopMoneyRs(lots),
      labels: riskStatusLabels(cfg),
      checkboxHint: `₹${DAY_PROFIT_LOCK_RS.toLocaleString('en-IN')} × lots (1→₹3k · 3→₹9k)`,
    },
    version: APP_VERSION,
    appBuild: APP_BUILD,
    authPresent: !!session.auth,
    events: session.events.slice(0, 40),
    mongo: !!mongoDb,
    userId: session.userId,
  };
}

function readAuthPlain(session) {
  if (!session.auth) return null;
  try {
    return {
      apiKey: dec(session.auth.apiKeyEnc),
      accessToken: dec(session.auth.accessTokenEnc),
    };
  } catch {
    return null;
  }
}

function getWorker(session) {
  if (!session.worker) {
    const { LiveWorker } = require('./live.worker');
    session.worker = new LiveWorker({
      readAuth: () => readAuthPlain(session),
      pushEvent: (a, d) => pushEvent(session, a, d),
      heartbeat: (m) => heartbeat(session, m),
      getConfig: () => session.config,
    });
  }
  return session.worker;
}

async function persistRun(session) {
  if (!mongoDb) return;
  await mongoDb.collection('live_runs').updateOne(
    { _id: session.userId },
    {
      $set: {
        userId: session.userId,
        active: session.status === 'running',
        status: session.status,
        config: session.config,
        message: session.message,
        startedAt: session.startedAt,
        stoppedAt: session.stoppedAt,
        lastHeartbeatAt: session.lastHeartbeatAt,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
}

function stopTickLoop(session) {
  if (session.tickTimer) {
    clearInterval(session.tickTimer);
    session.tickTimer = null;
  }
}

function startTickLoop(session) {
  if (session.tickTimer) return;
  const w = getWorker(session);
  w.resetWarm();
  const run = () => {
    if (session.status !== 'running') return;
    void w
      .onTick()
      .then(() => persistRun(session))
      .catch((err) => console.error('[live-store]', session.userId, err.message));
  };
  run();
  // 15s ticks — cut live lag vs Paper on 5m bar closes / peak-lock exits.
  session.tickTimer = setInterval(run, 15_000);
  heartbeat(session, 'Server Live running — strategy worker active');
  pushEvent(session, 'WORKER', `User ${session.userId} · 15s ticks · multi-user OK`);
}

async function attachMongo(db) {
  mongoDb = db;
  try {
    const runs = await db
      .collection('live_runs')
      .find({ active: true })
      .toArray();
    for (const run of runs) {
      const userId = String(run.userId || run._id || '');
      if (!userId || userId === 'active') continue;
      const session = getSession(userId);
      session.status = run.status || 'stopped';
      session.config = run.config || null;
      session.startedAt = run.startedAt || null;
      session.message = run.message || session.message;
      const auth = await db.collection('kite_auth').findOne({ _id: userId });
      if (auth?.apiKeyEnc && auth?.accessTokenEnc) {
        session.auth = {
          apiKeyEnc: auth.apiKeyEnc,
          accessTokenEnc: auth.accessTokenEnc,
          updatedAt: auth.updatedAt,
        };
      }
      if (session.status === 'running') {
        startTickLoop(session);
      }
    }
    // Migrate legacy primary → leave in place for owner who re-pushes
  } catch (err) {
    console.error('[live-store] mongo hydrate failed', err.message);
  }
}

async function start(userId, config) {
  const session = getSession(userId);
  if (session.status === 'running') {
    pushEvent(session, 'START_IGNORED', 'Already running — Stop first to change books/lots');
    session.message = 'Already running. Stop first to change config.';
    return statusPayload(session);
  }
  session.config = normalizeStartConfig(config);
  if (session.config.realOrders && !session.auth) {
    const err = new Error('Push Kite token first before real money Start');
    err.status = 400;
    throw err;
  }
  if (!session.config.enableNifty && !session.config.enableBank && !session.config.enableCrude) {
    const err = new Error('Enable at least one book');
    err.status = 400;
    throw err;
  }
  session.status = 'running';
  session.startedAt = new Date().toISOString();
  session.stoppedAt = null;
  const riskBits = riskStatusLabels(session.config);
  pushEvent(
    session,
    'START',
    `Daily desk · books N${session.config.enableNifty ? 1 : 0}/B${session.config.enableBank ? 1 : 0}/C${session.config.enableCrude ? 1 : 0} · bank=${session.config.bankStrategy} · crude=${session.config.crudeStrategy} · real=${session.config.realOrders}` +
      (riskBits.length ? ` · ${riskBits.join(' · ')}` : ''),
  );
  startTickLoop(session);
  await persistRun(session);
  return statusPayload(session);
}

async function stop(userId) {
  const session = getSession(userId);
  session.status = 'stopped';
  session.stoppedAt = new Date().toISOString();
  session.message = 'Stopped by user';
  stopTickLoop(session);
  pushEvent(session, 'STOP', 'Server Live stopped');
  await persistRun(session);
  return statusPayload(session);
}

async function putAuth(userId, { apiKey, accessToken }) {
  if (!apiKey || !accessToken) {
    const err = new Error('apiKey and accessToken required');
    err.status = 400;
    throw err;
  }
  const session = getSession(userId);
  session.auth = {
    apiKeyEnc: enc(apiKey),
    accessTokenEnc: enc(accessToken),
    updatedAt: new Date().toISOString(),
  };
  if (mongoDb) {
    await mongoDb.collection('kite_auth').updateOne(
      { _id: String(userId) },
      { $set: { ...session.auth, userId: String(userId) } },
      { upsert: true },
    );
  }
  pushEvent(session, 'AUTH', 'Kite token stored (encrypted, per-user)');
  return { ok: true, updatedAt: session.auth.updatedAt };
}

function statusFor(userId) {
  return statusPayload(getSession(userId));
}

/**
 * Kite `token apiKey:accessToken` for a user, using the in-memory session or,
 * if absent, the encrypted token stored in Mongo (kite_auth) from a prior Push.
 * Lets Paper backtests reuse the pushed token instead of a per-request browser
 * session. Returns null when no token is available.
 */
async function getAuthorizationFor(userId) {
  const session = getSession(userId);
  let plain = readAuthPlain(session);
  if ((!plain?.apiKey || !plain?.accessToken) && mongoDb) {
    try {
      const auth = await mongoDb.collection('kite_auth').findOne({ _id: String(userId) });
      if (auth?.apiKeyEnc && auth?.accessTokenEnc) {
        session.auth = {
          apiKeyEnc: auth.apiKeyEnc,
          accessTokenEnc: auth.accessTokenEnc,
          updatedAt: auth.updatedAt,
        };
        plain = readAuthPlain(session);
      }
    } catch (err) {
      console.error('[live-store] getAuthorizationFor mongo lookup failed', err.message);
    }
  }
  if (!plain?.apiKey || !plain?.accessToken) {
    return null;
  }
  return `token ${plain.apiKey}:${plain.accessToken}`;
}

module.exports = {
  attachMongo,
  statusFor,
  start,
  stop,
  putAuth,
  getSession,
  getAuthorizationFor,
};
