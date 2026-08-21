# @fiduswriter/document

<p align="center"><img src="https://git.fiduswriter.org/fiduswriter/fiduswriter-document-ts/raw/branch/main/demo/logo.svg" alt="@fiduswriter/document logo" width="100" height="100"></p>

This package contains the Fidus Writer document schema, importers and exporters.

## Demo

Interactive examples running entirely in the browser are available at
**https://fiduswriter.pages.fiduswriter.org/fiduswriter-document-ts/**

The demo site includes:

- **File converter** — export a sample document (with editable JSON and bibliography) to JATS, HTML, LaTeX, Pandoc JSON, EPUB, DOCX, and ODT. DOCX and ODT exports support custom upload templates; built-in "Classic" (DOCX) and "Free" (ODT) templates are provided as defaults.
- **Schema viewer** — browse all document nodes, marks, and their allowed content.
- **JATS bibliography generator** — fill in a reference and preview the rendered JATS XML.
- **Import preview** — drop a native `.fidus` file and inspect its JSON.

## Usage

```javascript
import {docSchema, FW_DOCUMENT_VERSION} from "@fiduswriter/document/schema"
import {DocxConvert} from "@fiduswriter/document/importer/docx/convert.js"
import {DOCXExporter} from "@fiduswriter/document/exporter/docx/index.js"
```

## TypeScript

The package is fully written in TypeScript. Source files are compiled to
`dist/` on build and published with matching `.d.ts` declarations. The public
import paths remain unchanged.

## Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm run typecheck  # run tsc --noEmit
npm test           # run the Jest test suite
npm run deploy-pages  # build and push the demo site to Forgejo Pages
```

## Dependencies

- `fwtoolkit` — shared utilities (text helpers, network helpers, etc.)

## Schema JSON

A JSON serialization of the schema is exported as `schema.json` and regenerated
by the `prepare` / `prepublishOnly` scripts.

## Tests

The test suite includes round-trip tests that import real DOCX files, run them
through the exporters, and validate that the generated output files contain the
required ZIP entries and well-formed XML.
