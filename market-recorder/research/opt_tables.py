"""Render every table used in OPTIONS-BUYING-RESEARCH.md from the result files. Prints markdown to stdout / OUT/tables.md."""
import json
import os

import numpy as np
import pandas as pd

import opt_core as oc
import opt_run as r

OUT = r.OUT
R = json.load(open(os.path.join(OUT, "report.json")))
F = json.load(open(os.path.join(OUT, "fut-report.json")))
C = json.load(open(os.path.join(OUT, "crude-report.json")))
RG = json.load(open(os.path.join(OUT, "regimes.json")))
lines = []


def P(s=""):
    lines.append(s)


def money(x):
    return "n/a" if x is None or x != x else f"{x:,.0f}"


def ci(c):
    return f"[{c[0]:,.0f}, {c[1]:,.0f}]"


P("## T1. Tier-1 grid: how many configurations make money (base spread, 1 lot, net of all charges)")
P()
P("| Index | Configs | Median net/trade train / val / test (Rs) | % configs > 0 train / val / test |")
P("|---|---:|---|---|")
for u, rep in R.items():
    d = rep["distribution"]
    P(f"| {u} | {rep['configs']:,} | {money(d['train']['median'])} / {money(d['val']['median'])} / {money(d['test']['median'])} | {d['train']['pct_positive']:.0f}% / {d['val']['pct_positive']:.0f}% / {d['test']['pct_positive']:.0f}% |")
P()
P("## T2. Entry family medians over the grid (Rs net per trade, ALL directions)")
P()
fams = [f["family"] for f in R["NIFTY"]["families"]]
P("| Family | " + " | ".join(f"{u} tr/val/test" for u in R) + " |")
P("|---|" + "---|" * len(R))
for fam in fams:
    cells = []
    for u in R:
        f = next(x for x in R[u]["families"] if x["family"] == fam)
        cells.append(f"{f['median_train']:,.0f} / {f['median_val']:,.0f} / {f['median_test']:,.0f}")
    P(f"| {fam} | " + " | ".join(cells) + " |")
P()
P("## T3. Seven buckets: selected configuration, out-of-sample result and selection-adjusted p-value")
P()
P("Selection: positive TRAIN expectancy, then best VALIDATION; TEST is evaluated once. p = share of 40 direction-randomised re-runs of the whole pipeline whose picked TEST expectancy was at least as large.")
P()
P("| Bucket | Picked config (family, DTE, strike offset, stop, target, hold bars, delay) | Trades train/val/test | Net per trade train / val / test (Rs) | Test 95% CI (day bootstrap) | Test win % / PF | Test Rs/day | Test green-day % | p |")
P("|---|---|---|---|---|---|---:|---:|---:|")
for u, rep in R.items():
    for s in ("CE", "PE"):
        pk = rep["picks"][s]["picked"]
        if not pk:
            P(f"| {u} {s} | no train-positive configuration with enough validation trades | | | | | | | |")
            continue
        c, ev = pk["cfg"], pk["eval"]
        tr, va, te = ev["base/train"], ev["base/val"], ev["base/test"]
        P(
            f"| {u} {s} | {c['family']}, DTE{c['dte']}, off{c['offset']:+d}, {c['stop']:.0%}/{c['target']:.0%}, {c['hold']}, d{c['delay']} | {tr['trades']}/{va['trades']}/{te['trades']} | "
            f"{money(tr['net_per_trade'])} / {money(va['net_per_trade'])} / {money(te['net_per_trade'])} | {ci(te['ci95_net_per_trade'])} | {te['win_pct']:.0f}% / {te['profit_factor']:.2f} | "
            f"{money(te['net_per_calendar_day'])} | {te['green_days_pct']:.0f}% | {rep['null'][s]['p_value_ge_observed']:.2f} |"
        )
