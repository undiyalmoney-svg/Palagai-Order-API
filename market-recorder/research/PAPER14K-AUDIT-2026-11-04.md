# Paper 14k strategy audit — 2026-11-04

Research only. No live orders. The Paper 14k desk was not modified.
Figures that are not the four live paper fills use **modelled** Black-Scholes
premiums (previous-day India VIX, flat intraday, no skew) on 5-minute index
bars, base 0.8% spread + 1 tick/leg, exact Zerodha charges, 1 lot at today's
size. That is the same tape as `OPTIONS-BUYING-RESEARCH.md`. It is **not**
broker-verified option tape.

**Verdict: no statistically validated, after-cost edge is established for the
Paper 14k rules, and none of the four new models is approved for live trading.**

Reproduce: `python3 market-recorder/research/paper14k_audit.py`
(reads `/tmp/optres/{nifty,bank,sensex}-5minute.json` and `vix-day.json`).
Output: `/tmp/optres/out/paper14k-audit.json`.

---

## A. Root-cause analysis of 2026-11-04 paper losses

Desk blotter (flat ₹50 charge) totals **−₹975**. Exact Zerodha charges on the
same four fills total **₹267** vs the desk's ₹200, so the after-cost loss is
about **−₹1,042**. Historical rows were not edited.

| Contract | Entry → exit | Mode | Move | Designed scratch / SL | Paper ₹ | Exact charges | Exact net |
|---|---|---|---:|---|---:|---:|---:|
| NIFTY 23950 CE exp 9 Nov | 95.70 → 93.25 | pdhl | 2.45 | 2.4 / 5 | −209 | 61.64 | −221 |
| NIFTY 24000 CE exp 9 Nov | 90.25 → 87.85 | trap | 2.40 | 2.4 / 5 | −206 | 60.81 | −217 |
| BANKNIFTY 55900 CE exp 23 Nov | 604.70 → 599.40 | pdhl | 5.30 | 5 / 10 | −209 | 89.90 | −249 |
| SENSEX 77500 CE exp 5 Nov | 173.30 → 158.25 | trap | 15.05 | 8 / 16 | −351 | 54.60 | −356 |

### What actually caused each loss

1. **Nifty 23950 CE (pdhl).** The move is 1.02× the 2.4-point scratch. This is
   the designed cheap-OTM scratch firing on a ~₹96 premium (2.6%). Recorder
   bid/ask later in the session was **0.25–0.30%** of premium (~₹0.25), so
   spread alone does not explain 2.45 points. Delta ~0.36–0.42, IV ~14–15%,
   India VIX 15.7. The desk paid the live ask and scratched when last/low
   printed 2.4 points under that ask. Cause: **fixed-point scratch too tight
   for the live premium, plus last-price/stop check against an ask fill.**

2. **Nifty 24000 CE (trap).** Move equals the 2.4-point scratch exactly.
   Same mechanism as (1). A second entry the same morning after the first
   scratch — **no cooldown**. Recorded LTP on this strike never printed 90.25
   in the 1-minute snapshots we have (session min in the recorder is 97.55 at
   13:04). The desk fill is still the blotter of record; the recorder simply
   does not contain that print.

3. **Bank Nifty 55900 CE (pdhl).** Move 5.3 vs scratch 5.0 (1.06×). Premium
   ~₹605, scratch = **0.8%**. This is monthly DTE ~19, delta ~0.47–0.50
   (near ATM, not cheap OTM). 1-lot cash ~₹18,000. Theta about −₹22/unit/day
   (−₹660/lot/day) does not explain a 5-point print. Cause: **point scratch
   designed for a ₹100 premium, applied to a ₹600 premium.** Spread when
   quoted was 0.27–0.41% (~₹1.6–2.5), smaller than the scratch, so this is
   a real 5-point dip after paying the ask, not a 2% book.

4. **Sensex 77500 CE (trap).** Move 15.05 points: through the 8-point scratch,
   almost to the 16-point SL. Exit labelled scratch because a gapped bar
   fills at `min(scratch, open)` and keeps the scratch reason. Expiry is
   **2026-11-05 (DTE 1)**. Recorder theta −140 to −158/unit/day. Morning
   premium ran 227 → 339 (09:30) → 223 (10:22), then the strike left ATM±3
   and the recorder stopped. Desk entry 173.30 is **₹50 below the last
   recorded print**. Cause: **direction against a long CE after a morning
   spike, DTE-1 theta, trap entry — not scratch tightness alone.**

### Audit of the rest of the stack (today)

