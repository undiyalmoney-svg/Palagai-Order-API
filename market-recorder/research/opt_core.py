"""Options-buying simulation core: pricing, entry signals, exits, costs, metrics.

Everything here is research code. It never places orders and never imports the order desk.

Conventions (kept deliberately conservative):
  * A signal is computed from bar i's CLOSE. The order can only fill at the OPEN of bar i+1+delay (delay in bars).
  * Premium = Black-Scholes mid on the (level-scaled) underlying path; the buyer pays mid + half spread and
    sells at mid - half spread, plus slippage ticks. Stops are tested before targets inside the same bar.
  * Charges are the exact Zerodha schedule in costs.py. Lot sizes are the CURRENT lots (65 / 30 / 20 / 10 bbl),
    and each day's index path is rescaled to today's index level, so rupee results answer "what would one lot
    trade today have earned", not "what did the 2023 lot size earn".
"""
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.special import ndtr

import costs

SESSION_END_MIN = 15 * 60 + 30  # IST minute-of-day of expiry settlement used for T
FLAT_MIN = 15 * 60 + 15  # all positions are closed at/after this bar's open (no overnight)

UNDERLYINGS = {
    # name: step, lot (units), venue, tick
    "NIFTY": dict(step=50, lot=65, venue="NSE", tick=0.05),
    "BANKNIFTY": dict(step=100, lot=30, venue="NSE", tick=0.05),
    "SENSEX": dict(step=100, lot=20, venue="BSE", tick=0.05),
    "CRUDEOILM": dict(step=50, lot=10, venue="MCX", tick=0.05),  # lot = barrels per Kite lot; premium is Rs per barrel
}

SPREADS = {  # full bid-ask spread as a fraction of mid premium, plus a one-tick slippage per leg
    "tight": 0.003,
    "base": 0.008,
    "wide": 0.02,
}


# ----------------------------------------------------------------------------- pricing
def bs_price(S, K, T, iv, is_call, r=0.065):
    """Vectorised Black-Scholes. T in years. Returns intrinsic when T<=0."""
    S, K, T, iv = np.broadcast_arrays(np.asarray(S, float), np.asarray(K, float), np.asarray(T, float), np.asarray(iv, float))
    Tc = np.maximum(T, 1e-9)
    sq = iv * np.sqrt(Tc)
    d1 = (np.log(S / K) + (r + 0.5 * iv * iv) * Tc) / sq
    d2 = d1 - sq
    disc = np.exp(-r * Tc)
    call = S * ndtr(d1) - K * disc * ndtr(d2)
    put = K * disc * ndtr(-d2) - S * ndtr(-d1)
    px = np.where(is_call, call, put)
    intrinsic = np.where(is_call, np.maximum(S - K, 0), np.maximum(K - S, 0))
    return np.where(T <= 0, intrinsic, np.maximum(px, intrinsic * 0 + 0.0))


def black76(F, K, T, iv, is_call):
    F, K, T, iv = np.broadcast_arrays(np.asarray(F, float), np.asarray(K, float), np.asarray(T, float), np.asarray(iv, float))
    Tc = np.maximum(T, 1e-9)
    sq = iv * np.sqrt(Tc)
    d1 = (np.log(F / K) + 0.5 * iv * iv * Tc) / sq
    d2 = d1 - sq
    px = np.where(is_call, F * ndtr(d1) - K * ndtr(d2), K * ndtr(-d2) - F * ndtr(-d1))
    intrinsic = np.where(is_call, np.maximum(F - K, 0), np.maximum(K - F, 0))
    return np.where(T <= 0, intrinsic, px)


# ----------------------------------------------------------------------------- data
def load_bars(path):
    import json

    raw = json.load(open(path))
    if isinstance(raw[0], dict):
        df = pd.DataFrame(raw).rename(columns={"date": "ts"})
    else:
        df = pd.DataFrame(raw, columns=["ts", "open", "high", "low", "close", "volume"])
    df["ts"] = pd.to_datetime(df["ts"].str.slice(0, 19))
    df["date"] = df["ts"].dt.strftime("%Y-%m-%d")
    df["min"] = df["ts"].dt.hour * 60 + df["ts"].dt.minute
    return df[["ts", "date", "min", "open", "high", "low", "close", "volume"]].reset_index(drop=True)


