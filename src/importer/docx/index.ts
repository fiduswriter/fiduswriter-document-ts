import {escapeText} from "fwtoolkit"

import {DocxConvert} from "./convert.js"
import {NativeImporter} from "../native/importer.js"
import {ensureZipSizeGuard} from "../zip_guard.js"

import type {
    E2EEOptions,
    FidusDoc,
    FidusNode,
    NativeImporterBackend,
    User
} from "../../types.js"

interface DocxImporterOptions {
    getTemplate: (importId: string | number | null) => Promise<Record<string, unknown>>
    nativeBackend: NativeImporterBackend
    e2eeOptions?: E2EEOptions | null
}

export class DocxImporter {
    file: Blob
    user: User
    path: string
    importId: string | number | null
    e2eeOptions: E2EEOptions | null
    getTemplate: (importId: string | number | null) => Promise<Record<string, unknown>>
    nativeBackend: NativeImporterBackend

    template: Record<string, unknown> | null = null
    output: {
        ok: boolean
        statusText: string
        doc: Record<string, unknown> | null
        docInfo: Record<string, unknown> | null
    } = {
        ok: false,
        statusText: "",
        doc: null,
        docInfo: null
    }

    constructor(
        file: Blob,
        user: User,
        path: string,
        importId: string | number | null,
        options: DocxImporterOptions
    ) {
        this.file = file
        this.user = user
        this.path = path
        this.importId = importId
        this.getTemplate = options.getTemplate
        this.nativeBackend = options.nativeBackend
        this.e2eeOptions = options.e2eeOptions ?? null
    }

    init(): Promise<typeof this.output> {
        return this.getTemplate(this.importId)
            .then(template => {
                this.template = template
                return this.importDocx()
            })
            .catch(error => {
                this.output.statusText = error.message
                return this.output
            })
    }

    importDocx(): Promise<typeof this.output> {
        ensureZipSizeGuard()
        const bibliography: Record<string, unknown> = {}
        return import("jszip")
            .then(({default: JSZip}) => this.file.arrayBuffer().then(ab => JSZip.loadAsync(ab)))
            .then(zip => {
                const docx = new DocxConvert(
                    zip,
                    this.importId as string,
                    this.template as {content: FidusDoc},
                    bibliography
                )

                return docx.init().then(convertedDoc => {
                    const title =
                        (convertedDoc.content as FidusNode).content?.[0].content?.[0]
                            .text || "Untitled"
                    const nativeImporter = new NativeImporter(
                        {
                            content: convertedDoc.content,
                            title,
                            comments: convertedDoc.comments,
                            settings: convertedDoc.settings
                        },
                        bibliography,
                        {db: docx.images || {}},
                        [],
                        this.user,
                        this.nativeBackend,
                        {
                            importId: this.importId,
                            requestedPath: this.path + title,
                            template: null,
                            e2eeOptions: this.e2eeOptions
                        }
                    )

                    return nativeImporter
                        .init()
                        .then(({doc, docInfo}) => {
                            this.output.ok = true
                            this.output.doc = doc
                            this.output.docInfo = docInfo
                            this.output.statusText = `${escapeText(
                                doc.title as string
                            )} successfully imported.`
                            return this.output
                        })
                        .catch(error => {
                            this.output.statusText = error.message
                            console.error(error)
                            return this.output
                        })
                })
            })
    }
}
