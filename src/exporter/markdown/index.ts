import {BibLatexExporter} from "bibliojson"
import type {BibDB as BibjsonBibDB} from "bibliojson"
import download from "downloadjs"

import {gettext, shortFileTitle} from "fwtoolkit"
import type {BibDB, ExportDoc, FidusNode, ImageDB} from "../../types.js"
import type {ProgressCallback} from "../tools/progress.js"
import {fixTables, removeHidden} from "../tools/doc_content.js"
import {createSlug, getImageDBEntryFilename} from "../tools/file.js"
import {ZipFileCreator} from "fwtoolkit/file/zip"
import {MarkdownExporterConvert} from "./convert.js"
import {readMe} from "./readme.js"

/*
 Exporter to pandoc-flavoured Markdown.
*/

export class MarkdownExporter {
    doc: ExportDoc
    docTitle: string
    bibDB: BibDB
    imageDB: ImageDB
    updated: Date

    docContent: FidusNode | false
    zipFileName: string | false
    textFiles: Array<{filename: string; contents: string}>
    httpFiles: Array<{filename: string; url: string; blob?: Blob}>

    conversion: {
        markdown: string
        imageIds: Array<string | number>
        usedBibDB: Record<string, {entry_key?: string} & Record<string, unknown>>
    } | undefined
    progressCallback?: ProgressCallback

    constructor(
        doc: ExportDoc,
        bibDB: BibDB,
        imageDB: ImageDB,
        updated: Date,
        progressCallback?: ProgressCallback
    ) {
        this.doc = doc
        this.docTitle = shortFileTitle(this.doc.title, this.doc.path || "")
        this.bibDB = bibDB
        this.imageDB = imageDB
        this.updated = updated
        this.progressCallback = progressCallback

        this.docContent = false
        this.zipFileName = false
        this.textFiles = []
        this.httpFiles = []
    }

    async init(): Promise<void> {
        this.progressCallback?.(gettext("Exporting to Markdown..."), 0)
        this.zipFileName = `${createSlug(this.docTitle)}.md.zip`
        this.docContent = fixTables(
            removeHidden(this.doc.content) as FidusNode
        )
        const converter = new MarkdownExporterConvert(
            this.imageDB,
            this.bibDB,
            this.doc.settings
        )
        this.conversion = converter.init(this.docContent)
        this.progressCallback?.(gettext("Preparing Markdown files..."), 50)
        this.textFiles.push({
            filename: "document.md",
            contents: this.conversion.markdown
        })
        if (Object.keys(this.conversion.usedBibDB).length > 0) {
            const bibExport = new BibLatexExporter(
                this.conversion.usedBibDB as unknown as BibjsonBibDB
            )
            this.textFiles.push({
                filename: "bibliography.bib",
                contents: bibExport.parse()
            })
        }
        this.conversion.imageIds.forEach(id => {
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
        this.textFiles.push({filename: "README.txt", contents: readMe})
        await this.createZip()
        this.progressCallback?.(gettext("Export to Markdown complete."), 100)
        return Promise.resolve()
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