def split_days(df, min_bars=60):
    """Dict date -> dict of numpy arrays for full sessions only."""
    out = {}
    for d, g in df.groupby("date", sort=True):
        if len(g) < min_bars:
            continue
        out[d] = dict(min=g["min"].to_numpy(), o=g["open"].to_numpy(), h=g["high"].to_numpy(), l=g["low"].to_numpy(), c=g["close"].to_numpy())
    return out


def load_vix(path):
    import json

    v = pd.DataFrame(json.load(open(path)))
    v["date"] = v["date"].str.slice(0, 10)
    return v.set_index("date")["close"].to_dict()


def prev_close_vix(vix, dates):
    """IV for date d is the VIX close of the previous trading day: known before the open, no look-ahead."""
    ds = sorted(vix)
    out = {}
    j = -1
    for d in dates:
        while j + 1 < len(ds) and ds[j + 1] < d:
            j += 1
        if j >= 0:
            out[d] = vix[ds[j]] / 100.0
    return out


# ----------------------------------------------------------------------------- features / signals
def ema(x, n):
    return pd.Series(x).ewm(span=n, adjust=False).mean().to_numpy()


def build_series(days):
    """Chain all sessions into continuous arrays for EMAs/ATR (past-only recursions) and per-day offsets."""
    keys = sorted(days)
    cat = {k: np.concatenate([days[d][k] for d in keys]) for k in ("min", "o", "h", "l", "c")}
    sizes = [len(days[d]["c"]) for d in keys]
    starts = np.concatenate([[0], np.cumsum(sizes)])[:-1]
    cat["e9"], cat["e21"], cat["e50"] = ema(cat["c"], 9), ema(cat["c"], 21), ema(cat["c"], 50)
    rng = cat["h"] - cat["l"]
    cat["rng"] = rng
    cat["rng_ma20"] = pd.Series(rng).rolling(20, min_periods=20).mean().shift(1).to_numpy()  # excludes current bar
    return keys, cat, starts, sizes


@dataclass
class Signal:
    date: str
    i: int  # bar index within the day at whose close the signal is known
    direction: int  # +1 buy CE, -1 buy PE
    family: str


def _first_break(days, keys, cat, starts, sizes, level_fn, family, once=True, start_bar=3, end_bar=60, cooldown=0):
    sigs = []
    for k, d in enumerate(keys):
        s, n = starts[k], sizes[k]
        c = cat["c"][s : s + n]
        lv = level_fn(d, k, s, n)
        if lv is None:
            continue
        hi, lo = lv
        last = -999
        for i in range(start_bar, min(n - 3, end_bar)):
            if i - last <= cooldown:
                continue
            if c[i] > hi:
                sigs.append(Signal(d, i, 1, family))
                last = i
            elif c[i] < lo:
                sigs.append(Signal(d, i, -1, family))
                last = i
            else:
                continue
            if once:
                break
    return sigs


