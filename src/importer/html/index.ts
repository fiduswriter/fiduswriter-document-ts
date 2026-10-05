import {escapeText} from "fwtoolkit"

import {HtmlConvert} from "./convert.js"
import {NativeImporter} from "../native/importer.js"

import type {
    BibDB,
    BibDBEntry,
    E2EEOptions,
    FidusDoc,
    FidusNode,
    ImageDBEntry,
    NativeImporterBackend,
    User
} from "../../types.js"

interface HtmlImporterOptions {
    getTemplate: (importId: string | number | null) => Promise<Record<string, unknown>>
    nativeBackend: NativeImporterBackend
    /** Bibliography database for restoring citation nodes. */
    bibDB?: BibDB
    /** Images available inside an imported zip bundle, keyed by path. */
    files?: {images?: Record<string, Blob>; bibliography?: string}
    e2eeOptions?: E2EEOptions | null
}

export class HtmlImporter {
    file: Blob
    user: User
    path: string
    importId: string | number | null
    bibDB: BibDB
    zipImages: Record<string, Blob>
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
        options: HtmlImporterOptions
    ) {
        this.file = file
        this.user = user
        this.path = path
        this.importId = importId
        this.bibDB = options.bibDB || {db: {}}
        this.zipImages = options.files?.images || {}
        this.e2eeOptions = options.e2eeOptions ?? null
        this.getTemplate = options.getTemplate
        this.nativeBackend = options.nativeBackend
    }

    init(): Promise<typeof this.output> {
        return this.getTemplate(this.importId)
            .then(template => {
                this.template = template
                return this.importHtml()
            })
            .catch(error => {
                this.output.statusText = error.message
                return this.output
            })
    }

    async importHtml(): Promise<typeof this.output> {
        const html = await this.file.text()
        return this.handleHtmlContent(html)
    }

    handleHtmlContent(html: string): Promise<typeof this.output> {
        const converter = new HtmlConvert(
            html,
            this.importId as string,
            this.template as {content: FidusDoc},
            this.bibDB,
            this.zipImages
        )

        let convertedDoc: {
            content: FidusDoc
            settings: Record<string, unknown>
            comments: Record<string, never>
            images: Record<string | number, ImageDBEntry>
            otherFiles: Array<{filename: string; content?: Blob; url?: string}>
        }
        try {
            convertedDoc = converter.init()
        } catch (error: unknown) {
            this.output.statusText =
                error instanceof Error ? error.message : String(error)
            console.error(error)
            return Promise.resolve(this.output)
        }

        const title =
            (convertedDoc.content as FidusNode).content?.[0].content
                ?.map(inline => inline.text || "")
                .join("")
                .trim() || "Untitled"

        const nativeImporter = new NativeImporter(
            {
                content: convertedDoc.content,
                title,
                comments: convertedDoc.comments,
                settings: convertedDoc.settings
            },
            {db: {}},
            {db: convertedDoc.images},
            convertedDoc.otherFiles.map(file => ({
                filename: file.filename,
                content: file.content as Blob,
                url: file.url
            })),
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
                this.output.statusText = (error as Error).message
                console.error(error)
                return this.output
            })
    }
}

export type {BibDBEntry}
