import {MathMLToLaTeX} from "mathml-to-latex"
import type {XMLElement} from "../../exporter/tools/xml.js"
import {
    randomFigureId,
    randomHeadingId,
    randomTableId
} from "../../schema/common/index.js"
import {inlineToPlainText} from "../helpers.js"
import {
    isDocxBibliographyField,
    isDocxCitationField,
    isDocxSdtBibliography,
    isDocxSdtCitation,
    parseDocxFieldCitation,
    parseDocxSdtCitation
} from "./citations.js"
import {normalizeText} from "./helpers.js"
import {omml2mathml} from "./omml2mathml.js"
import {DocxParser} from "./parse.js"
import type {RunProperties} from "./parse.js"
import {gettext} from "fwtoolkit"
import type JSZip from "jszip"
import type {
    CommentData,
    FidusMark,
    FidusDoc,
    FidusNode,
    ImageDBEntry,
    Track
} from "../../types.js"

/** Text extracted from a document section for metadata or body. */
interface ExtractedContent {
    content: FidusNode[]
    containerNodes: XMLElement[]
    header?: XMLElement
}

/** A metadata section grouped by semantic type. */
interface MetadataItem {
    type: string
    content: ExtractedContent
}

/** A document section (heading + its body content). */
interface DocxSection {
    title: string | null
    content: FidusNode[]
}

/** An in-progress DOCX field (FLDCHAR state machine). */
interface FieldState {
    status: "instruction" | "display"
    display: FidusNode[]
    instructions: string
    data: string | null
}

/** Paragraph style information returned by getParaStyle(). */
interface ParaStyle {
    id?: string
    name?: string
    isHeading?: boolean
    isCaption?: boolean
    level?: number
    numbering: {
        id: string
        level: number
        definition?: {
            abstractId: string
            levels: Array<{level: string; format: string; text: string; start: number}>
            overrides: Array<{level: string; start: number}>
        }
    } | null
}

/** A partially assembled document during conversion (before cast to FidusDoc). */
interface InProgressDoc {
    type: string
    attrs: {
        import_id: string
        title?: string
    }
    content: FidusNode[]
}

function attr(node: unknown, name: string): string {
    if (node && typeof node === "object" && "getAttribute" in node) {
        return String((node as XMLElement).getAttribute(name) || "")
    }
    return ""
}

export class DocxConvert {
    zip: JSZip
    importId: string
    template: {content: FidusDoc}
    bibliography: Record<string, unknown>
    images: Record<number, ImageDBEntry>
    parser: DocxParser
    tracks: Record<string, Track>
    currentTracks: Track[]
    currentFields: FieldState[]
    currentCommentIds: string[]
    sourcesXml: string | null
    referenceTargets: Record<string, {id: string; type: string; text?: string}>

    constructor(
        zip: JSZip,
        importId: string,
        template: {content: FidusDoc},
        bibliography: Record<string, unknown>
    ) {
        this.zip = zip
        this.importId = importId
        this.template = template
        this.bibliography = bibliography
        this.images = {}
        this.parser = new DocxParser(zip)
        this.tracks = {}
        this.currentTracks = []
        this.currentFields = []
        this.currentCommentIds = []
        this.sourcesXml = null
        this.referenceTargets = {}
    }

    async init(): Promise<{
        content: FidusDoc
        settings: Record<string, unknown>
        comments: Record<string, CommentData>
    }> {
        await this.parser.init()
        // Load Word-native bibliography sources if present.
        // This file is required by DocxCitationsParser for CITATION field codes.
        this.sourcesXml =
            (await this.zip.file("customXml/item1.xml")?.async("string")) ??
            null
        const body = this.parser.document!.query("w:body")
        if (!body) {
            return {
                content: {
                    type: "doc",
                    content: []
                },
                settings: {
                    import_id: this.importId,
                    tracked: false,
                    language: "en-US"
                },
                comments: {}
            }
        }
        // Find all reference targets in the document for cross-references
        this.referenceTargets = this.findReferenceTargets(this.parser.document!)

        const convertedContent = this.convertDocument(body)
        // Convert document
        return {
            content: convertedContent,
            settings: {
                import_id: this.importId,
                tracked: this.hasTrackedChanges(this.parser.document!),
                language: this.detectLanguage(this.parser.document!)
            },
            comments: this.parser.comments
        }
    }

    convertDocument(body: XMLElement): FidusDoc {
        const templateParts = this.template.content.content.slice()
        templateParts.shift() // Remove first element

        const document: InProgressDoc = {
            type: "doc",
            attrs: {
                import_id: this.importId
            },
            content: []
        }
        // Add title (required first element)
        const title = this.extractTitle(body)
        document.content.push({
            type: "title",
            content: title.content || [
                {type: "text", text: gettext("Untitled")}
            ]
        })
        title.containerNodes.forEach((node: XMLElement) => {
            node.parentElement?.removeChild(node)
        })
        document.attrs.title =
            title.content.map((node: FidusNode) => node.text || "").join("") ||
            gettext("Untitled")
        // Extract metadata sections
        const metadata = this.extractMetadata(body)
        metadata.forEach(({type, content}: MetadataItem) => {
            const templatePart = templateParts.find(
                (part: FidusNode) => part.attrs?.metadata === type
            )
            const attrs: Record<string, unknown> = {}
            if (templatePart) {
                if (templatePart.attrs?.hidden) {
                    attrs.hidden = false
                }
                document.content.push({
                    type: templatePart.type,
                    attrs: {
                        ...templatePart.attrs,
                        ...attrs
                    },
                    content: content.content
                })
                // Remove paragraphs from content so they are not added to body
                content.containerNodes.forEach((node: XMLElement) => {
                    node.parentElement?.removeChild(node)
                })
            }
        })
        // Extract main content sections
        const sections = this.groupContentIntoSections(body)
        // Map sections to template parts
        sections.forEach((section: DocxSection) => {
            const templatePart = this.findMatchingTemplatePart(
                section.title,
                templateParts
            )
            if (templatePart) {
                document.content.push({
                    type: "richtext_part",
                    attrs: {
                        title: templatePart.attrs?.title,
                        id: templatePart.attrs?.id,
                        metadata: templatePart.attrs?.metadata || undefined,
                        marks: templatePart.attrs?.marks || [
                            "strong",
                            "em",
                            "link"
                        ]
                    },
                    content: section.content
                })
            }
        })

        // Add remaining content to body section
        const unassignedContent = sections
            .filter(
                (section: DocxSection) =>
                    !this.findMatchingTemplatePart(section.title, templateParts)
            )
            .flatMap((section: DocxSection) => section.content)

        if (unassignedContent.length) {
            const bodyTemplatePart = templateParts.find(
                (part: FidusNode) => !part.attrs?.metadata && part.type === "richtext_part"
            )

            document.content.push({
                type: "richtext_part",
                attrs: {
                    title: bodyTemplatePart?.attrs?.title || "Body",
                    id: bodyTemplatePart?.attrs?.id || "body",
                    marks: ["strong", "em", "link"]
                },
                content: unassignedContent
            })
        }

        return document as FidusDoc
    }