| Factor | Finding |
|---|---|
| Entry / timing | pdhl and trap after the opening-range window; confirmation candle required. Desk started after the morning, so some fills are replayed signals bound at a later ask. |
| Trend / direction | All four were long CE. No PE was taken. Prior 3-year screen: CE buckets lose more than PE (T7b). |
| Strike | Picker aims +200 / +400 / +500 OTM but selected 23950/24000, 55900, 77500 (ATM+2 to +3). Rel_strike in the recorder is 2–3. |
| Premium | ₹90–605, not the plan's ₹50 / ₹100 / ₹150. |
| Bid/ask | Measured 0.25–0.41% when a two-sided book existed. Not the main loss. Historical spreads still missing. |
| Slippage | Desk uses last; live-like model uses 1 tick/leg. Sensex gapped through scratch. |
| IV / VIX | VIX 15.6–15.7 (low). Nifty IV ~0.14–0.15, Bank ~0.13–0.14, Sensex ~0.20. |
| Delta / gamma | Nifty δ 0.36–0.42; Bank δ 0.47–0.50; Sensex δ 0.36–0.45. Gamma small. These are not 0.10-delta lottery tickets. |
| Theta | Material only on Sensex DTE 1. |
| Liquidity | Two-sided books when quoted. Early 09:05 Nifty prints have empty depth. |
| Time of day | Entries after 09:45 / 10:15 by rule. Sensex damage is the post-spike fade. |
| Re-entry | Nifty took a second trade the same morning after a scratch. No cooldown. |
| Daily loss cap | ₹420 per book. Nifty −415 is at the cap; Sensex −351 is under it. Cap did not prevent the four tickets. |
| ₹50 charge | Understates NSE options (₹61–90 today). |

---

## B. Comparison of four models (identical modelled tape)

Pre-registered, not swept. Chronological split: train 55% / val 20% / test 25%
of trading days, 1-day embargo (`opt_core.chrono_split`). One trade per day.
Cheap-OTM offset −4 / −4 / −5 steps. DTE proxy 3 (Nifty, Sensex) and 10 (Bank).

| Model | Rule |
|---|---|
| Baseline | Paper 14k entries + existing point scratch/SL/TP. Scratch allowed on the fill bar. |
| A | Same entries/levels. Skip scratch on the fill bar (improved execution). |
| B | Same entries. Scratch 8% / SL 16% / TP 32% of the ask. Skip fill-bar scratch. |
| C | Same entries. Scratch 0.75× / SL 1.5× / TP 3× first-bar option range, floor 1.5× half-spread. |
| D | Model C exits only when the Paper 14k signal also passes the 6-bar momentum thrust. |

**TEST (unseen days) — modelled net ₹ / trade [95% day-bootstrap CI]**

| Model | Nifty | Bank Nifty | Sensex |
|---|---|---|---|
| Baseline | +101 [41, 156] n=171 | **−24 [−79, 32] n=169** | +37 [−20, 95] n=167 |
| A | +143 [79, 202] n=171 | +233 [161, 308] n=169 | +133 [69, 199] n=167 |
| B | +122 [8, 236] n=171 | +271 [−37, 623] n=169 | +87 [−36, 211] n=167 |
| C | +117 [3, 241] n=171 | +252 [2, 513] n=169 | +105 [−34, 250] n=167 |
| D | +557 n=3 | −135 n=7 | +904 n=2 |

**VALIDATION (the honesty check — not used to pick)**

| Model | Nifty | Bank Nifty | Sensex |
|---|---|---|---|
| Baseline | +31 [−30, 96] | −26 [−84, 37] | +30 [−29, 88] |
| A | +37 [−23, 98] | +117 [48, 191] | +73 [11, 135] |
| B | +67 [5, 128] | +354 [138, 574] | +82 [1, 166] |
| C | +58 [−5, 124] | +274 [92, 474] | +136 [36, 254] |
| D | n=1 | n=0 | n=3 |

Scratch share on baseline TEST: Nifty 99/171, Bank 117/169, Sensex 110/167
(about two thirds). That matches today's 4/4 scratches.

### Why a green TEST cell is not a live edge

- Constant-IV paths are smoother than live options. Skipping the fill-bar
  scratch (A vs baseline) turns Bank TEST from −24 to +233. Today's Bank
  fill scratched 5.3 points **immediately** — the live path is not the model.
- Tier-2 fidelity (T10): mean net real vs model was −64 vs −92 (Nifty),
  −160 vs −458 (Bank), **−437 vs −45 (Sensex)**. A +133 Sensex TEST on the
  model can be a −300 live number.
- The 2026 TEST window has positive random-entry medians in the earlier
  study (T5). Long-volatility buyers look better than they are.
- Model D sample is 2–7 TEST trades. Rejected.

---

## C. Recommended entry conditions

Tested **independently** on Model A (no stacking):

