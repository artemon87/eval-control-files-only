# History modules and tests

Application modules belong under `app/lib/`:

- `app/lib/unit-history-trend.ts`
- `app/lib/unit-history-types.ts`
- `app/lib/unit-trend-explorer.ts`
- `app/lib/time-window.ts`
- `app/lib/eval-api.ts`

The neighboring imports `./time-window` and `./eval-api` are correct in that directory. Do not copy application modules into `tests/`. Actual regression tests are named `tests/*.test.mjs` and load application modules from `../app/lib/`.

`npm test` runs the production build before the Node test suite. A TS2307 error naming `tests/unit-history-trend.ts`, `tests/unit-history-types.ts`, or `tests/unit-trend-explorer.ts` is therefore a build/type-check failure before the unit tests start. Inspect any copies in that folder, compare them with `app/lib/`, preserve any unique local changes, then move the application modules to their correct paths and remove only redundant copies. Do not add dummy `tests/time-window.ts` or `tests/eval-api.ts` files to mask the problem.

Run the focused History regressions without the production build:

```sh
node --test tests/unit-history-selection.test.mjs tests/unit-history-trend.test.mjs tests/unit-history-insights.test.mjs tests/unit-trend-explorer.test.mjs
```

Broad stage/target history requires the paired backend change accepting `all_stages` and `all_targets`. Merge/deploy the backend first. The chart defaults to all BSA/configurations, while automatic case comparisons still require matching configuration and case evidence. Range changes preserve the user's explicit chart configuration filter.
