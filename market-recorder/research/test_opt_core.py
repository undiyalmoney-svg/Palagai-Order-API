import copy
import unittest

import numpy as np
import pandas as pd

import costs
import opt_core as oc


def synth_days(n_days=40, seed=3, bars=75, start=23000.0):
    rng = np.random.default_rng(seed)
    days = {}
    px = start
    for d in range(n_days):
        date = (pd.Timestamp("2026-01-01") + pd.Timedelta(days=d)).strftime("%Y-%m-%d")
        r = rng.normal(0, 0.0007, bars)
        c = px * np.exp(np.cumsum(r))
        o = np.concatenate([[px], c[:-1]])
        spread = np.abs(rng.normal(0, 0.0005, bars)) * c
        h = np.maximum(o, c) + spread
        l = np.minimum(o, c) - spread
        days[date] = dict(min=555 + 5 * np.arange(bars), o=o, h=h, l=l, c=c)
        px = c[-1]
    return days


class TestPricing(unittest.TestCase):
    def test_put_call_parity(self):
        S, K, T, iv, r = 23400.0, 23500.0, 5 / 365, 0.15, 0.065
        c = oc.bs_price(S, K, T, iv, True)
        p = oc.bs_price(S, K, T, iv, False)
        self.assertAlmostEqual(float(c - p), S - K * np.exp(-r * T), places=6)

    def test_black76_parity(self):
        F, K, T, iv = 9300.0, 9350.0, 10 / 365, 0.55
        self.assertAlmostEqual(float(oc.black76(F, K, T, iv, True) - oc.black76(F, K, T, iv, False)), F - K, places=6)

    def test_expiry_returns_intrinsic(self):
        self.assertAlmostEqual(float(oc.bs_price(23500, 23400, 0, 0.15, True)), 100.0)
        self.assertAlmostEqual(float(oc.bs_price(23300, 23400, 0, 0.15, True)), 0.0)


class TestNoLookAhead(unittest.TestCase):
    def test_signals_at_bar_i_do_not_depend_on_later_bars(self):
        days = synth_days()
        sigs, _ = oc.gen_signals(days)
        keys = sorted(days)
        checked = 0
        for fam, lst in sigs.items():
            for sg in lst[:: max(1, len(lst) // 12)]:
                d2 = copy.deepcopy(days)
                k = keys.index(sg.date)
                for key in ("o", "h", "l", "c"):
                    d2[sg.date][key][sg.i + 1 :] = 1.0  # destroy everything after the signal bar
                    for later in keys[k + 1 :]:
                        d2[later][key][:] = 1.0
                s2, _ = oc.gen_signals(d2)
                same = [x for x in s2[fam] if x.date == sg.date and x.i == sg.i and x.direction == sg.direction]
                self.assertTrue(same, f"{fam} signal at {sg.date} bar {sg.i} changed when the future was altered")
                checked += 1
        self.assertGreater(checked, 20)

    def test_entry_is_after_signal_bar(self):
        days = synth_days()
        sigs, _ = oc.gen_signals(days)
        vix = {d: 0.15 for d in days}
        for delay in (0, 1):
            G, meta = oc.gather(sigs["ORB15"], days, vix, delay=delay)
            for r in range(len(meta)):
                d = meta.loc[r, "date"]
                i = meta.loc[r, "i"]
                self.assertEqual(G["min"][r, 0], days[d]["min"][i + 1 + delay])
                self.assertEqual(G["o"][r, 0], days[d]["o"][i + 1 + delay] * meta.loc[r, "scale"])


class TestExits(unittest.TestCase):
    def _P(self, o, fav, adv, c):
        n = len(o)
        H = oc.H_BARS
        f = lambda a: np.pad(np.array(a, float), ((0, 0), (0, H - len(a[0]))), constant_values=np.nan)
        return dict(o=f(o), fav=f(fav), adv=f(adv), c=f(c))

    def test_stop_is_taken_before_target_when_both_hit_in_one_bar(self):
        P = self._P([[100, 100, 100]], [[100, 200, 100]], [[100, 50, 100]], [[100, 100, 100]])
        meta = pd.DataFrame(dict(date=["d"], i=[1], direction=[1], nbars=[3]))
        tr = oc.exit_trades(P, meta, "NIFTY", "tight", stop=0.3, target=0.5, hold=45)
        self.assertEqual(tr.loc[0, "kind"], "stop")

    def test_gap_through_stop_fills_at_open_not_at_stop(self):
        P = self._P([[100, 40, 40]], [[100, 40, 40]], [[100, 40, 40]], [[100, 40, 40]])
        meta = pd.DataFrame(dict(date=["d"], i=[1], direction=[1], nbars=[3]))
        tr = oc.exit_trades(P, meta, "NIFTY", 0.0, stop=0.3, target=0.5, hold=45, slip_ticks=0)
        # sells at the gap open (40) minus half a tick (tick floor), not at the 70 stop level
        self.assertLess(tr.loc[0, "exit"], 41)

    def test_target_limit_fills_at_target_level(self):
        P = self._P([[100, 100, 100]], [[100, 160, 100]], [[100, 99, 100]], [[100, 120, 100]])
        meta = pd.DataFrame(dict(date=["d"], i=[1], direction=[1], nbars=[3]))
        tr = oc.exit_trades(P, meta, "NIFTY", 0.0, stop=0.3, target=0.5, hold=45, slip_ticks=0)
        self.assertEqual(tr.loc[0, "kind"], "target")
        self.assertAlmostEqual(tr.loc[0, "exit"], 150 - 0.025, places=6)

    def test_net_includes_spread_slippage_and_exact_charges(self):
        P = self._P([[100, 100]], [[100, 100]], [[100, 100]], [[100, 100]])
        meta = pd.DataFrame(dict(date=["d"], i=[1], direction=[1], nbars=[2]))
        tr = oc.exit_trades(P, meta, "NIFTY", "base", stop=0.3, target=0.5, hold=45, slip_ticks=1)
        row = tr.loc[0]
        qty = 65
        expected_charge = costs.options_round_trip(row["entry"], row["exit"], qty, "NSE")
        self.assertAlmostEqual(row["charges"], expected_charge, places=6)
        self.assertAlmostEqual(row["net"], (row["exit"] - row["entry"]) * qty - expected_charge, places=6)
        self.assertLess(row["net"], 0)  # a flat premium must lose money after spread and charges


class TestMetrics(unittest.TestCase):
    def test_chronological_split_has_no_overlap_and_embargo(self):
        dates = [f"2025-01-{d:02d}" if d <= 31 else f"2025-02-{d - 31:02d}" for d in range(1, 60)]
        s = oc.chrono_split(dates)
        self.assertLess(max(s["train"]), min(s["val"]))
        self.assertLess(max(s["val"]), min(s["test"]))
        self.assertGreater(dates.index(min(s["val"])) - dates.index(max(s["train"])), 1)
        self.assertGreater(dates.index(min(s["test"])) - dates.index(max(s["val"])), 1)

    def test_drawdown_and_streak(self):
        self.assertEqual(oc.max_drawdown(np.array([5, -3, -4, 2, -1])), 7.0)
        self.assertEqual(oc.longest_losing_streak([1, -1, -1, -1, 2, -1]), 3)


if __name__ == "__main__":
    unittest.main()
