"""Assemble one-lot capital, cost and expectancy snapshot for the 8-name universe.

Reads live Kite dumps written outside the repo (no token). Research only.
Does not claim profitability. Paper 14k remains the unvalidated baseline.
liveOrders stays false.
"""
from __future__ import annotations

import json
import os

import costs

LIVE = os.environ.get("UNIVERSE_LIVE", "/tmp/optres/out/universe-live.json")
MGN = os.environ.get("UNIVERSE_MGN", "/tmp/optres/out/universe-margins.json")
OUT = os.environ.get("UNIVERSE_OUT", "/tmp/optres/out/universe-capital.json")

VERDICT = "NO VALIDATED EDGE — DO NOT DEPLOY LIVE CAPITAL."

# Published research (OPTIONS-BUYING-RESEARCH.md + PAPER14K-AUDIT). Modelled unless noted.
EXPECT = {
    "NIFTY": dict(
        status="NO_EDGE",
        product="options",
        evidence="3y modelled grid + Paper 14k audit. Median config train −₹51/trade. Selected NIFTY CE test −₹85 (p=0.51). Paper 14k baseline VAL CI includes 0.",
        net_per_trade=None,
        profit_factor=None,
        max_dd=None,
        n_note="Not 400 real-quote fills. Modelled only.",
        daily_mean=None,
        monthly_mean=None,
        modelled_paper14k_test=dict(n=171, net=100.7, pf=1.76, wr=42.1, dd=2331, ci95=[41.1, 156.0], note="Modelled BS tape. Not live-quote validated. VAL CI includes 0."),
    ),
    "BANKNIFTY": dict(
        status="NO_EDGE",
        product="options",
        evidence="Paper 14k baseline negative on train/val/test. T1 median train −₹97. Selected BANKNIFTY CE test −₹491 (p=0.98).",
        net_per_trade=-24.0,
        profit_factor=0.87,
        max_dd=8868,
        n_note="Modelled Paper 14k TEST n=169. Live 4 Nov: −₹249 exact on one ticket.",
        daily_mean=-22.0,
        monthly_mean=None,
        modelled_paper14k_test=dict(n=169, net=-24.2, pf=0.87, wr=30.8, dd=8868, ci95=[-79.4, 32.4], note="CI includes 0. Negative on train/val/test."),
    ),
    "SENSEX": dict(
        status="NO_EDGE",
        product="options",
        evidence="Paper 14k baseline TEST +₹37 CI [−20, 95] includes 0. T3 SENSEX CE test −₹167 (p=0.61). T10 real vs model −₹437 vs −₹45.",
        net_per_trade=37.0,
        profit_factor=1.24,
        max_dd=3951,
        n_note="Modelled TEST n=167. CI includes 0. Live 4 Nov: −₹356 exact.",
        daily_mean=33.0,
        monthly_mean=None,
        modelled_paper14k_test=dict(n=167, net=37.0, pf=1.24, wr=None, dd=3951, ci95=[-20.0, 95.0], note="CI includes 0. T10 fidelity −₹437 live vs −₹45 model."),
    ),
    "FINNIFTY": dict(
        status="INCONCLUSIVE",
        product="options",
        evidence="No 3-year options study in this repo. Live specs only.",
        net_per_trade=None,
        profit_factor=None,
        max_dd=None,
        n_note="Need listed-contract 5m bid/ask history.",
        daily_mean=None,
        monthly_mean=None,
    ),
    "MIDCPNIFTY": dict(
        status="INCONCLUSIVE",
        product="options",
        evidence="No historical expectancy study.",
        net_per_trade=None,
        profit_factor=None,
        max_dd=None,
        n_note="Need listed-contract 5m bid/ask history.",
        daily_mean=None,
        monthly_mean=None,
    ),
    "BANKEX": dict(
        status="INCONCLUSIVE",
        product="options",
        evidence="No historical study. Live book is not tradeable (43–200% spread, OI 0–1,800).",
        net_per_trade=None,
        profit_factor=None,
        max_dd=None,
        n_note="Liquidity first; then history.",
        daily_mean=None,
        monthly_mean=None,
    ),
    "CRUDEOIL": dict(
        status="INCONCLUSIVE",
        product="both",
        evidence="No dedicated big-crude study. Mini futures/options already lose after costs (T9).",
        net_per_trade=None,
        profit_factor=None,
        max_dd=None,
        n_note="1 lot is 100 bbl; ATM CE today ~₹43,650. Mini is 10× smaller and already NO_EDGE.",
        daily_mean=None,
        monthly_mean=None,
    ),
    "CRUDEOILM": dict(
        status="NO_EDGE",
        product="both",
        evidence="T9: 14 weeks. Futures 0/540 configs positive on train, median net −₹95. Options real premium median −₹82, 4% configs positive. IV 51% vs realised 32%.",
        net_per_trade=-82.0,
        profit_factor=None,
        max_dd=None,
        n_note="Listed-contract window only. Not 400 fills.",
        daily_mean=None,
        monthly_mean=None,
    ),
}

