import {escapeText, gettext} from "fwtoolkit"

import {FW_DOCUMENT_VERSION} from "../../schema/index.js"
import {updateFile} from "./update.js"
import {updateTemplateFile} from "./update_template.js"
import {NativeImporter} from "./importer.js"

import type {
    E2EEOptions,
    FidusDoc,
    ImageDBEntries,
    NativeImporterBackend,
    Template,
    User
} from "../../types.js"

export const MIN_FW_DOCUMENT_VERSION = 1.6
export const MAX_FW_DOCUMENT_VERSION = Number.parseFloat(FW_DOCUMENT_VERSION)

const TEXT_FILENAMES = [
    "mimetype",
    "filetype-version",
    "document.json",
    "images.json",
    "bibliography.json"
]

export interface FidusFileImporterOptions {
    check?: boolean
    contacts?: Array<Record<string, unknown>>
    e2eeOptions?: E2EEOptions | null
    checkDocUsers?: (
        doc: Record<string, unknown>,
        user: User,
        contacts: Array<Record<string, unknown>>
    ) => Record<string, unknown>
}

export class FidusFileImporter {
    file: Blob
    user: User
    path: string
    check: boolean
    contacts: Array<Record<string, unknown>>
    e2eeOptions: E2EEOptions | null
    checkDocUsers?: (
        doc: Record<string, unknown>,
        user: User,
        contacts: Array<Record<string, unknown>>
    ) => Record<string, unknown>

    textFiles: Array<{filename: string; content: string}> = []
    otherFiles: Array<{filename: string; content: Blob | ArrayBuffer | string}> = []
    ok = false
    statusText = ""
    doc: Record<string, unknown> | null = null
    docInfo: Record<string, unknown> | null = null
    template: Template | null = null

    backend: NativeImporterBackend

    constructor(
        file: Blob,
        user: User,
        path: string,
        backend: NativeImporterBackend,
        options: FidusFileImporterOptions = {}
    ) {
        this.file = file
        this.user = user
        this.path = path
        this.check = options.check ?? false
        this.contacts = options.contacts || []
        this.e2eeOptions = options.e2eeOptions ?? null
        this.checkDocUsers = options.checkDocUsers
        this.backend = backend
    }

    init(): Promise<this> {
        if (!this.check) {
            return this.initZipFileRead()
        }
        return new Promise(resolve => {
            const reader = new FileReader()
            reader.onloadend = () => {
                const result = reader.result as string
                if (
                    result.length > 60 &&
                    result.substring(0, 2) === "PK"
                ) {
                    this.initZipFileRead().then(() => resolve(this))
                } else {
                    this.statusText = gettext(
                        "The uploaded file does not appear to be a Fidus Writer file."
                    )
                    resolve(this)
                }
            }
            reader.readAsText(this.file)
        })
    }

    initZipFileRead(): Promise<this> {
        return import("jszip")
            .then(({default: JSZip}) => new JSZip())
            .then(zipfs => zipfs.loadAsync(this.file))
            .then(zipfs => {
                const filenames: string[] = []
                const p: Array<Promise<void>> = []
                let validFile = true

                zipfs.forEach(filename => filenames.push(filename))

                TEXT_FILENAMES.forEach(filename => {
                    if (filenames.indexOf(filename) === -1) {
                        validFile = false
                    }
                })
                if (!validFile) {
                    this.statusText = gettext(
                        "The uploaded file does not appear to be a Fidus Writer file."
                    )
                    return this
                }

                filenames
                    .filter(filename => !filename.endsWith("/"))
                    .forEach(filename => {
                        p.push(
                            new Promise(resolve => {
                                const isText =
                                    ["mimetype", "filetype-version"].includes(
                                        filename
                                    ) || filename.endsWith(".json")
                                zipfs.files[filename]
                                    .async(isText ? "string" : "blob")
                                    .then(content => {
                                        if (isText) {
                                            this.textFiles.push({
                                                filename,
                                                content: content as string
                                            })
                                        } else {
                                            this.otherFiles.push({
                                                filename,
                                                content: content as Blob
                                            })
                                        }
                                        resolve()
                                    })
                            })
                        )
                    })
                return Promise.all(p).then(() => this.processFidusFile())
            })
    }

