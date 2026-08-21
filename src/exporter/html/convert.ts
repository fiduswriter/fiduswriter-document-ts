import {convertLatexToMathMl} from "mathlive"

import {escapeText, staticUrl} from "fwtoolkit"
import {ensureMathJax, latexToSvg} from "./math.js"
import {getCat} from "../../schema/i18n.js"
import type {
    BibDB,
    CSL,
    DocSettings,
    FidusMark,
    FidusNode,
    ImageDB
} from "../../types.js"
import {descendantNodes} from "../tools/doc_content.js"
import {formatCss} from "../tools/format.js"
import {getImageDBEntryFilename} from "../tools/file.js"
import {HTMLExporterCitations} from "./citations.js"
import {displayNumber} from "./tools.js"
import type {HtmlExportTemplateOptions} from "./templates.js"

type HtmlExportTemplate = (options: HtmlExportTemplateOptions) => string

interface HTMLExporterConvertOptions {
    xhtml?: boolean
    epub?: boolean
    relativeUrls?: boolean
    footnoteNumbering?: string
    affiliationNumbering?: string
    idPrefix?: string
    footnoteOffset?: number
    affiliationOffset?: number
    figureOffset?: Record<string, number>
    /**
     * Render tracked changes (insertions underlined, deletions struck through)
     * instead of silently dropping the marks. Only has an effect when the
     * document still contains `insertion`/`deletion` marks (i.e. the caller
     * did not resolve them first).
     */
    trackChanges?: boolean
    /**
     * How to render `equation`/`figure_equation` nodes. `"mathml"` (default)
     * emits MathML via MathLive. `"svg"` converts the stored LaTeX to an SVG
     * `<img>` via MathJax instead, which renders consistently everywhere
     * (browsers, EPUB readers, and the vivliostyle-pdf PDF emitter). Falls
     * back to MathML when MathJax cannot convert a formula.
     */
    mathOutput?: "mathml" | "svg"
}

export interface HTMLExportMetadata {
    title: string
    authors: FidusNode[]
    abstract: Record<string, FidusNode> | false
    keywords: string[]
    copyright: Record<string, unknown>
    toc: Array<{level: number; id: string; title: string; docTitle?: boolean}>
}

export class HTMLExporterConvert {
    docTitle: string
    docSettings: DocSettings
    docContent: FidusNode
    htmlExportTemplate: HtmlExportTemplate
    imageDB: ImageDB
    bibDB: BibDB
    csl: CSL
    styleSheets: Array<{filename?: string | null; contents?: string}>
    xhtml: boolean
    epub: boolean
    relativeUrls: boolean
    footnoteNumbering: string
    affiliationNumbering: string
    trackChanges: boolean
    mathOutput: "mathml" | "svg"

    endSlash: string
    imageIds: string[]
    categoryCounter: Record<string, number>
    affiliations: Record<string, number>
    parCounter: number
    headingCounter: number
    currentSectionLevel: number
    listCounter: number
    orderedListLengths: number[]
    footnotes: string[]
    fnCounter: number
    affCounter: number
    metaData: HTMLExportMetadata
    features: {math: boolean; bibliography: boolean}
    citations: {
        type: string
        bibCSS: string
        bibHTML: string
        citationTexts: string[]
    }
    citInfos: Array<Record<string, unknown>>
    citationCount: number
    extraStyleSheets: Array<{filename?: string | null; contents?: string}>
    idPrefix: string

    constructor(
        docTitle: string,
        docSettings: DocSettings,
        docContent: FidusNode,
        htmlExportTemplate: HtmlExportTemplate,
        imageDB: ImageDB,
        bibDB: BibDB,
        csl: CSL,
        styleSheets: Array<{filename?: string | null; contents?: string}>,
        {
            xhtml = false,
            epub = false,
            relativeUrls = true, // Whether to use relative urls for images, css files, etc. Is used when bundled in HTML. Not in print.
            footnoteNumbering = "decimal",
            affiliationNumbering = "alpha",
            idPrefix = "",
            footnoteOffset = 0,
            affiliationOffset = 0,
            figureOffset = {},
            trackChanges = false,
            mathOutput = "mathml"
        }: HTMLExporterConvertOptions = {}
    ) {
        this.docTitle = docTitle
        this.docSettings = docSettings
        this.docContent = docContent
        this.htmlExportTemplate = htmlExportTemplate
        this.imageDB = imageDB
        this.bibDB = bibDB
        this.csl = csl
        this.styleSheets = styleSheets
        this.xhtml = xhtml
        this.epub = epub
        this.relativeUrls = relativeUrls
        this.footnoteNumbering = footnoteNumbering
        this.affiliationNumbering = affiliationNumbering
        this.trackChanges = trackChanges
        this.mathOutput = mathOutput

        this.endSlash = this.xhtml ? "/" : ""
        this.imageIds = []
        this.categoryCounter = {} // counters for each type of figure (figure/table/photo)
        this.affiliations = {} // affiliations of authors and editors
        this.parCounter = 0
        this.headingCounter = 0
        this.currentSectionLevel = 0
        this.listCounter = 0
        this.orderedListLengths = []
        this.footnotes = []
        this.fnCounter = footnoteOffset
        this.affCounter = affiliationOffset
        this.metaData = {
            title: this.docTitle,
            authors: [],
            abstract: false,
            keywords: [],
            copyright: {
                licenses: []
            },
            toc: []
        }
        this.features = {
            math: false,
            bibliography: false
        }
        this.citations = {
            type: "",
            bibCSS: "",
            bibHTML: "",
            citationTexts: []
        }
        this.citInfos = []
        this.citationCount = 0
        this.extraStyleSheets = []
        this.idPrefix = idPrefix
        this.categoryCounter = Object.assign({}, figureOffset)
    }