def gen_signals(days):
    keys, cat, starts, sizes = build_series(days)
    sigs = {}
    h, l, c, o = cat["h"], cat["l"], cat["c"], cat["o"]

    def day_slice(k):
        s, n = starts[k], sizes[k]
        return s, n

    # opening range (first 3 bars = 09:15-09:30), first close beyond it; one per day
    def orb_lv(d, k, s, n):
        return h[s : s + 3].max(), l[s : s + 3].min()

    sigs["ORB15"] = _first_break(days, keys, cat, starts, sizes, orb_lv, "ORB15")

    # previous-day high/low break (prior session only)
    def pd_lv(d, k, s, n):
        if k == 0:
            return None
        ps, pn = starts[k - 1], sizes[k - 1]
        return h[ps : ps + pn].max(), l[ps : ps + pn].min()

    sigs["PDHL"] = _first_break(days, keys, cat, starts, sizes, pd_lv, "PDHL", start_bar=1)

    # rolling 1h support/resistance (12-bar Donchian, excluding the current bar), up to 3 per day with cooldown
    out = []
    for k, d in enumerate(keys):
        s, n = day_slice(k)
        cnt, last = 0, -999
        for i in range(12, n - 3):
            if i - last <= 6 or cnt >= 3:
                continue
            hi, lo = h[s + i - 12 : s + i].max(), l[s + i - 12 : s + i].min()
            if c[s + i] > hi:
                out.append(Signal(d, i, 1, "SRBRK"))
                cnt += 1
                last = i
            elif c[s + i] < lo:
                out.append(Signal(d, i, -1, "SRBRK"))
                cnt += 1
                last = i
    sigs["SRBRK"] = out

    # session-average (VWAP proxy: indices carry no volume) cross and rejection
    cross, rej = [], []
    for k, d in enumerate(keys):
        s, n = day_slice(k)
        tp = (h[s : s + n] + l[s : s + n] + c[s : s + n]) / 3
        avg = np.cumsum(tp) / np.arange(1, n + 1)
        cc, cr, last_c, last_r = 0, 0, -999, -999
        for i in range(6, n - 3):
            ci, cp = c[s + i], c[s + i - 1]
            if cc < 3 and i - last_c > 6:
                if ci > avg[i] and cp <= avg[i - 1]:
                    cross.append(Signal(d, i, 1, "AVGCROSS")); cc += 1; last_c = i
                elif ci < avg[i] and cp >= avg[i - 1]:
                    cross.append(Signal(d, i, -1, "AVGCROSS")); cc += 1; last_c = i
            if cr < 3 and i - last_r > 6:
                if l[s + i] <= avg[i] < ci and cp > avg[i - 1]:
                    rej.append(Signal(d, i, 1, "AVGREJECT")); cr += 1; last_r = i
                elif h[s + i] >= avg[i] > ci and cp < avg[i - 1]:
                    rej.append(Signal(d, i, -1, "AVGREJECT")); cr += 1; last_r = i
    sigs["AVGCROSS"], sigs["AVGREJECT"] = cross, rej

    # EMA alignment (fresh 9>21>50 stack with close above the fast EMA) and trend pullback continuation
    ema_a, ema_p = [], []
    e9, e21, e50 = cat["e9"], cat["e21"], cat["e50"]
    for k, d in enumerate(keys):
        s, n = day_slice(k)
        ca, cp_, la, lp = 0, 0, -999, -999
        for i in range(2, n - 3):
            g = s + i
            up = e9[g] > e21[g] > e50[g]
            dn = e9[g] < e21[g] < e50[g]
            upp = e9[g - 1] > e21[g - 1] > e50[g - 1]
            dnp = e9[g - 1] < e21[g - 1] < e50[g - 1]
            if ca < 2 and i - la > 12:
                if up and not upp and c[g] > e9[g]:
                    ema_a.append(Signal(d, i, 1, "EMASTACK")); ca += 1; la = i
                elif dn and not dnp and c[g] < e9[g]:
                    ema_a.append(Signal(d, i, -1, "EMASTACK")); ca += 1; la = i
            if cp_ < 2 and i - lp > 12:
                if up and l[g] <= e21[g] and c[g] > e9[g]:
                    ema_p.append(Signal(d, i, 1, "TRENDPULL")); cp_ += 1; lp = i
                elif dn and h[g] >= e21[g] and c[g] < e9[g]:
                    ema_p.append(Signal(d, i, -1, "TRENDPULL")); cp_ += 1; lp = i
    sigs["EMASTACK"], sigs["TRENDPULL"] = ema_a, ema_p

    # momentum: 6-bar return beyond 1.5 x (6-bar sqrt-scaled mean range)
    mom = []
    for k, d in enumerate(keys):
        s, n = day_slice(k)
        cnt, last = 0, -999
        for i in range(6, n - 3):
            g = s + i
            m = cat["rng_ma20"][g]
            if np.isnan(m) or cnt >= 3 or i - last <= 12:
                continue
            r = c[g] - c[g - 6]
            if abs(r) > 1.5 * m * math.sqrt(6):
                mom.append(Signal(d, i, 1 if r > 0 else -1, "MOMENTUM")); cnt += 1; last = i
    sigs["MOMENTUM"] = mom

    # range expansion (index volume is zero, so range is the volume proxy): bar range > 2.2x mean, close in outer quarter
    vx = []
    for k, d in enumerate(keys):
        s, n = day_slice(k)
        cnt, last = 0, -999
        for i in range(3, n - 3):
            g = s + i
            m = cat["rng_ma20"][g]
            if np.isnan(m) or cnt >= 3 or i - last <= 12:
                continue
            rg = h[g] - l[g]
            if rg > 2.2 * m and rg > 0:
                pos = (c[g] - l[g]) / rg
                if pos >= 0.75:
                    vx.append(Signal(d, i, 1, "RANGEEXP")); cnt += 1; last = i
                elif pos <= 0.25:
                    vx.append(Signal(d, i, -1, "RANGEEXP")); cnt += 1; last = i
    sigs["RANGEEXP"] = vx

    # volatility squeeze release: 12-bar range in the lowest 25% of its trailing 5-day history, then a break of that box
    sq = []
    box = pd.Series(h).rolling(12).max().to_numpy() - pd.Series(l).rolling(12).min().to_numpy()
    for k, d in enumerate(keys):
        s, n = day_slice(k)
        cnt, last = 0, -999
        for i in range(12, n - 3):
            g = s + i
            hist = box[max(0, g - 5 * 75) : g - 1]
            hist = hist[~np.isnan(hist)]
            if len(hist) < 200 or cnt >= 2 or i - last <= 12:
                continue
            if box[g - 1] <= np.percentile(hist, 25):
                hi, lo = h[g - 12 : g].max(), l[g - 12 : g].min()
                if c[g] > hi:
                    sq.append(Signal(d, i, 1, "SQUEEZE")); cnt += 1; last = i
                elif c[g] < lo:
                    sq.append(Signal(d, i, -1, "SQUEEZE")); cnt += 1; last = i
    sigs["SQUEEZE"] = sq
    return sigs, (keys, cat, starts, sizes)


