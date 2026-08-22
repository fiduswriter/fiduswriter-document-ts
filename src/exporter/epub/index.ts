import {HTMLExporter} from "../html/index.js"
import type {BibDB, Contributor, CSL, ExportDoc, FidusNode, ImageDB} from "../../types.js"
import type {ProgressCallback} from "../tools/progress.js"
import {formatHtml, formatXml} from "../tools/format.js"

import {
    containerTemplate,
    navTemplate,
    ncxTemplate,
    opfTemplate
} from "./templates.js"
import {
    buildHierarchy,
    getFontMimeType,
    getImageMimeType,
    getTimestamp
} from "./tools.js"

export class EpubExporter extends HTMLExporter {
    documentFileName: string
    lang: string
    shortLang: string
    progressCallback?: ProgressCallback

    constructor(
        doc: ExportDoc,
        bibDB: BibDB,
        imageDB: ImageDB,
        csl: CSL,
        updated: Date,
        documentStyles: Array<{
            slug: string
            contents: string
            documentstylefile_set: Array<[string, string]>
        }>,
        converterOptions: Record<string, unknown> = {},
        progressCallback?: ProgressCallback
    ) {
        super(doc, bibDB, imageDB, csl, updated, documentStyles, {
            xhtml: true,
            epub: true,
            ...converterOptions
        })
        this.progressCallback = progressCallback
        // Overriden properties
        this.documentFileName = "document.xhtml"
        this.contentFileName = "document.xhtml"
        this.fileEnding = "epub"
        this.mimeType = "application/epub+zip"
        this.lang = doc.settings.language || "en-US"
        this.shortLang = this.lang.split("-")[0]
    }

    async createZip(): Promise<void> {
        this.prefixFiles()
        await this.createEPUBFiles()
        return super.createZip()
    }

    prefixFiles(): void {
        // prefix all files with "EPUB/"
        this.textFiles = this.textFiles.map(file =>
            Object.assign({}, file, {filename: `EPUB/${file.filename}`})
        )
        this.httpFiles = this.httpFiles.map(file =>
            Object.assign({}, file, {filename: `EPUB/${file.filename}`})
        )
        this.includeZips = this.includeZips.map(file =>
            Object.assign({}, file, {directory: `EPUB/${file.directory}`})
        )
    }

    async createEPUBFiles(): Promise<void> {
        // Generate the required EPUB-specific files using the converted content
        this.textFiles.push(
            {
                filename: "META-INF/container.xml",
                contents: await formatXml(containerTemplate())
            },
            {
                filename: "EPUB/document.opf",
                contents: await formatXml(this.createOPF())
            },
            {
                filename: "EPUB/document.ncx",
                contents: await formatXml(this.createNCX())
            },
            {
                filename: "EPUB/document-nav.xhtml",
                contents: await formatHtml(this.createNav())
            }
        )
    }

    createOPF(): string {
        const timestamp = getTimestamp(this.updated)
        const images = this.httpFiles
            .map(file =>
                Object.assign({mimeType: getImageMimeType(file.filename)}, file)
            )
            .filter(image => image.mimeType) as Array<
            {filename: string; url: string; mimeType: string}
        >

        const fontFiles = this.httpFiles
            .map(file =>
                Object.assign({mimeType: getFontMimeType(file.filename)}, file)
            )
            .filter(file => file.mimeType) as Array<
            {filename: string; url: string; mimeType: string}
        >

        const styleSheets = this.textFiles.filter(file =>
            file.filename.endsWith(".css")
        )

        // Extract authors and keywords from metaData
        const rawAuthors = this.converter.metaData.authors.map(
            (node: FidusNode) => {
                const author = (node.attrs || {}) as Contributor
                if (author.firstname || author.lastname) {
                    const nameParts: string[] = []
                    if (author.firstname) {
                        nameParts.push(author.firstname as string)
                    }
                    if (author.lastname) {
                        nameParts.push(author.lastname as string)
                    }
                    return nameParts.join(" ")
                } else if (author.institution) {
                    return author.institution as string
                }
                return undefined
            }
        )
        const authors = rawAuthors.filter(
            (author): author is string => typeof author === "string"
        )
        return opfTemplate({
            language: this.lang,
            title: this.docTitle,
            authors,
            keywords: this.converter.metaData.keywords,
            idType: "fidus",
            id: String(this.doc.id),
            date: timestamp.slice(0, 10),
            modified: timestamp,
            styleSheets,
            math:
                this.converter.features.math &&
                this.converter.mathOutput !== "svg",
            images,
            fontFiles,
            copyright: this.doc.settings.copyright as
                | {holder?: string; year?: number}
                | undefined
        })
    }

    createNCX(): string {
        return ncxTemplate({
            shortLang: this.shortLang,
            title: this.docTitle,
            idType: "fidus",
            id: String(this.doc.id),
            toc: buildHierarchy(this.converter.metaData.toc)
        })
    }

    createNav(): string {
        const styleSheets = this.textFiles.filter(file =>
            file.filename.endsWith(".css")
        )
        return navTemplate({
            shortLang: this.shortLang,
            toc: buildHierarchy(this.converter.metaData.toc),
            styleSheets
        })
    }
}