VENUE = {
    "NIFTY": "NSE",
    "BANKNIFTY": "NSE",
    "FINNIFTY": "NSE",
    "MIDCPNIFTY": "NSE",
    "SENSEX": "BSE",
    "BANKEX": "BSE",
    "CRUDEOIL": "MCX",
    "CRUDEOILM": "MCX",
}
HOURS = {
    "NIFTY": "09:15–15:30 IST",
    "BANKNIFTY": "09:15–15:30 IST",
    "FINNIFTY": "09:15–15:30 IST",
    "MIDCPNIFTY": "09:15–15:30 IST",
    "SENSEX": "09:15–15:30 IST",
    "BANKEX": "09:15–15:30 IST",
    "CRUDEOIL": "09:00–23:30 IST (MCX energy)",
    "CRUDEOILM": "09:00–23:30 IST (MCX energy)",
}
UNITS = {"CRUDEOIL": 100, "CRUDEOILM": 10}

# Paper 14k 4 Nov 2026 blotter (desk ₹50 flat vs exact Zerodha). Historical rows not edited.
JOURNAL = [
    dict(book="NIFTY", contract="NIFTY 23950 CE 9 Nov", entry=95.70, exit=93.25, lot=65, mode="pdhl",
         paper_net=-209.3, exact_charges=61.64, exact_net=-220.89, move_pts=2.45, scratch_pts=2.4),
    dict(book="NIFTY", contract="NIFTY 24000 CE 9 Nov", entry=90.25, exit=87.85, lot=65, mode="trap",
         paper_net=-206.0, exact_charges=60.81, exact_net=-216.81, move_pts=2.40, scratch_pts=2.4),
    dict(book="BANKNIFTY", contract="BANKNIFTY 55900 CE 23 Nov", entry=604.70, exit=599.40, lot=30, mode="pdhl",
         paper_net=-209.0, exact_charges=89.90, exact_net=-248.90, move_pts=5.30, scratch_pts=5.0),
    dict(book="SENSEX", contract="SENSEX 77500 CE 5 Nov", entry=173.30, exit=158.25, lot=20, mode="trap",
         paper_net=-351.0, exact_charges=54.60, exact_net=-355.60, move_pts=15.05, scratch_pts=8.0),
]

CAPITAL_LEVELS = [50_000, 100_000, 200_000, 300_000, 500_000, 1_000_000, 1_500_000, 2_000_000]
DAILY_TARGETS = [500, 1000, 1500, 2000, 3000, 5000, 7500, 10000]
TRADE_FREQS = [1, 2, 3, 4, 5, 6]

# Index names that share equity-beta / rate / FII flow. Not independent books.
INDEX_CLUSTER = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"}
CRUDE_CLUSTER = {"CRUDEOIL", "CRUDEOILM"}

