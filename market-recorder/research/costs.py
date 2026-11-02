"""Zerodha F&O charges, per Zerodha's published schedule (checked 2026-11-02).

Futures: brokerage min(Rs20, 0.03%) per executed order; STT 0.05% sell side; NSE txn 0.00183%;
SEBI Rs10/crore; stamp 0.002% buy side; GST 18% on (brokerage + txn + SEBI); IPFT Rs0.01/crore.
Options: brokerage Rs20 flat per executed order; STT 0.15% of premium on sell side; NSE txn 0.03553% of premium;
SEBI Rs10/crore; stamp 0.003% buy side; GST 18% on (brokerage + txn + SEBI); IPFT Rs0.01/crore.
Venue variants (same schedule, checked 2026-11-02): BSE (Sensex) options txn 0.0325% of premium, STT/stamp as NSE;
MCX crude options: brokerage Rs20 flat, CTT 0.05% of premium sell side, MCX txn 0.0418% of premium, stamp 0.003% buy side;
MCX crude futures: brokerage min(Rs20, 0.03%), CTT 0.01% sell side, MCX txn 0.0021%, stamp 0.002% buy side.
LOTS['crudem'] is barrels per CRUDEOILM lot (Kite lot_size is 1 exchange lot = 10 barrels), so premium Rs/bbl x 10 = Rs per lot.
Slippage is NOT in here; it is modelled in points by the caller so it can be swept.
"""

import numpy as np

LOTS = {"nifty": 65, "bank": 30, "sensex": 20, "crudem": 10}  # valid for sessions on/after 2026-01-06; the research window starts 2026-03-27


def _gst(brokerage, txn, sebi):
    return 0.18 * (brokerage + txn + sebi)


_FUT = {  # brokerage cap, sell-side tax, txn, stamp
    "NSE": dict(tax=0.0005, txn=0.0000183, stamp=0.00002),
    "BSE": dict(tax=0.0005, txn=0.0, stamp=0.00002),
    "MCX": dict(tax=0.0001, txn=0.000021, stamp=0.00002),
}
_OPT = {
    "NSE": dict(tax=0.0015, txn=0.0003553, stamp=0.00003),
    "BSE": dict(tax=0.0015, txn=0.000325, stamp=0.00003),
    "MCX": dict(tax=0.0005, txn=0.000418, stamp=0.00003),
}


def futures_round_trip(entry_price, exit_price, qty, side=1, venue="NSE"):
    """side=+1 long (buy then sell), -1 short (sell then buy). Returns rupees."""
    p = _FUT[venue]
    long_ = np.asarray(side) == 1
    buy_val = np.where(long_, entry_price, exit_price) * qty
    sell_val = np.where(long_, exit_price, entry_price) * qty
    turnover = buy_val + sell_val
    brokerage = np.minimum(20.0, 0.0003 * buy_val) + np.minimum(20.0, 0.0003 * sell_val)
    stt = p["tax"] * sell_val
    txn = p["txn"] * turnover
    sebi = 10.0 * turnover / 1e7
    stamp = p["stamp"] * buy_val
    ipft = 0.01 * turnover / 1e7
    return brokerage + stt + txn + sebi + stamp + ipft + _gst(brokerage, txn, sebi)


def options_round_trip(buy_premium, sell_premium, qty, venue="NSE"):
    """Long option: buy at buy_premium, sell at sell_premium. qty is units (lot size x lots), premium is Rs per unit."""
    p = _OPT[venue]
    buy_val = buy_premium * qty
    sell_val = sell_premium * qty
    turnover = buy_val + sell_val
    brokerage = 40.0
    stt = p["tax"] * sell_val
    txn = p["txn"] * turnover
    sebi = 10.0 * turnover / 1e7
    stamp = p["stamp"] * buy_val
    ipft = 0.01 * turnover / 1e7
    return brokerage + stt + txn + sebi + stamp + ipft + _gst(brokerage, txn, sebi)


def options_charge_breakdown(buy_premium, sell_premium, qty, venue="NSE"):
    p = _OPT[venue]
    buy_val, sell_val = buy_premium * qty, sell_premium * qty
    turnover = buy_val + sell_val
    brokerage, stt, txn = 40.0, p["tax"] * sell_val, p["txn"] * turnover
    sebi, stamp, ipft = 10.0 * turnover / 1e7, p["stamp"] * buy_val, 0.01 * turnover / 1e7
    gst = _gst(brokerage, txn, sebi)
    return dict(brokerage=brokerage, stt_ctt=stt, exchange_txn=txn, sebi=sebi, stamp=stamp, ipft=ipft, gst=gst, total=brokerage + stt + txn + sebi + stamp + ipft + gst)


def futures_breakeven_points(price, qty, venue="NSE"):
    """Index points a futures round trip must clear just to pay charges (zero slippage)."""
    return futures_round_trip(price, price, qty, venue=venue) / qty


if __name__ == "__main__":
    for name, px, v in (("nifty", 23400.0, "NSE"), ("bank", 55000.0, "NSE"), ("sensex", 75000.0, "BSE"), ("crudem", 9300.0, "MCX")):
        q = LOTS[name]
        c = futures_round_trip(px, px, q, venue=v)
        print(f"{name}: 1 lot futures round trip charges Rs{c:,.0f} = {c / q:.1f} points; notional Rs{px * q:,.0f}")