| Filter | VAL result vs unfiltered A | Decision |
|---|---|---|
| None | Nifty +37 CI crosses 0; Bank +117; Sensex +73 | Baseline for any paper-forward |
| Prior-day chop | Weaker or similar on VAL; Nifty CI still crosses 0 | Do not add |
| Skip low VIX | VAL n collapses (13–15 days) | Do not add |
| Momentum confirm | n = 0–3 on VAL | Do not add |

**Not recommended until real-quote forward data exists:** RSI, ADX, EMA stack,
volume (index volume is zero on this tape), VWAP as a hard gate, breakout
stacking. The earlier 3-year family screen already tested EMASTACK, AVGCROSS,
ORB15, SRBRK, TRENDPULL — none beat random after costs except MOMENTUM, and
MOMENTUM does not overlap Paper 14k often enough to use as a gate.

Keep: morning structure, one confirmation candle, next-expiry only (never
DTE 0), one lot. Add a **cooldown after a scratch** (paper-only hypothesis:
no second entry for 60 minutes). That was not backtested as a family; it is
a risk rule, not an edge claim.

---

## D. Recommended exit conditions

| Approach | Evidence | Decision |
|---|---|---|
| Existing point scratch | 58–69% of modelled TEST trades; 4/4 live today | Keep as **baseline** so results stay comparable |
| Skip fill-bar scratch (A) | Helps on modelled tape; unproven on live quotes | Paper-only experiment, not live |
| 8/16/32% (B) | Bank TEST DD ₹19,487; Sensex TEST CI crosses 0 | Reject |
| ATR (C) | Bank/Sensex TEST DD ₹11–12k; Sensex CI crosses 0 | Reject |
| Trail / partials / time | Not tested (would be a new search) | Do not add |
| No-trade if spread > 3% | Live spreads today were 0.25–0.4% | Harmless filter; will not fix today's losses |

Instrument-specific **paper** hypothese (not live, not fitted on TEST):

- Nifty: if experimenting, keep points but raise scratch from 2.4 to at least
  2× half-spread + 1 tick, and do not scratch on the fill bar.
- Bank Nifty: point scratch of 5 on a ₹600 premium is noise. Either leave
  Bank on the baseline (and accept frequent scratches) or paper-test %
  exits knowing DD in the model is already ₹19k.
- Sensex: refuse DTE 1 (expiry week Friday). Today's −₹351 is a DTE-1 CE.

---

## E. Instrument-specific parameters (desk as it stands)

| | Nifty | Bank Nifty | Sensex |
|---|---|---|---|
| Lot | 65 | 30 | 20 |
| Plan premium | ₹50 | ₹100 | ₹150 |
| Live premium today | ₹90–96 | ₹605 | ₹173 |
| Scratch / SL / TP (pts) | 2.4 / 5 / 10 | 5 / 10 / 22 | 8 / 16 / 32 |
| OR → first entry | 10:15 | 09:45 | 09:45 |
| Flat | 15:15 | 15:15 | 15:15 |
| Day-loss cap | ₹420 | ₹420 | ₹420 |
| 1-lot cash today | ~₹6,200 | ~₹18,200 | ~₹3,500+ (later 173) |
| Expiry | Weekly Tue | Monthly last Tue | Weekly Fri |

---

## F. Risk-management rules (paper desk; still no live orders)

1. 1 lot. Never increase size after a loss.
2. Keep `liveOrders = false`.
3. Day-loss cap ₹420 **per book** remains. After a −₹209 Nifty scratch the
   book has ~₹211 left — a second Nifty ticket today nearly emptied it.
4. Maximum 1 open trade per book (already). Add: **maximum 1 closed scratch
   then stand down for the session** (cooldown). Not validated as +EV;
   it limits repeat noise.
5. No trade when depth is empty (09:05-style prints).
6. No trade on DTE 0; paper-hypothesis: no Sensex/Nifty DTE 1.
7. Do not copy Bank Nifty live unless the equity pocket has the live 1-lot
   ask (today ~₹18,000), which is above the ₹14,000 book sticker.
8. Liquidity: reject if modelled or quoted spread > 3% of premium.

---

## G. Backtesting methodology (this audit)

- Signals: port of `live-assume.engine.ts` morning structure + primary/backup
  + confirmation. Fill at the next bar (delay 0).
- Premium: Black-Scholes, IV = previous session India VIX close, path
  rescaled to the last session's open, current lots.
- Buyer pays mid + 0.4% + 1 tick; seller receives mid − 0.4% − 1 tick.
- Stop/scratch tested before target; gap through a stop fills at the open.
- Charges: `costs.options_round_trip` (Zerodha schedule checked 2026-11-02).
- Split: train / val / test by trading day, embargo 1 day. TEST once.
- CI: day bootstrap, 2000 resamples.
- Filters evaluated independently on Model A; none were selected on TEST.

