"""Fixed, untuned comparison of the pre-registered MOMENTUM entry against the Paper test desk's entry families.

    OPT_DATA=/tmp/optres2 python3 momentum_check.py [NIFTY SENSEX BANKNIFTY]

Every family uses the SAME exit (ATM, stop 40%, target 100%, 24-bar time exit, fill at the next bar open, base
spread, exact charges, 1 lot at today's lot size). Nothing here is selected on the data it reports: the exit is the
reference trade fixed in OPTIONS-BUYING-RESEARCH.md (2026-11-02). "new" = sessions after that study's data ended
(2026-10-30), i.e. the only days nothing was chosen on. MOMENTUM_FLIP is the same entry times with the direction
reversed: if it earns as much, the result is a timing/volatility effect, not direction skill. Modelled premiums
(previous-day VIX, flat IV); see the study's limitations. Research only: no order is placed.
"""
import json
import os
import sys

import numpy as np

import opt_core as oc
import opt_run

STUDY_END = "2026-10-30"
FAMILIES = ["MOMENTUM", "MOMENTUM_FLIP", "PDHL", "ORB15", "AVGREJECT", "AVGCROSS", "SRBRK", "RANDOM"]
DTES = {"NIFTY": [1, 3, 6], "SENSEX": [1, 3, 6], "BANKNIFTY": [3, 10]}
REF = dict(stop=0.40, target=1.00, hold=24)


def flip(sigs):
    return [oc.Signal(s.date, s.i, -s.direction, "MOMENTUM_FLIP") for s in sigs]


def segments(days):
    split = oc.chrono_split([d for d in days if d <= STUDY_END])
    seg = {d: k for k in ("train", "val", "test") for d in split[k]}
    for d in days:
        if d > STUDY_END:
            seg[d] = "new"
    return seg


def run(und):
    days, vprev, sigs = opt_run.prepare(und)
    sigs["MOMENTUM_FLIP"] = flip(sigs["MOMENTUM"])
    seg = segments(days)
    level_ref = days[sorted(days)[-1]]["o"][0]
    out = []
    for fam in FAMILIES:
        G, meta = oc.gather(sigs[fam], days, vprev, delay=0, level_ref=level_ref)
        for dte in DTES[und]:
            P, m = oc.build_paths(G, meta, und, dte, 0)
            tr = oc.exit_trades(P, m, und, "base", REF["stop"], REF["target"], REF["hold"])
            tr["seg"] = tr["date"].map(seg)
            row = dict(und=und, family=fam, dte=dte)
            for k in ("train", "val", "test", "new", "all"):
                t = tr if k == "all" else tr[tr["seg"] == k]
                lo, hi = oc.day_bootstrap_ci(t) if len(t) >= 20 else (np.nan, np.nan)
                row[k] = dict(n=int(len(t)), per_trade=round(float(t["net"].mean()), 1) if len(t) else None,
                              total=round(float(t["net"].sum())), win=round(float((t["net"] > 0).mean() * 100), 1) if len(t) else None,
                              ci=[round(lo), round(hi)] if not np.isnan(lo) else None)
            q = tr.assign(q=tr["date"].str.slice(0, 4) + "Q" + ((tr["date"].str.slice(5, 7).astype(int) - 1) // 3 + 1).astype(str))
            qs = q.groupby("q")["net"].mean()
            row["quarters_positive"] = f"{int((qs > 0).sum())}/{len(qs)}"
            daily = tr.groupby("date")["net"].sum()
            row["worst_day"] = round(float(daily.min())) if len(daily) else None
            row["losing_day_pct"] = round(float((daily < 0).mean() * 100), 1) if len(daily) else None
            row["max_dd"] = round(oc.max_drawdown(daily.to_numpy())) if len(daily) else None
            out.append(row)
            if fam in ("MOMENTUM", "MOMENTUM_FLIP") or dte == DTES[und][1]:
                print(und, fam, f"DTE{dte}", {k: (row[k]["n"], row[k]["per_trade"], row[k]["ci"]) for k in ("train", "val", "test", "new")},
                      "q+", row["quarters_positive"], flush=True)
    return out


if __name__ == "__main__":
    unds = sys.argv[1:] or ["NIFTY", "SENSEX", "BANKNIFTY"]
    res = [r for u in unds for r in run(u)]
    path = os.path.join(os.environ.get("OPT_OUT", "/tmp/optres2"), "momentum-check.json")
    json.dump(res, open(path, "w"), indent=1)
    print("wrote", path)
