"""Selection-adjusted null: repeat the WHOLE grid + selection pipeline with every signal's direction randomised.

Entry times, conditions, strikes, exits, spreads and charges are unchanged, so any option convexity or time-of-day effect stays
in the null; only directional information is destroyed. The distribution of the picked configuration's TEST expectancy under this
null is what an honest test result must be compared with (the picked config is the best of thousands, so ~0 is not the null).

    python3 opt_null.py NIFTY 40
"""
import contextlib
import io
import os
import sys

import numpy as np
import pandas as pd

import opt_core as oc
import opt_run as r


def flip(sigs, seed):
    rng = np.random.default_rng(seed)
    out = {}
    for fam, lst in sigs.items():
        if fam == "RANDOM":
            continue
        out[fam] = [oc.Signal(s.date, s.i, int(rng.choice([-1, 1])), s.family) for s in lst]
    return out


def main():
    und, n = sys.argv[1], int(sys.argv[2])
    days, vprev, sigs = r.prepare(und)
    ds = sorted(d for d in days if d in vprev)
    split = oc.chrono_split(ds)
    level_ref = days[ds[-1]]["c"][-1]
    rows = []
    for seed in range(n):
        with contextlib.redirect_stdout(io.StringIO()):
            grid = r.run_grid(und, days, vprev, flip(sigs, 1000 + seed), split, level_ref)
        ch = r.choose(grid)
        for (u, sname), v in ch.items():
            for lab in ("naive", "picked"):
                c = v[lab]
                rows.append(dict(und=und, seed=seed, set=sname, kind=lab, found=c is not None, **({k: c[k] for k in ("family", "mean_train", "mean_val", "mean_test", "n_test")} if c else {})))
        pd.DataFrame(rows).to_pickle(os.path.join(r.OUT, f"null-{und}.pkl"))
        print(und, seed, flush=True)


if __name__ == "__main__":
    main()
