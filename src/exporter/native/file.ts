import {shortFileTitle, gettext} from "fwtoolkit"

import {ShrinkFidus} from "./shrink.js"
import {ZipFidus} from "./zip.js"
import {createSlug} from "../tools/file.js"
import {saveFile} from "../save.js"
import type {ShrinkDoc} from "./shrink.js"

import type {BibDB, ExportDoc, ImageDB, TemplateFiles} from "../../types.js"

export type ProgressCallback = (
    message: string,
    percentage?: number | null
) => void

export class ExportFidusFile {
    doc: ExportDoc
    bibDB: BibDB
    imageDB: ImageDB
    includeTemplate: boolean
    token: string | boolean
    getTemplateFiles?: (
        docId: string | number,
        token: string | boolean
    ) => Promise<TemplateFiles>
    progressCallback?: ProgressCallback
    shouldDownload: boolean

    constructor(
        doc: ExportDoc,
        bibDB: BibDB,
        imageDB: ImageDB,
        includeTemplate = true,
        token: string | boolean = false,
        getTemplateFiles?: (
            docId: string | number,
            token: string | boolean
        ) => Promise<TemplateFiles>,
        progressCallback?: ProgressCallback,
        download = true
    ) {
        this.doc = doc
        this.bibDB = bibDB
        this.imageDB = imageDB
        this.includeTemplate = includeTemplate
        this.token = token
        this.getTemplateFiles = getTemplateFiles
        this.progressCallback = progressCallback
        this.shouldDownload = download
        return this.init() as unknown as ExportFidusFile
    }

    init(): Promise<Blob> {
        this.progressCallback?.(
            gettext("File export has been initiated."),
            0
        )
        const shrinker = new ShrinkFidus(
            this.doc as unknown as ShrinkDoc,
            this.imageDB,
            this.bibDB,
            this.progressCallback
        )
        return shrinker
            .init()
            .then(({doc, shrunkImageDB, shrunkBibDB, httpIncludes}) => {
                const zipper = new ZipFidus(
                    this.doc.id,
                    doc,
                    shrunkImageDB,
                    shrunkBibDB,
                    httpIncludes,
                    this.includeTemplate,
                    this.token,
                    this.getTemplateFiles
                )
                return zipper.init()
            })
            .then(blob => {
                this.progressCallback?.(gettext("Export complete."), 100)
                if (this.shouldDownload) {
                    this.download(blob)
                }
                return blob
            })
    }

    download(blob: Blob): Promise<boolean> {
        const title: string = shortFileTitle(this.doc.title, this.doc.path || "") || "untitled"
        const filename = `${createSlug(title)}.fidus`
        return saveFile(blob, filename, {
            description: "Fidus Writer document",
            mimeType: "application/vnd.fiduswriter+zip",
            extensions: [".fidus"]
        })
    }
}
