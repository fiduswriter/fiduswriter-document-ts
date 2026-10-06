/**
 * Typst export notes.
 * @module
 */

export const readMe = `Fidus Writer Typst export
==========================

This archive contains the document exported to Typst markup (document.typ)
and, when the document contains citations, a bibliography database
(bibliography.bib) with all cited entries, plus the images referenced by
the document in the images/ folder.

Compiling the document
----------------------

With the Typst CLI installed (https://github.com/typst/typst), compile the
document to PDF:

    typst compile document.typ

The images/ folder and bibliography.bib must sit next to document.typ.
Citations are resolved by Typst itself through the exported bibliography.

Format notes
------------
* Equations are stored as LaTeX source in Fidus Writer and are converted to
  Typst math on a best-effort basis; exotic LaTeX constructs may need
  manual adjustment after the export.
* Tables are exported as captioned table figures; colspan/rowspan become
  table.cell(colspan:)/table.cell(rowspan:).
* Document parts are marked with // doc-part comments so the structure
  stays visible in the source.
`
