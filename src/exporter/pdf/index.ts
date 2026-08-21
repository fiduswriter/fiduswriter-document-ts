import download from "downloadjs"
import {addAlert, gettext, shortFileTitle, staticUrl} from "fwtoolkit"
import {printHTML} from "@vivliostyle/print"
import {
    emitPdfFromVivliostyleWindow,
    type EmitAttachment,
    type EmitMetadata,
    type PrintOptions
} from "vivliostyle-pdf"

import type {BibDB, CSL, ExportDoc, FidusNode, ImageDB} from "../../types.js"
import {PrintExporter} from "../print/index.js"
import {createSlug} from "../tools/file.js"

export interface PdfExporterOptions {
    /**
     * The Fidus Writer application version. Used as the PDF Creator string
     * (e.g. "Fidus Writer 4.1.7").
     */
    version?: string
    /**
     * A pre-built `.fidus` file (bytes) to embed as a PDF attachment so the
     * PDF is self-contained with its editable source.
     */
    fidusFile?: Uint8Array | ArrayBuffer
    /** Print-production options (crop marks, trim/bleed boxes, link borders,
        SVG rasterization). */
    printOptions?: PrintOptions
}

/**
 * Export the document directly to a PDF, client-side, without the browser
 * print dialog. Reuses the print pipeline's HTML generation (vivliostyle
 * pagination) and then runs vivliostyle-pdf's DOM-to-PDF emitter on the
 * paginated iframe to produce a real vector PDF, which is downloaded.
 */
export class PdfExporter extends PrintExporter {
    options: PdfExporterOptions

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
        progressCallback?: (
            message: string,
            percentage?: number | null
        ) => void,
        options: PdfExporterOptions = {}
    ) {
        super(
            doc,
            bibDB,
            imageDB,
            csl,
            updated,
            documentStyles,
            progressCallback
        )
        this.options = options
    }

    protected async buildMetadata(
        metaData: {
            title: string
            authors: FidusNode[]
            keywords: string[]
        }
    ): Promise<EmitMetadata> {
        const authorString = metaData.authors
            .map((author: FidusNode) => {
                const authorAttrs = author.attrs || {}
                const firstname = authorAttrs.firstname
                const lastname = authorAttrs.lastname
                const institution = authorAttrs.institution
                if (firstname || lastname) {
                    const nameParts: string[] = []
                    if (typeof firstname === "string") {
                        nameParts.push(firstname)
                    }
                    if (typeof lastname === "string") {
                        nameParts.push(lastname)
                    }
                    return nameParts.join(" ")
                } else if (typeof institution === "string") {
                    return institution
                }
                return ""
            })
            .filter(Boolean)
            .join(", ")
        const metadata: EmitMetadata = {
            title: metaData.title,
            keywords: metaData.keywords.length
                ? metaData.keywords.join(", ")
                : undefined,
            language: this.doc.settings.language || "en-US",
            creator: this.options.version
                ? `Fidus Writer ${this.options.version}`
                : "Fidus Writer"
        }
        if (authorString.length) {
            metadata.author = authorString
        }
        return metadata
    }

    async init(): Promise<void> {
        const title = shortFileTitle(this.doc.title, this.doc.path || "")
        this.progressCallback?.(
            `${title}: ${gettext("PDF export has been initiated.")}`,
            0
        )

        const {html, metaData} = await this.buildPaginatedHtml()

        this.progressCallback?.(
            `${title}: ${gettext("Rendering PDF…")}`,
            25
        )

        const metadata = await this.buildMetadata(metaData)
        const slug = createSlug(this.docTitle) || "document"
        const filename = `${slug}.pdf`

        const attachments: EmitAttachment[] = []
        if (this.options.fidusFile) {
            attachments.push({
                filename: `${slug}.fidus`,
                bytes: this.options.fidusFile,
                mimeType: "application/vnd.fiduswriter+zip",
                description:
                    "Fidus Writer source document (editable version of this PDF)"
            })
        }

        const fail = (message: string): void => {
            this.progressCallback?.(`${title}: ${message}`, 100)
            addAlert("error", message)
        }

        printHTML(html, {
            removeIframe: false,
            hideIframe: true,
            errorCallback: (errorMessage: string) => {
                fail(`${gettext("PDF export failed.")} ${errorMessage}`)
            },
            printCallback: (iframeWin: Window) => {
                void (async () => {
                    try {
                        const bytes = await emitPdfFromVivliostyleWindow(
                            iframeWin,
                            (message: string) =>
                                this.progressCallback?.(
                                    `${title}: ${message}`,
                                    null
                                ),
                            {
                                sourceHtml: html,
                                metadata,
                                printOptions: this.options.printOptions,
                                // The vivliostyle-pdf fallback fonts and the
                                // WOFF2 decoder wasm are bundled in
                                // static-libs/ and served from the app's
                                // static files (see the vivliostyle-pdf
                                // README). If they are missing, exports still
                                // work whenever the document's own fonts can
                                // be embedded.
                                baseUrl: staticUrl(""),
                                woff2WasmUrl: staticUrl("woff2/woff2.wasm"),
                                attachments
                            }
                        )
                        download(
                            new Blob([bytes as BlobPart], {
                                type: "application/pdf"
                            }),
                            filename,
                            "application/pdf"
                        )
                        this.progressCallback?.(
                            `${title}: ${gettext("PDF export complete.")}`,
                            100
                        )
                    } catch (error) {
                        console.error(error)
                        fail(gettext("PDF export failed."))
                    } finally {
                        iframeWin.frameElement?.remove()
                    }
                })()
            }
        })
    }
}
