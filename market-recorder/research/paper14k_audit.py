"""Paper-14k audit: four pre-registered models on the same 3-year modelled-premium tape.

Research only. No orders. Does not import the order desk.
Premiums are Black-Scholes on the previous day's India VIX close (no look-ahead),
scaled to today's lot. Spreads are the base 0.8% scenario + 1 tick/leg.
That is the same tape as OPTIONS-BUYING-RESEARCH.md — not live option quotes.

Parameters are pre-registered. TEST is evaluated once. Nothing is selected on TEST.
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

import costs
import opt_core as oc

DATA = os.environ.get("OPT_DATA", "/tmp/optres")
OUT = os.environ.get("OPT_OUT", "/tmp/optres/out")
FILES = {"NIFTY": "nifty-5minute.json", "BANKNIFTY": "bank-5minute.json", "SENSEX": "sensex-5minute.json"}

# Paper 14k books (mirrors option-14k-plan.ts). scratch/sl/tp are premium POINTS.
BOOKS = {
    "NIFTY": dict(
        orS=9 * 60 + 15, orE=10 * 60 + 15, entryS=10 * 60 + 15, flat=15 * 60 + 15,
        quietW=30, pdMax=500, orMin=20, orMax=180, trapP=12, vwapMin=15,
        sl=5.0, tp=10.0, scratch=2.4, lot=65, step=50, otm_steps=-4, venue="NSE",
    ),
    "BANKNIFTY": dict(
        orS=9 * 60 + 15, orE=9 * 60 + 45, entryS=9 * 60 + 45, flat=15 * 60 + 15,
        quietW=80, pdMax=900, orMin=40, orMax=350, trapP=25, vwapMin=30,
        sl=10.0, tp=22.0, scratch=5.0, lot=30, step=100, otm_steps=-4, venue="NSE",
    ),
    "SENSEX": dict(
        orS=9 * 60 + 15, orE=9 * 60 + 45, entryS=9 * 60 + 45, flat=15 * 60 + 15,
        quietW=100, pdMax=1000, orMin=50, orMax=400, trapP=30, vwapMin=35,
        sl=16.0, tp=32.0, scratch=8.0, lot=20, step=100, otm_steps=-5, venue="BSE",
    ),
}
PRIMARY = {"trend": "pdhl", "range": "fade", "quiet": "vwap_fade"}
BACKUP = {
    "trend": ["trap", "all_three", "fade_trap"],
    "range": ["trap", "vwap_fade", "fade_trap"],
    "quiet": ["fade", "trap", "fade_trap"],
    "stand": ["trap", "vwap_fade", "fade"],
}

# Pre-registered Model B / C (not swept).
B_SCRATCH, B_SL, B_TP = 0.08, 0.16, 0.32
C_SCRATCH_ATR, C_SL_ATR, C_TP_ATR = 0.75, 1.50, 3.00
SPREAD = "base"
HOLD = 45


def next_friday_dte(date_str: str) -> int:
    d = datetime.strptime(date_str, "%Y-%m-%d")
    add = (4 - d.weekday()) % 7
    if add == 0:
        add = 7
    return add


def next_last_tuesday_dte(date_str: str) -> int:
    d = datetime.strptime(date_str, "%Y-%m-%d")

    def last_tue(y, m):
        if m == 12:
            nxt = datetime(y + 1, 1, 1)
        else:
            nxt = datetime(y, m + 1, 1)
        day = nxt - timedelta(days=1)
        while day.weekday() != 1:
            day -= timedelta(days=1)
        return day

    cand = last_tue(d.year, d.month)
    if cand.date() <= d.date():
        m = d.month + 1
        y = d.year + (1 if m > 12 else 0)
        m = 1 if m > 12 else m
        cand = last_tue(y, m)
    return (cand.date() - d.date()).days


def morning_structure(mins, o, h, l, c, cfg) -> str:
    mask = (mins >= cfg["orS"]) & (mins <= cfg["orE"])
    if mask.sum() < 2:
        return "stand"
    hi, lo = h[mask].max(), l[mask].min()
    width = hi - lo
    if width <= 0:
        return "stand"
    o0, c1 = o[mask][0], c[mask][-1]
    mid = (hi + lo) / 2
    if width < cfg["quietW"]:
        return "quiet"
    if c1 >= mid + 0.2 * width and c1 > o0:
        return "trend"
    if c1 <= mid - 0.2 * width and c1 < o0:
        return "trend"
    return "range"


def _pdhl(mins, o, h, l, c, i, prev, cfg):
    if prev is None:
        return 0
    phi, plo = prev
    if phi - plo > cfg["pdMax"]:
        return 0
    if c[i] > phi and c[i] > o[i]:
        return 1
    if c[i] < plo and c[i] < o[i]:
        return -1
    return 0


def _fade(mins, o, h, l, c, i, cfg):
    if mins[i] <= cfg["orE"]:
        return 0
    mask = (mins >= cfg["orS"]) & (mins <= cfg["orE"])
    if not mask.any():
        return 0
    hi, lo = h[mask].max(), l[mask].min()
    w = hi - lo
    if w < cfg["orMin"] or w > cfg["orMax"]:
        return 0
    if h[i] > hi and c[i] < hi and c[i] < o[i]:
        return -1
    if l[i] < lo and c[i] > lo and c[i] > o[i]:
        return 1
    return 0


def _trap(mins, o, h, l, c, i, cfg):
    a = max(0, i - 6)
    if i - a < 3:
        return 0
    sh, sl = h[a:i].max(), l[a:i].min()
    if l[i] < sl - cfg["trapP"] and c[i] > sl and c[i] > o[i]:
        return 1
    if h[i] > sh + cfg["trapP"] and c[i] < sh and c[i] < o[i]:
        return -1
    return 0


def _vwap(mins, o, h, l, c, i, cfg):
    sess = mins <= mins[i]
    typ = ((h[sess] + l[sess] + c[sess]) / 3).mean()
    dist = c[i] - typ
    if abs(dist) < cfg["vwapMin"]:
        return 0
    if dist > 0 and c[i] < o[i]:
        return -1
    if dist < 0 and c[i] > o[i]:
        return 1
    return 0


def book_signal(mode, mins, o, h, l, c, i, prev, cfg):
    if mode == "pdhl":
        return _pdhl(mins, o, h, l, c, i, prev, cfg)
    if mode in ("fade", "orb_fade"):
        return _fade(mins, o, h, l, c, i, cfg)
    if mode == "trap":
        return _trap(mins, o, h, l, c, i, cfg)
    if mode == "vwap_fade":
        return _vwap(mins, o, h, l, c, i, cfg)
    if mode == "pdhl_fade":
        return _pdhl(mins, o, h, l, c, i, prev, cfg) or _fade(mins, o, h, l, c, i, cfg)
    if mode == "fade_trap":
        return _fade(mins, o, h, l, c, i, cfg) or _trap(mins, o, h, l, c, i, cfg)
    if mode == "all_three":
        return (
            _pdhl(mins, o, h, l, c, i, prev, cfg)
            or _fade(mins, o, h, l, c, i, cfg)
            or _trap(mins, o, h, l, c, i, cfg)
        )
    return 0


def pick_signal(mins, o, h, l, c, i, structure, prev, cfg):
    st = "stand" if structure == "wait" else structure
    primary = PRIMARY.get(st)
    if primary:
        d = book_signal(primary, mins, o, h, l, c, i, prev, cfg)
        if d:
            return d, primary
    for alt in BACKUP.get(st, []):
        d = book_signal(alt, mins, o, h, l, c, i, prev, cfg)
        if d:
            return d, alt
    return 0, primary or "stand"


def paper14k_signals(days, und: str) -> list[oc.Signal]:
    cfg = BOOKS[und]
    keys = sorted(days)
    out = []
    for k, d in enumerate(keys):
        dd = days[d]
        mins, o, h, l, c = dd["min"], dd["o"], dd["h"], dd["l"], dd["c"]
        prev = None
        if k > 0:
            p = days[keys[k - 1]]
            prev = (p["h"].max(), p["l"].min())
        structure = morning_structure(mins, o, h, l, c, cfg)
        pending = None
        for i in range(len(c) - 1):
            if pending:
                ok = (
                    (c[i] > o[i] and c[i] > pending[1])
                    if pending[0] == 1
                    else (c[i] < o[i] and c[i] < pending[1])
                )
                if ok:
                    out.append(oc.Signal(d, i - 1, pending[0], pending[2]))
                    break
                pending = None
                continue
            if mins[i] < cfg["entryS"] or mins[i] > cfg["flat"] - 30:
                continue
            direc, mode = pick_signal(mins, o, h, l, c, i, structure, prev, cfg)
            if not direc:
                continue
            pending = (direc, c[i], mode)
    return out


def momentum_ok(days, keys, cat, starts, sizes, sg: oc.Signal) -> bool:
    k = keys.index(sg.date)
    s = starts[k]
    g = s + sg.i
    if sg.i < 6 or g >= len(cat["c"]):
        return False
    m = cat["rng_ma20"][g]
    if m != m:
        return False
    r = cat["c"][g] - cat["c"][g - 6]
    if abs(r) <= 1.5 * m * math.sqrt(6):
        return False
    return (1 if r > 0 else -1) == sg.direction


def apply_exits(P, meta, und, model: str, skip_first_bar: bool) -> pd.DataFrame:
    cfg = BOOKS[und]
    u = oc.UNDERLYINGS[und]
    lot, venue, tick = cfg["lot"], cfg["venue"], u["tick"]
    sp = oc.SPREADS[SPREAD]
    n, H = P["o"].shape
    nb = meta["nbars"].to_numpy()
    p0 = P["o"][:, 0]
    valid = (p0 > 0.5) & (nb >= 2)
    half = np.maximum(sp * p0 / 2, tick / 2)
    entry = p0 + half + tick

    if model in ("baseline", "A"):
        scratch_lv = entry - cfg["scratch"]
        sl_lv = entry - cfg["sl"]
        tp_lv = entry + cfg["tp"]
    elif model == "B":
        scratch_lv = entry * (1 - B_SCRATCH)
        sl_lv = entry * (1 - B_SL)
        tp_lv = entry * (1 + B_TP)
    elif model in ("C", "D"):
        # option-path ATR: mean of first 6 completed mid ranges (looks only at bars after fill;
        # for bar 0.. we use index-scaled proxy: 6-bar mean of fav-adv once available, else 8% of prem)
        rng = np.maximum(P["fav"] - P["adv"], 0)
        # past-only: ATR from bars 0..j-1; for vectorised exits use a constant ATR = mean of bars 0-5 of THIS path
        # (those bars are after the signal, so using them for the stop of bar 0 would leak).
        # Conservative: ATR from the entry open vs a 20-bar INDEX range mapped by |dP/dS| ~ premium/spot * 0.5.
        # Simpler pre-register: ATR = max(0.04 * entry, 6-bar mean range of the FIRST bar only = |fav0-adv0|).
        atr = np.maximum(np.nanmean(np.where(np.arange(H)[None, :] < 1, rng, np.nan), axis=1), 0.04 * entry)
        scratch_lv = entry - C_SCRATCH_ATR * atr
        sl_lv = entry - C_SL_ATR * atr
        tp_lv = entry + C_TP_ATR * atr
        floor = entry - 1.5 * half
        scratch_lv = np.minimum(scratch_lv, floor)
    else:
        raise ValueError(model)

    start = 1 if skip_first_bar else 0
    bars = np.arange(H)[None, :]
    inb = (bars >= start) & (bars < np.minimum(nb, HOLD)[:, None])
    pstop = np.where(inb, P["adv"], np.inf)
    ptgt = np.where(inb, P["fav"], -np.inf)
    hit_sc = pstop <= scratch_lv[:, None]
    hit_sl = pstop <= sl_lv[:, None]
    hit_tp = ptgt >= tp_lv[:, None]
    BIG = H + 5
    jsc = np.where(hit_sc.any(1), hit_sc.argmax(1), BIG)
    jsl = np.where(hit_sl.any(1), hit_sl.argmax(1), BIG)
    jtp = np.where(hit_tp.any(1), hit_tp.argmax(1), BIG)
    last = np.maximum(np.minimum(nb, HOLD) - 1, 0)
    # scratch has priority, then SL, then TP (matches live-paper.engine.ts)
    js_first = np.minimum(jsc, jsl)
    exit_j = np.minimum(np.minimum(js_first, jtp), last)
    kind = np.where(
        (jsc < BIG) & (jsc <= jsl) & (jsc <= jtp),
        "scratch",
        np.where((jsl < BIG) & (jsl <= jtp), "sl", np.where(jtp < BIG, "tp", "time")),
    )
    rows = np.arange(n)
    open_at = P["o"][rows, exit_j]
    close_at = P["c"][rows, exit_j]
    lvl = np.where(kind == "scratch", scratch_lv, np.where(kind == "sl", sl_lv, np.where(kind == "tp", tp_lv, close_at)))
    exit_mid = np.where(kind in ("scratch", "sl") if False else kind != "tp", np.minimum(lvl, open_at), np.where(kind == "tp", np.where(open_at >= tp_lv, open_at, tp_lv), close_at))
    # rewrite cleanly
    exit_mid = np.where(
        (kind == "scratch") | (kind == "sl"),
        np.minimum(lvl, open_at),
        np.where(kind == "tp", np.where(open_at >= tp_lv, open_at, tp_lv), close_at),
    )
    half_x = np.maximum(sp * np.maximum(exit_mid, 0) / 2, tick / 2)
    exit_px = np.maximum(exit_mid - half_x - tick, 0.0)
    qty = lot
    paid = (exit_px - entry) * qty
    chg = np.where(valid, costs.options_round_trip(entry, exit_px, qty, venue), 0.0)
    df = meta.copy()
    df["entry"], df["exit"], df["kind"], df["bars_held"] = entry, exit_px, kind, exit_j + 1
    df["gross_mid"] = (exit_mid - p0) * qty
    df["net"] = paid - chg
    df["charges"] = chg
    df["spread_cost"] = df["gross_mid"] - paid
    df["model"] = model
    return df[valid].reset_index(drop=True)


def metrics(tr, all_days, label):
    s = oc.summarize(tr, all_days=all_days, max_per_day=1, label=label)
    if s.get("trades", 0) == 0:
        return s
    t = tr.sort_values(["date", "i"]).groupby("date").head(1)
    lo, hi = oc.day_bootstrap_ci(t)
    s["ci95"] = [lo, hi]
    s["kinds"] = t["kind"].value_counts().to_dict()
    s["rr_obs"] = (abs(s["avg_win"]) / abs(s["avg_loss"])) if s["avg_loss"] else None
    return s


def forensic_today():
    """Exact-charge reconstruction of the four 2026-11-04 paper fills. Prices are as reported by the desk."""
    rows = [
        dict(book="NIFTY", contract="NIFTY 23950 CE 9 Nov", entry=95.70, exit=93.25, lot=65, venue="NSE", scratch=2.4, sl=5, mode="pdhl"),
        dict(book="NIFTY", contract="NIFTY 24000 CE 9 Nov", entry=90.25, exit=87.85, lot=65, venue="NSE", scratch=2.4, sl=5, mode="trap"),
        dict(book="BANKNIFTY", contract="BANKNIFTY 55900 CE 23 Nov", entry=604.70, exit=599.40, lot=30, venue="NSE", scratch=5.0, sl=10, mode="pdhl"),
        dict(book="SENSEX", contract="SENSEX 77500 CE 5 Nov", entry=173.30, exit=158.25, lot=20, venue="BSE", scratch=8.0, sl=16, mode="trap"),
    ]
    out = []
    for r in rows:
        move = r["entry"] - r["exit"]
        paper = round((r["exit"] - r["entry"]) * r["lot"] - 50, 1)
        exact = float(costs.options_round_trip(r["entry"], r["exit"], r["lot"], r["venue"]))
        exact_net = (r["exit"] - r["entry"]) * r["lot"] - exact
        bd = costs.options_charge_breakdown(r["entry"], r["exit"], r["lot"], r["venue"])
        out.append(
            dict(
                **r,
                move_pts=round(move, 2),
                scratch_pts=r["scratch"],
                sl_pts=r["sl"],
                move_vs_scratch=round(move / r["scratch"], 2),
                paper_net_rs=paper,
                exact_charges_rs=round(exact, 2),
                exact_net_rs=round(exact_net, 2),
                charge_breakdown={k: round(float(v), 2) for k, v in bd.items()},
            )
        )
    return out


def filter_independent(tr, days, vprev, keys, cat, starts, sizes, und):
    """Each filter alone, on the same Model-A-improved trades. No combining."""
    regimes = oc.day_regimes(days, vprev)
    out = {}
    base = tr
    out["none"] = base
    chop = set(regimes.index[regimes["regime_trend"] == "chop"])
    out["prior_chop"] = base[base["date"].isin(chop)]
    vix_ok = set(regimes.index[regimes["regime_vol"] != "low"])
    out["skip_vix_low"] = base[base["date"].isin(vix_ok)]
    mom = [sg for sg in [oc.Signal(r.date, int(r.i), int(r.direction), r.family) for r in base.itertuples()] if momentum_ok(days, keys, cat, starts, sizes, sg)]
    mom_keys = {(s.date, s.i) for s in mom}
    out["momentum_confirm"] = base[base.apply(lambda r: (r["date"], int(r["i"])) in mom_keys, axis=1)]
    return out


def run_und(und: str):
    df = oc.load_bars(os.path.join(DATA, FILES[und]))
    days = oc.split_days(df)
    vix = oc.load_vix(os.path.join(DATA, "vix-day.json"))
    vprev = oc.prev_close_vix(vix, sorted(days))
    sigs = paper14k_signals(days, und)
    keys, cat, starts, sizes = oc.build_series(days)
    split = oc.chrono_split(sorted(days))
    level_ref = days[sorted(days)[-1]]["o"][0]
    cfg = BOOKS[und]

    def dte_of(date):
        return next_friday_dte(date) if und != "BANKNIFTY" else next_last_tuesday_dte(date)

    # one DTE per signal (next expiry; skip DTE 0)
    kept = [s for s in sigs if dte_of(s.date) >= 1]
    G, meta = oc.gather(kept, days, vprev, delay=0, level_ref=level_ref)
    if len(meta) == 0:
        return dict(und=und, trades=0)
    # build paths at the book's cheap-OTM offset; DTE varies — use the median DTE of the book as a constant
    # (variable DTE per row is not in build_paths). Pre-register: Nifty/Sensex DTE=3, Bank DTE=10.
    dte = 3 if und != "BANKNIFTY" else 10
    P, m = oc.build_paths(G, meta, und, dte, cfg["otm_steps"])
    models = {
        "baseline": apply_exits(P, m, und, "baseline", skip_first_bar=False),
        "A": apply_exits(P, m, und, "A", skip_first_bar=True),
        "B": apply_exits(P, m, und, "B", skip_first_bar=True),
        "C": apply_exits(P, m, und, "C", skip_first_bar=True),
    }
    # Model D: Model C exits on the momentum-confirmed subset of the same entries
    mom_idx = [
        i
        for i, r in m.iterrows()
        if momentum_ok(days, keys, cat, starts, sizes, oc.Signal(r["date"], int(r["i"]), int(r["direction"]), r["family"]))
    ]
    if mom_idx:
        Pm = {k: v[mom_idx] for k, v in P.items()}
        models["D"] = apply_exits(Pm, m.iloc[mom_idx].reset_index(drop=True), und, "D", skip_first_bar=True)
    else:
        models["D"] = m.iloc[0:0].copy()

    seg = {}
    for part, ds in split.items():
        for d in ds:
            seg[d] = part

    report = {"und": und, "dte_used": dte, "otm_steps": cfg["otm_steps"], "signals": len(kept), "split": {k: len(v) for k, v in split.items()}}
    report["models"] = {}
    for name, tr in models.items():
        report["models"][name] = {}
        for part, ds in split.items():
            sub = tr[tr["date"].isin(ds)]
            report["models"][name][part] = metrics(sub, ds, f"{und} {name} {part}")
        report["models"][name]["all"] = metrics(tr, sorted(days), f"{und} {name} all")

    # Independent filters on Model A (improved execution, same entries). Evaluated on each split, not selected.
    report["filters_on_A"] = {}
    for fname, ftr in filter_independent(models["A"], days, vprev, keys, cat, starts, sizes, und).items():
        report["filters_on_A"][fname] = {part: metrics(ftr[ftr["date"].isin(ds)], ds, f"{und} A/{fname} {part}") for part, ds in split.items()}

    return report


def main():
    os.makedirs(OUT, exist_ok=True)
    today = forensic_today()
    reports = {u: run_und(u) for u in ("NIFTY", "BANKNIFTY", "SENSEX")}
    payload = {
        "generated": datetime.utcnow().isoformat() + "Z",
        "disclaimer": (
            "Modelled Black-Scholes premiums, previous-day VIX, base 0.8% spread + 1 tick/leg, "
            "exact Zerodha charges, 1 lot. Not live quotes. TEST was not used to choose parameters. "
            "Not a claim of profitability."
        ),
        "preregistered": {
            "B": {"scratch": B_SCRATCH, "sl": B_SL, "tp": B_TP},
            "C": {"scratch_atr": C_SCRATCH_ATR, "sl_atr": C_SL_ATR, "tp_atr": C_TP_ATR},
            "D": "Model C exits on Paper-14k entries that also pass the 6-bar momentum thrust (independent filter).",
            "execution": "Buy mid+halfspread+1tick, sell mid-halfspread-1tick. Model A/B/C/D skip scratch on the fill bar.",
            "split": "chrono 55/20/25 of trading days, 1-day embargo (opt_core.chrono_split).",
        },
        "today_forensic": today,
        "underlyings": reports,
    }
    path = os.path.join(OUT, "paper14k-audit.json")
    with open(path, "w") as f:
        json.dump(payload, f, indent=2, default=str)
    print(json.dumps({u: {m: reports[u]["models"][m]["test"] for m in reports[u]["models"]} for u in reports}, indent=2, default=str))
    print("wrote", path)


if __name__ == "__main__":
    main()