PORTFOLIO_SCENARIOS = [
    ("A", ["NIFTY"]),
    ("B", ["NIFTY", "SENSEX"]),
    ("C", ["NIFTY", "SENSEX", "CRUDEOILM"]),
    ("D", ["NIFTY", "BANKNIFTY", "SENSEX", "CRUDEOILM"]),
    ("E", ["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY", "CRUDEOILM"]),
    ("F", ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "CRUDEOIL", "CRUDEOILM"]),
]


def pick(opts, kind, off):
    return next((o for o in opts if o["kind"] == kind and o["offset"] == off), None)


def capital_band(premium_rs, fut_nrml, opt_sell=None):
    """Minimum = 1 ATM CE ask + 50% reserve. Recommended = 1 ATM + 100% reserve.
    Conservative = max(3× ATM, futures NRML + 30%). Never spend the whole account.
    """
    prem = 0 if premium_rs is None else float(premium_rs)
    fut = 0 if fut_nrml is None else float(fut_nrml)
    if not prem and not fut:
        return dict(minimum=None, recommended=None, conservative=None)
    minimum = int(round(prem * 1.5)) if prem else None
    recommended = int(round(prem * 2.0)) if prem else None
    conservative = int(round(max(prem * 3.0, fut * 1.3))) if (prem or fut) else None
    return dict(minimum=minimum, recommended=recommended, conservative=conservative)


def liquidity_flag(uid, spread, oi):
    """Venue-aware book quality. MCX OI is exchange lots (1 lot = 10 or 100 bbl)."""
    sp = 0.0 if spread is None else float(spread)
    open_int = 0 if oi is None else int(oi)
    if sp > 0.05:
        return "untradeable"
    if uid in CRUDE_CLUSTER:
        if open_int < 200:
            return "thin"
        if sp > 0.015:
            return "thin"
        return "ok"
    if open_int < 2000:
        return "thin"
    if sp > 0.015:
        return "thin"
    return "ok"


def win_rate_needed(expectancy_rs, risk_rs, reward_multiple):
    """Win rate that produces `expectancy_rs` when wins pay RR×risk and losses cost risk."""
    if risk_rs is None or risk_rs <= 0 or reward_multiple <= 0:
        return None
    wr = (expectancy_rs / risk_rs + 1.0) / (reward_multiple + 1.0)
    return round(wr, 4)


def daily_target_row(target, risk_rs=2967.0):
    """Hypothetical arithmetic for a daily net target. Not a forecast."""
    rows = []
    for n in TRADE_FREQS:
        e = target / n
        rows.append(dict(
            trades=n,
            required_net_per_trade=round(e, 2),
            wr_rr1=win_rate_needed(e, risk_rs, 1),
            wr_rr2=win_rate_needed(e, risk_rs, 2),
            wr_rr3=win_rate_needed(e, risk_rs, 3),
        ))
    return dict(
        target=target,
        hypothetical=True,
        supported_by_validated_edge=False,
        note="No strategy in this repo has a one-sided 95% lower CI for after-cost expectancy above zero on real-quote fills. These are break-even identities, not probabilities.",
        risk_rs_used=risk_rs,
        risk_note="Nifty ATM 25% stop + scratch-flat charges from the 4 Nov snapshot, used only as a scale. Not a recommended stop.",
        by_frequency=rows,
        required_capital_if_risk_2pct=int(round(target / 0.02)),
        max_acceptable_loss=int(round(target)),
        probability_of_reaching_target="UNSUPPORTED — no validated edge",
        probability_losing_day="UNSUPPORTED — no validated edge",
        probability_exceeding_daily_loss="UNSUPPORTED — no validated edge",
    )


