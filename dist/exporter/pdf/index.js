import download from "downloadjs";
import { addAlert, gettext, shortFileTitle, staticUrl } from "fwtoolkit";
import { emitPdfFromWindow } from "pages-to-pdf";
import { PrintExporter } from "../print/index.js";
import { getPrintEngine } from "../print/engines/registry.js";
import { createSlug } from "../tools/file.js";
/**
 * Export the document directly to a PDF, client-side, without the browser
 * print dialog. Reuses the print pipeline's HTML generation (pagination by
 * the selected print engine) and then runs the pages-to-pdf DOM-to-PDF
 * emitter on the paginated iframe to produce a real vector PDF, which is
 * downloaded.
 */
export class PdfExporter extends PrintExporter {
    options;
    constructor(doc, bibDB, imageDB, csl, updated, documentStyles, progressCallback, options = {}) {
        super(doc, bibDB, imageDB, csl, updated, documentStyles, progressCallback, {
            printEngine: options.printEngine,
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
        const engine = getPrintEngine(this.options.printEngine);
        const pdfOptions = {};
        if (this.options.pdfUa) {
            pdfOptions.pdfUa = 2;
        }
        if (this.options.pdfA) {
            // PDF/A-4 forbids embedded files — the conformance level is
            // upgraded to PDF/A-4f whenever files are attached.
            const embedsFiles = attachments.length > 0 || this.options.embedSourceHtml !== undefined;
            pdfOptions.pdfA =
                embedsFiles && this.options.pdfA !== "4f"
                    ? "4f"
                    : this.options.pdfA;
        }
        try {
            const paginated = await engine.preparePagination({
                html,
                title: metaData.title,
                polyfillURL: staticUrl("paged/paged.polyfill.js"),
                errorCallback: (errorMessage) => {
                    fail(`${gettext("PDF export failed.")} ${errorMessage}`);
                }
            });
            try {
                const bytes = await emitPdfFromWindow(paginated.win, {
                    onProgress: (message) => this.progressCallback?.(`${title}: ${message}`, null),
                    sourceHtml: html,
                    metadata,
                    printOptions: this.options.printOptions,
                    embedSourceHtml: this.options.embedSourceHtml,
                    // The fallback fonts, the WOFF2 decoder wasm and the
                    // PDF/A sRGB ICC profile are bundled in static-libs/
                    // and served from the app's static files. If they are
                    // missing, exports still work whenever the document's
                    // own fonts can be embedded, and the output intent is
                    // skipped.
                    baseUrl: staticUrl(""),
                    woff2WasmUrl: staticUrl("woff2/woff2.wasm"),
                    attachments,
                    pdfOptions,
                    backend: engine.backend
                });
                download(new Blob([bytes], {
                    type: "application/pdf"
                }), filename, "application/pdf");
                this.progressCallback?.(`${title}: ${gettext("PDF export complete.")}`, 100);
            }
            finally {
                paginated.cleanup();
            }
        }
        catch (error) {
            console.error(error);
            fail(gettext("PDF export failed."));
        }
    }
}
//# sourceMappingURL=index.js.map