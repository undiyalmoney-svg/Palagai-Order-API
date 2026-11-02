import math
from costs import futures_round_trip, options_round_trip, futures_breakeven_points, LOTS


def test_futures_nifty_charges_match_hand_calc():
    px, q = 23400.0, 65
    v = px * q
    brokerage = 40.0
    stt = 0.0005 * v
    txn = 0.0000183 * 2 * v
    sebi = 10 * 2 * v / 1e7
    stamp = 0.00002 * v
    ipft = 0.01 * 2 * v / 1e7
    gst = 0.18 * (brokerage + txn + sebi)
    assert math.isclose(futures_round_trip(px, px, q), brokerage + stt + txn + sebi + stamp + ipft + gst, rel_tol=1e-9)
    assert 850 < futures_round_trip(px, px, q) < 1000  # about 14 index points of cost per round trip


def test_short_pays_stt_on_the_first_leg():
    long_cost = futures_round_trip(23400, 23410, 65, side=1)
    short_cost = futures_round_trip(23400, 23390, 65, side=-1)
    assert long_cost > 0 and short_cost > 0


def test_option_charges_are_a_small_fraction_of_premium():
    c = options_round_trip(100.0, 110.0, 65)
    assert 55 < c < 90
    assert c / (110 * 65) < 0.015


def test_breakeven_points():
    assert 13 < futures_breakeven_points(23400, LOTS["nifty"]) < 16
    assert 30 < futures_breakeven_points(55000, LOTS["bank"]) < 36


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