    extractMetadata(body: XMLElement) {
        const metadata: MetadataItem[] = []

        // Try structured contributor data from custom properties first
        const contributorsByRole = this.extractContributorsFromCustomProps()
        if (Object.keys(contributorsByRole).length) {
            Object.entries(contributorsByRole).forEach(
                ([role, contributors]: [string, FidusNode[]]) => {
                    metadata.push({
                        type: role,
                        content: {content: contributors, containerNodes: []}
                    })
                }
            )
        } else {
            // Fall back to legacy author extraction
            const authors = this.extractAuthors(body)
            if (authors.content.length) {
                metadata.push({
                    type: "authors",
                    content: authors
                })
            }
        }

        // Extract abstract if present
        const abstract = this.extractAbstract(body)
        if (abstract.content.length) {
            metadata.push({
                type: "abstract",
                content: abstract
            })
        }

        // Extract keywords if present
        const keywords = this.extractKeywords(body)
        if (keywords.content.length) {
            metadata.push({
                type: "keywords",
                content: keywords
            })
        }
        return metadata
    }

    extractContributorsFromCustomProps() {
        if (!this.parser.customDoc) {
            return {}
        }

        const properties = this.parser.customDoc.queryAll("property")
        const contributors: FidusNode[] = []

        properties.forEach((prop: XMLElement) => {
            const name = attr(prop, "name")
            if (!name || !name.startsWith("fidus_contributor_")) {
                return
            }
            const match = name.match(/^fidus_contributor_(\d+)_(\w+)$/)
            if (!match) {
                return
            }
            const num = parseInt(match[1])
            const field = match[2]
            const lpwstr = prop.query("vt:lpwstr")
            const value = lpwstr ? lpwstr.textContent : ""

            if (!contributors[num - 1]) {
                contributors[num - 1] = {
                    type: "contributor",
                    attrs: {
                        firstname: "",
                        lastname: "",
                        email: "",
                        institution: "",
                        id_type: "",
                        id_value: "",
                        role: ""
                    }
                }
            }
            const contributor = contributors[num - 1]!
            const contributorAttrs = contributor.attrs!
            if (field === "role") {
                contributorAttrs.role = value
            } else if (
                [
                    "firstname",
                    "lastname",
                    "email",
                    "institution",
                    "id_type",
                    "id_value"
                ].includes(field)
            ) {
                contributorAttrs[field] = value
            }
        })

        const byRole: Record<string, FidusNode[]> = {}
        contributors.forEach((contributor: FidusNode) => {
            if (!contributor) {
                return
            }
            const role = String(contributor.attrs?.role || "authors")
            if (!byRole[role]) {
                byRole[role] = []
            }
            byRole[role].push(contributor)
        })

        return byRole
    }

    extractAuthors(body: XMLElement) {
        const authors: FidusNode[] = []

        // Try to find author information in metadata
        const authorNodes = body
            .queryAll("w:pStyle", {"w:val": "Author"})
            .map((pStyle: XMLElement) => pStyle.closest("w:p"))
            .filter((p: XMLElement | null): p is XMLElement => p !== null)
        authorNodes.forEach((authorNode: XMLElement) => {
            const authorText = this.getTextContent(authorNode)
            const [firstname = "", lastname = ""] = authorText.split(" ", 2)
            authors.push({
                type: "contributor",
                attrs: {
                    firstname,
                    lastname,
                    email: "",
                    institution: ""
                }
            })
        })
        if (authors.length) {
            return {
                content: authors,
                containerNodes: authorNodes
            }
        }
        // Also check Creator in document properties
        const creator = this.parser.coreDoc?.query("dc:creator")?.textContent

        if (creator) {
            const [firstname = "", lastname = ""] = creator.split(" ", 2)

            return {
                content: [
                    {
                        type: "contributor",
                        attrs: {
                            firstname,
                            lastname,
                            email: "",
                            institution: ""
                        }
                    }
                ],
                containerNodes: []
            }
        }
        return {content: [], containerNodes: []}
    }

    extractAbstract(body: XMLElement) {
        // Look for section with Abstract style or heading
        const abstractNodes = body
            .queryAll("w:pStyle", {"w:val": "Abstract"})
            .map((pStyle: XMLElement) => pStyle.closest("w:p"))
            .filter((p: XMLElement | null): p is XMLElement => p !== null)
        if (abstractNodes.length) {
            return {
                content: abstractNodes
                    .map((abstractNode: XMLElement) =>
                        this.convertBlock(abstractNode)
                    )
                    .filter((b): b is FidusNode => b !== null),
                containerNodes: abstractNodes
            }
        }
        const extractedPart = this.extractPartOnTitle(body, ["Abstract"])
        if (extractedPart.content.length) {
            return {
                content: extractedPart.content
                    .map((abstractNode: XMLElement) =>
                        this.convertBlock(abstractNode)
                    )
                    .filter((b): b is FidusNode => b !== null),
                containerNodes: extractedPart.content.concat(
                    extractedPart.header ? [extractedPart.header] : []
                )
            }
        }
        return {content: [], containerNodes: []}
    }

