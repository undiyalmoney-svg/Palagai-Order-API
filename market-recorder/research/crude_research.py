"""CRUDEOILM research on the only history Kite serves: contracts listed today (futures since 2026-07-27, options since 2026-09-10).

    python3 crude_research.py -> /tmp/optres/out/crude-report.json

Futures: the same signal families, 1 lot (10 barrels) with the MCX charge schedule, % stops/targets sized for crude's volatility.
Options: real 5-minute premiums of the listed Nov-17 expiry contracts replayed on the same signals (spread scenarios on top).
This is ~14 weeks of one regime including a limit-down crash week, so every number here is exploratory.
"""
import itertools
import json
import os

import numpy as np
import pandas as pd
from scipy.optimize import brentq

import opt_core as oc
import opt_tier2 as t2

oc.FLAT_MIN = 23 * 60 + 15
oc.SESSION_END_MIN = 23 * 60 + 30
OUT = os.environ.get("OPT_OUT", "/tmp/optres/out")


def fut_days(listed, sym="CRUDEOILM26NOVFUT"):
    v = listed[sym]
    rows = [(pd.Timestamp(c[0][:19]), c[1], c[2], c[3], c[4], c[5]) for c in json.load(open(t2.LISTED))[sym]["candles"]]
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df["date"] = df["ts"].dt.strftime("%Y-%m-%d")
    df["min"] = df["ts"].dt.hour * 60 + df["ts"].dt.minute
    df = df[df["ts"].dt.weekday < 5]
    return oc.split_days(df, min_bars=120), df


