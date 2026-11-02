"""Fixed reference option trade (ATM, stop 40%, target 100%, hold 24 bars, base spread) by family x direction x regime.

Regimes use only information known before the open (see opt_core.day_regimes). Expiry vs non-expiry is the DTE choice:
DTE 0 is an expiry-day option, DTE>=1 is not. Output /tmp/optres/out/regimes.json.
"""
import json
import os

import numpy as np
import pandas as pd

import opt_core as oc
import opt_run as r

CFG = dict(stop=0.40, target=1.0, hold=24)


def cell(t):
    if len(t) < 15:
        return dict(n=int(len(t)), net=None)
    lo, hi = oc.day_bootstrap_ci(t, B=500)
    return dict(n=int(len(t)), net=float(t["net"].mean()), ci=[float(lo), float(hi)], win=float((t["net"] > 0).mean() * 100))


def main():
    out = {}
    for und in ("NIFTY", "BANKNIFTY", "SENSEX"):
        days, vprev, sigs = r.prepare(und)
        ds = sorted(d for d in days if d in vprev)
        reg = oc.day_regimes({d: days[d] for d in ds}, vprev)
        level_ref = days[ds[-1]]["c"][-1]
        res = {}
        for dte in ([0, 1, 3] if und != "BANKNIFTY" else [3, 10, 20]):
            for fam, lst in sigs.items():
                G, meta = oc.gather(lst, days, vprev, delay=0, level_ref=level_ref)
                P, m = oc.build_paths(G, meta, und, dte, 0)
                tr = oc.exit_trades(P, m, und, "base", **CFG).join(reg[["regime_vol", "regime_trend"]], on="date")
                key = f"{fam}|dte{dte}"
                res[key] = dict(
                    ALL=cell(tr),
                    CE=cell(tr[tr["direction"] == 1]),
                    PE=cell(tr[tr["direction"] == -1]),
                    **{f"vol_{v}": cell(tr[tr["regime_vol"] == v]) for v in ("low", "mid", "high")},
                    **{f"trend_{v}": cell(tr[tr["regime_trend"] == v]) for v in ("trend", "chop")},
                )
        out[und] = res
        print(und, "ok", flush=True)
    json.dump(out, open(os.path.join(r.OUT, "regimes.json"), "w"), indent=1, default=float)


if __name__ == "__main__":
    main()
