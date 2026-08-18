# AGENTS.md — @fiduswriter/document

This file contains information for AI coding agents working on the
`fiduswriter-document` repository. Read this first if you are unfamiliar with
the project.

## Project overview

`@fiduswriter/document` is a TypeScript library that implements the Fidus
Writer document model, import filters, export filters, and related static
assets.

- Package name: `@fiduswriter/document`
- License: `AGPL-3.0`
- Repository: `https://git.fiduswriter.org/fiduswriter/fiduswriter-document-ts.git`
- Author: Johannes Wilm

The library is intentionally backend-agnostic: it knows nothing about Django and
can be used in the browser, in Node.js, and in the Fidus Writer CLI.

## Scope

Code in this repository should be limited to:

- The ProseMirror document schema (`src/schema/`).
- Import filters: native Fidus format, DOCX, ODT, Pandoc JSON
  (`src/importer/`).
- Export filters: native, DOCX, ODT, LaTeX, HTML, EPUB, JATS, Pandoc, print
  (`src/exporter/`).
- Shared transforms (`src/transform/`).
- Citation/bibliography helpers used during import/export
  (`src/citations/`, `src/bibliography/`).
- MathLive static assets bundled from `mathlive` into `static-libs/` and the
  `@fiduswriter/document/mathlive` re-export.

Do **not** put in this repository:

- Pure UI components (those belong in `fwtoolkit`).
- Django-specific logic.
- End-to-end encryption code.
- Book management logic (use `@fiduswriter/books-document` for composite/book
  exporters).

## Technology stack

- **Language:** TypeScript 6.0+.
- **Module system:** ESM (`"type": "module"`).
- **Build tool:** `tsc` only; no bundler is used.
- **Test runner:** Jest with `ts-jest` and `--experimental-vm-modules`.
- **DOM environment:** `happy-dom`.
- **Peer-style dependencies:** `fwtoolkit`, `prosemirror-*`, `mathlive`.

## Directory layout

```
.
├── src/                  # TypeScript source files
│   ├── schema/           # ProseMirror document schema
│   ├── importer/         # Import filters
│   ├── exporter/         # Export filters
│   ├── citations/        # CSL / citeproc helpers
│   ├── bibliography/     # Bibliography helpers
│   ├── transform/        # Document transforms
│   ├── mathlive/         # MathLive re-export and OPF includes
│   └── css/              # Document-related CSS (for EPUB/HTML exports)
├── dist/                 # Compiled JS, .d.ts and source maps (generated)
├── static-libs/          # Bundled MathLive CSS/fonts and zip (generated)
├── scripts/              # Build helpers
│   ├── bundle-mathlive.ts # Bundles MathLive assets into static-libs/
│   ├── export-schema.js  # Writes schema.json
│   └── deploy-pages.sh   # Deploys demo/ to git-pages
├── demo/                 # git-pages demo
├── test/                 # Jest tests
├── package.json
├── tsconfig.json
├── jest.config.js
└── schema.json           # Exported JSON schema (generated)
```

## Build and test commands

```bash
# Install dependencies
pnpm install

# Compile TypeScript to dist/
pnpm run build

# Export schema.json
pnpm run build-schema

# Bundle MathLive CSS/fonts into static-libs/
pnpm run bundle-mathlive

# Run all three build steps
pnpm run prepare

# Run the Jest test suite
pnpm test

# Run linting and formatting checks
pnpm run lint
pnpm run format:check
```

This repository uses pnpm for day-to-day development. Run `pnpm install` to
install dependencies; `package-lock.json` is not tracked (pnpm maintains
`pnpm-lock.yaml`).

`pnpm run bundle-mathlive` is deterministic: the generated zip uses source file
mtimes and a stable ordering, so identical source MathLive versions produce an
identical `static-libs/zip/mathlive_style.zip`.

## Pre-commit / pre-publish

- `pnpm run prepare` runs build, schema export, and MathLive bundling.
- `npm publish` triggers `prepublishOnly`, which also runs build, schema export,
  and MathLive bundling.
- There is no pre-commit hook in this repository; rely on CI and run tests
  before committing.

## Code style guidelines

- Use ES modules and TypeScript strict mode.
- Import local files with the `.js` extension even when the source file is
  `.ts`, e.g. `import {XmlZip} from "../tools/xml_zip.js"`.
- Avoid `any` unless necessary.
- Keep the library backend-agnostic; do not import Django or browser-only APIs
  except in code paths clearly meant for the browser.

## Testing instructions

Tests live in `test/` and run with Jest.

- Use `pnpm test` to run the full suite.
- Tests use `happy-dom` for DOM APIs where needed.
- Import/export tests often round-trip fixture files.

## MathLive bundling

The MathLive static bundle is committed into the repository under
`static-libs/` so consumers (including the main Fidus Writer app and the CLI)
do not need to run the bundler themselves.

To update the bundle after upgrading the `mathlive` dependency, add the package
with pnpm (`pnpm add` is pnpm's equivalent of `npm install <pkg>`):

```bash
pnpm add mathlive@<version>
pnpm run bundle-mathlive
```

Verify with `git diff` that only `static-libs/` and possibly
`.mathlive_bundle_cache.json` changed. Because the bundle is deterministic, the
zip checksum should remain stable if the MathLive sources did not actually
change.

## Consumers

This library is consumed by:

- `fiduswriter/` (the main Fidus Writer Django app) via `document/package.json5`.
- `@fiduswriter/books-document` for book-level exporters/importers.
- `@fiduswriter/cli` for command-line conversion.

When publishing a new version, update those consumers and run their tests.

## Release checklist

- Ensure `pnpm run build` succeeds.
- Ensure `pnpm test` passes.
- Update `package.json` version if needed (`npm version patch|minor|major`).
- `npm publish` triggers `prepublishOnly`, which builds and bundles.
- Push commits and tags.
- Update downstream consumers (`@fiduswriter/books-document`,
  `@fiduswriter/cli`, `fiduswriter/document/package.json5`).

## Useful references

- `package.json` — scripts, exports and dependency versions.
- `tsconfig.json` — compiler options.
- `src/index.ts` — canonical list of public exports.
- `src/schema/` — document schema definition.
- `scripts/bundle-mathlive.ts` — MathLive asset bundling logic.
