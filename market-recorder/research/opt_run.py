"""Tier-1 options-buying screen on 3 years of index 5-minute bars with modelled premiums.

    python3 opt_run.py [NIFTY|BANKNIFTY|SENSEX ...]

Reads /tmp/optres/{nifty,bank,sensex}-5minute.json and vix-day.json (fetch scripts in this folder), writes /tmp/optres/out/.
Selection protocol (nothing from TEST is used to choose anything):
  1. every configuration is scored on TRAIN (first 55% of days) with the BASE spread scenario;
  2. configurations with positive TRAIN expectancy and enough trades go forward; the one with the best VALIDATION expectancy wins;
  3. the winner is evaluated ONCE on the last 25% of days (TEST), with tight/base/wide spread scenarios and day-bootstrap CIs.
A random-entry family runs through the identical grid as the null reference.
"""
import itertools
import json
import os
import pickle
import sys
import time

import numpy as np
import pandas as pd

import opt_core as oc

DATA = os.environ.get("OPT_DATA", "/tmp/optres")
OUT = os.environ.get("OPT_OUT", "/tmp/optres/out")
FILES = {"NIFTY": "nifty-5minute.json", "BANKNIFTY": "bank-5minute.json", "SENSEX": "sensex-5minute.json"}
DTES = {"NIFTY": [0, 1, 3, 6], "SENSEX": [0, 1, 3, 6], "BANKNIFTY": [3, 10, 20]}
OFFSETS = [-3, -2, -1, 0, 1, 2, 3]
STOPS = [0.25, 0.40]
TARGETS = [0.30, 0.60, 1.00]
HOLDS = [12, 24, 45]
DELAYS = [0, 1]
MIN_TRAIN_TRADES = 150
MIN_VAL_TRADES = 60


def random_signals(days, seed=11, per_day=2):
    rng = np.random.default_rng(seed)
    out = []
    for d in sorted(days):
        for _ in range(per_day):
            out.append(oc.Signal(d, int(rng.integers(3, 60)), int(rng.choice([-1, 1])), "RANDOM"))
    return out


def prepare(und):
    df = oc.load_bars(os.path.join(DATA, FILES[und]))
    days = oc.split_days(df)
    vix = oc.load_vix(os.path.join(DATA, "vix-day.json"))
    vprev = oc.prev_close_vix(vix, sorted(days))
    sigs, _ = oc.gen_signals(days)
    sigs["RANDOM"] = random_signals(days)
    return days, vprev, sigs


def segment_of(dates, split):
    seg = {}
    for k in ("train", "val", "test"):
        for d in split[k]:
            seg[d] = k
    return np.array([seg.get(d, "gap") for d in dates])


def run_grid(und, days, vprev, sigs, split, level_ref):
    recs = []
    t0 = time.time()
    for fam, lst in sigs.items():
        for delay in DELAYS:
            G, meta = oc.gather(lst, days, vprev, delay=delay, level_ref=level_ref)
            if len(meta) < 100:
                continue
            seg = segment_of(meta["date"], split)
            dirs = meta["direction"].to_numpy()
            for dte in DTES[und]:
                for off in OFFSETS:
                    P, m = oc.build_paths(G, meta, und, dte, off)
                    for stop, tgt, hold in itertools.product(STOPS, TARGETS, HOLDS):
                        tr = oc.exit_trades(P, m, und, "base", stop, tgt, hold)
                        if len(tr) == 0:
                            continue
                        sg = segment_of(tr["date"], split)
                        net = tr["net"].to_numpy()
                        d_ = tr["direction"].to_numpy()
                        for sname, smask in (("ALL", np.ones(len(tr), bool)), ("CE", d_ == 1), ("PE", d_ == -1)):
                            row = dict(und=und, family=fam, delay=delay, dte=dte, offset=off, stop=stop, target=tgt, hold=hold, set=sname)
                            for k in ("train", "val", "test"):
                                mk = smask & (sg == k)
                                row[f"n_{k}"] = int(mk.sum())
                                row[f"mean_{k}"] = float(net[mk].mean()) if mk.any() else np.nan
                            recs.append(row)
        print(und, fam, "done", len(recs), f"{time.time() - t0:.0f}s", flush=True)
    return pd.DataFrame(recs)


def choose(grid):
    out = {}
    for (und, sname), g in grid[grid["family"] != "RANDOM"].groupby(["und", "set"]):
        cand = g[(g["n_train"] >= MIN_TRAIN_TRADES) & (g["mean_train"] > 0)]
        naive = g[g["n_train"] >= MIN_TRAIN_TRADES].sort_values("mean_train", ascending=False).head(1)
        pick = cand[cand["n_val"] >= MIN_VAL_TRADES].sort_values("mean_val", ascending=False).head(1)
        out[(und, sname)] = dict(naive=naive.iloc[0].to_dict() if len(naive) else None, picked=pick.iloc[0].to_dict() if len(pick) else None, n_cfg=len(g), n_train_pos=int(len(cand)))
    return out


def evaluate(und, cfg, days, vprev, sigs, split, level_ref, direction_set):
    lst = sigs[cfg["family"]]
    G, meta = oc.gather(lst, days, vprev, delay=int(cfg["delay"]), level_ref=level_ref)
    P, m = oc.build_paths(G, meta, und, int(cfg["dte"]), int(cfg["offset"]))
    res = {}
    for spread in ("tight", "base", "wide"):
        tr = oc.exit_trades(P, m, und, spread, cfg["stop"], cfg["target"], int(cfg["hold"]))
        if direction_set == "CE":
            tr = tr[tr["direction"] == 1]
        elif direction_set == "PE":
            tr = tr[tr["direction"] == -1]
        seg = segment_of(tr["date"], split)
        for k in ("train", "val", "test"):
            t = tr[seg == k]
            s = oc.summarize(t, all_days=split[k], label=f"{spread}/{k}")
            s["ci95_net_per_trade"] = oc.day_bootstrap_ci(t)
            res[(spread, k)] = s
        res[(spread, "trades")] = tr
    return res


def main():
    names = sys.argv[1:] or list(FILES)
    os.makedirs(OUT, exist_ok=True)
    for und in names:
        days, vprev, sigs = prepare(und)
        ds = sorted(d for d in days if d in vprev)
        split = oc.chrono_split(ds)
        level_ref = days[ds[-1]]["c"][-1]
        print(und, "days", len(ds), {k: len(v) for k, v in split.items()}, "level_ref", level_ref, {k: len(v) for k, v in sigs.items()}, flush=True)
        grid = run_grid(und, days, vprev, sigs, split, level_ref)
        grid.to_pickle(os.path.join(OUT, f"grid-{und}.pkl"))
        with open(os.path.join(OUT, f"meta-{und}.json"), "w") as fh:
            json.dump(dict(days=len(ds), split={k: [v[0], v[-1], len(v)] for k, v in split.items()}, level_ref=level_ref, signals={k: len(v) for k, v in sigs.items()}), fh)


if __name__ == "__main__":
    main()
