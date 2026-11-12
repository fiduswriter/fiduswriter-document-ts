import {ShrinkFidus} from "./shrink.js"
import type {ShrinkDoc} from "./shrink.js"
import {ZipFidus} from "./zip.js"

import type {
    BibDB,
    ExportDoc,
    ImageDB,
    TemplateFiles,
    UploadRevision
} from "../../types.js"
import type {ProgressCallback} from "./shrink.js"

export class SaveRevision {
    doc: ExportDoc
    imageDB: ImageDB
    bibDB: BibDB
    note: string
    uploadRevision: UploadRevision
    token: string | boolean
    getTemplateFiles?: (
        docId: string | number,
        token: string | boolean
    ) => Promise<TemplateFiles>
    onError?: (error: unknown) => void
    progressCallback?: ProgressCallback

    constructor(
        doc: ExportDoc,
        imageDB: ImageDB,
        bibDB: BibDB,
        note: string,
        uploadRevision: UploadRevision,
        options: {
            token?: string | boolean
            getTemplateFiles?: (
                docId: string | number,
                token: string | boolean
            ) => Promise<TemplateFiles>
            onError?: (error: unknown) => void
            progressCallback?: ProgressCallback
        } = {}
    ) {
        this.doc = doc
        this.imageDB = imageDB
        this.bibDB = bibDB
        this.note = note
        this.uploadRevision = uploadRevision
        this.token = options.token ?? false
        this.getTemplateFiles = options.getTemplateFiles
        this.onError = options.onError
        this.progressCallback = options.progressCallback
    }

    init(): Promise<unknown> {
        this.progressCallback?.(gettext("Saving snapshot..."), 0)
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
                    true,
                    this.token,
                    this.getTemplateFiles
                )
                return zipper.init()
            })
            .then(blob => {
                this.progressCallback?.(gettext("Uploading snapshot..."), 95)
                return this.uploadRevision(
                    blob,
                    this.doc as unknown as Record<string, unknown>
                )
            })
            .then(result => {
                this.progressCallback?.(gettext("Snapshot saved."), 100)
                return result
            })
            .catch(error => {
                if (this.onError) {
                    this.onError(error)
                }
                throw error
            })
    }
}
