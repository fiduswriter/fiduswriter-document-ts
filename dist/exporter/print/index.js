import { shortFileTitle, gettext, staticUrl } from "fwtoolkit";
import { PAPER_SIZES } from "../../schema/const.js";
import { HTMLExporter } from "../html/index.js";
import { HTMLExporterConvert } from "../html/convert.js";
import { removeHidden } from "../tools/doc_content.js";
import { getPrintEngine } from "./engines/registry.js";
export { registerPrintEngine, getPrintEngine, DEFAULT_PRINT_ENGINE } from "./engines/registry.js";
export class PrintExporter extends HTMLExporter {
    progressCallback;
    options;
    constructor(doc, bibDB, imageDB, csl, updated, documentStyles, progressCallback, options = {}) {
        super(doc, bibDB, imageDB, csl, updated, documentStyles, {
            relativeUrls: false
        });
        this.progressCallback = progressCallback;
        this.options = {
            figurePageFloats: true,
            tablePageFloats: true,
            ...options
        };
    }
    /**
     * Build the pagination-ready HTML string (and its metadata) shared by
     * the print dialog and the PDF exporter: document content with the print
     * CSS (pagination, footnotes, TOC page numbers) and the document style
     * (with asset URLs made absolute so fonts/images resolve inside the
     * iframe).
     */
    async buildPaginatedHtml() {
        this.docContent = removeHidden(this.doc.content);
        this.styleSheets = [
            { url: staticUrl("css/document/document.css") },
            {
                contents: `a.footnote, a.affiliation {
                    -adapt-template: url(data:application/xml,${encodeURI('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:s="http://www.pyroxy.com/ns/shadow"><head><style>.footnote-content{float:footnote}</style></head><body><s:template id="footnote"><s:content/><s:include class="footnote-content"/></s:template></body></html>#footnote')});
                    text-decoration: none;
                    color: inherit;
                    vertical-align: baseline;
                    font-size: 70%;
                    position: relative;
                    top: -0.3em;
                }
                aside.footnote label:first-child, aside.footnote *:nth-child(2),
                aside.affiliation label:first-child, aside.affiliation *:nth-child(2) {
                    display: inline;
                }
                aside.footnote label:first-child:after,
                aside.affiliation label:first-child:after  {
                    content: '. '
                }

                body, section[role=doc-footnotes] {
                    counter-reset: cat-figure cat-equation cat-photo cat-table footnote-counter footnote-marker-counter;
                }
                section#affiliations, section#footnotes  {
                    display: none;
                }
                section:footnote-content {
                    display: block;
                    font-size: small;
                    font-style: normal;
                    font-weight: normal;
                    text-decoration: none;
                    text-indent: 0;
                    text-align: initial;
                }
                .table-of-contents a {
                	display: inline-flex;
                	width: 100%;
                	text-decoration: none;
                	color: currentColor;
                	break-inside: avoid;
                	align-items: baseline;
                }
                .table-of-contents a::before {
                	margin-left: 1px;
                	margin-right: 1px;
                	border-bottom: solid 1px lightgray;
                	content: "";
                	order: 1;
                	flex: auto;
                }
                .table-of-contents a::after {
                	text-align: right;
                	content: target-counter(attr(href, url), page);
                	align-self: flex-end;
                	flex: none;
                	order: 2;
                }
                span.insertion, [data-track="insertion"] {
                	text-decoration: underline;
                }
                span.deletion, [data-track="deletion"] {
                	text-decoration: line-through;
                }
                ${this.options.figurePageFloats
                    ? `/* Default: display (centered) figures become page floats,
                   moved to the top of the page. Side-aligned figures keep
                   their regular float. These are intentionally low-specificity
                   defaults: the document style stylesheet is loaded after
                   this sheet and can freely override them (e.g. to implement
                   a more elaborate float scheme). */
                figure[data-aligned="center"] {
                    float-reference: page;
                    float: top;
                }`
                    : ""}
                ${this.options.tablePageFloats
                    ? `/* Default: tables become page floats, moved to the top of
                   the page. Overridable by the document style stylesheet. */
                table {
                    float-reference: page;
                    float: top;
                }`
                    : ""}
                body {
                    background-color: white;
                }
                @page {
                    size: ${(PAPER_SIZES.find(size => size[0] === this.doc.settings.papersize) || ["", "A4"])[1]};
                    @top-center {
                        content: env(doc-title);
                    }
                    @bottom-center {
                        content: counter(page);
                    }
                }`
            }
        ];
        const docStyle = this.getDocStyle(this.doc);
        if (docStyle) {
            this.styleSheets.push(docStyle);
        }
        await Promise.all(this.styleSheets.map(async (sheet) => await this.loadStyle(sheet)));
        this.converter = new HTMLExporterConvert(this.docTitle, this.doc.settings, this.docContent, this.htmlExportTemplate, this.imageDB, this.bibDB, this.csl, this.styleSheets, {
            relativeUrls: false,
            // Render tracked changes when the document still contains the
            // marks (resolved exports simply have none to render).
            trackChanges: true,
            // Formulas as SVG so the DOM-to-PDF emitter (and the browser
            // print pipeline) render fractions, radicals and stretchy
            // delimiters faithfully.
            mathOutput: "svg"
        });
        const { html, metaData } = await this.converter.init();
        return { html, metaData };
    }
    async init() {
        this.progressCallback?.(`${shortFileTitle(this.doc.title, this.doc.path || "")}: ${gettext("Printing has been initiated.")}`, 0);
        const { html, metaData } = await this.buildPaginatedHtml();
        this.progressCallback?.(`${shortFileTitle(this.doc.title, this.doc.path || "")}: ${gettext("Print view ready. Opening print dialog...")}`, 100);
        const engine = getPrintEngine(this.options.printEngine);
        window.printInstance = {
            engine: engine.name
        };
        await engine.print({
            html,
            title: metaData.title,
            polyfillURL: staticUrl("paged/paged.polyfill.js")
        });
        this.progressCallback?.(`${shortFileTitle(this.doc.title, this.doc.path || "")}: ${gettext("Printing complete.")}`, 100);
    }
    getDocStyle(doc) {
        // Override the default as we need to use the original URLs in print.
        const docStyle = this.documentStyles.find((ds) => ds.slug === doc.settings.documentstyle);
        if (!docStyle) {
            return false;
        }
        let contents = docStyle.contents;
        docStyle.documentstylefile_set.forEach(([url, filename]) => (contents = contents.replace(new RegExp(filename, "g"), new URL(url, window.location.href).href)));
        return { contents, filename: "" };
    }
    loadStyle(sheet) {
        if (sheet.url) {
            sheet.filename = sheet.url;
            delete sheet.url;
        }
        return Promise.resolve(sheet);
    }
}
//# sourceMappingURL=index.js.map