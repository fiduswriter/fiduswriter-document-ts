import download from "downloadjs"

import {gettext, shortFileTitle, staticUrl} from "fwtoolkit"
import type {BibDB, CSL, ExportDoc, FidusNode, ImageDB} from "../../types.js"
import {formatHtml} from "../tools/format.js"
import {removeHidden} from "../tools/doc_content.js"
import {createSlug, getImageExtension} from "../tools/file.js"
import {ZipFileCreator, type ZipTextFile} from "fwtoolkit/file/zip"
import type {ProgressCallback} from "../tools/progress.js"
import {HTMLExporterConvert} from "./convert.js"
import type {HTMLExportMetadata} from "./convert.js"
import {htmlExportTemplate} from "./templates.js"

/*
 Exporter to HTML
*/

// The open-license (SIL OFL) Libertinus Serif/Mono fallback fonts bundled
// with @fiduswriter/document. css/document.css references them through
// relative @font-face url()s (fonts/...), so they are shipped in the export
// next to the stylesheet under css/fonts/ to keep the fallback self-contained.
const FALLBACK_FONTS = [
    "LibertinusSerif-Regular.ttf",
    "LibertinusSerif-Bold.ttf",
    "LibertinusSerif-Italic.ttf",
    "LibertinusSerif-BoldItalic.ttf",
    "LibertinusMono-Regular.ttf"
]

export class HTMLExporter {
    doc: ExportDoc
    bibDB: BibDB
    imageDB: ImageDB
    csl: CSL
    updated: Date
    documentStyles: Array<{
        slug: string
        contents: string
        documentstylefile_set: Array<[string, string]>
    }>
    converterOptions: Record<string, unknown>

