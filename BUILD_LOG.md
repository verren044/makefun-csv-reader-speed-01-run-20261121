# BUILD_LOG — csv-reader-speed-01-run-20261121

## Approach

Drop-in replacement for csv-reader 1.0.0 in `solve.js` (ES module, stdlib
only, no network, deterministic). The reference parses one character at a
time with per-character string concatenation; this version uses native
`indexOf`/`slice` on the hot path:

- Unquoted field: `indexOf(',')` + `indexOf('\n')` find the delimiter,
  one `slice` is the field. CRLF recognised by the char before `\n`.
  Only a stray CR inside a field falls back to a char loop.
- Quoted field: `indexOf('"')` finds the closing/doubled quote, slices
  accumulate. Only segments containing a line break pay for a CR→LF
  transform (`replace(/\r\n?/g, '\n')`) and line recount.
- BOM drop, empty-line skip, stray-CR-only line suppression, short/long
  row padding/cutting, and all error records (`stray_cr`,
  `unterminated_quote`, `quote_junk`, `short_row`, `long_row`) with their
  exact order follow the reference.
- `main.ts` is the baseline driver verbatim (incl.
  `--no-incremental-marking`); `package.json` is `{"type":"module"}` as
  in the baseline, so `solve.js` loads as ESM without reparse.

## Benchmarks (practice set, 6 cases, 10,193,953 bytes CSV)

Machine: this VM, Node v24.22.1 (grader runs Node 22.23.4; code uses only
stable string APIs). `solve-only` = `run()` over all 6 cases, 7 timed runs
after warmup, median reported.

| | solve-only median | throughput | full `main.ts` wall |
|---|---|---|---|
| This entry | **177 ms** (runs: 134–305 ms) | **57.5 MB/s** | 762–1158 ms |
| House baseline (csv-reader 1.0.0) | 814 ms (runs: 661–912 ms) | 12.5 MB/s | 1438–1835 ms |

**Speedup (solve-only): ~4.6x.** End-to-end wall is ~1.7x because both
entries share the driver's JSON parse of the 10 MB input and stringify of
the answers. For reference, the house-measured public drop-ins were
~1.9x (d3-dsv 0.73 s vs baseline 1.38 s).

## Verification

- Practice set: **6/6 cases byte-identical** to
  `practice/reference/expected.json` (also identical to running the
  reference `readCsv` directly). Rows/errors per case: g-0001 12414/318,
  g-0002 14171/382, g-0003 6250/179, g-0004 7582/229, g-0005 9811/270,
  g-0006 13464/392.
- Edge cases: **124/124 pass** differential vs reference (BOM, empty
  text, empty lines, lone/CRLF CRs, unterminated quotes, quote junk,
  doubled quotes, multiline quoted fields, CR inside quotes, short/long
  rows, header true/false, no trailing newline, `""`, `""""`).
- Fuzz: **3000/3000 pass** — random texts over `, " \n \r a b space BOM`,
  length 0–39, header true/false, differential vs reference.
- Determinism: `main.ts` run twice on the practice set →
  `answers.json` sha256 identical both runs:
  `bb5b6cc5c523edf0b18a20cd1f577b0d461b3ae021fd3ab2c9b4e4a5f01002ed`.
- `main.ts` output matches the practice expected answers (JSON-value
  comparison, all 6 cases).
- Repo size: well under the 1 MiB cap (solve.js ~8 KB, total < 20 KB).

## Revision (parent, 21 Nov 2026 ~13:35 WIB, thinking_revised fix)
- One `indexOf('\r')` pre-scan per input (`hasCR`): when the whole input
  has no CR, the per-field `seg.indexOf('\r')` scans in readUnquoted /
  readQuoted are skipped (they could never find one). With a CR present
  the code takes exactly the old path, so answers are unchanged either
  way — it removes one O(field) scan per field on the common no-CR case.
- Verified: practice set 6/6 byte-identical to expected.json; differential
  fuzz 3000/3000 vs reference readCsv; targeted edges 66/66 (BOM, CRLF,
  stray CR, unterminated quotes, quote junk, doubled quotes, multiline
  quoted fields, CR inside quotes, short/long rows, header true/false);
  two main.ts runs byte-identical. Solve-only median 168.8 ms vs 177 ms
  before (runs 138–274 ms; within run-to-run variance, the win is the
  removed per-field scan, not the median).