P()
P("## T4. Picked configuration under spread scenarios (TEST net per trade, Rs; tight 0.3% / base 0.8% / wide 2.0% full spread + 1 tick per leg)")
P()
P("| Bucket | tight | base | wide | gross (mid) per trade | charges per trade | spread+slippage per trade (base) |")
P("|---|---:|---:|---:|---:|---:|---:|")
for u, rep in R.items():
    for s in ("CE", "PE"):
        pk = rep["picks"][s]["picked"]
        if not pk:
            continue
        ev = pk["eval"]
        P(f"| {u} {s} | {money(ev['tight/test']['net_per_trade'])} | {money(ev['base/test']['net_per_trade'])} | {money(ev['wide/test']['net_per_trade'])} | {money(ev['base/test']['gross_mid_per_trade'])} | {money(ev['base/test']['charges_per_trade'])} | {money(ev['base/test']['spread_cost_per_trade'])} |")
P()
P("## T5. Null distribution of the picked TEST expectancy (what pure noise produces after the same search)")
P()
P("| Index / set | null 5th | null median | null 95th | observed | p |")
P("|---|---:|---:|---:|---:|---:|")
for u, rep in R.items():
    for s in ("ALL", "CE", "PE"):
        n = rep["null"][s]
        q = n["null_picked_test_mean_pcts"]
        P(f"| {u} {s} | {money(q['5'])} | {money(q['50'])} | {money(q['95'])} | {money(n['observed_picked_test_mean'])} | {n['p_value_ge_observed']:.2f} |")
P()
P("## T6. Fixed reference trade (ATM, stop 40%, target 100%, hold 24 bars, base spread), full 3 years, by entry family")
P()
P("Rs net per trade [95% day-bootstrap CI], n. Only cells with n >= 15 are shown.")
P()
for u in RG:
    P(f"**{u}**")
    P()
    keys = sorted({k.split("|")[1] for k in RG[u]}, key=lambda x: int(x[3:]))
    P("| Family | " + " | ".join(f"{k} ALL" for k in keys) + " | CE (first DTE) | PE (first DTE) |")
    P("|---|" + "---|" * (len(keys) + 2))
    for fam in dict.fromkeys(fams + ["RANDOM"]):
        if fam not in {k.split("|")[0] for k in RG[u]}:
            continue
        cells = []
        for k in keys:
            c = RG[u][f"{fam}|{k}"]["ALL"]
            cells.append("n/a" if c.get("net") is None else f"{c['net']:,.0f} {ci(c['ci'])} n={c['n']}")
        c1 = RG[u][f"{fam}|{keys[0]}"]
        ce = "n/a" if c1["CE"].get("net") is None else f"{c1['CE']['net']:,.0f} (n={c1['CE']['n']})"
        pe = "n/a" if c1["PE"].get("net") is None else f"{c1['PE']['net']:,.0f} (n={c1['PE']['n']})"
        P(f"| {fam} | " + " | ".join(cells) + f" | {ce} | {pe} |")
    P()
P("## T7. Regime splits of the reference trade (MOMENTUM and SRBRK, Rs net per trade, n)")
P()
P("| Index | Family | DTE | trending prior day | choppy prior day | VIX low | VIX mid | VIX high | CE | PE |")
P("|---|---|---:|---|---|---|---|---|---|---|")
for u in RG:
    for key in sorted(RG[u]):
        fam, dte = key.split("|")
        if fam not in ("MOMENTUM", "SRBRK", "ORB15"):
            continue
        x = RG[u][key]
        g = lambda c: "n/a" if x[c].get("net") is None else f"{x[c]['net']:,.0f} ({x[c]['n']})"
        P(f"| {u} | {fam} | {dte[3:]} | {g('trend_trend')} | {g('trend_chop')} | {g('vol_low')} | {g('vol_mid')} | {g('vol_high')} | {g('CE')} | {g('PE')} |")
