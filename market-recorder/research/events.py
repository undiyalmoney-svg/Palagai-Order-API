"""Breakout events, go/trap labels and as-of features.

Rules that keep this leak-free:
  * an event is the first CLOSE beyond a level, so it is only known at the close of candle i
  * every feature uses bars <= i (and snapshots whose key is <= the decision cutoff)
  * the trade enters at the OPEN of bar i+1+delay
  * labels use only bars after entry, windows never cross a session end
Definitions are the original ones (opening-15-minute high/low, previous-day high/low).
"""
import sqlite3
import numpy as np
import pandas as pd

TOKENS = {"nifty": 256265, "bank": 260105}
WINDOW = 60
TARGET = {"nifty": 10.0, "bank": 17.0}
LAST_EVENT_MIN = 14 * 60 + 30
LEVELS = {"orh": 0, "orl": 1, "pdh": 2, "pdl": 3}


def load_bars(db, token, interval="minute"):
    df = pd.read_sql_query(
        "select ts, open, high, low, close, volume, oi from hist_bars where token=? and interval=? order by ts",
        db, params=(token, interval))
    df["ts"] = pd.to_datetime(df["ts"])
    df["date"] = df["ts"].dt.strftime("%Y-%m-%d")
    df["hm"] = df["ts"].dt.hour * 60 + df["ts"].dt.minute
    return df


def front_future(db, name, date):
    """Futures token to use on `date`: the nearest expiry that has bars that day (a rule known at the time)."""
    rows = db.execute(
        "select i.token, i.expiry from instruments i where i.kind='FUT' and i.underlying=? order by i.expiry",
        (name.upper() if name == "nifty" else "BANKNIFTY",)).fetchall()
    for tok, exp in rows:
        if exp >= date:
            n = db.execute("select count(*) from hist_bars where token=? and interval='minute' and ts like ?", (tok, date + "%")).fetchone()[0]
            if n > 300:
                return tok, exp
    return None, None


def outcomes(o, h, l, c, i, d, T, S, n_after=WINDOW, delay=0):
    """Entry at open of bar i+1+delay. Returns (pts_gross, kind). Conservative: same-bar target+stop counts as stop."""
    j0 = i + 1 + delay
    if j0 >= len(o):
        return None
    e = o[j0]
    end = min(j0 + n_after, len(o))
    for j in range(j0, end):
        hit_t = (h[j] - e >= T) if d == 1 else (e - l[j] >= T)
        hit_s = (e - l[j] >= S) if d == 1 else (h[j] - e >= S)
        if hit_s:
            return -S, "stop"
        if hit_t:
            return T, "target"
    last = c[end - 1]
    return d * (last - e), "timeout"