    extractKeywords(body: XMLElement) {
        let extraNodes: XMLElement[] = []
        // Look for keywords section or metadata
        let keywordNodes = body
            .queryAll("w:pStyle", {"w:val": "Keywords"})
            .map((pStyle: XMLElement) => pStyle.closest("w:p"))
            .filter((p: XMLElement | null): p is XMLElement => p !== null)

        if (!keywordNodes.length) {
            // If no keywords section is found, look for a title called "Keywords"
            const extractedPart = this.extractPartOnTitle(
                body,
                ["Keywords", "Keywords:", "Keyword"],
                1
            )

            if (extractedPart.content.length) {
                keywordNodes = extractedPart.content
                extraNodes = extractedPart.header ? [extractedPart.header] : []
            }
        }

        if (keywordNodes) {
            return {
                content: keywordNodes
                    .map((keywordsNode: XMLElement) => this.getTextContent(keywordsNode))
                    .flatMap((str: string) => str.split(/[,;|:]+/)) // Split on multiple separators
                    .map((keyword: string) => keyword.trim()) // Trim whitespace
                    .filter((keyword: string) => keyword.length > 0)
                    .map((keyword: string) => ({
                        type: "tag",
                        attrs: {
                            tag: keyword
                        }
                    })),
                containerNodes: keywordNodes.concat(extraNodes)
            }
        }

        return {content: [], containerNodes: []}
    }

    extractPartOnTitle(
        body: XMLElement,
        titleWords: string[],
        maxPars: number | false = false
    ): {header: XMLElement | undefined; content: XMLElement[]} {
        // Fall back to heading starting with TITLEWORD in text
        if (typeof titleWords === "string") {
            titleWords = [titleWords]
        }
        const headingPars = body
            .queryAll("w:pStyle", {
                "w:val": [
                    "Heading1",
                    "Heading2",
                    "Heading3",
                    "Heading4",
                    "Heading5",
                    "Heading6",
                    "Heading7",
                    "Heading8",
                    "Heading9"
                ]
            })
            .map((pStyle: XMLElement) => pStyle.closest("w:p"))
            .filter((p: XMLElement | null): p is XMLElement => p !== null)
        const header = headingPars.find((p: XMLElement) =>
            titleWords.includes(this.getTextContent(p).trim())
        )
        const content: XMLElement[] = []
        if (header && header.nextSibling) {
            //const content = []
            //const containerNodes = [sectionHeader]
            const headerLevel = this.getParaStyle(header).level
            let searchPar = header

            // Add everything to abstract until next heading with the same or lower level
            while (
                searchPar.nextSibling &&
                (!maxPars || content.length < maxPars)
            ) {
                searchPar = searchPar.nextSibling
                const paraStyle = this.getParaStyle(searchPar)
                if (paraStyle.isHeading && (paraStyle.level ?? 0) <= (headerLevel ?? 0)) {
                    break
                }
                content.push(searchPar)
            }
        }

        return {header, content}
    }

    groupContentIntoSections(body: XMLElement) {
        const sections: DocxSection[] = []
        let currentSection: {title: string | null; content: FidusNode[]} = {
            title: null,
            content: []
        }

        const skippedBlocks: XMLElement[] = []

        const collect = (node: XMLElement) => {
            if (skippedBlocks.includes(node)) {
                return
            }
            if (node.tagName === "w:tbl") {
                const table = this.convertTable(node)
                if (table) {
                    currentSection.content.push(table)
                }
                return
            }
            if (node.tagName === "w:sdt") {
                // Block-level content control (bibliography/citation controls
                // are handled elsewhere): process the wrapped blocks.
                if (isDocxSdtBibliography(node) || isDocxSdtCitation(node)) {
                    return
                }
                const sdtContent = node.query("w:sdtContent")
                sdtContent?.children
                    .filter(
                        (child): child is XMLElement =>
                            typeof child !== "string"
                    )
                    .forEach(collect)
                return
            }
            if (node.tagName !== "w:p") {
                return
            }

            const style = this.getParaStyle(node)
            const title = this.getSectionTitle(node, style)
            if (title && style.isHeading) {
                if (currentSection.content.length) {
                    sections.push(currentSection)
                }
                currentSection = {
                    title,
                    content: []
                }
            }

            const block = this.convertBlock(node, skippedBlocks)
            if (block) {
                currentSection.content.push(block)
            }
        }

        body.children
            .filter((node): node is XMLElement => typeof node !== "string")
            .forEach(collect)

        if (currentSection.content.length) {
            sections.push(currentSection)
        }

        return sections
    }

    getSectionTitle(node: XMLElement, style: ParaStyle) {
        if (!node || !style) {
            return null
        }

        // For headings, use text content as section title
        if (style.isHeading && (style.level ?? 0) <= 4) {
            return this.getTextContent(node)
        }

        // Check style name for section indicators
        if (style.name) {
            const name = style.name.toLowerCase()
            if (name.includes("section") || name.includes("title")) {
                return this.getTextContent(node)
            }
        }

        return null
    }

    findMatchingTemplatePart(sectionTitle: string | null, templateParts: FidusNode[]) {
        if (!sectionTitle) {
            return null
        }

        // Try exact match first
        let matchingPart = templateParts.find(
            (part: FidusNode) =>
                part.type === "richtext_part" &&
                !part.attrs?.metadata &&
                String(part.attrs?.title ?? "").toLowerCase() === sectionTitle.toLowerCase()
        )

        if (!matchingPart) {
            // Try fuzzy matching
            matchingPart = templateParts.find(
                (part: FidusNode) =>
                    part.type === "richtext_part" &&
                    !part.attrs?.metadata &&
                    this.isSimilarTitle(String(part.attrs?.title ?? ""), sectionTitle)
            )
        }

        return matchingPart
    }

    isSimilarTitle(title1: string, title2: string) {
        const normalized1 = normalizeText(title1)
        const normalized2 = normalizeText(title2)

        return (
            normalized1.includes(normalized2) ||
            normalized2.includes(normalized1)
        )
    }

    getTextContent(node: XMLElement) {
        return node
            .queryAll("w:t")
            .map((t: XMLElement) => t.textContent)
            .join("")
    }

