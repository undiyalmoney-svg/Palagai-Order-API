"""Sanity checks for the 8-name capital study. Research only. No live orders."""
import json
import os

import costs
import universe_capital as u


def test_verdict_is_no_edge():
    assert u.VERDICT.startswith("NO VALIDATED EDGE")


def test_capital_band_never_spends_the_account():
    band = u.capital_band(11570, 176108)
    assert band["minimum"] == 17355
    assert band["recommended"] == 23140
    assert band["conservative"] == 228940
    assert band["recommended"] > 11570
    assert band["conservative"] > 176108


def test_capital_band_none_when_empty():
    assert u.capital_band(None, None) == dict(minimum=None, recommended=None, conservative=None)


def test_liquidity_bankex_untradeable_crude_ok():
    assert u.liquidity_flag("BANKEX", 0.43, 120) == "untradeable"
    assert u.liquidity_flag("CRUDEOIL", 0.0032, 614) == "ok"
    assert u.liquidity_flag("CRUDEOILM", 0.0026, 4217) == "ok"
    assert u.liquidity_flag("NIFTY", 0.0014, 5_811_195) == "ok"
    assert u.liquidity_flag("FINNIFTY", 0.009, 1260) == "thin"


def test_win_rate_identity():
    # E = wr*RR*R - (1-wr)*R  =>  wr = (E/R + 1) / (RR+1)
    # need +500 with risk 2500 and RR 2 → wr = (0.2+1)/3 = 0.4
    assert u.win_rate_needed(500, 2500, 2) == 0.4


def test_nifty_scratch_flat_charges_match_costs():
    tot = costs.options_round_trip(178, 178, 65, "NSE")
    assert abs(tot - 74.63) < 0.05
    bd = costs.options_charge_breakdown(178, 178, 65, "NSE")
    assert bd["brokerage"] == 40.0
    assert bd["stt_ctt"] > 0


def test_journal_four_fills_and_exact_net():
    assert len(u.JOURNAL) == 4
    paper = round(sum(r["paper_net"] for r in u.JOURNAL))
    assert paper == -975
    exact = round(sum(r["exact_net"] for r in u.JOURNAL))
    assert exact == -1042


def test_assemble_from_live_dumps():
    live = "/tmp/optres/out/universe-live.json"
    mgn = "/tmp/optres/out/universe-margins.json"
    if not (os.path.exists(live) and os.path.exists(mgn)):
        return
    payload = u.assemble(json.load(open(live)), json.load(open(mgn)))
    assert payload["verdict"] == u.VERDICT
    ids = [b["id"] for b in payload["books"]]
    assert ids == ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "CRUDEOIL", "CRUDEOILM"]
    by = {b["id"]: b for b in payload["books"]}
    assert by["BANKEX"]["liquidity_flag"] == "untradeable"
    assert by["CRUDEOIL"]["liquidity_flag"] == "ok"
    assert by["NIFTY"]["option_buy"]["one_lot_atm_rs"] == 11570
    assert by["CRUDEOILM"]["fut"]["nrml_margin"] == 28450
    assert all(b["expectancy"]["status"] in ("NO_EDGE", "INCONCLUSIVE") for b in payload["books"])
    assert payload["recommended_portfolio"]["live"] == "NONE"
    assert payload["answers"]["validated_strategy"].startswith("NONE")
    # 50k can paper Nifty or Sensex or Crude Mini; cannot do Bank ATM recommended
    p50 = next(p for p in payload["capital_plans"] if p["capital"] == 50_000)
    assert p50["insufficient_for_live"] is True
    assert "BANKNIFTY" not in p50["option_buy_fit"]
    assert "SENSEX" in p50["option_buy_fit"]
    assert "CRUDEOILM" in p50["option_buy_fit"]
    a = next(p for p in payload["portfolios"] if p["id"] == "A")
    assert a["n"] == 1
    assert a["suitable_for_live"] is False
    assert a["recommended_capital"] == by["NIFTY"]["capital"]["recommended"]
    raw = json.dumps(payload)
    assert "5bnh" not in raw
    assert "8541" not in raw
    t500 = payload["daily_targets"][0]
    assert t500["supported_by_validated_edge"] is False
    assert t500["by_frequency"][0]["required_net_per_trade"] == 500


def test_plan_rejects_untradeable_and_keeps_reserve():
    books = [
        dict(id="NIFTY", liquidity_flag="ok", capital=dict(recommended=23140, conservative=228940),
             fut=dict(nrml_margin=176108)),
        dict(id="BANKEX", liquidity_flag="untradeable", capital=dict(recommended=65421, conservative=277248),
             fut=dict(nrml_margin=213268)),
    ]
    plan = u.plan_for_capital(50_000, books)
    assert plan["option_buy_fit"] == ["NIFTY"]
    assert "BANKEX" not in plan["option_buy_fit"]
    assert plan["insufficient_for_live"] is True
    assert plan["lots_per_instrument"] == 1


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