def day_regimes(days, vix_prev):
    """Per-day regime tags using only information available before that day's open."""
    keys = sorted(days)
    rows = []
    closes = {d: days[d]["c"][-1] for d in keys}
    ranges = {d: (days[d]["h"].max() - days[d]["l"].min()) / days[d]["c"][-1] for d in keys}
    first = {d: days[d]["o"][0] for d in keys}
    # trailing 250-day VIX percentile of the prior close
    vser = pd.Series({d: vix_prev.get(d, np.nan) for d in keys})
    pct = vser.rolling(250, min_periods=60).apply(lambda w: (w[:-1] < w[-1]).mean(), raw=True)
    for k, d in enumerate(keys):
        if k < 6:
            rows.append(dict(date=d, regime_vol="na", regime_trend="na", gap_pct=np.nan))
            continue
        p = keys[k - 1]
        gap = first[d] / closes[p] - 1
        # prior-day efficiency ratio (trend vs chop) from 5m bars
        pc = days[p]["c"]
        er = abs(pc[-1] - pc[0]) / max(np.abs(np.diff(pc)).sum(), 1e-9)
        # realised range of the last 5 sessions relative to the last 60
        r5 = np.mean([ranges[keys[j]] for j in range(k - 5, k)])
        r60 = np.mean([ranges[keys[j]] for j in range(max(0, k - 60), k)])
        rows.append(
            dict(
                date=d,
                regime_vol=("high" if (not np.isnan(pct.iloc[k]) and pct.iloc[k] >= 2 / 3) else "low" if (not np.isnan(pct.iloc[k]) and pct.iloc[k] <= 1 / 3) else "mid"),
                regime_trend=("trend" if er >= 0.08 else "chop"),
                gap_pct=gap,
                rv_ratio=r5 / r60 if r60 else np.nan,
            )
        )
    return pd.DataFrame(rows).set_index("date")


# ----------------------------------------------------------------------------- simulation
H_BARS = 45  # longest hold considered (3h45)


def _T_years(minute, dte_days):
    return np.maximum(dte_days + (SESSION_END_MIN - minute) / 1440.0, 0.0) / 365.0