def portfolio_from_books(label, ids, books_by_id):
    chosen = [books_by_id[i] for i in ids if i in books_by_id]
    prem = sum((b["option_buy"]["one_lot_atm_rs"] or 0) for b in chosen)
    rec = sum((b["capital"]["recommended"] or 0) for b in chosen)
    cons = sum((b["capital"]["conservative"] or 0) for b in chosen)
    fut = sum((b["fut"]["nrml_margin"] or 0) for b in chosen)
    day_risk = sum((b["option_buy"]["est_stop_25pct"] or 0) for b in chosen)
    index_n = sum(1 for b in chosen if b["id"] in INDEX_CLUSTER)
    crude_n = sum(1 for b in chosen if b["id"] in CRUDE_CLUSTER)
    untradeable = [b["id"] for b in chosen if b["liquidity_flag"] == "untradeable"]
    statuses = {b["id"]: b["expectancy"]["status"] for b in chosen}
    nets = [b["expectancy"]["net_per_trade"] for b in chosen if b["expectancy"]["net_per_trade"] is not None]
    return dict(
        id=label,
        instruments=ids,
        n=len(chosen),
        total_premium_atm=round(prem, 2),
        recommended_capital=rec,
        conservative_capital=cons,
        futures_margin_if_all_fut=fut,
        max_simultaneous_option_exposure=round(prem, 2),
        estimated_daily_risk_25pct=round(day_risk, 2),
        maximum_daily_loss_option_buy=round(prem, 2),
        reserve_capital=rec - int(round(prem)),
        capital_utilization=None if not rec else round(prem / rec, 3),
        expected_portfolio_drawdown="UNKNOWN — no validated joint model",
        net_portfolio_expectancy=None if not nets else round(sum(nets), 2),
        expectancy_note="Sum of modelled single-name figures where they exist. Not a portfolio forecast. Joint CI was not estimated.",
        index_names_in_book=index_n,
        crude_names_in_book=crude_n,
        correlated=(
            "index cluster plus crude — not independent books"
            if index_n >= 2 and crude_n >= 1
            else "yes — treat as one equity-beta book"
            if index_n >= 2
            else "yes — same crude"
            if crude_n >= 2
            else "single-cluster"
        ),
        untradeable=untradeable,
        statuses=statuses,
        suitable_for_live=False,
    )


def plan_for_capital(capital, books):
    """What one-lot option-buy books fit without spending the whole account."""
    half = capital * 0.50
    thirty = capital * 0.30
    option_fit = []
    for b in books:
        rec = b["capital"]["recommended"]
        if rec is None:
            continue
        if b["liquidity_flag"] == "untradeable":
            continue
        if rec <= half:
            option_fit.append(b["id"])
    fut_fit = []
    for b in books:
        cons = b["capital"]["conservative"]
        if cons and cons <= capital and b["liquidity_flag"] != "untradeable":
            # conservative already includes 30% over NRML; still require leftover cash
            if (b["fut"]["nrml_margin"] or 0) <= capital * 0.70:
                fut_fit.append(b["id"])
    max_sim = 1 if capital < 300_000 else (2 if capital < 1_000_000 else 2)
    daily_risk = min(int(round(capital * 0.02)), 2_000 if capital < 300_000 else 5_000)
    insufficient = len(option_fit) == 0
    return dict(
        capital=capital,
        option_buy_fit=option_fit,
        futures_fit=fut_fit,
        recommended_instruments=option_fit[:1],
        n_instruments=1 if option_fit else 0,
        lots_per_instrument=1 if option_fit else 0,
        max_simultaneous=max_sim if option_fit else 0,
        capital_reserve_pct=50,
        daily_risk_limit=daily_risk,
        max_expected_drawdown="UNKNOWN — no validated model. Desk book cap is ₹420/book (paper).",
        insufficient_for_live=True,
        insufficient_for_paper=insufficient,
        note=(
            "No validated edge at any capital. Larger capital only buys more of a zero/negative expectancy. "
            f"Option-buy recommended capital must be ≤ 50% of the account (≤₹{int(half):,}). "
            f"Futures NRML must stay ≤ 70% (≤₹{int(capital * 0.70):,})."
        ),
        leftover_if_first=None if not option_fit else capital - next(
            b["capital"]["recommended"] for b in books if b["id"] == option_fit[0]
        ),
        spend_ceiling=int(half),
        daily_risk_note=f"2% of capital, capped. Never raise size after a loss. Paper desk still uses ₹420/book.",
        _thirty=thirty,
    )


