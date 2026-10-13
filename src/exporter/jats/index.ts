import download from "downloadjs"

import {gettext, shortFileTitle} from "fwtoolkit"
import {formatXml} from "../tools/format.js"
import type {BibDB, CSL, ExportDoc, ImageDB} from "../../types.js"
import type {ProgressCallback} from "../tools/progress.js"
import {createSlug, getImageDBEntryFilename, getImageExtension} from "../tools/file.js"
import {ZipFileCreator} from "fwtoolkit/file/zip"
import {JATSExporterConverter} from "./convert.js"
import {
    articleTemplate,
    bookPartWrapperTemplate,
    darManifest
} from "./templates.js"

/*
 Exporter to JATS
*/

export class JATSExporter {
    doc: ExportDoc
    docTitle: string
    bibDB: BibDB
    imageDB: ImageDB
    csl: CSL
    updated: Date
    type: string

    zipFileName: string | false
    textFiles: Array<{filename: string; contents: string}>
    httpFiles: Array<{filename: string; url: string; blob?: Blob}>

    converter!: JATSExporterConverter
    progressCallback?: ProgressCallback

    constructor(
        doc: ExportDoc,
        bibDB: BibDB,
        imageDB: ImageDB,
        csl: CSL,
        updated: Date,
        type: string,
        progressCallback?: ProgressCallback
    ) {
        this.doc = doc
        this.docTitle = shortFileTitle(this.doc.title, this.doc.path || "")
        this.bibDB = bibDB
        this.imageDB = imageDB
        this.csl = csl
        this.updated = updated
        this.type = type // "article", "book-part-wrapper" (for documents) or "book" (for document collections)
        this.progressCallback = progressCallback

        this.zipFileName = false
        this.textFiles = []
        this.httpFiles = []
    }

    async init(): Promise<void> {
        this.progressCallback?.(gettext("Exporting to JATS..."), 0)
        const fileFormat = this.type === "article" ? "jats" : "bits"
        this.zipFileName = `${createSlug(this.docTitle)}.${fileFormat}.zip`
        this.converter = new JATSExporterConverter(
            this.type,
            this.doc,
            this.csl,
            this.imageDB,
            this.bibDB
        )
        const {
            front,
            body,
            back,
            imageIds
        }: {
            front: string
            body: string
            back: string
            imageIds: string[]
        } = await this.converter.init()
        this.progressCallback?.(gettext("Assembling JATS archive..."), 70)
        const jats =
            this.type === "article"
                ? articleTemplate({front, body, back})
                : bookPartWrapperTemplate({front, body, back})
        this.textFiles.push({
            filename: "manuscript.xml",
            contents: await formatXml(jats)
        })
        const images = imageIds.map(id => {
            const imageEntry = this.imageDB.db[id]
            const imageValue = imageEntry.image
            let filename: string
            let url: string
            let blob: Blob | undefined
            if (imageValue instanceof Blob) {
                const ext = getImageExtension(
                    imageEntry.file_type as string | undefined,
                    imageValue.type
                )
                filename = `image-${id}.${ext}`
                url = `blob:${id}`
                blob = imageValue
            } else {
                // Data URLs have no usable last path segment (the base64
                // payload may contain "/"); the helper derives a stable name.
                filename = getImageDBEntryFilename(imageEntry, id)
                url = imageValue as string
            }
            return {
                title: imageEntry.title || "",
                filename,
                url,
                blob
            }
        })
        this.textFiles.push({
            filename: "manifest.xml",
            contents: await formatXml(
                darManifest({
                    title: this.docTitle,
                    type: this.type,
                    images
                })
            )
        })
        images.forEach(image => {
            this.httpFiles.push({
                filename: image.filename,
                url: image.url,
                blob: image.blob
            })
        })

        const downloadResult = await this.createZip()
        this.progressCallback?.(gettext("Export to JATS complete."), 100)
        return downloadResult
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