def gather(sigs, days, vix_prev, delay=0, level_ref=None):
    """Collect, per signal, the scaled underlying bars from the fill bar onward (padded to H_BARS).

    Fill bar = signal bar + 1 + delay. Nothing at or before the signal bar's close beyond what produced the signal is used.
    """
    rows = []
    for sg in sigs:
        if sg.date not in vix_prev:
            continue
        dd = days[sg.date]
        j0 = sg.i + 1 + delay
        if j0 >= len(dd["c"]) - 1 or dd["min"][j0] >= FLAT_MIN:
            continue
        rows.append((sg, j0))
    n = len(rows)
    G = {k: np.full((n, H_BARS), np.nan) for k in ("o", "h", "l", "c", "min")}
    meta = []
    for r, (sg, j0) in enumerate(rows):
        dd = days[sg.date]
        scale = (level_ref or dd["o"][0]) / dd["o"][0]
        idx = np.arange(j0, min(j0 + H_BARS, len(dd["c"])))
        idx = idx[dd["min"][idx] <= FLAT_MIN]
        m = len(idx)
        for k in ("o", "h", "l", "c"):
            G[k][r, :m] = dd[k][idx] * scale
        G["min"][r, :m] = dd["min"][idx]
        meta.append(dict(date=sg.date, i=sg.i, direction=sg.direction, family=sg.family, iv=vix_prev[sg.date], scale=scale, nbars=m))
    return G, pd.DataFrame(meta)


def build_paths(G, meta, und, dte_days, offset, iv_factor=1.0, model="bs"):
    """Premium mid paths (vectorised). offset>0 is in-the-money by that many strike steps, <0 out-of-the-money.

    IV is the previous trading day's India VIX close x iv_factor, constant through the day (no intraday IV dynamics).
    """
    cfg = UNDERLYINGS[und] if und in UNDERLYINGS else dict(step=50)
    isc = (meta["direction"].to_numpy() == 1)
    S0 = G["o"][:, 0]
    atm = np.round(S0 / cfg["step"]) * cfg["step"]
    K = np.where(isc, atm - offset * cfg["step"], atm + offset * cfg["step"])[:, None]
    iv = (meta["iv"].to_numpy() * iv_factor)[:, None]
    mins = G["min"]
    Tb = _T_years(mins, dte_days)
    Te = _T_years(mins + 5, dte_days)
    ic = isc[:, None]
    f = (lambda S, T: black76(S, K, T, iv, ic)) if model == "b76" else (lambda S, T: bs_price(S, K, T, iv, ic))
    po, ph, pl, pc = f(G["o"], Tb), f(G["h"], Te), f(G["l"], Te), f(G["c"], Te)
    fav, adv = np.where(ic, ph, pl), np.where(ic, pl, ph)
    P = dict(o=po, fav=fav, adv=adv, c=pc)
    m = meta.copy()
    m["K"], m["S0"] = K[:, 0], S0
    return P, m


