# Fuzz testing

The importers and exporters — the code paths that parse untrusted files —
are fuzz-tested with property-based harnesses under `test/fuzz/`. The
harnesses run the compiled `dist/` code in Node under happy-dom, the same
way the CLI consumes these libraries.

## Running

```bash
npm run build            # harnesses import dist/
npm run test:fuzz        # all harnesses, FC_RUNS iterations each (default 500)
FC_RUNS=2000 node test/fuzz/run-all.js
FC_RUNS=1000 node test/fuzz/native-fidus.js
FC_SEED=12345 FC_RUNS=1000 node test/fuzz/native-fidus.js   # replay a seed
```

Seed containers for the native fuzzer live in `test/fuzz/seeds/` (copied
from `fiduswriter-cli-ts/test/`). Minimized repros of fixed bugs live in
`test/fuzz/regressions/` and run as part of `npm test`.

## Harnesses

| Harness           | Target                                                                                                            | Key invariants                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `native-fidus.js` | `FidusFileImporter` with bit-flipped, truncated, re-zipped, JSON-mutated and version-tampered `.fidus` containers | import always settles (resolves with a status message or rejects with a catchable Error) — never hangs, never crashes the process |
| `docx-odt.js`     | `DocxImporter`/`OdtImporter` with byte-mutated, truncated and XML-spliced uploads                                 | same settle guarantee                                                                                                             |
| `html-pandoc.js`  | `HtmlImporter` with adversarial HTML, `PandocImporter` with mutated Pandoc ASTs                                   | same settle guarantee, `ok` results always carry a document                                                                       |
| `roundtrip.js`    | random document (schema-aware generator) → `ShrinkFidus`/`ZipFidus` → `FidusFileImporter`                         | the imported content equals the original (compared via the schema), bibliography survives                                         |

Shared infrastructure: `config.js` (fast-check setup), `setup.js`
(happy-dom globals), `rng.js` (seeded decisions), `doc-generator.js`
(structure-aware random Fidus documents).

## Bugs found by fuzzing so far (all fixed)

1. **Corrupt `.fidus` containers hung the import forever** — the per-entry
   read in `FidusFileImporter.initZipFileRead` had no `.catch()`; an entry
   with a bad CRC or broken deflate stream (JSZip "uncompressed data size
   mismatch") left `Promise.all` pending forever _and_ raised an unhandled
   rejection. `loadAsync` failures on structurally broken zips also never
   settled the `check: true` path. Both paths now settle with a
   "does not appear to be a Fidus Writer file" status.
2. **Export crashed on dangling image references** — `ShrinkFidus` threw
   `TypeError: undefined.startsWith` when the document referenced an image
   id missing from the imageDB (reachable when a document step arrives
   before its `iu` update). Dangling references are now skipped; the
   importer already tolerates the missing image.
   Regression: `regressions/shrink-missing-image.js`.