def rank_books(books):
    """Rank on liquidity, costs, capital — never on unvalidated gross returns."""
    tradeable = [b for b in books if b["liquidity_flag"] != "untradeable"]
    by_spread = sorted(tradeable, key=lambda b: (b["option_buy"]["spread_pct"] is None, b["option_buy"]["spread_pct"] or 99))
    by_cash = sorted(tradeable, key=lambda b: (b["capital"]["recommended"] is None, b["capital"]["recommended"] or 10**12))
    by_oi = sorted(tradeable, key=lambda b: -((b["option_buy"].get("atm_ce") or {}).get("oi") or 0))
    return dict(
        method="Liquidity, spread, capital efficiency, risk per lot. Expectancy is NO_EDGE or INCONCLUSIVE for every name — it is not used as a ranking key.",
        best_one_lot_paper="NIFTY — tightest two-sided book, deepest OI, weekly expiries, charges ~₹75 RT. Still NO_EDGE.",
        second_best_paper="SENSEX — lowest index ATM cash (₹7,023) and weekly Fridays. DTE-1 fade on 4 Nov. Still NO_EDGE.",
        best_low_capital="CRUDEOILM — ATM CE ~₹4,446, futures NRML ₹28,450. T9 already loses after costs. Not a cheap edge.",
        best_liquidity="NIFTY",
        best_risk_adjusted="NONE — no validated positive after-cost expectancy.",
        avoid=["BANKEX", "NIFTY+BANKNIFTY+SENSEX as diversification", "CRUDEOIL standard as a first book", "any futures book until an options edge exists"],
        further_research=["FINNIFTY", "MIDCPNIFTY", "CRUDEOIL (separate from mini)", "Paper-only Model A execution on NIFTY"],
        by_spread=[b["id"] for b in by_spread],
        by_recommended_cash=[b["id"] for b in by_cash],
        by_atm_oi=[b["id"] for b in by_oi],
    )


def frequency_note():
    return dict(
        rule="Do not add trades to hit a daily rupee target.",
        paper14k_design="One signal family per book per session; no-trade days are valid.",
        live_4_nov="Nifty took a second ticket after a scratch (no cooldown). Both lost.",
        evidence={
            1: "Matches the pre-registered Paper 14k and 3-year grids (one trade/day). Still no validated edge.",
            2: "Doubles charges and the chance of a second scratch. 4 Nov Nifty: −₹221 then −₹217.",
            3: "No study in this repo supports three independent +EV entries per name per day.",
            4: "Overtrading. Cost stack (₹54–₹122 RT plus spread) dominates any unvalidated tick edge.",
            5: "Rejected. Same as 4 with worse cost drag.",
            "gt5": "Rejected. Intraday options buying at this size is a lottery on direction, not a volume business.",
        },
        optimal_per_instrument="0 or 1. A no-trade day is allowed and preferred when spread, DTE, or structure fail the filters.",
        time_of_day="Paper 14k: Nifty first entry 10:15, Bank/Sensex 09:45, flat 15:15. Crude energy session 09:00–23:30 IST; overnight gap is a different market.",
        losing_day_probability="UNSUPPORTED as a forecast. Modelled Paper 14k green-day rates were ~31–42% on TEST — that is not a live probability.",
    )


