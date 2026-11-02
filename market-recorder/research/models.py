"""Models A-D, chronological evaluation, rupee P&L.

A = candle features only; B = A + futures (volume/OI/basis[/book]); C = A + options; D = everything.
Live-recorder features (book, options) are added by live_features.py once the recorder has data.
"""
import json
import sqlite3
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, precision_score, recall_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer

import events
from costs import LOTS, futures_round_trip

BASE = ["hm", "lvl", "dir", "body", "brng", "loc", "over", "sp5", "sp15", "sp30", "comp", "orw", "gapal", "dopen", "drng", "nprev", "oth", "oth5", "pdr", "vix", "wd"]
FUT = ["fvol1_rel", "fvol5_rel", "fvol15_rel", "foi5", "foi15", "foi30", "foi5_pct", "foi15_pct", "foi30_pct", "pxoi_build", "oi_up", "basis", "basis_chg15", "fut_vs_spot5"]
SLIP_PTS = {"nifty": 1.0, "bank": 1.5}


def make_models():
    return {
        "logit": make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression(C=0.1, max_iter=1000)),
        "gbm": HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=120),
        "rf": make_pipeline(SimpleImputer(strategy="median"), RandomForestClassifier(n_estimators=200, min_samples_leaf=10, random_state=0)),
    }


def split_by_day(df, fr=(0.6, 0.15)):
    days = sorted(df["date"].unique())
    n = len(days)
    a, b = int(n * fr[0]), int(n * (fr[0] + fr[1]))
    tr, va, te = set(days[:a]), set(days[a:b]), set(days[b:])
    # whole-day embargo: the last training/validation day is dropped so no outcome window straddles a boundary
    tr.discard(days[a - 1])
    va.discard(days[b - 1])
    return df[df["date"].isin(tr)], df[df["date"].isin(va)], df[df["date"].isin(te)]


def net_rupees(row, name, sx):
    lot = LOTS[name]
    pts = row[f"pts_{sx}"]
    px = row["entry_px"]
    exit_px = px + row["dir"] * pts
    charges = futures_round_trip(px, exit_px, lot, side=row["dir"])
    return pts * lot - SLIP_PTS[name] * lot - charges


def daily_stats(sel, name, sx, all_days):
    """One trade per day per index: the first selected event. Days with no selected event earn 0."""
    first = sel.sort_values("ts").groupby("date").head(1)
    pnl = first.apply(lambda r: net_rupees(r, name, sx), axis=1) if len(first) else pd.Series(dtype=float)
    daily = pd.Series(0.0, index=sorted(all_days))
    for d, v in zip(first["date"], pnl):
        daily[d] = v
    eq = daily.cumsum()
    dd = (eq.cummax() - eq).max() if len(eq) else 0.0
    losing = (daily < 0).astype(int)
    streak = best = 0
    for x in losing:
        streak = streak + 1 if x else 0
        best = max(best, streak)
    return dict(days=len(daily), trade_days=int(len(first)), avg_daily=float(daily.mean()), median_daily=float(daily.median()),
                green_pct=float((daily > 0).mean() * 100), max_dd=float(dd), max_losing_streak=int(best), total=float(daily.sum()),
                avg_per_trade=float(pnl.mean()) if len(pnl) else 0.0, avg_win=float(pnl[pnl > 0].mean()) if (pnl > 0).any() else 0.0,
                avg_loss=float(pnl[pnl <= 0].mean()) if (pnl <= 0).any() else 0.0)


def day_bootstrap_auc(y, p, days, n=500, seed=0):
    rng = np.random.default_rng(seed)
    ud = np.unique(days)
    out = []
    for _ in range(n):
        pick = rng.choice(ud, len(ud))
        m = np.concatenate([np.where(days == d)[0] for d in pick])
        if len(np.unique(y[m])) < 2:
            continue
        out.append(roc_auc_score(y[m], p[m]))
    return (float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))) if out else (np.nan, np.nan)


