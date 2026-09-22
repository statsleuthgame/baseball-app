# Fantasy model: evaluation status and next experiment

**Review date:** September 22, 2026.
**Source reviewed:** `d87999add3bf02b552551418773114e543ea279e`.

## What exists

[`fantasy.py`](../backend/app/services/fantasy.py) estimates hitter fantasy points from historical event rates and contextual adjustments. [`backtest_fantasy.py`](../scripts/backtest_fantasy.py) reconstructs many inputs as of the previous day, joins predictions to game outcomes, and searches a grid of weights.

The checked-in [weight file](../backend/app/data/fantasy_weights.json) contains historical calibration metrics: R² 0.1246, MAE 4.8246, Spearman 0.3559, and 1,721 test rows, labeled version `2026-04-18`. These are **stored, unverified historical results**, not newly reproduced measurements. No matching backtest CSV is tracked in the reviewed repository, and the file does not identify its evaluation date window or dataset hash.

## Why these are not yet pregame performance claims

| Finding in the reviewed code | Consequence |
| --- | --- |
| Generation passes `actual_pa = max(1, row["pa"])` into `project_hitter_points` | This evaluates scoring conditional on observed opportunities. Actual plate appearances are unknown before a game; it is not an end-to-end pregame forecast. |
| Fitting splits the first 80% and final 20% of input rows without sorting or grouping dates | A single game/day can cross the boundary, and a reordered or resumed CSV need not provide a chronological holdout. |
| League rates load from a fixed `league_rates_2026.json`; sprint speed is fetched by season; handedness is inferred across the loaded parquet | Historical availability is not enforced for every input. Snapshot provenance and cutoff checks are needed. This is a risk to audit, not proof that each stored metric was affected. |
| The fitter implements its own reprojection formula instead of invoking the production projection function | Parity needs testing so a calibration score measures the same computation used by the app. |
| The stored metrics omit a baseline, dated splits, dataset hash, and source revision | A reader cannot independently reconstruct or judge the reported improvement. |

The current UI's “edge” values are model estimates. Neither these calibration metrics nor passing unit tests demonstrate profitable betting, calibrated outcome probabilities, or customer impact.

## Reproduce the existing exploratory workflow

After installing the backend requirements in a Python environment:

```bash
# Inspect arguments without generating data or changing weights
python scripts/backtest_fantasy.py --help

# Example: generate an exploratory historical dataset (network access required)
python scripts/backtest_fantasy.py --start 2026-04-01 --end 2026-04-14 --csv /tmp/fantasy-exploratory.csv
```

This example is a command template, **not a completed experiment**. Statcast features read a local parquet cache that is not bundled with the repository; missing inputs may take fallback paths. Record feature coverage and retrieval failures. The existing `--fit` option writes `backend/app/data/fantasy_weights.json`; run it only in an isolated experiment checkout and retain the original weights.

## Protocol for a defensible next result

1. **Define the task:** predict pregame hitter fantasy points for a documented eligible population. Use projected opportunities available at prediction time, not actual plate appearances. Keep conditional-on-actual-PA analysis as a separately labeled diagnostic.
2. **Freeze inputs:** record source revision, weights, scoring rules, data hashes, prediction timestamps, and per-feature availability. League, park, speed, lineup, and pitcher inputs must obey the same information cutoff.
3. **Split by complete dates:** use an early training period, a later validation period for tuning, and a final untouched test period. Keep all rows from a game/day together. Never choose weights or reporting thresholds from final-test outcomes.
4. **Use the production function:** regenerate predictions through the same projection code that serves the app, with explicit frozen configuration. Test missing features and ensure results do not depend on row order.
5. **Compare a baseline:** evaluate a simple historical-rate projection using the same eligible rows and pregame opportunity estimate. Report the exact baseline formula and fit its parameters only on training data.
6. **Publish results:** report dates, row/game/day counts, exclusions, missing-feature coverage, MAE/RMSE, R², rank correlation, and daily ranking performance. For uncertainty, resample whole games or days rather than assuming batter rows are independent.
7. **Keep claims within evidence:** probability calibration and economic outcomes require separate experiments with timestamped lines, prices, and selection rules; a point-forecast benchmark does not establish either.

## Current completion boundary

This pass audits the evaluation design and makes its status visible from the README. It does not rerun historical calibration, repair the modeling pipeline, or claim a baseline improvement. The next substantive modeling task is a date-safe dataset and production-parity evaluation harness, followed by a frozen holdout run.