    docTitle: string
    docContent: FidusNode | false
    zipFileName: string | false
    textFiles: Array<{filename: string; contents?: string; url?: string}>
    httpFiles: Array<{filename: string; url: string; blob?: Blob}>
    includeZips: Array<{directory: string; url: string}>
    metaData!: HTMLExportMetadata
    htmlExportTemplate: typeof htmlExportTemplate
    contentFileName: string
    fileEnding: string
    mimeType: string
    styleSheets: Array<{url?: string; filename?: string; contents?: string}>
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
        converterOptions: Record<string, unknown> = {},
        template: typeof htmlExportTemplate = htmlExportTemplate,
        progressCallback?: ProgressCallback
    ) {
        this.doc = doc
        this.bibDB = bibDB
        this.imageDB = imageDB
        this.csl = csl
        this.updated = updated
        this.documentStyles = documentStyles
        this.converterOptions = converterOptions
        this.progressCallback = progressCallback

        this.docTitle = shortFileTitle(this.doc.title, this.doc.path || "")

        this.docContent = false
        this.zipFileName = false
        this.textFiles = []
        this.httpFiles = []
        this.includeZips = []
        // this.metaData is populated during export() from the converter.
        // To override in subclasses
        this.htmlExportTemplate = template
        this.contentFileName = "document.html"
        this.fileEnding = "html.zip"
        this.mimeType = "application/zip"

        // Stylesheets will have one of:
        // * a url - which means they will be fetched before they are included as a separate file
        // * a filename and contents - which means they will be included as a separate file
        // * only contents - which means they will be incldued inside <style></style> tags in the document header
        // * only filename - which means they will be referenced as a separate file. You need to add the file yourself.
        this.styleSheets = [{url: staticUrl("css/document/document.css")}]
    }

    async init(): Promise<void> {
        this.progressCallback?.(gettext("Exporting to HTML..."), 0)
        await this.process()
        this.progressCallback?.(gettext("Creating HTML zip file..."), 90)
        const downloadResult = await this.createZip()
        this.progressCallback?.(gettext("Export to HTML complete."), 100)
        return downloadResult
    }

    async process(): Promise<void> {
        // Process the document and prepare files
        this.zipFileName = `${createSlug(this.docTitle)}.${this.fileEnding}`
        this.docContent = removeHidden(this.doc.content) as FidusNode

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
            this.converterOptions
        )
        const {html, imageIds, metaData, extraStyleSheets} =
            await this.converter.init()
        this.metaData = metaData
        if (this.converter.features.math && this.converter.mathOutput !== "svg") {
            // Only MathML output needs the MathLive styles/fonts bundle; SVG
            // equations are self-contained data-URI images. Skipping the zip in
            // SVG mode avoids an otherwise-unnecessary (and possibly failing)
            // fetch of mathlive_style.zip.
            this.includeZips.push({
                directory: "css",
                url: staticUrl("zip/mathlive_style.zip")
            })
        }
        await this.addDoc(html)
        this.addImages(imageIds)
        this.addFallbackFonts()
        await Promise.all(
            extraStyleSheets.map(
                async (sheet: {filename?: string | null; contents?: string}) =>
                    await this.loadStyle(sheet)
            )
        )
    }

    converter!: HTMLExporterConvert

    getProcessedFiles(): {
        textFiles: Array<{filename: string; contents?: string; url?: string}>
        httpFiles: Array<{filename: string; url: string; blob?: Blob}>
        includeZips: Array<{directory: string; url: string}>
        metaData: HTMLExportMetadata
        converter: HTMLExporterConvert
    } {
        // Return the processed files and metadata. Used when using the
        // exporter in a different context than creating a zip file.
        return {
            textFiles: this.textFiles,
            httpFiles: this.httpFiles,
            includeZips: this.includeZips,
            metaData: this.metaData,
            converter: this.converter
        }
    }

    async addDoc(html: string): Promise<void> {
        this.textFiles.push({
            filename: this.contentFileName,
            contents: await formatHtml(html)
        })
    }

    addImages(imageIds: string[]): void {
        imageIds.forEach(id => {
            const image = this.imageDB.db[id]
            const imageValue = image.image
            if (imageValue instanceof Blob) {
                const ext = getImageExtension(
                    image.file_type as string | undefined,
                    imageValue.type
                )
                this.httpFiles.push({
                    filename: `images/image-${id}.${ext}`,
                    url: `blob:${id}`,
                    blob: imageValue
                })
            } else {
                this.httpFiles.push({
                    filename: `images/${(imageValue as string).split("/").pop()!}`,
                    url: imageValue as string
                })
            }
        })
    }

    addFallbackFonts(): void {
        FALLBACK_FONTS.forEach(filename => {
            this.httpFiles.push({
                filename: `css/fonts/${filename}`,
                url: staticUrl(`css/document/fonts/${filename}`)
            })
        })
    }

    getDocStyle(doc: ExportDoc): {contents: string; filename: string} | false {
        const docStyle = this.documentStyles.find(
            docStyle => docStyle.slug === doc.settings.documentstyle
        )

        // The files will be in the base directory. The filenames of
        // DocumentStyleFiles will therefore not need to replaced with their URLs.
        if (!docStyle) {
            return false
        }
        let contents = docStyle.contents
        docStyle.documentstylefile_set.forEach(
            ([_url, filename]) =>
                (contents = contents.replace(
                    new RegExp(filename, "g"),
                    `media/${filename}`
                ))
        )
        this.httpFiles = this.httpFiles.concat(
            docStyle.documentstylefile_set.map(([url, filename]) => ({
                filename: `css/media/${filename}`,
                url
            }))
        )
        return {contents, filename: `css/${docStyle.slug}.css`}
    }

    async loadStyle(
        sheet: {url?: string; filename?: string | null; contents?: string}
    ): Promise<{url?: string; filename?: string | null; contents?: string}> {
        if (sheet.url) {
            // Use simple fetch without X-Requested-With header and credentials
            // to avoid CORS preflight redirect issues with CDNs
            const response = await fetch(sheet.url)
            if (!response.ok) {
                throw response
            }
            const text = await response.text()
            sheet.contents = text
            sheet.filename = `css/${sheet.url.split("/").pop()!.split("?")[0]}`
            delete sheet.url
        }
        if (sheet.filename) {
            this.textFiles.push(sheet as {filename: string; contents?: string})
        }
        return Promise.resolve(sheet)
    }

    async createZip(): Promise<void> {
        const zipper = new ZipFileCreator(
            this.textFiles as ZipTextFile[],
            this.httpFiles,
            this.includeZips,
            this.mimeType,
            this.updated
        )
        const blob = await zipper.init()
        return this.download(blob)
    }

    download(blob: Blob): void | Promise<void> {
        return download(blob, this.zipFileName as string, this.mimeType)
    }
}
