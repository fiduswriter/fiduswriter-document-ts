import download from "downloadjs";
import { addAlert, gettext, shortFileTitle, staticUrl } from "fwtoolkit";
import { printHTML } from "@vivliostyle/print";
import { emitPdfFromVivliostyleWindow } from "vivliostyle-pdf";
import { PrintExporter } from "../print/index.js";
import { createSlug } from "../tools/file.js";
/**
 * Export the document directly to a PDF, client-side, without the browser
 * print dialog. Reuses the print pipeline's HTML generation (vivliostyle
 * pagination) and then runs vivliostyle-pdf's DOM-to-PDF emitter on the
 * paginated iframe to produce a real vector PDF, which is downloaded.
 */
export class PdfExporter extends PrintExporter {
    options;
    constructor(doc, bibDB, imageDB, csl, updated, documentStyles, progressCallback, options = {}) {
        super(doc, bibDB, imageDB, csl, updated, documentStyles, progressCallback, {
            figurePageFloats: options.figurePageFloats,
            tablePageFloats: options.tablePageFloats
        });
        this.options = options;
    }
    async buildMetadata(metaData) {
        const authorString = metaData.authors
            .map((author) => {
            const authorAttrs = author.attrs || {};
            const firstname = authorAttrs.firstname;
            const lastname = authorAttrs.lastname;
            const institution = authorAttrs.institution;
            if (firstname || lastname) {
                const nameParts = [];
                if (typeof firstname === "string") {
                    nameParts.push(firstname);
                }
                if (typeof lastname === "string") {
                    nameParts.push(lastname);
                }
                return nameParts.join(" ");
            }
            else if (typeof institution === "string") {
                return institution;
            }
            return "";
        })
            .filter(Boolean)
            .join(", ");
        const metadata = {
            title: metaData.title,
            keywords: metaData.keywords.length
                ? metaData.keywords.join(", ")
                : undefined,
            language: this.doc.settings.language || "en-US",
            // Creator: the document's authors when present, otherwise the
            // current Fidus Writer user who initiated the export.
            creator: authorString.length
                ? authorString
                : this.options.userName,
            // Producer: the application that produced the PDF.
            producer: this.options.version
                ? `Fidus Writer ${this.options.version}`
                : "Fidus Writer"
        };
        if (authorString.length) {
            metadata.author = authorString;
        }
        return metadata;
    }
    async init() {
        const title = shortFileTitle(this.doc.title, this.doc.path || "");
        this.progressCallback?.(`${title}: ${gettext("PDF export has been initiated.")}`, 0);
        const { html, metaData } = await this.buildPaginatedHtml();
        this.progressCallback?.(`${title}: ${gettext("Rendering PDF…")}`, 25);
        const metadata = await this.buildMetadata(metaData);
        // Name the download after the document title (not the folder path
        // segment that `docTitle`/`shortFileTitle` carries).
        const slug = createSlug(this.doc.title) || "document";
        const filename = `${slug}.pdf`;
        const attachments = [];
        if (this.options.fidusFile) {
            attachments.push({
                filename: `${slug}.fidus`,
                bytes: this.options.fidusFile,
                mimeType: "application/vnd.fiduswriter+zip",
                description: "Fidus Writer source document (editable version of this PDF)"
            });
        }
        const fail = (message) => {
            this.progressCallback?.(`${title}: ${message}`, 100);
            addAlert("error", message);
        };
        printHTML(html, {
            removeIframe: false,
            hideIframe: true,
            errorCallback: (errorMessage) => {
                fail(`${gettext("PDF export failed.")} ${errorMessage}`);
            },
            printCallback: (iframeWin) => {
                void (async () => {
                    try {
                        const bytes = await emitPdfFromVivliostyleWindow(iframeWin, (message) => this.progressCallback?.(`${title}: ${message}`, null), {
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
                        });
                        download(new Blob([bytes], {
                            type: "application/pdf"
                        }), filename, "application/pdf");
                        this.progressCallback?.(`${title}: ${gettext("PDF export complete.")}`, 100);
                    }
                    catch (error) {
                        console.error(error);
                        fail(gettext("PDF export failed."));
                    }
                    finally {
                        iframeWin.frameElement?.remove();
                    }
                })();
            }
        });
    }
}
//# sourceMappingURL=index.js.map