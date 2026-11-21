# csv-reader-speed-01-run-20261121 — fast broken-CSV reader

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/verren044/makefun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/verren044/makefun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers
exactly as csv-reader does on every input (`{columns, rows, errors}` for
`{text, header}`), at ~4.6x the speed of the house baseline on the practice
set. `main.ts` is the harness driver: it reads `/input/cases.json`, answers
each case with `run`, and writes `/output/answers.json`.

## How it is faster

The reference walks one character at a time and concatenates one character
at a time. This version never does either on the hot path:

- **Unquoted fields**: two native `indexOf` scans (`','` and `'\n'`) find
  the next delimiter; the field is a single `slice`. A `\r` inside the
  slice (stray CR) is the only case that falls back to a char loop, and
  CRLF line ends are recognised by the char before the `\n'`.
- **Quoted fields**: one native `indexOf('"')` finds the closing quote (or
  a doubled quote, handled by accumulating slices). Only segments that
  contain a line break pay for a CR→LF transform and a line recount.
- **Semantics**: BOM, empty lines, stray-CR-only lines, short/long rows,
  `quote_junk`, `unterminated_quote`, `stray_cr` errors and their order
  follow csv-reader 1.0.0 exactly.

No dependencies, no network, no clock, no randomness, no state kept
between calls — `run(input)` is pure, so two runs are byte-identical.

## Files

- `solve.js` — the fast reader, `export function run(input)`
- `main.ts` — harness driver (reads cases, writes answers)
- `BUILD_LOG.md` — benchmarks and verification
- `LICENSE` — MIT

## Verify locally

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

Output matches `practice/reference/expected.json` on all 6 cases.
