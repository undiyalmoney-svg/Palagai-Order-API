"""Fetch Kite historical candles (with OI) for the contracts that are listed today. Token comes from env KT only.

Kite serves history only for contracts still listed, so option/futures history reaches back to each contract's listing
(weeks, not years). The output is written outside the repo (default /tmp/optres) and is read-only research input.
Rate: ~3 requests/second at most (Kite limit for historical); this script sleeps 0.4 s between calls.
"""
import csv, io, json, os, sys, time, urllib.request
from datetime import datetime, timedelta

KT = os.environ["KT"]
H = {"X-Kite-Version": "3", "Authorization": "token " + KT}
OUT = os.environ.get("OUT", "/tmp/optres")
NOW = datetime.now()


def get(url, tries=4):
    err = None
    for _ in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=40).read().decode()
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(1.5)
    raise err


def candles(token, interval, frm, to, oi=True):
    u = f"https://api.kite.trade/instruments/historical/{token}/{interval}?from={frm:%Y-%m-%d}+00:00:00&to={to:%Y-%m-%d}+23:59:59&oi={1 if oi else 0}"
    time.sleep(0.4)
    return json.loads(get(u))["data"]["candles"]


def chunked(token, interval, frm, to, days):
    out, cur = [], frm
    while cur <= to:
        end = min(cur + timedelta(days=days - 1), to)
        out += candles(token, interval, cur, end)
        cur = end + timedelta(days=1)
    return out


def instruments(ex):
    return list(csv.DictReader(io.StringIO(get(f"https://api.kite.trade/instruments/{ex}"))))


def main():
    out = {}
    plans = [("NFO", "NIFTY", 256265, 0.03, 2), ("NFO", "BANKNIFTY", 260105, 0.03, 2), ("BFO", "SENSEX", 265, 0.03, 2), ("MCX", "CRUDEOILM", None, 0.12, 3)]
    for ex, name, spot_token, band, n_exp in plans:
        rows = [r for r in instruments(ex) if r["name"] == name]
        futs = sorted([r for r in rows if r["instrument_type"] == "FUT"], key=lambda r: r["expiry"])[:3]
        if spot_token:
            ref = candles(spot_token, "day", NOW - timedelta(days=10), NOW, oi=False)[-1][4]
        else:
            ref = candles(int(futs[0]["instrument_token"]), "day", NOW - timedelta(days=10), NOW)[-1][4]
        opts = [r for r in rows if r["instrument_type"] in ("CE", "PE")]
        exps = sorted({r["expiry"] for r in opts})[:n_exp]
        sel = [r for r in opts if r["expiry"] in exps and abs(float(r["strike"]) - ref) / ref <= band]
        print(name, "ref", ref, "expiries", exps, "contracts", len(sel), "futs", [f["tradingsymbol"] for f in futs], flush=True)
        for r in futs + sel:
            kind = r["instrument_type"]
            iv = "5minute"
            try:
                c = chunked(int(r["instrument_token"]), iv, NOW - timedelta(days=100), NOW, 90)
            except Exception as e:  # noqa: BLE001
                print("  fail", r["tradingsymbol"], e, flush=True)
                c = []
            out[r["tradingsymbol"]] = dict(name=name, kind=kind, expiry=r["expiry"], strike=float(r["strike"] or 0), lot=int(r["lot_size"]), token=int(r["instrument_token"]), candles=c)
        print(name, "done", sum(1 for k, v in out.items() if v["name"] == name and v["candles"]), flush=True)
    json.dump(out, open(os.path.join(OUT, "listed-5m-oi.json"), "w"))
    print("contracts", len(out), "candles", sum(len(v["candles"]) for v in out.values()))


if __name__ == "__main__":
    main()
