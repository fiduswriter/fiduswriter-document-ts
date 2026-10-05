import download from "downloadjs"

import {gettext, shortFileTitle} from "fwtoolkit"
import {formatXml} from "../tools/format.js"
import type {BibDB, CSL, ExportDoc, FidusNode, ImageDB} from "../../types.js"
import type {ProgressCallback} from "../tools/progress.js"
import {createSlug, getImageDBEntryFilename} from "../tools/file.js"
import {ZipFileCreator} from "fwtoolkit/file/zip"
import {TeiExporterMath} from "./math.js"
import {TeiCitationsExporter} from "./citations.js"
import {convert} from "./convert.js"
import type {TeiConversion} from "./convert.js"
import {extractCitations} from "./extract.js"
import {removeHidden} from "../tools/doc_content.js"

/*
 Exporter to TEI (Text Encoding Initiative) XML.
*/

export interface TEIExporterOptions {
    /** TEI XML inserted into `<publicationStmt>`. */
    publicationStmt?: string
}

export class TEIExporter {
    doc: ExportDoc
    docTitle: string
    bibDB: BibDB
    imageDB: ImageDB
    csl: CSL
    updated: Date
    options: TEIExporterOptions

    zipFileName: string | false
    textFiles: Array<{filename: string; contents: string}>
    httpFiles: Array<{filename: string; url: string; blob?: Blob}>

    conversion: TeiConversion | undefined
    progressCallback?: ProgressCallback

    constructor(
        doc: ExportDoc,
        bibDB: BibDB,
        imageDB: ImageDB,
        csl: CSL,
        updated: Date,
        options: TEIExporterOptions = {},
        progressCallback?: ProgressCallback
    ) {
        this.doc = doc
        this.docTitle = shortFileTitle(this.doc.title, this.doc.path || "")
        this.bibDB = bibDB
        this.imageDB = imageDB
        this.csl = csl
        this.updated = updated
        this.options = options
        this.progressCallback = progressCallback

        this.zipFileName = false
        this.textFiles = []
        this.httpFiles = []
    }

    async init(): Promise<void> {
        this.progressCallback?.(gettext("Exporting to TEI..."), 0)
        this.zipFileName = `${createSlug(this.docTitle)}.tei.xml.zip`
        const docContent = removeHidden(this.doc.content) as FidusNode
        const citations = new TeiCitationsExporter(
            this.doc.settings,
            this.bibDB,
            this.csl
        )
        this.progressCallback?.(gettext("Formatting citations..."), 30)
        await citations.init(extractCitations(docContent))
        const mathExporter = new TeiExporterMath()
        this.conversion = convert(
            createSlug(this.docTitle),
            docContent,
            this.imageDB,
            citations,
            mathExporter,
            Object.assign({}, this.doc.settings, this.options)
        )
        this.progressCallback?.(gettext("Assembling TEI archive..."), 70)
        this.textFiles.push({
            filename: `${createSlug(this.docTitle)}.tei.xml`,
            contents: await formatXml(this.conversion.tei)
        })
        this.addImages(this.conversion.imageIds)
        await this.createZip()
        this.progressCallback?.(gettext("Export to TEI complete."), 100)
        return Promise.resolve()
    }

    addImages(imageIds: Array<string | number>): void {
        imageIds.forEach(id => {
            const imageEntry = this.imageDB.db[id]
            if (!imageEntry) {
                return
            }
            const imageValue = imageEntry.image
            const filename = getImageDBEntryFilename(imageEntry, id)
            if (imageValue instanceof Blob) {
                this.httpFiles.push({
                    filename: `images/${filename}`,
                    url: `blob:${id}`,
                    blob: imageValue
                })
            } else if (imageValue instanceof ArrayBuffer) {
                this.httpFiles.push({
                    filename: `images/${filename}`,
                    url: `blob:${id}`,
                    blob: new Blob([imageValue], {
                        type: (imageEntry.file_type as string) || "image/png"
                    })
                })
            } else if (typeof imageValue === "string") {
                this.httpFiles.push({
                    filename: `images/${filename}`,
                    url: imageValue
                })
            }
        })
    }

    createZip(): Promise<void> {
        const zipper = new ZipFileCreator(
            this.textFiles,
            this.httpFiles,
            undefined,
            undefined,
            this.updated
        )
        return zipper.init().then(blob => this.download(blob))
    }

    download(blob: Blob): void | Promise<void> {
        return download(blob, this.zipFileName as string, "application/zip")
    }
}
