import {escapeText} from "fwtoolkit"

import {OdtConvert} from "./convert.js"
import {NativeImporter} from "../native/importer.js"
import {ensureZipSizeGuard} from "../zip_guard.js"

import type {
    BibDB,
    E2EEOptions,
    FidusDoc,
    FidusNode,
    NativeImporterBackend,
    User
} from "../../types.js"
import type JSZip from "jszip"

interface OdtImporterOptions {
    getTemplate: (importId: string | number | null) => Promise<Record<string, unknown>>
    nativeBackend: NativeImporterBackend
    bibDB?: BibDB
    e2eeOptions?: E2EEOptions | null
}

export class OdtImporter {
    file: Blob
    user: User
    path: string
    importId: string | number | null
    bibDB: BibDB
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
        options: OdtImporterOptions
    ) {
        this.file = file
        this.user = user
        this.path = path
        this.importId = importId
        this.bibDB = options.bibDB || {db: {}}
        this.getTemplate = options.getTemplate
        this.nativeBackend = options.nativeBackend
        this.e2eeOptions = options.e2eeOptions ?? null
    }

    init(): Promise<typeof this.output> {
        return this.getTemplate(this.importId)
            .then(template => {
                this.template = template
                return this.importOdt()
            })
            .catch(error => {
                this.output.statusText = error.message
                return this.output
            })
    }

    importOdt(): Promise<typeof this.output> {
        ensureZipSizeGuard()
        return import("jszip")
            .then(({default: JSZip}) => this.file.arrayBuffer().then(ab => JSZip.loadAsync(ab)))
            .then(zip => {
                const contentPromise = zip.file("content.xml")?.async("string")
                const stylePromise = zip.file("styles.xml")?.async("string")
                const metaPromise = zip.file("meta.xml")?.async("string")
                const manifestPromise = zip
                    .file("META-INF/manifest.xml")
                    ?.async("string")

                if (!contentPromise) {
                    this.output.statusText = "File does not contain content.xml"
                    return Promise.resolve(this.output)
                }

                const imageFiles: Record<string, JSZip.JSZipObject> = {}
                zip.forEach((relativePath, zipEntry) => {
                    if (relativePath.startsWith("Pictures/")) {
                        imageFiles[relativePath] = zipEntry
                    }
                })

                const imagePromises = Object.entries(imageFiles).map(
                    ([filename, zipEntry]) =>
                        zipEntry.async("blob").then((blob: Blob) => ({
                            filename,
                            blob
                        }))
                )

                return Promise.all([
                    contentPromise,
                    stylePromise,
                    metaPromise,
                    manifestPromise,
                    Promise.all(imagePromises)
                ]).then(
                    ([contentXml, stylesXml, metaXml, manifestXml, images]) => {
                        const imageObj: Record<string, Blob> = {}
                        images.forEach(({filename, blob}: {filename: string; blob: Blob}) => {
                            imageObj[filename] = blob
                        })

                        return this.handleOdtContent(
                            contentXml,
                            stylesXml,
                            metaXml,
                            manifestXml,
                            imageObj
                        )
                    }
                )
            })
    }

    handleOdtContent(
        contentXml: string,
        stylesXml: string | undefined,
        metaXml: string | undefined,
        manifestXml: string | undefined,
        images: Record<string, Blob> = {}
    ): Promise<typeof this.output> {
        const bibliography: Record<string, unknown> = {}

        const converter = new OdtConvert(
            contentXml,
            stylesXml || "",
            metaXml || "",
            manifestXml || "",
            this.importId as string,
            this.template as {content: FidusDoc},
            bibliography,
            this.bibDB
        )

        let convertedDoc
        try {
            convertedDoc = converter.init()
        } catch (error: unknown) {
            this.output.statusText = error instanceof Error ? error.message : String(error)
            console.error(error)
            return Promise.resolve(this.output)
        }

        const title =
            (convertedDoc.content as FidusNode).content?.[0].content?.[0].text ||
            "Untitled"

        const nativeImporter = new NativeImporter(
            {
                content: convertedDoc.content,
                title,
                comments: convertedDoc.comments,
                settings: convertedDoc.settings
            },
            bibliography,
            {db: converter.images || {}},
            Object.entries(images).map(([filename, blob]) => ({
                filename,
                content: blob
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
                this.output.statusText = error.message
                console.error(error)
                return this.output
            })
    }
}