    extractTitle(body: XMLElement) {
        // First try to find paragraph with Title style
        const titlePars = body
            .queryAll("w:pStyle", {"w:val": "Title"})
            .map((pStyle: XMLElement) => pStyle.closest("w:p"))
            .filter((p: XMLElement | null): p is XMLElement => p !== null)

        if (titlePars.length) {
            return {
                // The schema title node may only contain text, so any
                // fields/breaks/etc. in the title paragraph are flattened.
                content: inlineToPlainText(
                    this.convertInline(titlePars[0])
                ),
                containerNodes: [titlePars[0]]
            }
        }

        // Fall back to first heading
        const headingPars = body
            .queryAll("w:pStyle", {
                "w:val": [
                    "Heading1",
                    "Heading2",
                    "Heading3",
                    "Heading4",
                    "Heading5",
                    "Heading6",
                    "Heading7",
                    "Heading8",
                    "Heading9"
                ]
            })
            .map((pStyle: XMLElement) => pStyle.closest("w:p"))
            .filter((p: XMLElement | null): p is XMLElement => p !== null)
        if (headingPars.length) {
            return {
                content: inlineToPlainText(
                    this.convertInline(headingPars[0])
                ),
                containerNodes: [headingPars[0]]
            }
        }

        return {
            content: [
                {
                    type: "text",
                    text: gettext("Untitled")
                }
            ],
            containerNodes: []
        }
    }

    inBibliography(node: XMLElement) {
        // Check if we currently are in a field.
        const currentField = this.currentFields[this.currentFields.length - 1]

        if (
            currentField &&
            isDocxBibliographyField(currentField.instructions)
        ) {
            return true
        }
        // Check every SDT block inside this paragraph.
        for (const sdt of node.queryAll("w:sdt")) {
            if (isDocxSdtBibliography(sdt)) {
                return true
            }
        }

        return false
    }

    convertBlock(node: XMLElement, skippedBlocks: XMLElement[] = []): FidusNode | null {
        if (node.tagName !== "w:p") {
            return null
        }
        const inBibliography = this.inBibliography(node)
        let converted: FidusNode | null
        const style = this.getParaStyle(node)
        if (style.isHeading) {
            converted = this.convertHeading(node, style)
        } else if (style.numbering) {
            converted = this.convertListItem(node, style)
        } else if (
            style.isCaption &&
            (node.query("w:drawing") || node.query("w:pict"))
        ) {
            converted = this.convertFigure(node, node)
        } else if (
            style.isCaption &&
            (node.nextSibling?.query("w:drawing") ||
                node.nextSibling?.query("w:pict")) &&
            !skippedBlocks.includes(node.nextSibling)
        ) {
            skippedBlocks.push(node.nextSibling)
            converted = this.convertFigure(node.nextSibling, node)
        } else if (node.query("w:drawing") || node.query("w:pict")) {
            if (
                node.nextSibling &&
                this.getParaStyle(node.nextSibling).isCaption
            ) {
                skippedBlocks.push(node.nextSibling)
                converted = this.convertFigure(node, node.nextSibling)
            } else {
                converted = this.convertFigure(node)
            }
        } else {
            converted = this.convertParagraph(node)
        }
        if (inBibliography || this.inBibliography(node)) {
            // We skip bibliography paragraphs
            return null
        }
        return this.wrapTrackChanges(node, converted)
    }

    wrapTrackChanges(node: XMLElement, content: FidusNode | null): FidusNode | null {
        if (!content || !node.previousSibling) {
            return content
        }
        const track = this.getTracksFromNode(node.previousSibling)
        if (!track) {
            return content
        }

        return {
            ...content,
            attrs: Object.assign({}, content.attrs || {}, {track})
        }
    }

    getTracksFromNode(node: XMLElement) {
        const deletion = node.query("w:pPr")?.query("w:del")
        const insertion = node.query("w:pPr")?.query("w:ins")

        const tracks: Track[] = []

        if (insertion) {
            const date = new Date(attr(insertion, "w:date"))
            const date10 = Math.floor(date.getTime() / 60000) * 10
            tracks.push({
                type: "insertion",
                user: 0, // Default user ID
                username: attr(insertion, "w:author"),
                date: date10
            })
        }

        if (deletion) {
            const date = new Date(attr(deletion, "w:date"))
            const date10 = Math.floor(date.getTime() / 60000) * 10
            tracks.push({
                type: "deletion",
                user: 0, // Default user ID
                username: attr(deletion, "w:author"),
                date: date10
            })
        }

        if (tracks.length === 0) {
            return null
        }

        return tracks
    }

    getParaStyle(node: XMLElement): ParaStyle {
        const pStyle = node.query("w:pStyle")
        const styleId = attr(pStyle, "w:val")
        const style = this.parser.styles[styleId] || {}

        const numPr = node.query("w:numPr")
        const numId = attr(numPr?.query("w:numId"), "w:val")
        const ilvl = parseInt(
            attr(numPr?.query("w:ilvl"), "w:val") || "0"
        )

        return {
            ...style,
            numbering: numId
                ? {
                      id: numId,
                      level: ilvl,
                      definition: this.parser.numbering[numId]
                  }
                : null
        }
    }

    convertParagraph(node: XMLElement) {
        const pStyle = node.query("w:pStyle")
        const styleId = attr(pStyle, "w:val")

        // Check if this is a code block (Code style or inherited from one)
        if (
            styleId &&
            (this.parser.isCodeStyle?.(styleId) || styleId === "Code")
        ) {
            return {
                type: "code_block",
                attrs: {
                    track: [],
                    language: "",
                    category: "",
                    title: "",
                    id: ""
                },
                content: this.convertInline(node)
            }
        }

        return {
            type: "paragraph",
            content: this.convertInline(node)
        }
    }

    convertHeading(node: XMLElement, style: ParaStyle) {
        return {
            type: `heading${style.level}`,
            attrs: {
                id: randomHeadingId(),
                level: style.level
            },
            content: this.convertInline(node)
        }
    }

    convertListItem(node: XMLElement, style: ParaStyle) {
        const numbering = style.numbering
        if (!numbering) {
            return this.convertParagraph(node)
        }
        const level = numbering.definition?.levels[numbering.level]

        return {
            type: level?.format === "bullet" ? "bullet_list" : "ordered_list",
            attrs: {
                id: `L${Math.random().toString(36).slice(2)}`,
                level: numbering.level,
                start: level?.start || 1
            },
            content: [
                {
                    type: "list_item",
                    content: [this.convertParagraph(node)]
                }
            ]
        }
    }

