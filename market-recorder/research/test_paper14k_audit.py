"""Sanity checks for the Paper 14k audit runner. Research only."""
import paper14k_audit as a
import costs


def test_forensic_matches_blotter_and_exact_charges():
    rows = a.forensic_today()
    assert len(rows) == 4
    paper = sum(r["paper_net_rs"] for r in rows)
    assert round(paper) == -975
    nifty0 = rows[0]
    assert nifty0["move_pts"] == 2.45
    assert nifty0["move_vs_scratch"] == 1.02
    chg = costs.options_round_trip(95.70, 93.25, 65, "NSE")
    assert abs(nifty0["exact_charges_rs"] - chg) < 0.02
    sensex = rows[3]
    assert sensex["move_pts"] == 15.05
    assert sensex["move_pts"] > sensex["scratch_pts"]


def test_dte_never_zero_on_expiry_weekday():
    # Tuesday 2026-11-03 is Nifty weekly expiry; next Friday-rule is not used
    # for Nifty Tuesday but next_friday_dte must still be >= 1.
    assert a.next_friday_dte("2026-11-04") >= 1
    assert a.next_last_tuesday_dte("2026-11-04") >= 1