def build(db, name, other, stops=(0.5, 1.0), delay=0, start="2026-04-01"):
    bars = load_bars(db, TOKENS[name])
    obars = load_bars(db, TOKENS[other])
    vix = pd.read_sql_query("select ts, close from hist_bars where token=264969 and interval='day'", db)
    vix["date"] = pd.to_datetime(vix["ts"]).dt.strftime("%Y-%m-%d")
    vixmap = dict(zip(vix["date"], vix["close"]))
    days = [d for d in bars["date"].unique() if d >= start]
    all_dates = list(bars["date"].unique())
    obymap = {d: g.reset_index(drop=True) for d, g in obars.groupby("date")}
    T = TARGET[name]
    rows = []
    for d in days:
        g = bars[bars["date"] == d].reset_index(drop=True)
        if len(g) < 300 or d not in obymap:
            continue
        idx = all_dates.index(d)
        if idx == 0:
            continue
        pg = bars[bars["date"] == all_dates[idx - 1]]
        pdh, pdl, pdc = pg["high"].max(), pg["low"].min(), pg["close"].iloc[-1]
        pdr = float(np.sign(pg["close"].iloc[-1] - pg["open"].iloc[0]))
        o, h, l, c, hm = g["open"].values, g["high"].values, g["low"].values, g["close"].values, g["hm"].values
        og = obymap[d]
        oc = og["close"].values if len(og) == len(g) else None
        orh, orl = h[:15].max(), l[:15].min()
        runh, runl = np.maximum.accumulate(h), np.minimum.accumulate(l)
        levels = {"orh": orh, "orl": orl, "pdh": pdh, "pdl": pdl}
        fired = {}
        ftok, fexp = front_future(db, name, d)
        fg = None
        if ftok:
            fb = pd.read_sql_query("select ts, open, high, low, close, volume, oi from hist_bars where token=? and interval='minute' and ts like ? order by ts", db, params=(ftok, d + "%"))
            fb["ts"] = pd.to_datetime(fb["ts"])
            fg = g[["ts"]].merge(fb, on="ts", how="left")
        for i in range(16, len(g) - WINDOW - 2 - delay):
            if hm[i] >= LAST_EVENT_MIN:
                break
            for nm, lv in levels.items():
                up = nm in ("orh", "pdh")
                crossed = (c[i] > lv and c[i - 1] <= lv) if up else (c[i] < lv and c[i - 1] >= lv)
                if not crossed or fired.get(nm, 0) >= 2:
                    continue
                dr = 1 if up else -1
                fired[nm] = fired.get(nm, 0) + 1
                rng = max(h[i] - l[i], 1e-9)
                f = dict(date=d, ts=g["ts"].iloc[i], name=name, hm=int(hm[i]), lvl=LEVELS[nm], dir=dr,
                         body=dr * (c[i] - o[i]), brng=rng, loc=((c[i] - l[i]) / rng) if dr == 1 else ((h[i] - c[i]) / rng),
                         over=dr * (c[i] - lv), sp5=dr * (c[i] - c[i - 5]), sp15=dr * (c[i] - c[i - 15]), sp30=dr * (c[i] - c[max(0, i - 30)]),
                         comp=h[max(0, i - 30):i].max() - l[max(0, i - 30):i].min(), orw=orh - orl,
                         gapal=dr * (o[0] - pdc), dopen=dr * (c[i] - o[0]), drng=runh[i] - runl[i], nprev=fired[nm] - 1,
                         oth=dr * (oc[i] - oc[max(0, i - 15)]) if oc is not None else np.nan,
                         oth5=dr * (oc[i] - oc[i - 5]) if oc is not None else np.nan,
                         pdr=pdr, vix=vixmap.get(d, np.nan), wd=pd.Timestamp(d).weekday(), entry_px=o[i + 1 + delay])
                for sx in stops:
                    pts, kind = outcomes(o, h, l, c, i, dr, T, T * sx, delay=delay)
                    f[f"pts_{sx}"] = pts
                    f[f"kind_{sx}"] = kind
                if fg is not None:
                    f.update(futures_features(fg, i, dr, c))
                rows.append(f)
    return pd.DataFrame(rows)


def futures_features(fg, i, dr, spot):
    """Futures volume / OI / basis as known at the close of bar i (bars <= i only). `spot` is the index close series."""
    v = fg["volume"].values.astype(float)
    oi = fg["oi"].values.astype(float)
    fc = fg["close"].values.astype(float)
    if np.isnan(fc[i]) or np.isnan(fc[i - 30]) or np.isnan(oi[i]):
        return {}
    out = {}
    base = v[max(0, i - 60):i]
    base_mean = np.nanmean(base) if len(base) else np.nan
    ok = bool(base_mean and base_mean > 0)
    out["fvol1_rel"] = v[i] / base_mean if ok else np.nan
    for k in (5, 15):
        out[f"fvol{k}_rel"] = np.nansum(v[i - k + 1:i + 1]) / (base_mean * k) if ok else np.nan
    for k in (5, 15, 30):
        d_oi = oi[i] - oi[i - k]
        out[f"foi{k}"] = d_oi
        out[f"foi{k}_pct"] = d_oi / oi[i - k] if oi[i - k] else np.nan
    dp15 = dr * (fc[i] - fc[i - 15])
    d_oi15 = oi[i] - oi[i - 15]
    out["pxoi_build"] = float(np.sign(dp15) * np.sign(d_oi15))
    out["oi_up"] = float(d_oi15 > 0)
    out["basis"] = fc[i] - spot[i]
    out["basis_chg15"] = (fc[i] - spot[i]) - (fc[i - 15] - spot[i - 15])
    out["fut_vs_spot5"] = dr * ((fc[i] - fc[i - 5]) - (spot[i] - spot[i - 5]))
    return out
