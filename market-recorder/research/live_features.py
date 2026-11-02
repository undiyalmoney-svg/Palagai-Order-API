"""As-of options / futures-book features from the recorder's `quotes` table.

Cutoff rule: a snapshot with minute_key K was fetched at K:03. For an event on 1-minute candle labelled T
(closing at T+1:00), a trade entering at the open of bar T+1+delay may only use snapshots with
minute_key <= T + delay minutes. delay=0 therefore uses the snapshot taken 57 seconds BEFORE the close of the
breakout candle, delay=1 uses the snapshot taken 3 seconds AFTER it and enters one bar later.
"""
import numpy as np
import pandas as pd

LOOKBACK_MIN = 40


def load_quotes(db):
    q = pd.read_sql_query(
        """select q.*, i.underlying, i.kind, i.expiry, i.strike from quotes q join instruments i on i.token = q.token""", db)
    q["key_ts"] = pd.to_datetime(q["minute_key"])
    return q.sort_values(["key_ts", "token"]).reset_index(drop=True)


def _mid(df):
    m = (df["bid1"] + df["ask1"]) / 2
    return m.where((df["bid1"] > 0) & (df["ask1"] > 0), df["ltp"])


def features(q, name, event_ts, dr, delay=0):
    cutoff = pd.Timestamp(event_ts).floor("min") + pd.Timedelta(minutes=delay)
    w = q[q["underlying"] == ("NIFTY" if name == "nifty" else "BANKNIFTY")]
    w = w[(w["key_ts"] <= cutoff) & (w["key_ts"] > cutoff - pd.Timedelta(minutes=LOOKBACK_MIN))]
    out = {}
    if w.empty or w["key_ts"].max() < cutoff - pd.Timedelta(minutes=2):
        return out
    fut = w[w["kind"] == "FUT"]
    if len(fut):
        front = fut[fut["expiry"] == fut["expiry"].min()].sort_values("key_ts")
        last = front.iloc[-1]
        tot = (last["bid5_qty"] or 0) + (last["ask5_qty"] or 0)
        out["fbook_imb"] = dr * (last["bid5_qty"] - last["ask5_qty"]) / tot if tot else np.nan
        out["fspread"] = last["ask1"] - last["bid1"] if last["bid1"] and last["ask1"] else np.nan
        out["fbook_l1_imb"] = dr * (last["bid1_qty"] - last["ask1_qty"]) / max(last["bid1_qty"] + last["ask1_qty"], 1)
        vd = front["vol_delta"].astype(float)
        base = vd.iloc[:-5].mean() if len(vd) > 8 else np.nan
        out["fvol5_live_rel"] = vd.iloc[-5:].sum() / (base * 5) if base and base > 0 else np.nan
        out["foi15_live"] = front["oi_delta"].iloc[-15:].sum()
        spot = w[w["kind"] == "SPOT"].sort_values("key_ts")
        if len(spot) >= 16 and len(front) >= 16:
            prem = front["ltp"].values[-1] - spot["ltp"].values[-1]
            prem0 = front["ltp"].values[-16] - spot["ltp"].values[-16]
            out["fprem"] = prem
            out["fprem_chg15"] = prem - prem0
    opt = w[w["kind"].isin(["CE", "PE"])]
    if len(opt):
        near = opt[opt["expiry"] == opt["expiry"].min()]
        atm = near[near["rel_strike"] == 0]
        ce = atm[atm["kind"] == "CE"].sort_values("key_ts")
        pe = atm[atm["kind"] == "PE"].sort_values("key_ts")
        if len(ce) >= 6 and len(pe) >= 6:
            cv, pv = ce["vol_delta"].iloc[-5:].sum(), pe["vol_delta"].iloc[-5:].sum()
            out["ce_pe_vol_imb"] = dr * (cv - pv) / (cv + pv) if (cv + pv) > 0 else np.nan
            straddle = _mid(ce).values + _mid(pe).values[: len(ce)] if len(ce) == len(pe) else np.nan
            if isinstance(straddle, np.ndarray) and len(straddle) >= 6:
                out["straddle_chg5"] = straddle[-1] / straddle[-6] - 1
            conf = ce if dr == 1 else pe
            m = _mid(conf).values
            out["confirm_prem_chg5"] = m[-1] / m[-6] - 1 if m[-6] else np.nan
            ivc = ce["iv_calc"].values[-1], ce["iv_calc"].values[-6], pe["iv_calc"].values[-1], pe["iv_calc"].values[-6]
            if not any(pd.isna(v) for v in ivc):
                out["iv_chg5"] = (ivc[0] + ivc[2]) / 2 - (ivc[1] + ivc[3]) / 2
                out["iv_level"] = (ivc[0] + ivc[2]) / 2
            ce_oi = ce["oi_delta"].iloc[-15:].sum()
            pe_oi = pe["oi_delta"].iloc[-15:].sum()
            out["oi_chg_pe_minus_ce"] = dr * (pe_oi - ce_oi) / max(abs(pe_oi) + abs(ce_oi), 1)
        g = near.groupby(["key_ts", "rel_strike"])["vol_delta"].sum().unstack("rel_strike")
        if len(g) >= 10:
            recent = g.iloc[-3:].sum()
            base = g.iloc[:-3]
            z = (recent - base.mean() * 3) / (base.std().replace(0, np.nan) * np.sqrt(3))
            out["strike_vol_maxz"] = float(z.max())
            out["strike_vol_maxz_rel"] = float(z.idxmax()) * dr if z.notna().any() else np.nan
        near_all = near.sort_values("key_ts").groupby(["key_ts", "kind"]).agg(oi=("oi", "sum")).reset_index()
        last_k = near_all["key_ts"].max()
        cur = near_all[near_all["key_ts"] == last_k].set_index("kind")["oi"]
        if "CE" in cur and "PE" in cur and cur["CE"] > 0:
            out["pcr_oi"] = cur["PE"] / cur["CE"]
    return out


def add_live_features(df, q, name, delay=0):
    rows = [features(q, name, r.ts, r.dir, delay) for r in df.itertuples()]
    return pd.concat([df.reset_index(drop=True), pd.DataFrame(rows)], axis=1)
