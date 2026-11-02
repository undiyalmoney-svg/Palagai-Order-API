"""Tier-2: real option premiums (Kite 5-minute candles of contracts listed today) versus the Tier-1 model.

    python3 opt_tier2.py          # needs /tmp/optres/listed-5m-oi.json from fetch_history.py

1. Calibration: implied IV from real premium vs the previous-day India VIX used by Tier-1; model-vs-real premium ratio.
2. Replay: the same signals, but entry/exit premiums come from the real contract's own candles.
   Real candles are traded prices (no bid/ask), so the same spread scenarios are applied on top: the spread stays UNVALIDATED
   until the recorder has collected live books for NSE/BSE options.
"""
import json
import os
import sys

import numpy as np
import pandas as pd
from scipy.optimize import brentq

import opt_core as oc
import opt_run as r

LISTED = os.environ.get("OPT_LISTED", "/tmp/optres/listed-5m-oi.json")


def load_listed():
    raw = json.load(open(LISTED))
    out = {}
    for sym, v in raw.items():
        if not v["candles"]:
            continue
        a = np.array([[pd.Timestamp(c[0][:19]).value // 60_000_000_000, c[1], c[2], c[3], c[4], c[5], (c[6] if len(c) > 6 else np.nan)] for c in v["candles"]], float)
        v = dict(v)
        v["kind"] = v.get("kind") or v.get("type")
        v["arr"] = a  # minute-epoch(naive IST), o,h,l,c,vol,oi
        out[sym] = v
    return out


def _epoch_min(date, minute):
    return pd.Timestamp(date).value // 60_000_000_000 + minute


def implied_iv(price, S, K, T, is_call):
    if price <= 0 or T <= 0:
        return np.nan
    intrinsic = max(S - K, 0) if is_call else max(K - S, 0)
    if price <= intrinsic + 1e-6:
        return np.nan
    f = lambda v: float(oc.bs_price(S, K, T, v, is_call)) - price
    try:
        return brentq(f, 0.01, 3.0)
    except ValueError:
        return np.nan


def calibration(listed, und_days, vprev, und):
    rows = []
    for sym, v in listed.items():
        if v["name"] != und or v["kind"] not in ("CE", "PE"):
            continue
        days = und_days
        exp = pd.Timestamp(v["expiry"])
        for d, dd in days.items():
            if d not in vprev:
                continue
            t0 = _epoch_min(d, 0)
            idx = {int(t): k for k, t in enumerate(v["arr"][:, 0])}
            for j in range(0, len(dd["c"]), 3):  # every 15 minutes is plenty
                tm = int(t0 + dd["min"][j])
                k = idx.get(tm)
                if k is None:
                    continue
                o, h, l, c, vol = v["arr"][k, 1:6]
                if vol <= 0:
                    continue
                S = dd["c"][j]
                T = ((exp - pd.Timestamp(d)).days + (oc.SESSION_END_MIN - (dd["min"][j] + 5)) / 1440.0) / 365.0
                if T <= 0:
                    continue
                ivr = implied_iv(c, S, v["strike"], T, v["kind"] == "CE")
                model = float(oc.bs_price(S, v["strike"], T, vprev[d], v["kind"] == "CE"))
                rows.append(dict(sym=sym, date=d, kind=v["kind"], dte=(exp - pd.Timestamp(d)).days, moneyness=(S / v["strike"] - 1) * (1 if v["kind"] == "CE" else -1) * 100, real=c, model=model, iv_real=ivr, iv_vix=vprev[d], vol=vol))
    return pd.DataFrame(rows)


def replay(listed, und, days, vprev, sigs_by_family, cfgs, spreads=("tight", "base", "wide")):
    """Real-premium replay. One row per (family, config, spread) with summary over all real trades available."""
    cfgd = oc.UNDERLYINGS[und]
    by_exp = {}
    for sym, v in listed.items():
        if v["name"] == und and v["kind"] in ("CE", "PE"):
            by_exp.setdefault(v["expiry"], {}).setdefault((v["kind"], v["strike"]), v)
    exps = sorted(by_exp)
    first_day = min(min(v["arr"][:, 0]) for v in listed.values() if v["name"] == und)
    out = []
    trades_all = {}
    for fam, sigs in sigs_by_family.items():
        H = oc.H_BARS
        mats, meta = [], []
        for sg in sigs:
            d = sg.date
            dd = days[d]
            t0 = _epoch_min(d, 0)
            j0 = sg.i + 1
            if j0 >= len(dd["c"]) - 1 or dd["min"][j0] >= oc.FLAT_MIN or t0 + dd["min"][j0] < first_day:
                continue
            expiry = next((e for e in exps if e >= d), None)
            if expiry is None:
                continue
            S0 = dd["o"][j0]
            K = round(S0 / cfgd["step"]) * cfgd["step"]
            kind = "CE" if sg.direction == 1 else "PE"
            v = by_exp[expiry].get((kind, float(K)))
            if v is None:
                continue
            arr = v["arr"]
            idx = {int(t): k for k, t in enumerate(arr[:, 0])}
            ks = [idx.get(int(t0 + dd["min"][j])) for j in range(j0, min(j0 + H, len(dd["c"]))) if dd["min"][j] <= oc.FLAT_MIN]
            if not ks or ks[0] is None or any(k is None for k in ks):
                continue
            seg = arr[ks]
            m = len(ks)
            M = np.full((H, 4), np.nan)
            M[:m] = seg[:, 1:5]
            entry_vol = seg[0, 5]
            mats.append(M)
            meta.append(dict(date=d, i=sg.i, direction=sg.direction, family=fam, nbars=m, K=K, expiry=expiry, entry_vol=entry_vol, S0=S0))
        if not mats:
            continue
        A = np.stack(mats)
        P = dict(o=A[:, :, 0], fav=A[:, :, 1], adv=A[:, :, 2], c=A[:, :, 3])
        mdf = pd.DataFrame(meta)
        for cfg in cfgs:
            for sp in spreads:
                tr = oc.exit_trades(P, mdf, und, sp, cfg["stop"], cfg["target"], cfg["hold"])
                s = oc.summarize(tr, label=f"{fam}|{sp}")
                s.update(family=fam, spread=sp, **cfg)
                lo, hi = oc.day_bootstrap_ci(tr)
                s["ci_lo"], s["ci_hi"] = lo, hi
                out.append(s)
                trades_all[(fam, sp, cfg["stop"], cfg["target"], cfg["hold"])] = tr
    return pd.DataFrame(out), trades_all


def main():
    listed = load_listed()
    res = {}
    for und in ("NIFTY", "BANKNIFTY", "SENSEX"):
        days, vprev, sigs = r.prepare(und)
        cal = calibration(listed, days, vprev, und)
        cal.to_pickle(os.path.join(r.OUT, f"calib-{und}.pkl"))
        cfgs = [dict(stop=s, target=t, hold=h) for s in (0.25, 0.40) for t in (0.6, 1.0) for h in (12, 24, 45)]
        rp, _ = replay(listed, und, days, vprev, {k: v for k, v in sigs.items()}, cfgs)
        rp.to_pickle(os.path.join(r.OUT, f"replay-{und}.pkl"))
        print(und, "calib rows", len(cal), "replay rows", len(rp), flush=True)


if __name__ == "__main__":
    main()


def fidelity(und, cfg=dict(stop=0.40, target=1.0, hold=24)):
    """Per-trade comparison of Tier-1 modelled P&L with the real-premium replay on the same signals, strikes and expiries."""
    listed = {k: v for k, v in load_listed().items() if v["name"] == und}
    days, vprev, sigs = r.prepare(und)
    rows = []
    for fam in ("ORB15", "SRBRK", "AVGCROSS", "AVGREJECT", "TRENDPULL", "SQUEEZE", "EMASTACK", "MOMENTUM", "PDHL", "RANGEEXP"):
        rp, trades = replay(listed, und, days, vprev, {fam: sigs[fam]}, [cfg], spreads=("base",))
        key = (fam, "base", cfg["stop"], cfg["target"], cfg["hold"])
        if key not in trades:
            continue
        real = trades[key]
        for dte, grp in real.assign(dte=lambda x: (pd.to_datetime(x["expiry"]) - pd.to_datetime(x["date"])).dt.days).groupby("dte"):
            want = {(d, i) for d, i in zip(grp["date"], grp["i"])}
            sub = [s for s in sigs[fam] if (s.date, s.i) in want]
            G, meta = oc.gather(sub, days, vprev, delay=0, level_ref=None)
            P, m = oc.build_paths(G, meta, und, int(dte), 0)
            model = oc.exit_trades(P, m, und, "base", cfg["stop"], cfg["target"], cfg["hold"])
            j = grp.merge(model[["date", "i", "net", "gross_mid", "kind"]], on=["date", "i"], suffixes=("_real", "_model"))
            j["dte"], j["family"] = dte, fam
            rows.append(j)
    if not rows:
        return None
    return pd.concat(rows, ignore_index=True)