    convertFigure(node: XMLElement, captionNode: XMLElement | null = null) {
        let captionBlock, captionOrder
        if (captionNode) {
            captionBlock = this.convertParagraph(captionNode)
            captionOrder = node.nextSibling === captionNode ? "after" : "before"
        }

        const drawing = node.query("w:drawing")
        if (!drawing) {
            return null
        }

        const blip = drawing.query("a:blip")
        if (!blip) {
            return null
        }

        const rId = attr(blip, "r:embed")
        const rel = this.parser.relationships[rId]
        if (!rel) {
            return null
        }

        const imagePath = rel.target.split("/").pop() || rel.target
        const imageBlob = this.parser.images[imagePath]

        if (!imageBlob) {
            return null
        }

        // <a:ext cx="5753598" cy="4463556" />
        //
        const size = drawing.query("a:ext")
        const width = parseInt(attr(size, "cx") || "0") / 9525 // In EMUs
        const height = parseInt(attr(size, "cy") || "0") / 9525 // In EMUs

        const imageId = Math.floor(Math.random() * 1000000)
        this.images[imageId] = {
            id: imageId,
            title: imagePath,
            image: imagePath,
            file: imageBlob,

            copyright: {
                holder: false,
                year: false,
                freeToRead: true,
                licenses: []
            },
            checksum: 0,
            width,
            height
        }

        const image: FidusNode = {
            type: "image",
            attrs: {
                image: imageId
            }
        }

        const caption: FidusNode = {
            type: "figure_caption",
            content: captionBlock?.content || []
        }

        const content =
            captionOrder === "before" ? [caption, image] : [image, caption]

        return {
            type: "figure",
            attrs: {
                id: randomFigureId(),
                aligned: "center",
                width: 100,
                caption: !!captionBlock
            },
            content
        }
    }

    convertTable(node: XMLElement): FidusNode | null {
        const tblPr = node.query("w:tblPr")
        const tblW = tblPr?.query("w:tblW")
        let width = "100"
        if (attr(tblW, "w:type") === "pct") {
            const pct = parseInt(attr(tblW, "w:w"))
            if (pct > 0) {
                // PCT widths are fiftieths of a percent (5000 = 100%)
                width = String(Math.min(100, Math.round(pct / 50)))
            }
        }
        const aligned = attr(tblPr?.query("w:jc"), "w:val") || "center"

        const rows: FidusNode[] = []
        // Cells currently being extended downward by a vertical merge
        // (w:vMerge), keyed by grid column index.
        const vMergeOrigins = new Map<number, FidusNode>()
        node.children
            .filter(
                (child): child is XMLElement =>
                    typeof child !== "string" && child.tagName === "w:tr"
            )
            .forEach((row: XMLElement) => {
                const tableRow = this.convertTableRow(row, vMergeOrigins)
                if (tableRow) {
                    rows.push(tableRow)
                }
            })

        if (!rows.length) {
            return null
        }

        return {
            type: "table",
            attrs: {
                id: randomTableId(),
                track: [],
                width,
                aligned,
                layout: "fixed",
                category: "none",
                caption: false
            },
            content: [
                {type: "table_caption"},
                {
                    type: "table_body",
                    content: rows
                }
            ]
        }
    }

    convertTableRow(
        row: XMLElement,
        vMergeOrigins: Map<number, FidusNode>
    ): FidusNode | null {
        const isHeader = Boolean(row.query("w:trPr")?.query("w:tblHeader"))
        const cells: FidusNode[] = []
        let column = 0
        row.children
            .filter(
                (child): child is XMLElement =>
                    typeof child !== "string" && child.tagName === "w:tc"
            )
            .forEach((tc: XMLElement) => {
                const tcPr = tc.query("w:tcPr")
                const gridSpan =
                    parseInt(attr(tcPr?.query("w:gridSpan"), "w:val")) || 1

                const hMerge = tcPr?.query("w:hMerge")
                if (hMerge && attr(hMerge, "w:val") !== "restart") {
                    // Cell covered by a horizontal merge started in the
                    // previous cell.
                    const prev = cells[cells.length - 1]
                    if (prev?.attrs) {
                        prev.attrs.colspan = (prev.attrs.colspan as number) + 1
                    }
                    column += 1
                    return
                }

                const vMerge = tcPr?.query("w:vMerge")
                const vMergeVal = vMerge
                    ? attr(vMerge, "w:val") || "continue"
                    : ""
                if (vMergeVal === "continue") {
                    // Cell covered by a vertical merge started further up.
                    const origin = vMergeOrigins.get(column)
                    if (origin?.attrs) {
                        origin.attrs.rowspan = (origin.attrs.rowspan as number) + 1
                    }
                    column += gridSpan
                    return
                }

                const cell: FidusNode = {
                    type: isHeader ? "table_header" : "table_cell",
                    attrs: {
                        colspan: gridSpan,
                        rowspan: 1
                    },
                    content: this.convertTableCellContent(tc)
                }
                if (vMergeVal === "restart") {
                    for (let i = 0; i < gridSpan; i++) {
                        vMergeOrigins.set(column + i, cell)
                    }
                } else {
                    for (let i = 0; i < gridSpan; i++) {
                        vMergeOrigins.delete(column + i)
                    }
                }
                cells.push(cell)
                column += gridSpan
            })
        if (!cells.length) {
            return null
        }
        return {type: "table_row", content: cells}
    }

    convertTableCellContent(tc: XMLElement): FidusNode[] {
        const content: FidusNode[] = []
        const collect = (child: XMLElement) => {
            if (child.tagName === "w:p") {
                const block = this.convertBlock(child, [])
                if (block) {
                    content.push(block)
                }
            } else if (child.tagName === "w:tbl") {
                const table = this.convertTable(child)
                if (table) {
                    content.push(table)
                }
            } else if (child.tagName === "w:sdt") {
                const sdtContent = child.query("w:sdtContent")
                sdtContent?.children
                    .filter(
                        (sub): sub is XMLElement => typeof sub !== "string"
                    )
                    .forEach(collect)
            }
        }
        tc.children
            .filter((child): child is XMLElement => typeof child !== "string")
            .forEach(collect)
        if (!content.length) {
            content.push({type: "paragraph"})
        }
        return content
    }

