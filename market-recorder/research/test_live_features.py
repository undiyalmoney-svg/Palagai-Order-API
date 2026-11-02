import sqlite3
import numpy as np
import pandas as pd
from live_features import features, load_quotes
from events import outcomes
from models import auc_power_events
from datetime import datetime, timedelta


def synthetic(extra_after=0):
    db = sqlite3.connect(":memory:")
    db.executescript(open("../db.js").read().split("const SCHEMA = `")[1].split("`;")[0])
    ins = db.execute
    ins("insert into instruments (token,symbol,underlying,kind,expiry,strike,lot_size,first_seen,last_seen) values (1,'NIFTYFUT','NIFTY','FUT','2026-11-23',0,65,'d','d')")
    ins("insert into instruments (token,symbol,underlying,kind,expiry,strike,lot_size,first_seen,last_seen) values (2,'NIFTYSPOT','NIFTY','SPOT',null,null,null,'d','d')")
    ins("insert into instruments (token,symbol,underlying,kind,expiry,strike,lot_size,first_seen,last_seen) values (3,'NCE','NIFTY','CE','2026-11-03',23400,65,'d','d')")
    ins("insert into instruments (token,symbol,underlying,kind,expiry,strike,lot_size,first_seen,last_seen) values (4,'NPE','NIFTY','PE','2026-11-03',23400,65,'d','d')")
    t0 = datetime(2026, 11, 3, 9, 30)
    for k in range(40 + extra_after):
        key = (t0 + timedelta(minutes=k)).strftime("%Y-%m-%d %H:%M")
        for tok, ltp in ((1, 23400 + k), (2, 23380 + k), (3, 100 + k * 0.5), (4, 100 - k * 0.3)):
            kind = {1: "FUT", 2: "SPOT", 3: "CE", 4: "PE"}[tok]
            ins("insert into quotes (token,minute_key,fetch_ts,ltp,volume,vol_delta,oi,oi_delta,bid1,ask1,bid1_qty,ask1_qty,bid5_qty,ask5_qty,rel_strike,iv_calc) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (tok, key, key, ltp, 1000 * k, 100 + (50000 if k > 36 else 0), 5000 + k, 10, ltp - 0.5, ltp + 0.5, 100, 50, 400, 200, 0 if tok > 2 else None, 0.14 + 0.0001 * k if tok > 2 else None))
    db.commit()
    return db


def test_features_ignore_snapshots_after_the_cutoff():
    ev = pd.Timestamp("2026-11-03 10:00")
    a = features(load_quotes(synthetic(0)), "nifty", ev, 1, delay=0)
    b = features(load_quotes(synthetic(20)), "nifty", ev, 1, delay=0)
    assert a and pd.Series(a).equals(pd.Series(b))


def test_delay_moves_the_cutoff_forward_one_snapshot():
    ev = pd.Timestamp("2026-11-03 09:55")
    q = load_quotes(synthetic(0))
    f0 = features(q, "nifty", ev, 1, delay=0)
    f1 = features(q, "nifty", ev, 1, delay=1)
    assert not pd.Series(f0).equals(pd.Series(f1))
    assert "fbook_imb" in f0 and f0["fbook_imb"] > 0


def test_a_late_volume_burst_cannot_leak_into_an_earlier_event():
    q = load_quotes(synthetic(0))
    early = features(q, "nifty", pd.Timestamp("2026-11-03 09:55"), 1, delay=0)
    late = features(q, "nifty", pd.Timestamp("2026-11-03 10:08"), 1, delay=0)
    assert late["fvol5_live_rel"] > early["fvol5_live_rel"]


def test_outcome_same_bar_target_and_stop_counts_as_stop():
    o = np.array([100.0, 100.0, 100.0]); h = np.array([100.0, 111.0, 100.0]); l = np.array([100.0, 94.0, 100.0]); c = o.copy()
    assert outcomes(o, h, l, c, 0, 1, 10.0, 5.0, n_after=2) == (-5.0, "stop")


def test_power_calculation():
    assert 700 < auc_power_events(0.55) < 900


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
            print("ok", n)
