/**
 * In-memory + Mongo-backed store for Server Live.
 * Separate from Kite order proxy — never calls kite.service for Phase-1 scaffold.
 */
const crypto = require('crypto');

const STALE_SEC = 180;

/** @type {{
 *  status: 'running'|'stopping'|'stopped'|'error',
 *  message: string,
 *  startedAt: string|null,
 *  stoppedAt: string|null,
 *  lastHeartbeatAt: string|null,
 *  config: object|null,
 *  events: Array<{at:string,action:string,detail:string}>,
 *  auth: { apiKeyEnc: string, accessTokenEnc: string, updatedAt: string }|null,
 * }} */
const state = {
  status: 'stopped',
  message: 'Server Live idle (scaffold — strategy ticks not wired yet)',
  startedAt: null,
  stoppedAt: null,
  lastHeartbeatAt: null,
  config: null,
  events: [],
  auth: null,
};

let mongoDb = null;
let tickTimer = null;

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
  const key = getEncKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function pushEvent(action, detail) {
  state.events.unshift({
    at: new Date().toISOString(),
    action,
    detail,
  });
  state.events = state.events.slice(0, 200);
}

function heartbeat(message) {
  state.lastHeartbeatAt = new Date().toISOString();
  if (message) {
    state.message = message;
  }
}

function statusPayload() {
  const ageSec = state.lastHeartbeatAt
    ? Math.round((Date.now() - Date.parse(state.lastHeartbeatAt)) / 1000)
    : null;
  return {
    status: state.status,
    message: state.message,
    startedAt: state.startedAt,
    stoppedAt: state.stoppedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    heartbeatAgeSec: ageSec,
    stale: ageSec == null ? state.status === 'running' : ageSec > STALE_SEC,
    config: state.config,
    authPresent: !!state.auth,
    events: state.events.slice(0, 40),
    mongo: !!mongoDb,
  };
}

async function attachMongo(db) {
  mongoDb = db;
  try {
    const run = await db.collection('live_runs').findOne({ active: true });
    if (run) {
      state.status = run.status || 'stopped';
      state.config = run.config || null;
      state.startedAt = run.startedAt || null;
      state.message = run.message || state.message;
    }
    const auth = await db.collection('kite_auth').findOne({ _id: 'primary' });
    if (auth?.apiKeyEnc && auth?.accessTokenEnc) {
      state.auth = {
        apiKeyEnc: auth.apiKeyEnc,
        accessTokenEnc: auth.accessTokenEnc,
        updatedAt: auth.updatedAt,
      };
    }
    if (state.status === 'running') {
      startTickLoop();
    }
  } catch (err) {
    console.error('[live-store] mongo hydrate failed', err.message);
  }
}

async function persistRun() {
  if (!mongoDb) return;
  await mongoDb.collection('live_runs').updateOne(
    { _id: 'active' },
    {
      $set: {
        active: state.status === 'running',
        status: state.status,
        config: state.config,
        message: state.message,
        startedAt: state.startedAt,
        stoppedAt: state.stoppedAt,
        lastHeartbeatAt: state.lastHeartbeatAt,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
}

function startTickLoop() {
  if (tickTimer) return;
  // Scaffold heartbeat only — does NOT place Kite orders.
  tickTimer = setInterval(() => {
    if (state.status !== 'running') return;
    heartbeat(
      `Scaffold tick · Nifty Trap · Bank ${state.config?.bankStrategy || 'trap'} · Crude All-Green · realOrders=${!!state.config?.realOrders}`,
    );
    void persistRun();
  }, 60_000);
  heartbeat('Server Live running (scaffold heartbeat)');
}

function stopTickLoop() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

async function start(config) {
  if (state.status === 'running') {
    const err = new Error('A Server Live run is already active');
    err.status = 409;
    throw err;
  }
  state.config = {
    enableNifty: !!config.enableNifty,
    enableBank: !!config.enableBank,
    enableCrude: !!config.enableCrude,
    niftyLots: Math.max(1, Math.floor(Number(config.niftyLots)) || 1),
    bankLots: Math.max(1, Math.floor(Number(config.bankLots)) || 1),
    crudeLots: Math.max(1, Math.floor(Number(config.crudeLots)) || 1),
    bankStrategy: config.bankStrategy === 'genie' ? 'genie' : 'trap',
    niftyStrategy: 'trap',
    crudeStrategy: 'all-green',
    realOrders: !!config.realOrders,
  };
  state.status = 'running';
  state.startedAt = new Date().toISOString();
  state.stoppedAt = null;
  pushEvent(
    'START',
    `books N${state.config.enableNifty ? 1 : 0}/B${state.config.enableBank ? 1 : 0}/C${state.config.enableCrude ? 1 : 0} · bank=${state.config.bankStrategy} · real=${state.config.realOrders}`,
  );
  startTickLoop();
  await persistRun();
  return statusPayload();
}

async function stop() {
  state.status = 'stopped';
  state.stoppedAt = new Date().toISOString();
  state.message = 'Stopped by user';
  stopTickLoop();
  pushEvent('STOP', 'Server Live stopped');
  await persistRun();
  return statusPayload();
}

async function putAuth({ apiKey, accessToken }) {
  if (!apiKey || !accessToken) {
    const err = new Error('apiKey and accessToken required');
    err.status = 400;
    throw err;
  }
  state.auth = {
    apiKeyEnc: enc(apiKey),
    accessTokenEnc: enc(accessToken),
    updatedAt: new Date().toISOString(),
  };
  if (mongoDb) {
    await mongoDb.collection('kite_auth').updateOne(
      { _id: 'primary' },
      { $set: { ...state.auth } },
      { upsert: true },
    );
  }
  pushEvent('AUTH', 'Kite token stored (encrypted)');
  return { ok: true, updatedAt: state.auth.updatedAt };
}

/** For future worker ticks — decrypt without exposing in status. */
function readAuthPlain() {
  if (!state.auth) return null;
  try {
    return {
      apiKey: dec(state.auth.apiKeyEnc),
      accessToken: dec(state.auth.accessTokenEnc),
    };
  } catch {
    return null;
  }
}

module.exports = {
  attachMongo,
  statusPayload,
  start,
  stop,
  putAuth,
  readAuthPlain,
  pushEvent,
  heartbeat,
};