    convertInline(node: XMLElement, enclosingTrack: FidusMark | null = null) {
        const content: FidusNode[] = []

        // We'll process all inline nodes in document order
        node.children
            .filter((child): child is XMLElement => typeof child !== "string")
            .forEach((child: XMLElement) => {
            let contentReceiver = content
            const currentField =
                this.currentFields[this.currentFields.length - 1]
            if (currentField) {
                if (currentField.status === "instruction") {
                    // We're currently inside the instruction part of a fieldChar
                    const instrText = child.query("w:instrText")
                    if (instrText) {
                        currentField.instructions += instrText.textContent
                    }
                }
                if (currentField.status === "display") {
                    // We're currently inside the display part of a fieldChar
                    contentReceiver = currentField.display
                }
            }
            if (child.tagName === "#text") {
                // Whitespace/text outside of runs carries no meaning in
                // WordprocessingML (only w:t inside w:r does).
                return
            }
            if (child.tagName === "w:r") {
                // A run
                const fieldChar = child.query("w:fldChar")
                if (fieldChar) {
                    let currentField: FieldState | undefined
                    let rendercurrentField = false
                    const type = attr(fieldChar, "w:fldCharType")
                    if (type === "begin") {
                        currentField = {
                            status: "instruction",
                            display: [] as FidusNode[],
                            instructions: "",
                            data: null
                        }
                        this.currentFields.push(currentField)
                    } else if (type === "separate") {
                        currentField =
                            this.currentFields[this.currentFields.length - 1]
                        currentField.status = "display"
                        contentReceiver = currentField.display
                    } else if (type === "end") {
                        currentField = this.currentFields.pop()
                        // If a fieldChar is closed and there was no display part,
                        // or it is inside another fieldChar, do nothing
                        if (
                            currentField &&
                            currentField.status === "display" &&
                            this.currentFields.length === 0
                        ) {
                            rendercurrentField = true
                            contentReceiver = content
                        }
                    }
                    // Capture base64-encoded field data (used by EndNote)
                    const fldDataNode = fieldChar.query("w:fldData")
                    if (fldDataNode && currentField) {
                        currentField.data = fldDataNode.textContent || null
                    }

                    if (rendercurrentField && currentField) {
                        this.renderField(currentField).forEach((node: FidusNode) =>
                            contentReceiver.push(node)
                        )
                    }
                    return
                }

                // Process footnote references
                const footnoteRef = child.query("w:footnoteReference")
                if (footnoteRef) {
                    const footnoteId = attr(footnoteRef, "w:id")
                    if (this.parser.footnotes[footnoteId]) {
                        contentReceiver.push(this.convertFootnote(footnoteId))
                    }
                    return
                }

                // Process endnote references
                const endnoteRef = child.query("w:endnoteReference")
                if (endnoteRef) {
                    const endnoteId = attr(endnoteRef, "w:id")
                    if (this.parser.endnotes[endnoteId]) {
                        contentReceiver.push(
                            this.convertFootnote(endnoteId, true)
                        )
                    }
                    return
                }

                // Process text with formatting
                const text =
                    child.query("w:t")?.textContent ||
                    child.query("w:delText")?.textContent
                if (!text) {
                    // Process line breaks
                    if (child.query("w:br")) {
                        contentReceiver.push({type: "hard_break"})
                    }
                    return
                }

                const rPr = child.query("w:rPr")
                const formatting = rPr
                    ? this.parser.extractRunProperties(rPr)
                    : {}
                const insertion = child.closest("w:ins")
                const deletion = child.closest("w:del")

                const marks = this.getCurrentMarks(
                    formatting,
                    insertion,
                    deletion
                )
                if (
                    enclosingTrack &&
                    !insertion &&
                    !deletion &&
                    !marks.some(mark =>
                        ["insertion", "deletion"].includes(mark.type)
                    )
                ) {
                    marks.push(enclosingTrack)
                }
                contentReceiver.push({
                    type: "text",
                    text,
                    marks
                })
            } else if (
                child.tagName === "w:ins" ||
                child.tagName === "w:del"
            ) {
                // Run-level tracked-change wrapper. The recursion picks up
                // the insertion/deletion via closest().
                this.convertInline(child).forEach((node: FidusNode) =>
                    contentReceiver.push(node)
                )
            } else if (
                child.tagName === "w:moveTo" ||
                child.tagName === "w:moveFrom"
            ) {
                // Tracked moves have no equivalent in our schema; import them
                // as insertion/deletion so the content is not lost.
                const trackMark = this.trackMarkFromElement(
                    child,
                    child.tagName === "w:moveTo" ? "insertion" : "deletion"
                )
                this.convertInline(child, trackMark).forEach(
                    (node: FidusNode) => contentReceiver.push(node)
                )
            } else if (child.tagName === "w:fldSimple") {
                // Simple field: instruction in the w:instr attribute, cached
                // display in the child runs.
                const display = this.convertInline(child)
                const rendered = this.renderField({
                    status: "display",
                    display,
                    instructions: attr(child, "w:instr"),
                    data: null
                })
                const result = rendered.length ? rendered : display
                result.forEach((node: FidusNode) => contentReceiver.push(node))
            } else if (
                child.tagName === "w:proofErr" ||
                child.tagName === "w:permStart" ||
                child.tagName === "w:permEnd" ||
                child.tagName === "w:bookmarkStart" ||
                child.tagName === "w:bookmarkEnd" ||
                child.tagName === "w:moveFromRangeStart" ||
                child.tagName === "w:moveFromRangeEnd" ||
                child.tagName === "w:moveToRangeStart" ||
                child.tagName === "w:moveToRangeEnd" ||
                child.tagName === "w:customXml" ||
                child.tagName === "w:sectPr"
            ) {
                // Markup/processing metadata without document content.
                return
            } else if (child.tagName === "w:commentRangeStart") {
                const commentId = attr(child, "w:id")
                if (commentId && this.parser.comments[commentId]) {
                    this.currentCommentIds.push(commentId)
                }
                return
            } else if (child.tagName === "w:commentRangeEnd") {
                const commentId = attr(child, "w:id")
                if (commentId) {
                    const index = this.currentCommentIds.indexOf(commentId)
                    if (index !== -1) {
                        this.currentCommentIds.splice(index, 1)
                    }
                }
                return
            } else if (
                child.tagName === "w:r" &&
                child.query("w:commentReference")
            ) {
                // Comment reference - just skip it (we already handle the range)
                return
            } else if (child.tagName === "w:hyperlink") {
                // Process hyperlink
                const rId = attr(child, "r:id")
                const anchor = attr(child, "w:anchor")
                const relationship = rId ? this.parser.relationships[rId] : null
                const href =
                    relationship?.target || (anchor ? `#${anchor}` : null)

                if (href) {
                    const runs = child.queryAll("w:r")
                    const text = runs
                        .map((run: XMLElement) => run.query("w:t")?.textContent || "")
                        .join("")

                    if (text) {
                        // Check if this is an internal link (bookmark reference) that should be a cross-reference
                        if (anchor && this.referenceTargets[anchor]) {
                            // If the link text is similar to the target text, treat it as a cross-reference
                            const target = this.referenceTargets[anchor]
                            const targetText = target.text || anchor

                            // Compare normalized versions to check if text matches target
                            if (
                                normalizeText(text) ===
                                    normalizeText(targetText) ||
                                // Also check for "Figure X: " or "Table X: " style references
                                text.match(
                                    /^(Figure|Table|Equation)\s+\d+(\.\d+)*(\:|\.)?\s*$/i
                                )
                            ) {
                                contentReceiver.push(
                                    this.convertCrossReference(anchor, text)
                                )
                                return
                            }
                        }

                        // Otherwise, treat as a normal link
                        const rPr = runs[0]?.query("w:rPr")
                        const formatting = rPr
                            ? this.parser.extractRunProperties(rPr)
                            : {}

                        const marks = this.getCurrentMarks(formatting)
                        marks.push({
                            type: "link",
                            attrs: {href, title: text}
                        })
                        contentReceiver.push({
                            type: "text",
                            text,
                            marks
                        })
                    }
                }
            } else if (child.tagName === "m:oMath") {
                const equationNode = this.convertEquation(child)
                if (equationNode) {
                    contentReceiver.push(equationNode)
                }
            } else if (child.tagName === "m:oMathPara") {
                // Display math paragraph: contains one or more m:oMath
                // elements plus property nodes we can skip.
                this.convertInline(child).forEach((node: FidusNode) =>
                    contentReceiver.push(node)
                )
            } else if (child.tagName === "m:oMathParaPr") {
                return
            } else if (child.tagName === "w:sdt") {
                if (isDocxSdtCitation(child)) {
                    // Used by Mendeley Cite & Citavi
                    const citationNode = parseDocxSdtCitation(
                        child,
                        this.bibliography
                    )
                    if (citationNode) {
                        contentReceiver.push(citationNode)
                    }
                }
            } else if (child.tagName === "w:pPr") {
                // Paragraph properties are block-level metadata; ignore when
                // extracting inline content.
                return
            } else {
                console.warn("unhandled node", child)
            }
        })

        return content
    }

