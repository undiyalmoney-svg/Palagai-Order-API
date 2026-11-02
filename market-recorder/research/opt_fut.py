"""1-lot futures on the same signals and the same train/validation/test protocol, for the options-vs-futures comparison.

    python3 opt_fut.py -> /tmp/optres/out/fut-report.json
"""
import itertools
import json
import os

import numpy as np
import pandas as pd

import opt_core as oc
import opt_run as r

STOPS = [0.0015, 0.0025, 0.004]
TARGETS = [0.003, 0.005, 0.008]
HOLDS = [12, 24, 45]


def main():
    out = {}
    for und in ("NIFTY", "BANKNIFTY", "SENSEX"):
        days, vprev, sigs = r.prepare(und)
        ds = sorted(d for d in days if d in vprev)
        split = oc.chrono_split(ds)
        level_ref = days[ds[-1]]["c"][-1]
        recs = []
        for fam, lst in sigs.items():
            for delay in r.DELAYS:
                G, meta = oc.gather(lst, days, vprev, delay=delay, level_ref=level_ref)
                for stop, tgt, hold in itertools.product(STOPS, TARGETS, HOLDS):
                    tr = oc.exit_futures(G, meta, und, stop, tgt, hold)
                    sg = r.segment_of(tr["date"], split)
                    net = tr["net"].to_numpy()
                    row = dict(family=fam, delay=delay, stop=stop, target=tgt, hold=hold)
                    for k in ("train", "val", "test"):
                        mk = sg == k
                        row[f"n_{k}"] = int(mk.sum())
                        row[f"mean_{k}"] = float(net[mk].mean()) if mk.any() else np.nan
                        row[f"gross_{k}"] = float(tr["gross_mid_per_trade" if False else "gross_mid"].to_numpy()[mk].mean()) if mk.any() else np.nan
                    recs.append(row)
        g = pd.DataFrame(recs)
        gg = g[g["family"] != "RANDOM"]
        cand = gg[(gg["n_train"] >= r.MIN_TRAIN_TRADES) & (gg["mean_train"] > 0)]
        pick = cand[cand["n_val"] >= r.MIN_VAL_TRADES].sort_values("mean_val", ascending=False).head(1)
        res = dict(
            configs=len(gg),
            median={k: float(gg[gg[f"n_{k}"] >= 60][f"mean_{k}"].median()) for k in ("train", "val", "test")},
            pct_positive={k: float((gg[gg[f"n_{k}"] >= 60][f"mean_{k}"] > 0).mean() * 100) for k in ("train", "val", "test")},
            median_gross={k: float(gg[gg[f"n_{k}"] >= 60][f"gross_{k}"].median()) for k in ("train", "val", "test")},
            train_positive=int(len(cand)),
            picked=None,
        )
        if len(pick):
            c = pick.iloc[0]
            G, meta = oc.gather(sigs[c["family"]], days, vprev, delay=int(c["delay"]), level_ref=level_ref)
            tr = oc.exit_futures(G, meta, und, c["stop"], c["target"], int(c["hold"]))
            sg = r.segment_of(tr["date"], split)
            ev = {}
            for k in ("train", "val", "test"):
                t = tr[sg == k]
                s = oc.summarize(t, all_days=split[k])
                s["ci95_net_per_trade"] = list(oc.day_bootstrap_ci(t))
                ev[k] = s
            res["picked"] = dict(cfg={k: (c[k].item() if hasattr(c[k], "item") else c[k]) for k in ("family", "delay", "stop", "target", "hold")}, eval=ev)
        out[und] = res
        print(und, "done", flush=True)
    json.dump(out, open(os.path.join(r.OUT, "fut-report.json"), "w"), indent=1, default=float)


if __name__ == "__main__":
    main()
