import {BibLatexExporter} from "bibliojson"
import type {BibDB as BibjsonBibDB} from "bibliojson"
import download from "downloadjs"

import {gettext, shortFileTitle} from "fwtoolkit"
import type {BibDB, BibDBEntries, ExportDoc, FidusNode, ImageDB} from "../../types.js"
import type {ProgressCallback} from "../tools/progress.js"
import {fixTables, removeHidden} from "../tools/doc_content.js"
import {createSlug, getImageDBEntryFilename, getImageExtension} from "../tools/file.js"
import {ZipFileCreator} from "fwtoolkit/file/zip"
import {LatexExporterConvert} from "./convert.js"
import {readMe} from "./readme.js"

/*
 Exporter to LaTeX
*/

export class LatexExporter {
    doc: ExportDoc
    docTitle: string
    bibDB: BibDB
    imageDB: ImageDB
    updated: Date

    docContent: FidusNode | false
    zipFileName: string | false
    textFiles: Array<{filename: string; contents: string}>
    httpFiles: Array<{filename: string; url: string; blob?: Blob}>

    conversion: {latex: string; imageIds: string[]; usedBibDB: BibDBEntries} | undefined
    progressCallback?: ProgressCallback

    constructor(doc: ExportDoc, bibDB: BibDB, imageDB: ImageDB, updated: Date, progressCallback?: ProgressCallback) {
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

    init(): Promise<void> {
        this.progressCallback?.(gettext("Exporting to LaTeX..."), 0)
        this.zipFileName = `${createSlug(this.docTitle)}.latex.zip`
        this.docContent = fixTables(removeHidden(this.doc.content) as FidusNode)
        const converter = new LatexExporterConvert(
            this,
            this.imageDB,
            this.bibDB,
            this.doc.settings
        )
        this.conversion = converter.init(this.docContent as FidusNode)
        this.progressCallback?.(gettext("Preparing LaTeX files..."), 50)
        if (Object.keys(this.conversion!.usedBibDB).length > 0) {
            const bibExport = new BibLatexExporter(
                this.conversion!.usedBibDB as unknown as BibjsonBibDB
            )
            this.textFiles.push({
                filename: "bibliography.bib",
                contents: bibExport.parse()
            })
        }
        this.textFiles.push({
            filename: "document.tex",
            contents: this.conversion!.latex
        })
        this.textFiles.push({filename: "README.txt", contents: readMe})
        this.conversion!.imageIds.forEach((id: string) => {
            const imageEntry = this.imageDB.db[id]
            const imageValue = imageEntry.image
            if (imageValue instanceof Blob) {
                const ext = getImageExtension(
                    imageEntry.file_type as string | undefined,
                    imageValue.type
                )
                this.httpFiles.push({
                    filename: `image-${id}.${ext}`,
                    url: `blob:${id}`,
                    blob: imageValue
                })
            } else {
                // Data URLs have no usable last path segment (the base64
                // payload may contain "/"); the helper derives a stable name.
                this.httpFiles.push({
                    filename: getImageDBEntryFilename(imageEntry, id),
                    url: imageValue as string
                })
            }
        })
        return this.createZip().then(downloadResult => {
            this.progressCallback?.(gettext("Export to LaTeX complete."), 100)
            return downloadResult
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