    // Method to help process cross-references in documents
    findReferenceTargets(document: XMLElement) {
        const targets: Record<string, {id: string; type: string; text?: string}> = {}

        // Find bookmarks
        document.queryAll("w:bookmarkStart").forEach((bookmark: XMLElement) => {
            const id = attr(bookmark, "w:id")
            const name = attr(bookmark, "w:name")
            if (id && name) {
                targets[name] = {
                    id: name,
                    type: "bookmark"
                }
            }
        })

        // Find headings (with styles like Heading1, Heading2, etc.)
        document.queryAll("w:pStyle").forEach((pStyle: XMLElement) => {
            const val = attr(pStyle, "w:val")
            if (val && val.match(/^Heading\d+$/)) {
                const paragraph = pStyle.closest("w:p")
                if (paragraph) {
                    const text = this.getTextContent(paragraph)
                    // Create an ID from the heading text
                    const id = text
                        .trim()
                        .toLowerCase()
                        .replace(/[^\w\s-]/g, "")
                        .replace(/\s+/g, "-")

                    targets[id] = {
                        id: id,
                        type: "heading",
                        text: text
                    }
                }
            }
        })

        return targets
    }

    convertFootnote(id: string, isEndnote: boolean = false) {
        const footnoteContent = isEndnote
            ? this.parser.endnotes[id].content
            : this.parser.footnotes[id].content

        // Convert the footnote content to our document model
        const content: FidusNode[] = []
        footnoteContent.forEach((block: FidusNode) => {
            if (block.type === "paragraph") {
                content.push({
                    type: "paragraph",
                    content: (block.content || []).map((node: FidusNode) => {
                        if (node.type === "text") {
                            return {
                                type: "text",
                                text: node.text,
                                marks: node.marks || []
                            }
                        }
                        return node
                    })
                })
            }
        })

        return {
            type: "footnote",
            attrs: {
                footnote: content
            }
        }
    }

    convertEquation(oMathNode: XMLElement) {
        // Extract OMML content and convert to MathML
        const mmlNode = omml2mathml(oMathNode)
        const latex = MathMLToLaTeX.convert(mmlNode.outerXML)
        return {
            type: "equation",
            attrs: {
                equation: latex
            }
        }
    }

    simplifiedOmmlToLatex(omml: XMLElement) {
        // This is a very basic conversion - in a real implementation you would
        // use a library like MathML-to-LaTeX or implement a more complete converter

        const xml = omml.outerXML

        // Extract text content as a fallback
        const textContent = xml
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()

        // If the OMML contains a fraction
        if (xml.includes("<m:f>")) {
            const numMatch = xml.match(/<m:num>(.*?)<\/m:num>/s)
            const denMatch = xml.match(/<m:den>(.*?)<\/m:den>/s)

            if (numMatch && denMatch) {
                const num = numMatch[1].replace(/<[^>]+>/g, "").trim()
                const den = denMatch[1].replace(/<[^>]+>/g, "").trim()
                return `\\frac{${num}}{${den}}`
            }
        }

        // If it contains a superscript
        if (xml.includes("<m:sup>")) {
            const baseMatch = xml.match(/<m:e>(.*?)<\/m:e>/s)
            const supMatch = xml.match(/<m:sup>(.*?)<\/m:sup>/s)

            if (baseMatch && supMatch) {
                const base = baseMatch[1].replace(/<[^>]+>/g, "").trim()
                const sup = supMatch[1].replace(/<[^>]+>/g, "").trim()
                return `${base}^{${sup}}`
            }
        }

        // If it contains a subscript
        if (xml.includes("<m:sub>")) {
            const baseMatch = xml.match(/<m:e>(.*?)<\/m:e>/s)
            const subMatch = xml.match(/<m:sub>(.*?)<\/m:sub>/s)

            if (baseMatch && subMatch) {
                const base = baseMatch[1].replace(/<[^>]+>/g, "").trim()
                const sub = subMatch[1].replace(/<[^>]+>/g, "").trim()
                return `${base}_{${sub}}`
            }
        }

        // Return a simplified representation with the text content
        return textContent || "x^2" // Default fallback
    }