    init(): Promise<{
        html: string
        imageIds: string[]
        extraStyleSheets: Array<{filename?: string | null; contents?: string}>
        metaData: HTMLExportMetadata
    }> {
        this.analyze(this.docContent)
        return this.process()
    }

    async processCitInfos(): Promise<void> {
        const citationProcessor = new HTMLExporterCitations(
            this.docSettings,
            this.bibDB,
            this.csl
        )
        const citations = await citationProcessor.init(this.citInfos)
        this.citations = citations
    }

    async process(): Promise<{
        html: string
        imageIds: string[]
        extraStyleSheets: Array<{filename?: string | null; contents?: string}>
        metaData: HTMLExportMetadata
    }> {
        if (this.citInfos.length) {
            await this.processCitInfos()
        }

        if (this.citations.bibCSS.length) {
            this.extraStyleSheets.push({
                filename: this.relativeUrls ? "css/bibliography.css" : null,
                contents: await formatCss(this.citations.bibCSS)
            })
        }
        if (this.features.math) {
            this.extraStyleSheets.push({
                filename: this.relativeUrls
                    ? "css/mathlive.css"
                    : staticUrl("css/libs/mathlive/mathlive.css")
            })
        }
        if (this.mathOutput === "svg" && this.features.math) {
            // MathJax must be initialised before the (synchronous) walkJson
            // conversion below; it is lazy-loaded so MathML-only exports and
            // documents without math pay nothing.
            await ensureMathJax()
        }
        const body = this.assembleBody()
        const back = this.assembleBack()
        const head = this.assembleHead()
        const html = this.htmlExportTemplate({
            head,
            body,
            back,
            settings: this.docSettings,
            lang: this.docSettings.language!.split("-")[0],
            xhtml: this.xhtml,
            epub: this.epub
        })
        return {
            html,
            imageIds: this.imageIds,
            extraStyleSheets: this.extraStyleSheets,
            metaData: this.metaData
        }
    }

    // Find information for meta tags in header
    analyze(node: FidusNode): void {
        const attrs = node.attrs || {}
        switch (node.type) {
            case "citation":
                this.citInfos.push(JSON.parse(JSON.stringify(attrs)))
                break
            case "contributors_part": {
                const metadata = attrs.metadata
                if (metadata === "authors" && node.content) {
                    node.content.forEach((author: FidusNode) => {
                        this.metaData.authors.push(author)
                    })
                }
                break
            }
            case "doc":
                if (attrs.copyright) {
                    this.metaData.copyright = attrs.copyright as Record<
                        string,
                        unknown
                    >
                }
                break
            case "heading1":
            case "heading2":
            case "heading3":
            case "heading4":
            case "heading5":
            case "heading6": {
                const level = Number.parseInt(node.type.slice(-1))
                this.metaData.toc.push({
                    level,
                    id: attrs.id as string,
                    title: (node.content || [])
                        .map((subNode: FidusNode) => this.walkJson(subNode))
                        .join("")
                })
                break
            }
            case "equation":
            case "figure_equation":
                this.features.math = true
                break
            case "footnote": {
                const footnote = attrs.footnote
                if (Array.isArray(footnote)) {
                    footnote.forEach((child: FidusNode) => this.analyze(child))
                }
                break
            }
            case "richtext_part": {
                const metadata = attrs.metadata
                const language = attrs.language
                if (metadata === "abstract") {
                    if (!this.metaData.abstract) {
                        this.metaData.abstract = {}
                    }
                    const abstract = this.metaData.abstract
                    if (language) {
                        abstract[language as string] = node
                    } else {
                        abstract.default = node
                    }
                }
                break
            }
            case "tags_part": {
                const metadata = attrs.metadata
                if (metadata === "keywords" && node.content) {
                    node.content.forEach((tag: FidusNode) => {
                        const tagAttrs = tag.attrs || {}
                        const tagValue = tagAttrs.tag
                        if (typeof tagValue === "string") {
                            this.metaData.keywords.push(tagValue)
                        }
                    })
                }
                break
            }
            case "title": {
                const title = this.textWalkJson(node)
                if (title.length) {
                    this.metaData.title = title
                }
                this.metaData.toc.push({
                    docTitle: true,
                    level: 1,
                    id: "title",
                    title: title
                })
                break
            }

            default:
                break
        }
        if (node.content) {
            node.content.forEach((child: FidusNode) => this.analyze(child))
        }
    }

