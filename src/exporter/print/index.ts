import {printHTML} from "@vivliostyle/print"
import {shortFileTitle, gettext, staticUrl} from "fwtoolkit"

import {PAPER_SIZES} from "../../schema/const.js"
import type {BibDB, CSL, ExportDoc, FidusNode, ImageDB} from "../../types.js"
import {HTMLExporter} from "../html/index.js"
import {HTMLExporterConvert} from "../html/convert.js"
import type {HTMLExportMetadata} from "../html/convert.js"
import {removeHidden} from "../tools/doc_content.js"

export type ProgressCallback = (
    message: string,
    percentage?: number | null
) => void

export class PrintExporter extends HTMLExporter {
    progressCallback?: ProgressCallback

    constructor(
        doc: ExportDoc,
        bibDB: BibDB,
        imageDB: ImageDB,
        csl: CSL,
        updated: Date,
        documentStyles: Array<{
            slug: string
            contents: string
            documentstylefile_set: Array<[string, string]>
        }>,
        progressCallback?: ProgressCallback
    ) {
        super(doc, bibDB, imageDB, csl, updated, documentStyles, {
            relativeUrls: false
        })
        this.progressCallback = progressCallback
    }

    /**
     * Build the vivliostyle-ready HTML string (and its metadata) shared by the
     * print dialog and the PDF exporter: document content with the print CSS
     * (pagination, footnotes, TOC page numbers) and the document style (with
     * asset URLs made absolute so fonts/images resolve inside the iframe).
     */
    protected async buildPaginatedHtml(): Promise<{
        html: string
        metaData: HTMLExportMetadata
    }> {
        this.docContent = removeHidden(this.doc.content) as FidusNode

        this.styleSheets = [
            {url: staticUrl("css/editor/document.css")},
            {
                contents: `a.footnote, a.affiliation {
                    -adapt-template: url(data:application/xml,${encodeURI(
                        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:s="http://www.pyroxy.com/ns/shadow"><head><style>.footnote-content{float:footnote}</style></head><body><s:template id="footnote"><s:content/><s:include class="footnote-content"/></s:template></body></html>#footnote'
                    )});
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
        ]

        const docStyle = this.getDocStyle(this.doc)

        if (docStyle) {
            this.styleSheets.push(docStyle)
        }

        await Promise.all(
            this.styleSheets.map(async sheet => await this.loadStyle(sheet))
        )

        this.converter = new HTMLExporterConvert(
            this.docTitle,
            this.doc.settings,
            this.docContent,
            this.htmlExportTemplate,
            this.imageDB,
            this.bibDB,
            this.csl,
            this.styleSheets,
            {
                relativeUrls: false,
                // Render tracked changes when the document still contains the
                // marks (resolved exports simply have none to render).
                trackChanges: true
            }
        )

        const {html, metaData} = await this.converter.init()
        return {html, metaData}
    }

    async init(): Promise<void> {
        this.progressCallback?.(
            `${shortFileTitle(this.doc.title, this.doc.path || "")}: ${gettext("Printing has been initiated.")}`,
            0
        )

        const {html, metaData} = await this.buildPaginatedHtml()

        this.progressCallback?.(
            `${shortFileTitle(this.doc.title, this.doc.path || "")}: ${gettext("Print view ready. Opening print dialog...")}`,
            100
        )

        const config: {title?: string; printCallback?: (iframeWin: Window) => void} = {
            title: metaData.title
        }

        if (navigator.userAgent.includes("Gecko/")) {
            // Firefox has issues printing images when in iframe. This workaround can be
            // removed once that has been fixed. TODO: Add gecko bug number if there is one.
            config.printCallback = iframeWin => {
                const oldBody = document.body
                document.body.parentElement!.dataset.vivliostylePaginated = "true"
                document.body = iframeWin.document.body
                document.body
                    .querySelectorAll("figure, table")
                    .forEach(el => delete (el as HTMLElement).dataset.category)
                iframeWin.document
                    .querySelectorAll("style")
                    .forEach(el => document.body.appendChild(el))
                const backgroundStyle = document.createElement("style")
                backgroundStyle.innerHTML = "body {background-color: white;}"
                document.body.appendChild(backgroundStyle)
                window.print()
                document.body = oldBody
                delete document.body.parentElement!.dataset.vivliostylePaginated
            }
        }
        await printHTML(html, config)
        this.progressCallback?.(
            `${shortFileTitle(this.doc.title, this.doc.path || "")}: ${gettext("Printing complete.")}`,
            100
        )
    }

    getDocStyle(doc: ExportDoc): {contents: string; filename: string} | false {
        // Override the default as we need to use the original URLs in print.
        const docStyle = this.documentStyles.find(
            (ds: {slug: string}) => ds.slug === doc.settings.documentstyle
        )
        if (!docStyle) {
            return false
        }

        let contents = docStyle.contents
        docStyle.documentstylefile_set.forEach(
            ([url, filename]: [string, string]) =>
                (contents = contents.replace(
                    new RegExp(filename, "g"),
                    new URL(url, window.location.href).href
                ))
        )
        return {contents, filename: ""}
    }

    loadStyle(sheet: {
        url?: string
        filename?: string | null
        contents?: string
    }): Promise<{url?: string; filename?: string | null; contents?: string}> {
        if (sheet.url) {
            sheet.filename = sheet.url
            delete sheet.url
        }
        return Promise.resolve(sheet)
    }
}