def missing_data():
    return [
        "Historical executable option bid/ask for FINNIFTY, MIDCPNIFTY, BANKEX, CRUDEOIL (standard).",
        "≥400 real-quote fills of any candidate rule, across regimes, with day-clustered CIs.",
        "Intraday IV, skew, and depth history (recorder v1.1.0 started 2026-11-02; ATM±3 only).",
        "Joint covariance of the eight books (index cluster vs crude) on live option P&L, not index returns.",
        "Expired-contract option tape (Kite will not grow it backwards).",
        "Sensex 77500 path after 10:22 IST on 4 Nov (left ATM±3; recorder dropped the strike).",
    ]


def build_book(b, mgn):
    uid = b["id"]
    venue = VENUE[uid]
    atm = pick(b["options"], "CE", 0)
    otm2 = pick(b["options"], "CE", 2)
    otm4 = pick(b["options"], "CE", 4)
    units = (atm or {}).get("units") or UNITS.get(uid) or (atm or {}).get("lot")
    lot = (atm or {}).get("lot") or (b.get("front_fut") or {}).get("lot")
    tick = (b.get("front_fut") or {}).get("tick")
    px = (atm or {}).get("ask") or (atm or {}).get("ltp")
    cost = (atm or {}).get("cost_rs")
    slip = None
    if atm and atm.get("ask") and atm.get("bid") and units:
        slip = round((atm["ask"] - atm["bid"]) * units, 2)
    chg = None
    bd = None
    if px and units:
        tot = float(costs.options_round_trip(px, px, units, venue))
        bd = {k: round(float(v), 2) for k, v in costs.options_charge_breakdown(px, px, units, venue).items()}
        chg = round(tot, 2)
    fut_px = (b.get("fut_quote") or {}).get("ltp")
    fut_qty = UNITS.get(uid) if uid.startswith("CRUDE") else (b.get("front_fut") or {}).get("lot")
    fut_chg = None
    if fut_px and fut_qty:
        fut_chg = round(float(costs.futures_round_trip(fut_px, fut_px, fut_qty, 1, venue)), 2)
    mg = mgn.get(uid) or {}
    band = capital_band(cost, mg.get("fut_nrml"), mg.get("opt_sell_nrml"))
    spread = (atm or {}).get("spread_pct")
    return dict(
        id=uid,
        venue=venue,
        pocket=b["pocket"],
        hours=HOURS[uid],
        spot=b.get("spot"),
        lot=lot,
        units=units,
        tick=tick,
        tick_value_rs=None if not (tick and units) else round(tick * units, 2),
        opt_expiries=b.get("opt_expiries"),
        fut=dict(
            symbol=(b.get("front_fut") or {}).get("symbol"),
            expiry=(b.get("front_fut") or {}).get("expiry"),
            ltp=fut_px,
            bid=(b.get("fut_quote") or {}).get("bid"),
            ask=(b.get("fut_quote") or {}).get("ask"),
            oi=(b.get("fut_quote") or {}).get("oi"),
            nrml_margin=mg.get("fut_nrml"),
            span=mg.get("span"),
            exposure=mg.get("exposure"),
            round_trip_charges=fut_chg,
        ),
        option_buy=dict(
            atm_ce=atm,
            otm2_ce=otm2,
            otm4_ce=otm4,
            one_lot_atm_rs=cost,
            one_lot_otm4_rs=(otm4 or {}).get("cost_rs"),
            max_loss_atm=cost,
            est_stop_25pct=None if not cost else round(0.25 * cost + (chg or 0), 2),
            round_trip_charges=chg,
            charge_breakdown=bd,
            spread_slip_rs=slip,
            spread_pct=None if spread is None else round(spread * 100, 3),
        ),
        option_sell=dict(
            nrml_margin=mg.get("opt_sell_nrml"),
            note="SPAN+exposure for 1 ATM CE short; premium credit is extra, not a substitute for margin.",
        ),
        capital=band,
        expectancy=EXPECT[uid],
        liquidity_flag=liquidity_flag(uid, spread, (atm or {}).get("oi")),
    )


