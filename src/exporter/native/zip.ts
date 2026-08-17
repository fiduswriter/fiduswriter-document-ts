import {ZipFileCreator} from "fwtoolkit/file/zip"
import {FW_DOCUMENT_VERSION} from "../../schema/index.js"

import type {TemplateFiles} from "../../types.js"

export class ZipFidus {
    docId: string | number
    doc: Record<string, unknown>
    shrunkImageDB: Record<string, Record<string, unknown>>
    shrunkBibDB: Record<string, Record<string, unknown>>
    httpFiles: Array<{url: string; filename: string; blob?: Blob}>
    includeTemplate: boolean
    token: string | boolean
    getTemplateFiles?: (
        docId: string | number,
        token: string | boolean
    ) => Promise<TemplateFiles>

    textFiles: Array<{filename: string; contents: string}> = []

    constructor(
        docId: string | number,
        doc: Record<string, unknown>,
        shrunkImageDB: Record<string, Record<string, unknown>>,
        shrunkBibDB: Record<string, Record<string, unknown>>,
        httpFiles: Array<{url: string; filename: string; blob?: Blob}>,
        includeTemplate = true,
        token: string | boolean = false,
        getTemplateFiles?: (
            docId: string | number,
            token: string | boolean
        ) => Promise<TemplateFiles>
    ) {
        this.docId = docId
        this.doc = doc
        this.shrunkImageDB = shrunkImageDB
        this.shrunkBibDB = shrunkBibDB
        this.httpFiles = httpFiles
        this.includeTemplate = includeTemplate
        this.token = token
        this.getTemplateFiles = getTemplateFiles

        this.textFiles = [
            {
                filename: "document.json",
                contents: JSON.stringify(this.doc)
            },
            {
                filename: "images.json",
                contents: JSON.stringify(this.shrunkImageDB)
            },
            {
                filename: "bibliography.json",
                contents: JSON.stringify(this.shrunkBibDB)
            },
            {
                filename: "filetype-version",
                contents: FW_DOCUMENT_VERSION
            }
        ]
    }

    init(): Promise<Blob> {
        if (!this.includeTemplate || !this.getTemplateFiles) {
            return this.createZip()
        }
        return this.getTemplateFiles(this.docId, this.token).then(
            ({textFiles, httpFiles}) => {
                this.textFiles = this.textFiles.concat(textFiles)
                this.httpFiles = this.httpFiles.concat(httpFiles)
                return this.createZip()
            }
        )
    }

    createZip(): Promise<Blob> {
        const zipper = new ZipFileCreator(
            this.textFiles,
            this.httpFiles,
            [],
            "application/vnd.fiduswriter+zip"
        )
        return zipper.init()
    }
}
