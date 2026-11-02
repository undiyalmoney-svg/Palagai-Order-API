"""Zerodha F&O charges, per Zerodha's published schedule (checked 2026-11-02).

Futures: brokerage min(Rs20, 0.03%) per executed order; STT 0.05% sell side; NSE txn 0.00183%;
SEBI Rs10/crore; stamp 0.002% buy side; GST 18% on (brokerage + txn + SEBI); IPFT Rs0.01/crore.
Options: brokerage Rs20 flat per executed order; STT 0.15% of premium on sell side; NSE txn 0.03553% of premium;
SEBI Rs10/crore; stamp 0.003% buy side; GST 18% on (brokerage + txn + SEBI); IPFT Rs0.01/crore.
Slippage is NOT in here; it is modelled in points by the caller so it can be swept.
"""

LOTS = {"nifty": 65, "bank": 30}  # valid for sessions on/after 2026-01-06; the research window starts 2026-03-27


def _gst(brokerage, txn, sebi):
    return 0.18 * (brokerage + txn + sebi)


def futures_round_trip(entry_price, exit_price, qty, side=1):
    """side=+1 long (buy then sell), -1 short (sell then buy). Returns rupees."""
    buy_val = (entry_price if side == 1 else exit_price) * qty
    sell_val = (exit_price if side == 1 else entry_price) * qty
    turnover = buy_val + sell_val
    brokerage = min(20.0, 0.0003 * buy_val) + min(20.0, 0.0003 * sell_val)
    stt = 0.0005 * sell_val
    txn = 0.0000183 * turnover
    sebi = 10.0 * turnover / 1e7
    stamp = 0.00002 * buy_val
    ipft = 0.01 * turnover / 1e7
    return brokerage + stt + txn + sebi + stamp + ipft + _gst(brokerage, txn, sebi)


def options_round_trip(buy_premium, sell_premium, qty):
    """Long option: buy at buy_premium, sell at sell_premium."""
    buy_val = buy_premium * qty
    sell_val = sell_premium * qty
    turnover = buy_val + sell_val
    brokerage = 40.0
    stt = 0.0015 * sell_val
    txn = 0.0003553 * turnover
    sebi = 10.0 * turnover / 1e7
    stamp = 0.00003 * buy_val
    ipft = 0.01 * turnover / 1e7
    return brokerage + stt + txn + sebi + stamp + ipft + _gst(brokerage, txn, sebi)


def futures_breakeven_points(price, qty):
    """Index points a futures round trip must clear just to pay charges (zero slippage)."""
    return futures_round_trip(price, price, qty) / qty


if __name__ == "__main__":
    for name, px in (("nifty", 23400.0), ("bank", 55000.0)):
        q = LOTS[name]
        c = futures_round_trip(px, px, q)
        print(f"{name}: 1 lot futures round trip charges Rs{c:,.0f} = {c / q:.1f} index points; notional Rs{px * q:,.0f}")