P()
P("## T7b. CE vs PE over the whole grid (median net per trade over all configurations, Rs; random-entry family shown as the reference)")
P()
P("| Index | CE train / val / test | PE train / val / test | RANDOM-entry CE test | RANDOM-entry PE test |")
P("|---|---|---|---|---|")
for u in R:
    g = pd.read_pickle(os.path.join(OUT, f"grid-{u}.pkl"))
    real = g[g["family"] != "RANDOM"]
    rnd = g[g["family"] == "RANDOM"]
    f = lambda d, s_: " / ".join(money(d[(d["set"] == s_) & (d[f"n_{k}"] >= 30)][f"mean_{k}"].median()) for k in ("train", "val", "test"))
    P(f"| {u} | {f(real, 'CE')} | {f(real, 'PE')} | {money(rnd[(rnd['set'] == 'CE') & (rnd['n_test'] >= 30)]['mean_test'].median())} | {money(rnd[(rnd['set'] == 'PE') & (rnd['n_test'] >= 30)]['mean_test'].median())} |")
P()
P("## T8. 1-lot futures on the same signals (540 configs per index, same split)")
P()
P("| Index | Median gross per trade tr/val/test (Rs) | Median NET per trade tr/val/test (Rs) | % configs > 0 tr/val/test | Train-positive configs |")
P("|---|---|---|---|---:|")
for u, v in F.items():
    P(f"| {u} | {money(v['median_gross']['train'])} / {money(v['median_gross']['val'])} / {money(v['median_gross']['test'])} | {money(v['median']['train'])} / {money(v['median']['val'])} / {money(v['median']['test'])} | {v['pct_positive']['train']:.0f}% / {v['pct_positive']['val']:.0f}% / {v['pct_positive']['test']:.0f}% | {v['train_positive']} |")
P()
P("## T9. Crude Oil Mini (14 weeks of listed-contract history)")
P()
d = C["daily"]
P(f"- Sessions: {C['days']} ({C['first']} to {C['last']}); split train/val/test = {C['split']['train'][2]}/{C['split']['val'][2]}/{C['split']['test'][2]} days.")
P(f"- Daily range median {d['median_range_pct']:.1f}% (about {d['median_range_points']:.0f} points = Rs{d['rupees_per_lot_median_range']:,.0f} per lot), 90th percentile {d['p90_range_pct']:.1f}%; worst day {d['worst_day'][0]} at {d['worst_day'][1]:.1f}%.")
fg = C["fut_grid"]
P(f"- Futures, 1 lot, {fg['configs']} configs: median gross per trade tr/val/test = {money(fg['median_gross']['train'])} / {money(fg['median_gross']['val'])} / {money(fg['median_gross']['test'])}; median net = {money(fg['median']['train'])} / {money(fg['median']['val'])} / {money(fg['median']['test'])}; % configs > 0 = {fg['pct_positive']['train']:.0f}% / {fg['pct_positive']['val']:.0f}% / {fg['pct_positive']['test']:.0f}%; configs positive on train: {fg['train_positive_configs']}.")
o = C["opt_replay"]
P(f"- Options, real premiums of the Nov-17 expiry: {o['rows']} family x exit configs, median net per trade Rs{o['median_net_per_trade']:,.0f}, {o['pct_positive']:.0f}% positive; trades per family at most {max(o['trades_by_family'].values())}.")
if "iv_vs_rv" in C:
    iv = C["iv_vs_rv"]
    P(f"- Implied vs realised: ATM implied vol median {iv['median_iv']:.0%} vs 5-minute realised vol median {iv['median_rv']:.0%}; implied was above realised on {iv['pct_days_iv_above_rv']:.0f}% of {iv['days']} days.")
P()
P("## T10. Model fidelity: Tier-1 modelled P&L vs real-premium replay on the same trades (reference exits, base spread)")
P()
P("| Index | Trades matched | Corr. of per-trade net | Mean net real / model (Rs) | Mean gross real / model (Rs) |")
P("|---|---:|---:|---|---|")
for u in ("NIFTY", "BANKNIFTY", "SENSEX"):
    j = pd.read_pickle(os.path.join(OUT, f"fidelity-{u}.pkl"))
    P(f"| {u} | {len(j)} | {np.corrcoef(j.net_real, j.net_model)[0, 1]:.2f} | {j.net_real.mean():,.0f} / {j.net_model.mean():,.0f} | {j.gross_mid_real.mean():,.0f} / {j.gross_mid_model.mean():,.0f} |")
P()
txt = "\n".join(lines)
open(os.path.join(OUT, "tables.md"), "w").write(txt)
print(txt)