def auc_power_events(auc=0.55, alpha_z=1.645, power_z=0.84):
    """Total events (balanced classes) for a one-sided 5% test at 80% power to separate `auc` from 0.5.
    Under H0, var(AUC) ~ (1/12)(1/n1 + 1/n0), so n per class = 1 / (6 * se^2)."""
    se = (auc - 0.5) / (alpha_z + power_z)
    return int(round(2 / (6 * se ** 2)))


def run(df, name, feature_sets, sx=0.5):
    df = df.dropna(subset=[f"pts_{sx}"]).copy()
    df["y"] = (df[f"kind_{sx}"] == "target").astype(int)
    tr, va, te = split_by_day(df)
    res = {"name": name, "stop_x": sx, "n": len(df), "days": df["date"].nunique(), "split": [len(tr), len(va), len(te)],
           "base_go": [float(x["y"].mean()) if len(x) else None for x in (tr, va, te)]}
    out = {}
    for label, cols in feature_sets.items():
        cols = [c for c in cols if c in df.columns]
        m = {}
        for mname, mdl in make_models().items():
            if len(tr) < 40 or tr["y"].nunique() < 2 or te["y"].nunique() < 2:
                m[mname] = None
                continue
            mdl.fit(tr[cols], tr["y"])
            p = mdl.predict_proba(te[cols])[:, 1]
            pv = mdl.predict_proba(va[cols])[:, 1] if len(va) else p
            auc = roc_auc_score(te["y"], p)
            lo, hi = day_bootstrap_auc(te["y"].values, p, te["date"].values)
            thr = np.quantile(pv, 0.7)
            pred = (p >= thr).astype(int)
            tops = {}
            for q in (0.1, 0.2, 0.3):
                k = max(int(len(te) * q), 1)
                idx = np.argsort(-p)[:k]
                sel = te.iloc[idx]
                net = sel.apply(lambda r: net_rupees(r, name, sx), axis=1)
                tops[f"top{int(q * 100)}"] = dict(n=int(k), go_rate=float(sel["y"].mean()), gross_pts=float(sel[f"pts_{sx}"].mean()), net_rs_per_trade=float(net.mean()))
            sel_all = te[p >= thr]
            m[mname] = dict(auc=float(auc), auc_ci95=[lo, hi], precision=float(precision_score(te["y"], pred, zero_division=0)),
                            recall=float(recall_score(te["y"], pred, zero_division=0)), tops=tops,
                            daily=daily_stats(sel_all, name, sx, te["date"].unique()))
        out[label] = m
    res["models"] = out
    allsel = te
    res["all_events_baseline"] = dict(go_rate=float(te["y"].mean()), gross_pts=float(te[f"pts_{sx}"].mean()),
                                      net_rs_per_trade=float(te.apply(lambda r: net_rupees(r, name, sx), axis=1).mean()),
                                      daily=daily_stats(allsel, name, sx, te["date"].unique()))
    return res


if __name__ == "__main__":
    dbfile = sys.argv[1] if len(sys.argv) > 1 else "/tmp/research-db/recorder.sqlite"
    db = sqlite3.connect(dbfile)
    report = {}
    for name, other in (("nifty", "bank"), ("bank", "nifty")):
        full = events.build(db, name, other)
        sub = full.dropna(subset=["fvol5_rel"]) if "fvol5_rel" in full else full.iloc[0:0]
        report[name] = {
            "events_all": int(len(full)), "events_with_futures": int(len(sub)), "days_all": int(full["date"].nunique()), "days_with_futures": int(sub["date"].nunique()),
            "A_full_window": {str(sx): run(full, name, {"A": BASE}, sx) for sx in (0.5, 1.0)},
            "A_vs_B_futures_window": {str(sx): run(sub, name, {"A": BASE, "B": BASE + FUT}, sx) for sx in (0.5, 1.0)},
        }
    report["events_needed_for_auc_0.55"] = auc_power_events(0.55)
    print(json.dumps(report, indent=1, default=float))