def exit_trades(P, meta, und, spread, stop, target, hold, venue=None, lot=None, tick=None, slip_ticks=1, qty_mult=1):
    """Apply the exit rule; return per-trade net rupees and diagnostics (DataFrame aligned to meta).

    Buyer pays ask = mid + half spread (+ slip) and sells at bid = mid - half spread (- slip).
    stop/target are fractions of the ENTRY MID premium on the mid path. A stop is tested before a target in a bar.
    Gaps through a level fill at the bar open (stop) or at the better open (target).
    """
    cfg = UNDERLYINGS.get(und, {})
    lot = lot or cfg["lot"]
    venue = venue or cfg["venue"]
    tick = tick or cfg.get("tick", 0.05)
    n, H = P["o"].shape
    sp = SPREADS[spread] if isinstance(spread, str) else spread
    nb = meta["nbars"].to_numpy()
    p0 = P["o"][:, 0]
    valid = (p0 > 0.5) & (nb >= 2)
    stop_lv = p0 * (1 - stop)
    tgt_lv = p0 * (1 + target)
    hold = min(hold, H)
    bars = np.arange(H)[None, :]
    inb = (bars < np.minimum(nb, hold)[:, None])
    pstop = np.where(inb, P["adv"], np.inf)
    ptgt = np.where(inb, P["fav"], -np.inf)
    hit_s = pstop <= stop_lv[:, None]
    hit_t = ptgt >= tgt_lv[:, None]
    BIG = H + 5
    js = np.where(hit_s.any(1), hit_s.argmax(1), BIG)
    jt = np.where(hit_t.any(1), hit_t.argmax(1), BIG)
    last = np.minimum(nb, hold) - 1
    last = np.maximum(last, 0)
    exit_j = np.minimum(np.minimum(js, jt), last)
    kind = np.where((js < BIG) & (js <= jt), "stop", np.where((jt < BIG), "target", "time"))
    rows = np.arange(n)
    open_at = P["o"][rows, exit_j]
    close_at = P["c"][rows, exit_j]
    exit_mid = np.where(
        kind == "stop",
        np.where(open_at <= stop_lv, open_at, stop_lv),
        np.where(kind == "target", np.where(open_at >= tgt_lv, open_at, tgt_lv), close_at),
    )
    half = np.maximum(sp * p0 / 2, tick / 2)
    half_x = np.maximum(sp * np.maximum(exit_mid, 0) / 2, tick / 2)
    entry = p0 + half + slip_ticks * tick
    exit_px = np.maximum(exit_mid - half_x - slip_ticks * tick, 0.0)
    qty = lot * qty_mult
    gross_mid = (exit_mid - p0) * qty
    paid = (exit_px - entry) * qty
    chg = np.where(valid, costs.options_round_trip(entry, exit_px, qty, venue), 0.0)
    net = paid - chg
    df = meta.copy()
    df["entry"], df["exit"], df["kind"], df["bars_held"] = entry, exit_px, kind, exit_j + 1
    df["gross_mid"], df["net"], df["charges"] = gross_mid, net, chg
    df["spread_cost"] = (gross_mid - paid)
    return df[valid].reset_index(drop=True)


# ----------------------------------------------------------------------------- metrics
def day_table(tr, max_per_day=None):
    t = tr.sort_values(["date", "i"])
    if max_per_day:
        t = t.groupby("date").head(max_per_day)
    return t.groupby("date")["net"].sum()


def max_drawdown(x):
    c = np.cumsum(x)
    peak = np.maximum.accumulate(np.concatenate([[0], c]))[1:]
    return float((peak - c).max()) if len(c) else 0.0


def longest_losing_streak(x):
    best = cur = 0
    for v in x:
        cur = cur + 1 if v < 0 else 0
        best = max(best, cur)
    return best


def summarize(tr, all_days=None, max_per_day=None, label=""):
    if len(tr) == 0:
        return dict(label=label, trades=0)
    t = tr.sort_values(["date", "i"])
    if max_per_day:
        t = t.groupby("date").head(max_per_day)
    net = t["net"].to_numpy()
    gross = t["gross_mid"].to_numpy()
    wins, losses = net[net > 0], net[net <= 0]
    daily = t.groupby("date")["net"].sum()
    nd = len(all_days) if all_days else len(daily)
    return dict(
        label=label,
        trades=len(net),
        days_traded=len(daily),
        trades_per_day=len(net) / max(nd, 1),
        gross_mid_per_trade=float(gross.mean()),
        net_per_trade=float(net.mean()),
        win_pct=float((net > 0).mean() * 100),
        avg_win=float(wins.mean()) if len(wins) else 0.0,
        avg_loss=float(losses.mean()) if len(losses) else 0.0,
        profit_factor=float(wins.sum() / -losses.sum()) if losses.sum() < 0 else float("inf"),
        net_total=float(net.sum()),
        net_per_calendar_day=float(net.sum() / max(nd, 1)),
        green_days_pct=float((daily > 0).mean() * 100),
        days_ge_350_pct=float((daily >= 350).mean() * 100),
        max_dd=max_drawdown(daily.to_numpy()),
        longest_loss_streak_trades=longest_losing_streak(net),
        charges_per_trade=float(t["charges"].mean()),
        spread_cost_per_trade=float(t["spread_cost"].mean()),
    )