    assembleHead(): string {
        let head = `<title>${escapeText(this.metaData.title)}</title>`
        if (this.metaData.authors.length) {
            const authorString = this.metaData.authors
                .map((author: FidusNode) => {
                    const authorAttrs = author.attrs || {}
                    const firstname = authorAttrs.firstname
                    const lastname = authorAttrs.lastname
                    const institution = authorAttrs.institution
                    if (firstname || lastname) {
                        const nameParts: string[] = []
                        if (typeof firstname === "string") {
                            nameParts.push(firstname)
                        }
                        if (typeof lastname === "string") {
                            nameParts.push(lastname)
                        }
                        return nameParts.join(" ")
                    } else if (typeof institution === "string") {
                        return institution
                    }
                    return ""
                })
                .join(", ")
            if (authorString.length) {
                head += `<meta name="author" content="${escapeText(authorString)}"${this.endSlash}>`
            }
        }
        const copyright = this.metaData.copyright
        const copyrightHolder = copyright.holder
        if (typeof copyrightHolder === "string" && copyrightHolder.length) {
            head += `<link rel="schema.dcterms" href="http://purl.org/dc/terms/"${this.endSlash}>`
            const year =
                typeof copyright.year === "number"
                    ? copyright.year
                    : new Date().getFullYear()
            head += `<meta name="dcterms.dateCopyrighted" content="${year}"${this.endSlash}>`
            head += `<meta name="dcterms.rightsHolder" content="${escapeText(copyrightHolder)}"${this.endSlash}>`
            // TODO: Add this.metaData.copyright.freeToRead if present

            const licenses = copyright.licenses
            if (Array.isArray(licenses)) {
                head += licenses
                    .map(
                        (license: unknown) => {
                            const licenseRecord =
                                typeof license === "object" &&
                                license !== null
                                    ? (license as Record<string, unknown>)
                                    : {}
                            const url = licenseRecord.url
                            return typeof url === "string"
                                ? `<link rel="license" href="${escapeText(url)}"${this.endSlash}>` // TODO: Add this.metaData.copyright.license.start info if present
                                : ""
                        }
                    )
                    .join("")
            }
        }
        const abstract = this.metaData.abstract
        if (abstract) {
            if (abstract.default) {
                head += this.walkJson(abstract.default)
            }
            Object.keys(abstract)
                .filter(language => language !== "default")
                .forEach(language => {
                    const abstractNode = abstract[language]
                    if (abstractNode) {
                        head += this.walkJson(abstractNode)
                    }
                })
        }
        if (this.metaData.keywords.length) {
            head += `<meta name="keywords" content="${escapeText(this.metaData.keywords.join(", "))}"${this.endSlash}>`
        }
        head += this.styleSheets
            .concat(this.extraStyleSheets)
            .map((sheet: {filename?: string | null; contents?: string}) => {
                if (!sheet.filename && !sheet.contents) {
                    console.warn(
                        "No filename or contents for stylesheet.",
                        sheet
                    )
                    return ""
                }
                return sheet.filename
                    ? `<link rel="stylesheet" type="text/css" href="${sheet.filename}"${this.endSlash}>`
                    : `<style>${sheet.contents}</style>`
            })
            .join("")
        return head
    }

    // Only allow for text output
    textWalkJson(node: FidusNode): string {
        let content = ""
        if (node.type === "text") {
            content +=
                typeof node.text === "string"
                    ? escapeText(node.text).normalize("NFC")
                    : ""
        } else if (node.content) {
            node.content.forEach((child: FidusNode) => {
                content += this.textWalkJson(child)
            })
        }
        return content
    }

    /**
     * When rendering tracked changes, mark block-level nodes that carry a
     * `track` attribute (deleted/inserted blocks) with `data-track`, so CSS
     * (and the vivliostyle-pdf emitter's decoration walk) can style them.
     */
    blockTrackData(attrs: Record<string, unknown>): string {
        if (!this.trackChanges) {
            return ""
        }
        const track = attrs.track
        if (Array.isArray(track)) {
            const type = (track as Array<{type?: string}>).find(
                (t: {type?: string}) =>
                    t &&
                    typeof t.type === "string" &&
                    t.type !== "block_change"
            )?.type
            if (type) {
                return ` data-track="${escapeText(type)}"`
            }
        }
        return ""
    }

