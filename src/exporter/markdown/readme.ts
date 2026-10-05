/**
 * Markdown export notes.
 * @module
 */

export const readMe = `Fidus Writer markdown export
============================

This archive contains the document exported to pandoc-flavoured markdown
(document.md) and, when the document contains citations, a bibliography
database (bibliography.bib) with all cited entries.

Reading the document with pandoc
--------------------------------

With pandoc installed, the markdown can be converted to other formats:

    pandoc document.md --citeproc --bibliography bibliography.bib \\
        -o document.html

Citations are exported in pandoc's bracketed citation syntax, e.g.
[@doe2020], so they are resolved either by --citeproc at conversion time or
by any tool that understands pandoc citations.

Format notes
------------

* The markdown uses pandoc's flavour (not GitHub flavoured markdown), as
  only the pandoc flavour supports the attribute blocks, fenced divs and
  bracketed citations used here.
* Document parts are wrapped in fenced divs (::: blocks) carrying the part
  ids and metadata, mirroring Fidus Writer's HTML export.
* Tables are exported as pipe tables. Merged cells (colspan/rowspan) cannot
  be represented in a pipe table; the merged grid is flattened and the
  covering cells appear as empty cells.
* Figure equations are exported as fenced divs with the LaTeX source in the
  data-equation attribute.
`