def day_bootstrap_ci(tr, B=2000, seed=7, stat="mean"):
    """CI for mean net per trade, resampling DAYS (trades within a day are dependent)."""
    if len(tr) == 0:
        return (np.nan, np.nan)
    g = tr.groupby("date")["net"].agg(["sum", "count"])
    s, c = g["sum"].to_numpy(), g["count"].to_numpy()
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(g), size=(B, len(g)))
    m = s[idx].sum(1) / np.maximum(c[idx].sum(1), 1)
    return float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))


def chrono_split(dates, train=0.55, val=0.20, embargo=1):
    """Chronological split by trading day with `embargo` days dropped between segments."""
    ds = sorted(dates)
    n = len(ds)
    a, b = int(n * train), int(n * (train + val))
    return dict(train=ds[:a], val=ds[a + embargo : b], test=ds[b + embargo :])


# ----------------------------------------------------------------------------- futures comparison (1 lot)
FUT_SLIP_PTS = {"NIFTY": 0.5, "BANKNIFTY": 1.0, "SENSEX": 2.0, "CRUDEOILM": 1.0}  # per leg, points
FUT_LOT = {"NIFTY": 65, "BANKNIFTY": 30, "SENSEX": 20, "CRUDEOILM": 10}
FUT_VENUE = {"NIFTY": "NSE", "BANKNIFTY": "NSE", "SENSEX": "BSE", "CRUDEOILM": "MCX"}


def exit_futures(G, meta, und, stop_pct, target_pct, hold, slip_pts=None):
    """1 lot of the future on the same signals/paths. stop/target are % of the entry price; stop is tested before target."""
    slip = FUT_SLIP_PTS[und] if slip_pts is None else slip_pts
    qty = FUT_LOT[und]
    n, H = G["o"].shape
    d = meta["direction"].to_numpy().astype(float)
    nb = meta["nbars"].to_numpy()
    e0 = G["o"][:, 0]
    entry = e0 + d * slip
    fav = np.where(d[:, None] > 0, G["h"], G["l"])
    adv = np.where(d[:, None] > 0, G["l"], G["h"])
    stop_lv = e0 * (1 - d * stop_pct)
    tgt_lv = e0 * (1 + d * target_pct)
    hold = min(hold, H)
    inb = np.arange(H)[None, :] < np.minimum(nb, hold)[:, None]
    hit_s = inb & np.where(d[:, None] > 0, adv <= stop_lv[:, None], adv >= stop_lv[:, None])
    hit_t = inb & np.where(d[:, None] > 0, fav >= tgt_lv[:, None], fav <= tgt_lv[:, None])
    BIG = H + 5
    js = np.where(hit_s.any(1), hit_s.argmax(1), BIG)
    jt = np.where(hit_t.any(1), hit_t.argmax(1), BIG)
    last = np.maximum(np.minimum(nb, hold) - 1, 0)
    ej = np.minimum(np.minimum(js, jt), last)
    kind = np.where((js < BIG) & (js <= jt), "stop", np.where(jt < BIG, "target", "time"))
    rows = np.arange(n)
    op, cl = G["o"][rows, ej], G["c"][rows, ej]
    gap_stop = np.where(d > 0, op <= stop_lv, op >= stop_lv)
    gap_tgt = np.where(d > 0, op >= tgt_lv, op <= tgt_lv)
    exit_mid = np.where(kind == "stop", np.where(gap_stop, op, stop_lv), np.where(kind == "target", np.where(gap_tgt, op, tgt_lv), cl))
    exit_px = exit_mid - d * slip
    pnl = d * (exit_px - entry) * qty
    side = np.where(d > 0, 1, -1)
    chg = costs.futures_round_trip(entry, exit_px, qty, side, FUT_VENUE[und])
    df = meta.copy()
    df["net"], df["charges"], df["kind"] = pnl - chg, chg, kind
    df["gross_mid"] = d * (exit_mid - e0) * qty
    df["spread_cost"] = df["gross_mid"] - pnl
    ok = nb >= 2
    return df[ok].reset_index(drop=True)
