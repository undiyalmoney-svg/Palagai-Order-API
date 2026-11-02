"""Turn the Tier-1 grids into the reported tables (picked configs, test metrics, regimes, null comparison).

    python3 opt_report.py  ->  /tmp/optres/out/report.json
"""
import json
import os

import numpy as np
import pandas as pd

import opt_core as oc
import opt_run as r

OUT = r.OUT
UNDS = ["NIFTY", "BANKNIFTY", "SENSEX"]


def fmt_cfg(c):
    return dict(family=c["family"], delay=int(c["delay"]), dte=int(c["dte"]), offset=int(c["offset"]), stop=float(c["stop"]), target=float(c["target"]), hold=int(c["hold"]))


def family_table(grid):
    a = grid[(grid["set"] == "ALL") & (grid["family"] != "RANDOM")]
    rows = []
    for fam, g in grid[grid["set"] == "ALL"].groupby("family"):
        row = dict(family=fam)
        for k in ("train", "val", "test"):
            v = g[g[f"n_{k}"] >= 30][f"mean_{k}"]
            row[f"median_{k}"] = float(v.median())
            row[f"pct_pos_{k}"] = float((v > 0).mean() * 100)
        rows.append(row)
    return rows


def regime_split(tr, regimes, col):
    tr = tr.join(regimes[[col]], on="date")
    out = {}
    for k, g in tr.groupby(col):
        s = oc.summarize(g, label=f"{col}={k}")
        out[str(k)] = dict(trades=s["trades"], net_per_trade=s.get("net_per_trade"), win_pct=s.get("win_pct"))
    return out


def evaluate_pick(und, cfg, days, vprev, sigs, split, level_ref, regimes, which):
    res = r.evaluate(und, cfg, days, vprev, sigs, split, level_ref, which)
    out = {}
    for sp in ("tight", "base", "wide"):
        for k in ("train", "val", "test"):
            s = dict(res[(sp, k)])
            s["ci95_net_per_trade"] = list(s["ci95_net_per_trade"])
            out[f"{sp}/{k}"] = s
    base_tr = res[("base", "trades")]
    seg = r.segment_of(base_tr["date"], split)
    test_tr = base_tr[seg == "test"]
    out["regimes_test_base"] = {c: regime_split(test_tr, regimes, c) for c in ("regime_vol", "regime_trend")}
    out["regimes_all_base"] = {c: regime_split(base_tr[seg != "gap"], regimes, c) for c in ("regime_vol", "regime_trend")}
    t = test_tr.sort_values(["date", "i"])
    out["test_trade_sd"] = float(t["net"].std())
    out["test_exit_kinds"] = t["kind"].value_counts().to_dict()
    out["monthly_net_all"] = base_tr[seg != "gap"].assign(m=lambda x: x["date"].str.slice(0, 7)).groupby("m")["net"].sum().round(0).to_dict()
    return out, base_tr


def null_compare(und, picked_by_set):
    f = os.path.join(OUT, f"null-{und}.pkl")
    if not os.path.exists(f):
        return {}
    n = pd.read_pickle(f)
    out = {}
    for sname, picked in picked_by_set.items():
        g = n[(n["set"] == sname) & (n["kind"] == "picked")]
        done = g["seed"].nunique()
        vals = g["mean_test"].fillna(-1e9)
        found = g["found"].mean() if len(g) else np.nan
        obs = picked["mean_test"] if picked else np.nan
        out[sname] = dict(
            null_runs=int(done),
            null_pick_found_rate=float(found),
            null_picked_test_mean_pcts={p: float(np.nanpercentile(g["mean_test"].dropna(), p)) for p in (5, 50, 95)} if g["mean_test"].notna().any() else {},
            observed_picked_test_mean=float(obs) if obs == obs else None,
            p_value_ge_observed=float(((vals >= obs).sum() + 1) / (len(vals) + 1)) if obs == obs else None,
        )
    return out


def main():
    report = {}
    for und in UNDS:
        grid = pd.read_pickle(os.path.join(OUT, f"grid-{und}.pkl"))
        days, vprev, sigs = r.prepare(und)
        ds = sorted(d for d in days if d in vprev)
        split = oc.chrono_split(ds)
        level_ref = days[ds[-1]]["c"][-1]
        regimes = oc.day_regimes({d: days[d] for d in ds}, vprev)
        ch = r.choose(grid)
        rep = dict(
            days=len(ds),
            split={k: [v[0], v[-1], len(v)] for k, v in split.items()},
            level_ref=level_ref,
            signals={k: len(v) for k, v in sigs.items()},
            configs=int((grid["set"] == "ALL").sum()),
            families=family_table(grid),
            distribution={
                k: dict(
                    median=float(grid[(grid["set"] == "ALL") & (grid[f"n_{k}"] >= 60)][f"mean_{k}"].median()),
                    pct_positive=float((grid[(grid["set"] == "ALL") & (grid[f"n_{k}"] >= 60)][f"mean_{k}"] > 0).mean() * 100),
                )
                for k in ("train", "val", "test")
            },
            picks={},
        )
        picked_by_set = {}
        for sname in ("ALL", "CE", "PE"):
            c = ch[(und, sname)]
            picked_by_set[sname] = c["picked"]
            entry = dict(n_candidates_train_positive=c["n_train_pos"], n_configs=c["n_cfg"])
            for lab in ("naive", "picked"):
                cfg = c[lab]
                if cfg is None:
                    entry[lab] = None
                    continue
                ev, _ = evaluate_pick(und, cfg, days, vprev, sigs, split, level_ref, regimes, sname)
                entry[lab] = dict(cfg=fmt_cfg(cfg), grid_means={k: float(cfg[f"mean_{k}"]) for k in ("train", "val", "test")}, eval=ev)
            rep["picks"][sname] = entry
        rep["null"] = null_compare(und, picked_by_set)
        report[und] = rep
        print(und, "ok", flush=True)
    json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1, default=float)


if __name__ == "__main__":
    main()