def assemble(live, mgn):
    books = [build_book(b, mgn) for b in live["books"]]
    by_id = {b["id"]: b for b in books}
    portfolios = [portfolio_from_books(lab, ids, by_id) for lab, ids in PORTFOLIO_SCENARIOS]
    plans = [plan_for_capital(c, books) for c in CAPITAL_LEVELS]
    for p in plans:
        p.pop("_thirty", None)
    targets = [daily_target_row(t) for t in DAILY_TARGETS]
    payload = dict(
        as_of=live.get("as_of"),
        india_vix=live.get("india_vix"),
        verdict=VERDICT,
        recommended_portfolio=dict(
            live="NONE",
            paper="One book, one lot: NIFTY weekly options (liquidity) or CRUDEOILM options (lowest cash). Never both plus Bank/Sensex as diversification.",
            lots=1,
            trades_per_day="0 or 1",
            daily_loss_cap_paper=420,
            why="Only names with a two-sided book and prior research. That research is NO_EDGE. Adding correlated index books multiplies the same bet.",
        ),
        disclaimer=(
            "Live lots, premiums, spreads, OI and Kite NRML margins are as of the snapshot. "
            "Expectancy figures are copied from prior research or marked INCONCLUSIVE. "
            "They are not live-quote validated. Paper 14k audit (2026-11-04) found no after-cost edge. "
            "liveOrders stays false. Token was never written to this file."
        ),
        books=books,
        rankings=rank_books(books),
        portfolios=portfolios,
        capital_plans=plans,
        daily_targets=targets,
        trade_frequency=frequency_note(),
        journal=JOURNAL,
        journal_totals=dict(
            paper_net=round(sum(r["paper_net"] for r in JOURNAL), 2),
            exact_charges=round(sum(r["exact_charges"] for r in JOURNAL), 2),
            exact_net=round(sum(r["exact_net"] for r in JOURNAL), 2),
        ),
        missing_data=missing_data(),
        answers=dict(
            capital_needed="For paper observation of one Nifty lot: recommended ₹23,140 (ATM cash ₹11,570 + 100% reserve) as of 4 Nov 2026 13:28 IST. For live deployment: do not fund. No validated edge.",
            instruments="Paper-only: NIFTY (first) or CRUDEOILM (low cash). Not a live shortlist.",
            how_many="One. Two only if the second is a different driver (crude vs index) and still paper. Three or more is correlated size, not diversification.",
            lots="One lot. Never two. Never average down. Never martingale.",
            trades_per_day="Zero or one per instrument. No-trade days allowed.",
            daily_expectancy="Not supported. Modelled figures are not live-quote validated. 4 Nov exact blotter: −₹1,042 on four tickets.",
            monthly_expectancy="Not supported. Do not annualise a non-edge.",
            avoid="BANKEX (untradeable book). CRUDEOIL standard as a first book. Stacking NIFTY+BANKNIFTY+SENSEX. Any futures book as a substitute for an options edge.",
            max_daily_loss="Paper desk ₹420/book. Research recommendation: 2% of allocated capital, never more than 25% of the premium on the open lot, then stand down.",
            validated_strategy="NONE. " + VERDICT,
        ),
    )
    return payload


def main():
    live = json.load(open(LIVE))
    mgn = json.load(open(MGN))
    payload = assemble(live, mgn)
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2)
    print("wrote", OUT)
    print("verdict", payload["verdict"])
    for b in payload["books"]:
        print(
            b["id"],
            "atm",
            b["option_buy"]["one_lot_atm_rs"],
            "otm4",
            b["option_buy"]["one_lot_otm4_rs"],
            "futM",
            b["fut"]["nrml_margin"],
            "chg",
            b["option_buy"]["round_trip_charges"],
            b["liquidity_flag"],
            b["expectancy"]["status"],
        )


if __name__ == "__main__":
    main()