Missing from this tape (do not invent): historical bid/ask, intraday IV,
skew, OI, index volume, the exact cheap-OTM contract's real premium path.

---

## H. Out-of-sample validation results

See tables in B. In words:

- **Baseline** (the live desk): Bank Nifty negative on train, val and test.
  Nifty and Sensex TEST CIs are mixed (Sensex includes 0; Nifty VAL includes 0).
- **A**: best looking modelled numbers; Nifty VAL CI still includes 0.
  Execution change is untested on real quotes (today contradicts it).
- **B / C**: larger modelled means, larger drawdowns, several TEST CIs
  include 0.
- **D**: rejected (n < 20 on every TEST cell).

Earlier study (`OPTIONS-BUYING-RESEARCH.md` T3, T5): the best grid-selected
CE/PE buckets are not distinguishable from a direction-randomised search.
Paper 14k is a PDHL/trap/fade family. T2 PDHL medians were negative or
indistinguishable from random.

---

## I. Reasons for rejecting unsuccessful models

- **D:** 2–18 trades. Win rate 100% on 3 Nifty TEST trades is noise.
- **B:** Bank TEST max DD ₹19,487 on a ₹14,000 sticker book. Sensex TEST
  losing streak 23. CI includes 0 on Bank and Sensex TEST.
- **C:** Same DD problem; ATR from the first modelled bar is a weak vol
  estimator and uses post-signal range (conservative floor added).
- **Stacked indicators:** not tested in combination; independent filters
  did not improve VAL.
- **Declaring A profitable:** would ignore T10 model error, Nifty VAL CI,
  and today's live scratches.

---

## J. Final recommended strategy rules (implementation-ready, paper only)

Do **not** arm live. Do **not** replace the baseline until a real-quote
forward sample says so.

```
BOOKS: nifty, bank, sensex   # crude unchanged, not in this audit
MODE: paper, liveOrders=false, guaranteed=false
ENTRY:
  morning structure from OR
  primary then backup (pdhl / fade / trap / vwap_fade)
  one confirmation candle
  next listed expiry, DTE >= 1
  1 lot at live ask if two-sided book exists, else skip
  cooldown: after a scratch, no new entry that session
EXIT (baseline, keep recording):
  existing point scratch / SL / TP
  option 5-minute bars only (never index bars)
  EOD 15:15
RISK:
  day-loss cap ₹420 / book
  never add size
  show exact venue charges and 1-lot cash needed
FORWARD SUCCESS RULE (pre-registered, do not tune):
  >= 400 real-quote paper fills
  one-sided lower 95% day-bootstrap CI of net ₹/trade > 0
  after exact charges and observed bid/ask
  if this fails, stop; do not add indicators
```

Optional **parallel paper book** (not the default blotter): Model A only
(skip fill-bar scratch). Same success rule. If it fails on real quotes,
discard it.

---

## K. Changes required in existing trading code

**Do not apply these to live order modules. Do not merge them as “the
profitable strategy.”**

| Item | File | Action | Do now? |
|---|---|---|---|
| Keep `liveOrders: false` | `live-paper.engine.ts` | No change | Yes (already) |
| Keep losing fills in the ledger | `paper-ledger.service.ts` | No delete/edit | Yes (already) |
| Exact charges vs ₹50 flat | `live-paper.engine.ts` `closeAt` | Optional display: show `optionRoundTripCharges` next to the ₹50 figure | Paper-only, later |
| Fill-bar scratch skip | `hitExit` / tick after `bindCheap` | Only on a parallel paper book | Not until real-quote sample |
| Scratch % / ATR | `option-14k-plan.ts` | Do not replace baseline | No |
| Cooldown after scratch | `tickBook` `canOpen` | One-line stand-down | Paper risk rule, optional |
| Refuse DTE 1 | `pickCheapOtm` | Skip dying week **and** the last session before expiry | Paper hypothesis |
| Recorder follow the picked strike | recorder universe | Today's Sensex 77500 vanished after 10:22 | Yes, data quality |
| This audit runner | `paper14k_audit.py` | Keep as research | Yes |

---

## Data still required (not invented)

1. Historical bid/ask and depth for the **exact** contract the desk buys
   (recorder started 2026-11-03; Sensex already drops strikes that leave ±3).
2. Intraday IV and skew (model is flat VIX).
3. ~400 forward paper fills on real quotes before any “edge” sentence.
4. Index volume if a volume filter is ever proposed (currently zero).

Until those exist, the honest statement remains: **today lost ₹975
(₹1,042 exact), the baseline Bank book loses on the modelled OOS split,
and no model in this audit is live-ready.**