    processFidusFile(): Promise<this> {
        const filetypeVersionFile = this.textFiles.find(
                file => file.filename === "filetype-version"
            ),
            mimeTypeFile = this.textFiles.find(
                file => file.filename === "mimetype"
            )

        if (!filetypeVersionFile || !mimeTypeFile) {
            this.statusText = gettext(
                "The uploaded file does not appear to be a Fidus Writer file."
            )
            return Promise.resolve(this)
        }

        const filetypeVersion = Number.parseFloat(filetypeVersionFile.content),
            mimeType = mimeTypeFile.content

        if (
            mimeType === "application/fidus+zip" &&
            filetypeVersion >= MIN_FW_DOCUMENT_VERSION &&
            filetypeVersion <= MAX_FW_DOCUMENT_VERSION
        ) {
            const documentFile = this.textFiles.find(
                    file => file.filename === "document.json"
                ),
                bibliographyFile = this.textFiles.find(
                    file => file.filename === "bibliography.json"
                ),
                imagesFile = this.textFiles.find(
                    file => file.filename === "images.json"
                )

            if (!documentFile || !bibliographyFile || !imagesFile) {
                this.statusText = gettext(
                    "The uploaded file does not appear to be a Fidus Writer file."
                )
                return Promise.resolve(this)
            }

            const updatedFile = updateFile(
                    JSON.parse(documentFile.content) as FidusDoc,
                    filetypeVersion,
                    JSON.parse(bibliographyFile.content),
                    JSON.parse(imagesFile.content) as ImageDBEntries
                ),
                bibliography = updatedFile.bibliography,
                images = updatedFile.images
            let doc = updatedFile.doc as unknown as Record<string, unknown>
            if (this.check && this.checkDocUsers) {
                doc = this.checkDocUsers(doc, this.user, this.contacts)
            }

            const templateFiles = this.otherFiles.filter(
                file =>
                    file.filename.startsWith("exporttemplates/") ||
                    file.filename.startsWith("documentstyles/")
            )
            this.otherFiles = this.otherFiles.filter(
                file =>
                    !file.filename.startsWith("exporttemplates/") &&
                    !file.filename.startsWith("documentstyles/")
            )

            const templateFile = this.textFiles.find(
                file => file.filename === "template.json"
            )
            if (templateFile) {
                const exporttemplatesFile = this.textFiles.find(
                        file => file.filename === "exporttemplates.json"
                    ),
                    documentstylesFile = this.textFiles.find(
                        file => file.filename === "documentstyles.json"
                    )
                if (!exporttemplatesFile || !documentstylesFile) {
                    this.statusText = gettext(
                        "The uploaded file does not appear to be a Fidus Writer file."
                    )
                    return Promise.resolve(this)
                }
                const templateDef = JSON.parse(templateFile.content)
                this.template = updateTemplateFile(
                    templateDef.attrs.template,
                    templateDef,
                    JSON.parse(exporttemplatesFile.content),
                    JSON.parse(documentstylesFile.content),
                    filetypeVersion
                ) as Template
                this.template.files = templateFiles
            }

            const safeTitle = (doc.title as string).replace(/\//g, "")
            const importer = new NativeImporter(
                doc,
                bibliography,
                {db: images},
                this.otherFiles,
                this.user,
                this.backend,
                {
                    importId: null,
                    requestedPath: this.path.endsWith("/")
                        ? this.path + safeTitle
                        : this.path,
                    template: this.template,
                    e2eeOptions: this.e2eeOptions
                }
            )
            return importer.init().then(({doc: importedDoc, docInfo}) => {
                this.ok = true
                this.doc = importedDoc
                this.docInfo = docInfo
                this.statusText = `${escapeText(
                    importedDoc.title as string
                )} ${gettext("successfully imported.")}`
                return this
            })
        }
        this.statusText =
            gettext(
                "The uploaded file does not appear to be of the version used on this server: "
            ) + FW_DOCUMENT_VERSION
        return Promise.resolve(this)
    }
}