def main():
    listed = t2.load_listed()
    days, df = fut_days(listed)
    ds = sorted(days)
    vprev = {d: 0.5 for d in ds}
    sigs, _ = oc.gen_signals(days)
    split = oc.chrono_split(ds)
    rep = dict(days=len(ds), first=ds[0], last=ds[-1], split={k: [v[0], v[-1], len(v)] for k, v in split.items()}, signals={k: len(v) for k, v in sigs.items()})

    dret = pd.Series({d: days[d]["c"][-1] / days[d]["o"][0] - 1 for d in ds})
    drng = pd.Series({d: (days[d]["h"].max() - days[d]["l"].min()) / days[d]["o"][0] for d in ds})
    rep["daily"] = dict(median_range_pct=float(drng.median() * 100), p90_range_pct=float(np.percentile(drng, 90) * 100), median_abs_ret_pct=float(dret.abs().median() * 100), worst_day=[dret.idxmin(), float(dret.min() * 100)])
    pts = {d: float(days[d]["h"].max() - days[d]["l"].min()) for d in ds}
    rep["daily"]["median_range_points"] = float(np.median(list(pts.values())))
    rep["daily"]["rupees_per_lot_median_range"] = rep["daily"]["median_range_points"] * 10

    # 1-lot futures grid
    recs = []
    level_ref = days[ds[-1]]["c"][-1]
    for fam, lst in sigs.items():
        for delay in (0, 1):
            G, meta = oc.gather(lst, days, vprev, delay=delay, level_ref=None)
            seg = None
            for stop, tgt, hold in itertools.product([0.003, 0.005, 0.008], [0.005, 0.01, 0.015], [12, 24, 45]):
                tr = oc.exit_futures(G, meta, "CRUDEOILM", stop, tgt, hold)
                sg = np.array([next((k for k in ("train", "val", "test") if d in split[k]), "gap") for d in tr["date"]])
                row = dict(family=fam, delay=delay, stop=stop, target=tgt, hold=hold)
                for k in ("train", "val", "test"):
                    mk = sg == k
                    row[f"n_{k}"] = int(mk.sum())
                    row[f"mean_{k}"] = float(tr["net"].to_numpy()[mk].mean()) if mk.any() else np.nan
                    row[f"gross_{k}"] = float(tr["gross_mid"].to_numpy()[mk].mean()) if mk.any() else np.nan
                recs.append(row)
    g = pd.DataFrame(recs)
    gg = g[g["family"] != "RANDOM"] if "RANDOM" in g["family"].values else g
    rep["fut_grid"] = dict(
        configs=len(gg),
        median={k: float(gg[gg[f"n_{k}"] >= 15][f"mean_{k}"].median()) for k in ("train", "val", "test")},
        pct_positive={k: float((gg[gg[f"n_{k}"] >= 15][f"mean_{k}"] > 0).mean() * 100) for k in ("train", "val", "test")},
        median_gross={k: float(gg[gg[f"n_{k}"] >= 15][f"gross_{k}"].median()) for k in ("train", "val", "test")},
        by_family=gg.groupby("family")[["mean_train", "mean_val", "mean_test"]].median().round(0).to_dict("index"),
    )
    cand = gg[(gg["n_train"] >= 40) & (gg["mean_train"] > 0) & (gg["n_val"] >= 15)].sort_values("mean_val", ascending=False)
    rep["fut_grid"]["train_positive_configs"] = int(((gg["n_train"] >= 40) & (gg["mean_train"] > 0)).sum())
    if len(cand):
        c = cand.iloc[0]
        G, meta = oc.gather(sigs[c["family"]], days, vprev, delay=int(c["delay"]))
        tr = oc.exit_futures(G, meta, "CRUDEOILM", c["stop"], c["target"], int(c["hold"]))
        ev = {}
        for k in ("train", "val", "test"):
            t = tr[tr["date"].isin(split[k])]
            s = oc.summarize(t, all_days=split[k])
            s["ci95_net_per_trade"] = list(oc.day_bootstrap_ci(t))
            ev[k] = s
        rep["fut_picked"] = dict(cfg={k: (c[k].item() if hasattr(c[k], "item") else c[k]) for k in ("family", "delay", "stop", "target", "hold")}, eval=ev)

    # real option premiums replay
    cfgs = [dict(stop=s, target=t, hold=h) for s in (0.25, 0.40) for t in (0.6, 1.0) for h in (12, 24, 45)]
    clisted = {k: v for k, v in listed.items() if v["name"] == "CRUDEOILM"}
    rp, trades = t2.replay(clisted, "CRUDEOILM", days, vprev, sigs, cfgs)
    rp.to_pickle(os.path.join(OUT, "replay-CRUDEOILM.pkl"))
    base = rp[rp["spread"] == "base"]
    rep["opt_replay"] = dict(
        rows=len(base),
        median_net_per_trade=float(base[base["trades"] >= 20]["net_per_trade"].median()),
        pct_positive=float((base[base["trades"] >= 20]["net_per_trade"] > 0).mean() * 100),
        by_family=base[base["trades"] >= 20].groupby("family")["net_per_trade"].median().round(0).to_dict(),
        trades_by_family=base.groupby("family")["trades"].max().to_dict(),
    )

    # implied vs realised vol (ATM Nov-17 options, Black-76 vs the Nov future)
    fut = listed["CRUDEOILM26NOVFUT"]["arr"]
    fidx = {int(t): i for i, t in enumerate(fut[:, 0])}
    ivs = []
    for sym, v in clisted.items():
        if v["kind"] not in ("CE", "PE") or v["expiry"] != "2026-11-17":
            continue
        for row in v["arr"][::6]:
            i = fidx.get(int(row[0]))
            if i is None or row[5] <= 0:
                continue
            F = fut[i, 4]
            if abs(v["strike"] / F - 1) > 0.01:
                continue
            day = pd.Timestamp(int(row[0]) * 60_000_000_000)
            T = ((pd.Timestamp("2026-11-17") - day.normalize()).days + (23 * 60 + 30 - (day.hour * 60 + day.minute)) / 1440.0) / 365.0
            if T <= 0:
                continue
            isc = v["kind"] == "CE"
            f = lambda x: float(oc.black76(F, v["strike"], T, x, isc)) - row[4]
            try:
                iv = brentq(f, 0.02, 4.0)
            except ValueError:
                continue
            ivs.append(dict(date=day.strftime("%Y-%m-%d"), iv=iv))
    ivdf = pd.DataFrame(ivs)
    if len(ivdf):
        daily_iv = ivdf.groupby("date")["iv"].median()
        r5 = np.log(df["close"]).groupby(df["date"]).diff().dropna()
        rv = r5.groupby(df.loc[r5.index, "date"]).std() * np.sqrt(174 * 252)
        j = pd.concat([daily_iv.rename("iv_atm"), rv.rename("rv_5m")], axis=1).dropna()
        rep["iv_vs_rv"] = dict(days=len(j), median_iv=float(j["iv_atm"].median()), median_rv=float(j["rv_5m"].median()), pct_days_iv_above_rv=float((j["iv_atm"] > j["rv_5m"]).mean() * 100))
    json.dump(rep, open(os.path.join(OUT, "crude-report.json"), "w"), indent=1, default=float)
    print("done")


if __name__ == "__main__":
    main()