    renderField(field: FieldState): FidusNode[] {
        const instr = field.instructions.trim()

        // Handle REF fields (cross-references)
        if (instr.startsWith("REF ")) {
            // Extract the target bookmark/heading ID
            const parts = instr.substring(4).trim().split(/\s+/)
            if (parts.length > 0) {
                const target = parts[0]
                const text = field.display.reduce(
                    (accumulator: string, currentValue: FidusNode) => {
                        if (currentValue.type === "text") {
                            return accumulator + (currentValue.text || "")
                        }
                        return accumulator
                    },
                    ""
                )
                return [this.convertCrossReference(target, text)]
            }
            return field.display || []
        }
        // Handle SEQ fields (figure/table/equation number cross-references)
        else if (instr.startsWith("SEQ ")) {
            // This is a sequence field that generates numbers for figures/tables/equations.
            // For cross-references, we look for the text in the display part.
            const seqMatch = instr.match(/^SEQ\s+(\S+)/)
            if (seqMatch) {
                const _seqName = seqMatch[1]
                const text = field.display.reduce((acc: string, curr: FidusNode) => {
                    if (curr.type === "text") {
                        return acc + (curr.text || "")
                    }
                    return acc
                }, "")
                if (text) {
                    // Return as a plain text node since we can't resolve SEQ references easily
                    return [
                        {
                            type: "text",
                            text,
                            marks: []
                        }
                    ]
                }
                return []
            }
            return field.display || []
        }
        // Handle citation fields
        else if (isDocxCitationField(instr)) {
            const cite = parseDocxFieldCitation(
                instr,
                field.data,
                this.sourcesXml,
                this.bibliography
            )
            return cite ? [cite] : []
        } else if (isDocxBibliographyField(instr)) {
            // We don't render the contents of bibliography fields
            return []
        } else {
            // We do not support this field type, so instead we return the display content.
            return field.display || []
        }
    }

    convertCrossReference(targetId: string, displayText: string) {
        // Look up the target in our reference targets
        const target = this.referenceTargets[targetId]

        // If we found the target, use its information
        if (target) {
            return {
                type: "cross_reference",
                attrs: {
                    id: targetId,
                    title: displayText || target.text || targetId
                }
            }
        }

        // If target not found, create a reference with the display text or target ID
        return {
            type: "cross_reference",
            attrs: {
                id: targetId,
                title: displayText || targetId
            }
        }
    }

    trackMarkFromElement(
        element: XMLElement,
        type: "insertion" | "deletion"
    ): FidusMark {
        const date = new Date(attr(element, "w:date"))
        const date10 = Math.floor(date.getTime() / 600000) * 10
        const mark: FidusMark = {
            type,
            attrs: {
                user: 0,
                username: attr(element, "w:author"),
                date: date10
            }
        }
        if (type === "insertion") {
            ;(mark.attrs as Record<string, unknown>).approved = false
        }
        return mark
    }

    createMarksFromFormatting(formatting: RunProperties, insertion: XMLElement | null = null, deletion: XMLElement | null = null) {
        const marks: FidusMark[] = []
        if (formatting.bold) {
            marks.push({type: "strong"})
        }
        if (formatting.italic) {
            marks.push({type: "em"})
        }
        if (formatting.underline) {
            marks.push({type: "underline"})
        }
        // Handle superscript and subscript
        if (formatting.vertAlign === "superscript") {
            marks.push({type: "sup"})
        }
        if (formatting.vertAlign === "subscript") {
            marks.push({type: "sub"})
        }
        // Handle inline code (monospace fonts)
        if (formatting.fontFamily) {
            const monospacePatterns: RegExp[] = [
                /^courier/i,
                /^consolas/i,
                /^monaco/i,
                /^menlo/i,
                /^lucida console/i,
                /^liberation mono/i,
                /^dejavu sans mono/i,
                /^bitstream vera sans mono/i,
                /^source code pro/i,
                /^fira code/i,
                /^ubuntu mono/i,
                /^droid sans mono/i
            ]
            const isMonospace = monospacePatterns.some((pattern: RegExp) =>
                pattern.test(String(formatting.fontFamily))
            )
            if (isMonospace) {
                marks.push({type: "code"})
            }
        }
        if (insertion) {
            const date = new Date(attr(insertion, "w:date"))
            const date10 = Math.floor(date.getTime() / 600000) * 10
            marks.push({
                type: "insertion",
                attrs: {
                    user: 0,
                    username: attr(insertion, "w:author"),
                    date: date10,
                    approved: false
                }
            })
        }
        if (deletion) {
            const date = new Date(attr(deletion, "w:date"))
            const date10 = Math.floor(date.getTime() / 600000) * 10
            marks.push({
                type: "deletion",
                attrs: {
                    user: 0,
                    username: attr(deletion, "w:author"),
                    date: date10
                }
            })
        }
        return marks
    }

    getCurrentMarks(
        formatting: RunProperties,
    insertion: XMLElement | null = null,
    deletion: XMLElement | null = null
): FidusMark[] {
        const marks = this.createMarksFromFormatting(
            formatting,
            insertion,
            deletion
        )
        // Add comment marks for any active comment IDs
        this.currentCommentIds.forEach((commentId: string) => {
            const commentAttrs: Record<string, unknown> = {
                id: Number.parseInt(commentId)
            }
            marks.push({
                type: "comment",
                attrs: commentAttrs
            })
        })
        return marks
    }

    hasTrackedChanges(doc: XMLElement) {
        return Boolean(doc.query("w:ins") || doc.query("w:del"))
    }

    detectLanguage(doc: XMLElement) {
        return attr(doc.query("w:lang"), "w:val") || "en-US"
    }
}
