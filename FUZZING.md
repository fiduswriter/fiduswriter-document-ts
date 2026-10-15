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
3. **Mutated DOCX/ODT uploads could kill the Node process with an
   unhandled rejection** — jszip 3.10.2 verifies each entry's inflated
   length against the (attacker-controlled) size declared in the zip header
   inside a detached stream worker (`getContentWorker`'s "end" handler in
   `jszip/lib/compressedObject.js`). When that check fires after the
   awaited import chain has already settled, the throw escapes as an
   unhandled rejection and Node's strict default aborts the process, even
   though the import itself resolved or rejected normally. `importDocx` and
   `importOdt` now call `ensureZipSizeGuard()`
   (`src/importer/zip_guard.ts`), which swallows that exact jszip assertion
   process-wide and re-raises every other rejection on the next tick
   (deferring to the host's own `unhandledRejection` policy when it has
   registered one).
   Regression: `regressions/jszip-orphan-size-mismatch.js`.
4. **ODT style reference cycles overflowed the call stack** — `isTitleStyle`,
   `isCodeBlockStyle` and `isHeadingStyle` followed
   `style:parent-style-name` recursively; a styles.xml with a cycle
   (`A → B → A`) produced a `RangeError: Maximum call stack size
exceeded`, turning an importable document into an import error (and
   spewing a 1000+-frame stack). All three walks are now iterative and
   stop at the first repeated parent name.
   Regression: `regressions/odt-style-cycle.js`.