    walkJson(node: FidusNode, options: Record<string, unknown> = {}): string {
        let start = "",
            content = "",
            end = ""
        const attrs = node.attrs || {}
        switch (node.type) {
            case "doc":
                break
            case "title":
                start += `<div class="doc-part doc-title" id="${this.idPrefix}title"${this.blockTrackData(attrs)}>`
                end = "</div>" + end
                break
            case "heading_part":
                start += `<div class="doc-part doc-heading doc-${attrs.id} ${attrs.metadata || "other"}" id="${this.idPrefix}${attrs.id}"${attrs.language ? ` lang="${attrs.language}"` : ""}${this.blockTrackData(attrs)}>`
                end = "</div>" + end
                break
            case "contributor":
                // Ignore - we deal with contributors_part instead.
                break
            case "contributors_part":
                if (node.content) {
                    start += `<div class="doc-part doc-contributors doc-${attrs.id} ${attrs.metadata || "other"}" id="${this.idPrefix}${attrs.id}"${attrs.language ? ` lang="${attrs.language}"` : ""}${this.blockTrackData(attrs)}>`
                    end = "</div>" + end
                    let counter = 0
                    const contributorOutputs: string[] = []
                    node.content.forEach((childNode: FidusNode) => {
                        const contributor = childNode.attrs || {}
                        const firstname = contributor.firstname
                        const lastname = contributor.lastname
                        const institution = contributor.institution
                        const idType = contributor.id_type
                        const idValue = contributor.id_value
                        let output = ""
                        if (firstname || lastname) {
                            output += `<span id="${this.idPrefix}${attrs.id}-${counter++}" class="person">`
                            const nameParts: string[] = []
                            if (typeof firstname === "string") {
                                nameParts.push(
                                    `<span class="firstname">${escapeText(firstname)}</span>`
                                )
                            }
                            if (typeof lastname === "string") {
                                nameParts.push(
                                    `<span class="lastname">${escapeText(lastname)}</span>`
                                )
                            }
                            if (nameParts.length) {
                                output += `<span class="name">${nameParts.join(" ")}</span>`
                            }
                            if (typeof institution === "string") {
                                let affNumber
                                if (this.affiliations[institution]) {
                                    affNumber = this.affiliations[institution]
                                } else {
                                    affNumber = ++this.affCounter
                                    this.affiliations[institution] = affNumber
                                }
                                const affNumberDisplay = displayNumber(
                                    affNumber,
                                    this.affiliationNumbering
                                )
                                output += `<a class="affiliation" href="#aff-${affNumber}"${this.epub ? ' epub:type="noteref"' : ""}>${affNumberDisplay}</a>`
                            }
                            if (
                                typeof idType === "string" &&
                                typeof idValue === "string"
                            ) {
                                output += `<span class="contributor-id">${escapeText(idType)}: ${escapeText(idValue)}</span>`
                            }
                            output += "</span>"
                        } else if (typeof institution === "string") {
                            // There is an affiliation but no first/last name. We take this
                            // as a group collaboration.
                            output += `<span id="${this.idPrefix}${attrs.id}-${counter++}" class="group">`
                            output += `<span class="name">${escapeText(institution)}</span>`
                            output += "</span>"
                        }
                        contributorOutputs.push(output)
                    })
                    content += contributorOutputs.join(", ")
                }
                break
            case "tags_part":
                if (node.content) {
                    start += `<div class="doc-part doc-tags doc-${attrs.id} doc-${attrs.metadata || "other"}" id="${this.idPrefix}${attrs.id}"${attrs.language ? ` lang="${attrs.language}"` : ""}${this.blockTrackData(attrs)}>`
                    end = "</div>" + end
                }
                break
            case "tag":
                if (typeof attrs.tag === "string") {
                    content += `<span class='tag'>${escapeText(attrs.tag)}</span>`
                }
                break
            case "richtext_part":
                if (node.content) {
                    start += `<div class="doc-part doc-richtext doc-${attrs.id} doc-${attrs.metadata || "other"}" id="${this.idPrefix}${attrs.id}"${attrs.language ? ` lang="${attrs.language}"` : ""}${this.blockTrackData(attrs)}>`
                    end = "</div>" + end
                }
                break
            case "table_of_contents": {
                const title =
                    typeof attrs.title === "string" ? attrs.title : ""
                start += `<div class="doc-part table-of-contents"><h1>${escapeText(title)}</h1>`
                content += this.metaData.toc
                    .map(
                        (item: {
                            level: number
                            id: string
                            title: string
                            docTitle?: boolean
                        }) =>
                            `<h${item.level}><a href="#${item.id}">${item.title}</a></h${item.level}>`
                    )
                    .join("")
                end += "</div>"
                break
            }
            case "separator_part":
                content += `<hr class="doc-part doc-separator doc-${attrs.id} doc-${attrs.metadata || "other"}" id="${this.idPrefix}${attrs.id}">`
                break
            case "table_part":
                if (node.content) {
                    start += `<div class="doc-part doc-table doc-${attrs.id} doc-${attrs.metadata || "other"}" id="${this.idPrefix}${attrs.id}"${attrs.language ? ` lang="${attrs.language}"` : ""}${this.blockTrackData(attrs)}>`
                    end = "</div>" + end
                }
                break
            case "paragraph":
                start += `<p id="${this.idPrefix}p-${++this.parCounter}"${this.blockTrackData(attrs)}>`
                end = "</p>" + end
                break
            case "heading1":
            case "heading2":
            case "heading3":
            case "heading4":
            case "heading5":
            case "heading6": {
                const level = Number.parseInt(node.type.slice(-1))
                start += `<h${level} id="${this.idPrefix}${attrs.id}"${this.blockTrackData(attrs)}>`
                end = `</h${level}>` + end
                break
            }
            case "code_block": {
                const codeAttrs: string[] = []
                const language = attrs.language
                const category = attrs.category
                const title = attrs.title
                const id = attrs.id
                if (typeof language === "string") {
                    codeAttrs.push(
                        `data-language="${escapeText(language)}"`
                    )
                }
                if (typeof category === "string") {
                    codeAttrs.push(`data-category="${category}"`)
                }
                if (typeof title === "string") {
                    codeAttrs.push(`data-title="${escapeText(title)}"`)
                }
                if (typeof id === "string") {
                    codeAttrs.push(`data-id="${id}"`)
                }
                const attrString = codeAttrs.length
                    ? ` ${codeAttrs.join(" ")}`
                    : ""

                // If there's a category, wrap in figure for proper numbering
                if (typeof category === "string" && typeof id === "string") {
                    const docLanguage = this.docSettings.language || "en-US"
                    const categoryLabel = getCat(category, docLanguage)

                    // Count code blocks to get the number
                    const categories: Record<string, number> = {}
                    for (const n of descendantNodes(this.docContent)) {
                        const nAttrs = n.attrs || {}
                        if (
                            n.type === "code_block" &&
                            typeof nAttrs.category === "string" &&
                            typeof nAttrs.id === "string"
                        ) {
                            if (!categories[nAttrs.category]) {
                                categories[nAttrs.category] = 0
                            }
                            categories[nAttrs.category]++
                            if (nAttrs.id === id) {
                                break
                            }
                        }
                    }
                    const number = categories[category] || 1
                    const label =
                        typeof title === "string"
                            ? `${categoryLabel} ${number}: ${escapeText(title)}`
                            : `${categoryLabel} ${number}`

                    start += `<figure class="code-block-figure" id="${this.idPrefix}${id}"><figcaption><span class="label">${label}</span></figcaption><pre${attrString}><code>`
                    end = `</code></pre></figure>` + end
                } else {
                    start += `<code${attrString}>`
                    end = "</code>" + end
                }
                break
            }
            case "blockquote":
                start += "<blockquote>"
                end = "</blockquote>" + end
                break
            case "ordered_list": {
                const order =
                    typeof attrs.order === "number" ? attrs.order : 1
                if (order === 1) {
                    start += `<ol id="${this.idPrefix}list-${++this.listCounter}">`
                } else {
                    start += `<ol id="${this.idPrefix}list-${++this.listCounter}" start="${order}">`
                }
                end = "</ol>" + end
                break
            }
            case "bullet_list":
                start += `<ul id="${this.idPrefix}list-${++this.listCounter}">`
                end = "</ul>" + end
                break
            case "list_item":
                start += "<li>"
                end = "</li>" + end
                break
            case "footnote": {
                const footnoteNumber = ++this.fnCounter
                const footnoteNumberDisplay = displayNumber(
                    footnoteNumber,
                    this.footnoteNumbering
                )
                content += `<a class="footnote"${this.epub ? ' epub:type="noteref"' : ""} href="#fn-${footnoteNumber}">${footnoteNumberDisplay}</a>`
                options = Object.assign({}, options)
                options.inFootnote = true
                const footnoteContent = attrs.footnote
                if (Array.isArray(footnoteContent)) {
                    this.footnotes.push(
                        this.walkJson(
                            {
                                type: "footnotecontainer",
                                attrs: {
                                    id: `fn-${footnoteNumber}`,
                                    label: footnoteNumberDisplay // Note: it's unclear whether the footnote number is required as a label
                                },
                                content: footnoteContent
                            },
                            options
                        )
                    )
                }
                break
            }
            case "footnotecontainer":
                start += `<aside class="footnote"${this.epub ? ' epub:type="footnote"' : ""} role="doc-footnote" id="${this.idPrefix}${attrs.id}"><label>${attrs.label}</label>`
                end = "</aside>" + end
                break
            case "text": {
                let strong: FidusMark | undefined,
                    em: FidusMark | undefined,
                    underline: FidusMark | undefined,
                    hyperlink: FidusMark | undefined,
                    anchor: FidusMark | undefined,
                    sup: FidusMark | undefined,
                    sub: FidusMark | undefined,
                    code: FidusMark | undefined,
                    insertion: FidusMark | undefined,
                    deletion: FidusMark | undefined
                // Check for hyperlink, bold/strong, italic/em and underline
                if (node.marks) {
                    strong = node.marks.find(
                        (mark: FidusMark) => mark.type === "strong"
                    )
                    em = node.marks.find((mark: FidusMark) => mark.type === "em")
                    underline = node.marks.find(
                        (mark: FidusMark) => mark.type === "underline"
                    )
                    hyperlink = node.marks.find(
                        (mark: FidusMark) => mark.type === "link"
                    )
                    anchor = node.marks.find(
                        (mark: FidusMark) => mark.type === "anchor"
                    )
                    sup = node.marks.find((mark: FidusMark) => mark.type === "sup")
                    sub = node.marks.find((mark: FidusMark) => mark.type === "sub")
                    code = node.marks.find((mark: FidusMark) => mark.type === "code")
                    insertion = node.marks.find(
                        (mark: FidusMark) => mark.type === "insertion"
                    )
                    deletion = node.marks.find(
                        (mark: FidusMark) => mark.type === "deletion"
                    )
                }
                if (this.trackChanges) {
                    if (insertion) {
                        start += '<span class="insertion">'
                        end = "</span>" + end
                    }
                    if (deletion) {
                        start += '<span class="deletion">'
                        end = "</span>" + end
                    }
                }
                if (em) {
                    start += "<em>"
                    end = "</em>" + end
                }
                if (strong) {
                    start += "<strong>"
                    end = "</strong>" + end
                }
                if (underline) {
                    start += '<span class="underline">'
                    end = "</span>" + end
                }
                if (sup) {
                    start += "<sup>"
                    end = "</sup>" + end
                }
                if (sub) {
                    start += "<sub>"
                    end = "</sub>" + end
                }
                if (code) {
                    start += "<code>"
                    end = "</code>" + end
                }
                if (hyperlink) {
                    const linkAttrs = hyperlink.attrs || {}
                    const href =
                        typeof linkAttrs.href === "string" ? linkAttrs.href : ""
                    const link = href.startsWith("#")
                        ? `#${this.idPrefix}${href.slice(1)}`
                        : href
                    start += `<a href="${link}">`
                    end = "</a>" + end
                }
                if (anchor) {
                    const anchorAttrs = anchor.attrs || {}
                    const id =
                        typeof anchorAttrs.id === "string" ? anchorAttrs.id : ""
                    start += `<span class="anchor" id="${this.idPrefix}${id}" data-id="${this.idPrefix}${id}">`
                    end = "</span>" + end
                }
                content +=
                    typeof node.text === "string"
                        ? escapeText(node.text).normalize("NFC")
                        : ""
                break
            }
            case "cross_reference": {
                const refId =
                    typeof attrs.id === "string" ? attrs.id : ""
                const refTitle =
                    typeof attrs.title === "string" ? attrs.title : "MISSING TARGET"
                start += `<a class="reference" href="#${this.idPrefix}${refId}">`
                content += escapeText(refTitle)
                end = "</a>" + end
                break
            }
            case "citation": {
                if (!this.citations.citationTexts.length) {
                    // There are no citations. This may happen while analyzing.
                    return ""
                }
                const citationText =
                    this.citations.citationTexts[this.citationCount++]
                if (
                    options.inFootnote ||
                    this.citations.type !== "note"
                ) {
                    content += citationText
                } else {
                    content += `<a class="footnote"${this.epub ? 'epub:type="noteref" ' : ""} href="#fn-${++this.fnCounter}">${this.fnCounter}</a>`
                    this.footnotes.push(
                        `<aside class="footnote"${this.epub ? 'epub:type="footnote" ' : ""} id="fn-${this.fnCounter}"><label>${this.fnCounter}</label><p id="${this.idPrefix}p-${++this.parCounter}">${citationText}</p></aside>`
                    )
                }
                break
            }
            case "figure": {
                let imageUrl: string | undefined,
                    copyright: Record<string, unknown> | undefined
                const figureContent = node.content || []
                const imageNode = figureContent.find(
                    (child: FidusNode) => child.type === "image"
                )
                const image =
                    imageNode?.attrs?.image || false
                if (image !== false) {
                    this.imageIds.push(image as string)
                    const imageDBEntry = this.imageDB.db[image as string]
                    if (imageDBEntry) {
                        copyright =
                            typeof imageDBEntry.copyright === "object" &&
                            imageDBEntry.copyright !== null
                                ? (imageDBEntry.copyright as Record<
                                      string,
                                      unknown
                                  >)
                                : undefined
                        const filename = getImageDBEntryFilename(
                            imageDBEntry,
                            image as string
                        )
                        imageUrl = this.relativeUrls
                            ? `images/${filename}`
                            : typeof imageDBEntry.image === "string"
                              ? imageDBEntry.image
                              : undefined
                    }
                }
                const caption =
                    attrs.caption && figureContent.length
                        ? figureContent.find(
                              (child: FidusNode) =>
                                  child.type === "figure_caption"
                          )?.content || []
                        : []
                const figureCategory =
                    typeof attrs.category === "string" ? attrs.category : "none"
                const figureId =
                    typeof attrs.id === "string" ? attrs.id : ""
                const figureAligned =
                    typeof attrs.aligned === "string" ? attrs.aligned : ""
                const figureWidth =
                    typeof attrs.width === "string" ? attrs.width : ""
                if (
                    figureCategory === "none" &&
                    imageUrl &&
                    !caption.length &&
                    (!copyright || !copyright.holder)
                ) {
                    content += `<img id="${this.idPrefix}${figureId}" class="aligned-${figureAligned} image-width-${figureWidth}" src="${imageUrl}"${this.endSlash}>`
                } else {
                    start += `<figure
                        id="${this.idPrefix}${figureId}"
                        class="aligned-${figureAligned} image-width-${figureWidth}"
                        data-aligned="${figureAligned}"
                        data-width="${figureWidth}"
                        data-category="${figureCategory}"
                    >`
                    end = "</figure>" + end

                    const equationNode = figureContent.find(
                        (child: FidusNode) => child.type === "figure_equation"
                    )
                    const equation = equationNode?.attrs?.equation

                    if (image !== false && copyright?.holder) {
                        let figureFooter = `<footer class="copyright ${copyright.freeToRead ? "free-to-read" : "not-free-to-read"}"><small>`
                        figureFooter += "© "
                        const year =
                            typeof copyright.year === "number"
                                ? copyright.year
                                : new Date().getFullYear()
                        figureFooter += `<span class="copyright-year">${year}</span> `
                        figureFooter += `<span class="copyright-holder">${escapeText(copyright.holder as string)}</span> `
                        const licenses = copyright.licenses
                        if (Array.isArray(licenses)) {
                            figureFooter += licenses
                                .map(
                                    (license: unknown) => {
                                        const licenseRecord =
                                            typeof license === "object" &&
                                            license !== null
                                                ? (license as Record<
                                                      string,
                                                      unknown
                                                  >)
                                                : {}
                                        const licenseUrl = licenseRecord.url
                                        const licenseStart = licenseRecord.start
                                        return typeof licenseUrl === "string"
                                            ? `<span class="license"><a rel="license"${licenseStart ? ` data-start="${licenseStart}"` : ""}>${escapeText(licenseUrl)}</a></span>`
                                            : ""
                                    }
                                )
                                .join("")
                        }
                        figureFooter += "</small></footer>"
                        end = figureFooter + end
                    }

                    if (caption.length || figureCategory !== "none") {
                        let figcaption = "<figcaption>"
                        if (figureCategory !== "none") {
                            if (!this.categoryCounter[figureCategory]) {
                                this.categoryCounter[figureCategory] = 0
                            }
                            const catCount = ++this.categoryCounter[figureCategory]
                            const catLabel = `${getCat(figureCategory, this.docSettings.language || "en-US")} ${catCount}`
                            figcaption += `<label>${escapeText(catLabel)}</label>`
                        }
                        if (caption.length) {
                            figcaption += `<p>${caption.map((child: FidusNode) => this.walkJson(child)).join("")}</p>`
                        }
                        figcaption += "</figcaption>"
                        if (figureCategory === "table") {
                            start += figcaption
                        } else {
                            end = figcaption + end
                        }
                    }

                    if (typeof equation === "string") {
                        if (this.mathOutput === "svg") {
                            const svgMath = latexToSvg(equation, true)
                            if (svgMath) {
                                start += `<div class="figure-equation" data-equation="${escapeText(equation)}">`
                                end = "</div>" + end
                                content = `<img class="equation-svg" src="${svgMath.src}" alt="${escapeText(equation)}" style="width:${svgMath.widthEm}em;height:${svgMath.heightEm}em;vertical-align:middle">`
                            } else {
                                start += `<div class="figure-equation" data-equation="${escapeText(equation)}"><math display="block">`
                                end = "</math></div>" + end
                                content = convertLatexToMathMl(equation)
                            }
                        } else {
                            start += `<div class="figure-equation" data-equation="${escapeText(equation)}"><math display="block">`
                            end = "</math></div>" + end
                            content = convertLatexToMathMl(equation)
                        }
                    } else {
                        if (imageUrl) {
                            content += `<img src="${imageUrl}"${this.endSlash}>`
                        }
                    }
                }
                break
            }
            case "figure_caption":
                // We are already dealing with this in the figure. Prevent content from being added a second time.
                return ""
            case "figure_equation":
                // We are already dealing with this in the figure.
                break
            case "image":
                // We are already dealing with this in the figure.
                break
            case "table": {
                const tableId = typeof attrs.id === "string" ? attrs.id : ""
                const tableWidth =
                    typeof attrs.width === "string" ? attrs.width : ""
                const tableAligned =
                    typeof attrs.aligned === "string" ? attrs.aligned : ""
                const tableLayout =
                    typeof attrs.layout === "string" ? attrs.layout : ""
                const tableCategory =
                    typeof attrs.category === "string" ? attrs.category : "none"
                start += `<table
                id="${this.idPrefix}${tableId}"
                class="table-${tableWidth}
                table-${tableAligned}
                table-${tableLayout}"
                data-width="${tableWidth}"
                data-aligned="${tableAligned}"
                data-layout="${tableLayout}"
                data-category="${tableCategory}"
            >`
                end = "</table>" + end
                if (tableCategory !== "none") {
                    if (!this.categoryCounter[tableCategory]) {
                        this.categoryCounter[tableCategory] = 0
                    }
                    const catCount = ++this.categoryCounter[tableCategory]
                    const catLabel = `${getCat(tableCategory, this.docSettings.language || "en-US")} ${catCount}`
                    start += `<label>${escapeText(catLabel)}</label>`
                }
                const tableContent = node.content || []
                const caption =
                    attrs.caption && tableContent.length
                        ? tableContent[0].content || []
                        : []
                if (caption.length) {
                    start += `<caption><p>${caption.map((child: FidusNode) => this.walkJson(child)).join("")}</p></caption>`
                }
                start += "<tbody>"
                end = "</tbody>" + end
                break
            }
            case "table_body":
                // Pass through to table.
                break
            case "table_caption":
                // We already deal with this in 'table'.
                return ""
            case "table_row":
                start += "<tr>"
                end = "</tr>" + end
                break
            case "table_cell": {
                const colspan =
                    typeof attrs.colspan === "number" ? attrs.colspan : 1
                const rowspan =
                    typeof attrs.rowspan === "number" ? attrs.rowspan : 1
                start += `<td${colspan === 1 ? "" : ` colspan="${colspan}"`}${rowspan === 1 ? "" : ` rowspan="${rowspan}"`}>`
                end = "</td>" + end
                break
            }
            case "table_header": {
                const colspan =
                    typeof attrs.colspan === "number" ? attrs.colspan : 1
                const rowspan =
                    typeof attrs.rowspan === "number" ? attrs.rowspan : 1
                start += `<th${colspan === 1 ? "" : ` colspan="${colspan}"`}${rowspan === 1 ? "" : ` rowspan="${rowspan}"`}>`
                end = "</th>" + end
                break
            }
            case "equation": {
                const equation =
                    typeof attrs.equation === "string" ? attrs.equation : ""
                if (this.mathOutput === "svg") {
                    const svgMath = latexToSvg(equation, false)
                    if (svgMath) {
                        start += `<span class="equation" data-equation="${escapeText(equation)}" style="vertical-align:${svgMath.verticalAlignEm}em">`
                        end = "</span>" + end
                        content = `<img class="equation-svg" src="${svgMath.src}" alt="${escapeText(equation)}" style="width:${svgMath.widthEm}em;height:${svgMath.heightEm}em">`
                    } else {
                        start += '<span class="equation"><math>'
                        end = "</math></span>" + end
                        content = convertLatexToMathMl(equation)
                    }
                } else {
                    start += '<span class="equation"><math>'
                    end = "</math></span>" + end
                    content = convertLatexToMathMl(equation)
                }
                break
            }
            case "hard_break":
                content += `<br${this.endSlash}>`
                break
            default:
                break
        }

        if (!content.length && node.content) {
            node.content.forEach((child: FidusNode) => {
                content += this.walkJson(child, options)
            })
        }

        return start + content + end
    }

    assembleBody(): string {
        return `<div id="${this.idPrefix}body">${this.walkJson(this.docContent)}</div>`
    }

    assembleBack(): string {
        let back = ""
        if (
            this.footnotes.length ||
            this.citations.bibHTML.length ||
            Object.keys(this.affiliations).length
        ) {
            back += `<div id="${this.idPrefix}back">`
            if (Object.keys(this.affiliations).length) {
                back += `<section id="${this.idPrefix}affiliations" class="affiliations">${Object.entries(
                    this.affiliations
                )
                    .map(
                        ([name, id]) =>
                            `<aside class="affiliation" id="aff-${id}"${this.epub ? 'epub:type="footnote"' : ""}><label>${displayNumber(id, this.affiliationNumbering)}</label> <div>${escapeText(name)}</div></aside>`
                    )
                    .join("")}</section>`
            }
            if (this.footnotes.length) {
                back += `<section class="fnlist footnotes" role="doc-footnotes" id="${this.idPrefix}footnotes">${this.footnotes.join("")}</section>`
            }
            if (this.citations.bibHTML.length) {
                back += `<div id="${this.idPrefix}references" class="references">${this.citations.bibHTML}</div>`
            }
            back += "</div>"
        }
        return back
    }
}
