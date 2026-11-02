"""Does any target/stop pair beat the charge wall with NO model at all? Every breakout event, futures, 1 lot."""
import sqlite3, sys
import numpy as np
import pandas as pd
import events
from costs import LOTS, futures_round_trip
from models import SLIP_PTS


def sweep(db, name, other, targets, stop_mults):
    bars = events.load_bars(db, events.TOKENS[name])
    ev = events.build(db, name, other, stops=(1.0,))
    by = {d: g.reset_index(drop=True) for d, g in bars.groupby("date")}
    rows = []
    lot = LOTS[name]
    for T in targets:
        for sm in stop_mults:
            S = T * sm
            nets, grs = [], []
            for r in ev.itertuples():
                g = by[r.date]
                i = int(g.index[g["ts"] == r.ts][0])
                res = events.outcomes(g["open"].values, g["high"].values, g["low"].values, g["close"].values, i, r.dir, T, S)
                if res is None:
                    continue
                pts = res[0]
                px = g["open"].values[i + 1]
                nets.append(pts * lot - SLIP_PTS[name] * lot - futures_round_trip(px, px + r.dir * pts, lot, side=r.dir))
                grs.append(pts)
            rows.append(dict(index=name, target=T, stop=S, events=len(nets), gross_pts=np.mean(grs), net_rs_per_trade=np.mean(nets), win=np.mean(np.array(grs) > 0)))
    return pd.DataFrame(rows)


if __name__ == "__main__":
    db = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else "/tmp/research-db/recorder.sqlite")
    pd.set_option("display.width", 160)
    print(sweep(db, "nifty", "bank", [10, 20, 30, 50], [0.5, 1.0, 1.5]).round(2).to_string(index=False))
    print(sweep(db, "bank", "nifty", [17, 40, 70, 100], [0.5, 1.0, 1.5]).round(2).to_string(index=False))
