import {MathMLToLaTeX} from "mathml-to-latex"

import {isLeaf, xmlDOM} from "../../exporter/tools/xml.js"
import type {XMLElement} from "../../exporter/tools/xml.js"
import {
    randomCommentId,
    randomFigureId,
    randomHeadingId,
    randomListId,
    randomTableId
} from "../../schema/common/index.js"
import {parseTracks} from "../../schema/common/track.js"
import {
    isOdtBibliographyReferenceMark,
    isOdtBibliographySection,
    isOdtCitationMark,
    parseOdtBibliographyMark,
    parseOdtReferenceMark
} from "./citations.js"
import {gettext} from "fwtoolkit"
import type {
    BibDB,
    CommentData,
    FidusDoc,
    FidusMark,
    FidusNode,
    ImageDBEntry
} from "../../types.js"

interface TextProperties {
    bold?: boolean
    italic?: boolean
    fontSize?: number
    fontFamily?: string
    color?: string
    backgroundColor?: string
    textDecoration?: string
    textPosition?: string
}

interface ParagraphProperties {
    marginTop?: number
    marginBottom?: number
    marginLeft?: number
    marginRight?: number
    textAlign?: string
    lineHeight?: string
    backgroundColor?: string
    padding?: number
    borderStyle?: string
}

interface SectionProperties {
    columnCount?: string
    columnGap?: number
    backgroundColor?: string
    margins?: {
        top?: number
        bottom?: number
        left?: number
        right?: number
    }
}

interface TableProperties {
    align?: string
    width?: number
    relWidth?: string
}

interface StyleProperties {
    parentStyleName?: string
    isSection?: boolean
    title?: string
    family?: string
    name?: string
    isHeading?: boolean
    outlineLevel?: string
    textProperties?: TextProperties
    paragraphProperties?: ParagraphProperties
    sectionProperties?: SectionProperties
    tableProperties?: TableProperties
}

interface TrackData {
    type: "insertion" | "deletion"
    user: number
    username: string
    date: number
    approved?: boolean
}

interface TrackMark {
    type: "insertion" | "deletion"
    attrs: {
        user: number
        username: string
        date: number
        approved?: boolean
    }
}

interface ReferenceableObject {
    type: "heading" | "figure"
    id: string
    node: XMLElement
}

interface ExtractedContent {
    content: FidusNode[]
    containerNodes: XMLElement[]
}

interface Section {
    title: string | null
    content: FidusNode[]
}

/** A metadata section grouped by semantic type. */
interface MetadataItem {
    type: string
    attrs?: Record<string, unknown>
    content: ExtractedContent
}

/** Result of converting an ODT block node: a single node, an array, or null. */
type ConvertResult = FidusNode | FidusNode[] | null

function attr(node: XMLElement | undefined, name: string): string {
    if (!node) {
        return ""
    }
    return String(node.getAttribute(name) || "")
}

function isElement(child: XMLElement | string): child is XMLElement {
    return typeof child !== "string"
}

function isBlockElement(child: XMLElement | string): child is XMLElement {
    return typeof child !== "string" && !isLeaf(child.tagName)
}

export class OdtConvert {
    importId: string
    template: {content: FidusDoc}
    bibliography: Record<string, unknown>
    bibDB: BibDB
    images: Record<number, ImageDBEntry>
    styles: Record<string, StyleProperties>
    contentDoc: XMLElement | null
    stylesDoc: XMLElement | null
    metaDoc: XMLElement | null
    manifestDoc: XMLElement | null
    tracks: Record<string, TrackData>
    comments: Record<string, CommentData>
    currentCommentIds: string[]
    currentTracks: TrackMark[]
    referenceableObjects: Record<string, ReferenceableObject>

    constructor(
        contentXml: string,
        stylesXml: string,
        metaXml: string,
        manifestXml: string,
        importId: string,
        template: {content: FidusDoc},
        bibliography: Record<string, unknown>,
        bibDb: BibDB
    ) {
        this.importId = importId
        this.template = template
        this.bibliography = bibliography
        this.bibDB = bibDb
        this.images = {}
        this.styles = {}

        this.contentDoc = contentXml ? xmlDOM(contentXml) : null
        this.stylesDoc = stylesXml ? xmlDOM(stylesXml) : null
        this.metaDoc = metaXml ? xmlDOM(metaXml) : null
        this.manifestDoc = manifestXml ? xmlDOM(manifestXml) : null

        this.tracks = {}
        this.comments = {}
        this.currentCommentIds = []
        this.currentTracks = []
        this.referenceableObjects = {} // All objects that can be referenced
    }

    init(): {
        content: FidusDoc
        settings: Record<string, unknown>
        comments: Record<string, CommentData>
    } {
        this.parseTrackedChanges()
        this.parseStyles()
        this.parseComments()

        if (this.contentDoc) {
            this.collectReferenceableObjects(this.contentDoc)
        }
        const content = this.convert()
        return {
            content,
            settings: {
                import_id: this.importId,
                tracked: Object.keys(this.tracks).length > 0,
                language: this.detectLanguage()
            },
            comments: this.comments
        }
    }

    parseTrackedChanges() {
        if (!this.contentDoc) {
            return
        }
        const trackedChangesEl = this.contentDoc!.query("text:tracked-changes")
        if (!trackedChangesEl) {
            return
        }

        // Tracked deletions are stored in two different ways in FW and ODT.
        // FW: The deleted content stays in place where it was before the deletion,
        // and is marked with a tracked change mark. Megre only occurs after change
        // has been accepted.
        // ODT: The deleted content is removed from the content flow and is replaced by a marker.
        // The removed content is stored in a special section of the document.
        // This method takes all the deleted content and puts it back into the place where
        // it was previously. That way the structure is more similar to the output FW document
        // and is more easily converted.
        const deletions: Record<string, XMLElement[]> = {}

        const changedRegions = trackedChangesEl.queryAll("text:changed-region")
        changedRegions.forEach(region => {
            const id = attr(region, "text:id")

            const insertion = region.query("text:insertion")
            const deletion = region.query("text:deletion")
            if (!insertion && !deletion) {
                // Neither insertion or deletion. Must be type unknown to us
                return
            }
            const changeInfo = region.query("office:change-info")
            if (changeInfo) {
                const track: TrackData = {
                    type: insertion ? "insertion" : "deletion",
                    user: 1,
                    username: changeInfo.query("dc:creator")?.textContent || "",
                    date: Math.floor(
                        new Date(
                            changeInfo.query("dc:date")?.textContent || ""
                        ).getTime() / 60000
                    )
                }
                if (insertion) {
                    track.approved = false
                }
                this.tracks[id] = track

                if (deletion) {
                    // Store deletion content for later use
                    deletions[id] = deletion.children.filter(isElement).filter(
                        child => child.tagName !== "office:change-info"
                    )
                }
            }
        })

        // Then find and replace all deletion change markers
        const changeMarkers = this.contentDoc!.queryAll("text:change")
        changeMarkers.forEach(marker => {
            const changeId = attr(marker, "text:change-id")
            const deletion = deletions[changeId]
            if (deletion) {
                if (deletion.length > 0) {
                    // Create change-start and change-end elements
                    const markerIndex =
                        marker.parentElement!.children.indexOf(marker)

                    marker.parentElement!.insertXMLAt(
                        `<text:change-start text:change-id="${changeId}"/>`,
                        markerIndex
                    )
                    marker.parentElement!.insertXMLAt(
                        `<text:change-end text:change-id="${changeId}"/>`,
                        markerIndex + 2
                    )

                    if (deletion.length === 1) {
                        // Single block - just insert the content
                        deletion[0].children.filter(isElement).forEach(content => {
                            marker.parentElement!.insertBefore(content, marker)
                        })
                    } else {
                        // Multiple blocks - need to split the paragraph/headline
                        const parentElement = marker.parentElement!
                        parentElement.splitAtChildElement(
                            marker,
                            deletion[0].children
                                .filter(isElement)
                                .map(node => node.toString())
                                .join("") || "", // First block content to be added to current node
                            deletion
                                .slice(1, -1)
                                .map(node => node.toString())
                                .join(""), // Middle blocks
                            deletion[deletion.length - 1].toString() // Last block
                        )
                    }
                }
                // Remove the original change marker
                marker.parentElement!.removeChild(marker)
            }
        })
    }

    parseStyles() {
        if (!this.stylesDoc) {
            return
        }
        const styleNodes = this.stylesDoc.queryAll("style:style")
        styleNodes.forEach(node => {
            const styleName = attr(node, "style:name")
            this.styles[styleName] = this.parseStyle(node)
        })
        const contentStyleNodes = this.contentDoc!.queryAll("style:style")
        contentStyleNodes.forEach(node => {
            const styleName = attr(node, "style:name")
            this.styles[styleName] = this.parseStyle(node)
        })
    }

    parseStyle(styleNode: XMLElement): StyleProperties {
        const properties: StyleProperties = {
            // Basic style information
            parentStyleName: attr(styleNode, "style:parent-style-name"),
            isSection:
                attr(styleNode, "style:family") === "section" ||
                Boolean(styleNode.query("style:section-properties")),
            title: attr(styleNode, "style:display-name"),

            // Family and name info
            family: attr(styleNode, "style:family"),
            name: attr(styleNode, "style:name"),

            // Heading related
            isHeading:
                attr(styleNode, "style:family") === "paragraph" &&
                (attr(styleNode, "style:name")
                    .toLowerCase()
                    .includes("heading") ||
                    attr(styleNode, "style:parent-style-name")
                        ?.toLowerCase()
                        .includes("heading")),
            outlineLevel: attr(styleNode, "text:outline-level"),

            // Text properties
            textProperties: {},

            // Paragraph properties
            paragraphProperties: {},

            // Section properties
            sectionProperties: {}
        }

        // Parse text properties
        const textProperties = styleNode.query("style:text-properties")
        if (textProperties) {
            properties.textProperties = {
                bold: attr(textProperties, "fo:font-weight") === "bold",
                italic:
                    attr(textProperties, "fo:font-style") === "italic",
                fontSize: this.convertLength(
                    attr(textProperties, "fo:font-size")
                ),
                fontFamily: attr(textProperties, "fo:font-family"),
                color: attr(textProperties, "fo:color"),
                backgroundColor: attr(textProperties, "fo:background-color"),
                textDecoration:
                    attr(textProperties, "style:text-underline-style") ||
                    attr(textProperties, "style:text-line-through-style"),
                textPosition: attr(textProperties, "style:text-position")
            }
        }

        // Parse paragraph properties
        const paragraphProperties = styleNode.query(
            "style:paragraph-properties"
        )
        if (paragraphProperties) {
            properties.paragraphProperties = {
                marginTop: this.convertLength(
                    attr(paragraphProperties, "fo:margin-top")
                ),
                marginBottom: this.convertLength(
                    attr(paragraphProperties, "fo:margin-bottom")
                ),
                marginLeft: this.convertLength(
                    attr(paragraphProperties, "fo:margin-left")
                ),
                marginRight: this.convertLength(
                    attr(paragraphProperties, "fo:margin-right")
                ),
                textAlign: attr(paragraphProperties, "fo:text-align"),
                lineHeight: attr(paragraphProperties, "fo:line-height"),
                backgroundColor: attr(paragraphProperties, "fo:background-color"),
                padding: this.convertLength(
                    attr(paragraphProperties, "fo:padding")
                ),
                borderStyle: attr(paragraphProperties, "fo:border-style")
            }
        }

        // Parse section properties
        const sectionProperties = styleNode.query("style:section-properties")
        if (sectionProperties) {
            properties.sectionProperties = {
                columnCount: attr(sectionProperties, "fo:column-count"),
                columnGap: this.convertLength(
                    attr(sectionProperties, "fo:column-gap")
                ),
                backgroundColor: attr(sectionProperties, "fo:background-color"),
                margins: {
                    top: this.convertLength(
                        attr(sectionProperties, "fo:margin-top")
                    ),
                    bottom: this.convertLength(
                        attr(sectionProperties, "fo:margin-bottom")
                    ),
                    left: this.convertLength(
                        attr(sectionProperties, "fo:margin-left")
                    ),
                    right: this.convertLength(
                        attr(sectionProperties, "fo:margin-right")
                    )
                }
            }
        }

        // Additional table-specific properties
        if (attr(styleNode, "style:family") === "table") {
            properties.tableProperties = {
                align: attr(styleNode, "table:align"),
                width: this.convertLength(
                    attr(styleNode, "style:width")
                ),
                relWidth: attr(styleNode, "style:rel-width")
            }
        }

        return properties
    }

    convertObject(node: XMLElement, attrs: Record<string, unknown>): FidusNode | null {
        const mathEl = node.query("math")
        if (mathEl) {
            attrs = Object.assign(
                {
                    equation: MathMLToLaTeX.convert(mathEl.innerXML)
                },
                attrs
            )
            return {
                type: "equation",
                attrs
            }
        }
        return null
    }

    parseComments() {
        if (!this.contentDoc) {
            return
        }
        const annotations = this.contentDoc!.queryAll("office:annotation")
        annotations.forEach(annotation => {
            const username = annotation.query("dc:creator")?.textContent || ""
            const date = new Date(
                annotation.query("dc:date")?.textContent || ""
            ).getTime()

            const id = (attr(annotation, "office:name") || "")
                .replace(/\D/g, "")
                .slice(0, 9)

            if (id) {
                // main comment
                this.comments[id] = {
                    user: 0,
                    username,
                    date,
                    comment: annotation
                        .queryAll("text:p")
                        .map(par => this.convertBlockNode(par))
                        .filter((par): par is FidusNode | FidusNode[] =>
                            Boolean(par)
                        )
                        .flat(),
                    answers: [],
                    resolved:
                        attr(annotation, "loext:resolved") === "true"
                }
            } else {
                const parentId = (
                    attr(annotation, "loext:parent-name") || ""
                )
                    .replace(/\D/g, "")
                    .slice(0, 9)
                if (parentId && this.comments[parentId]) {
                    this.comments[parentId].answers!.push({
                        id: randomCommentId(),
                        user: 0,
                        username,
                        date,
                        // drop the frist paragraph. It only contains "Reply to...."
                        answer: annotation
                            .queryAll("text:p")
                            .slice(1)
                            .map(par => this.convertBlockNode(par))
                            .filter((par): par is FidusNode | FidusNode[] =>
                                Boolean(par)
                            )
                            .flat()
                    })
                }
            }
        })
    }

    collectReferenceableObjects(node: XMLElement) {
        // Handle heading bookmarks
        const bookmarkStarts = node.queryAll("text:bookmark-start")
        bookmarkStarts.forEach((mark: XMLElement) => {
            const refName = attr(mark, "text:name")
            if (!refName) {
                return
            }

            // Find the closest heading
            let targetParent = mark.parentElement
            while (targetParent) {
                if (targetParent.tagName === "text:h") {
                    const id = randomHeadingId()
                    this.referenceableObjects[refName] = {
                        type: "heading",
                        id,
                        node: targetParent
                    }
                    break
                }
                targetParent = targetParent.parentElement
            }
        })

        // Handle figure sequences
        const sequences = node.queryAll("text:sequence")
        sequences.forEach((sequence: XMLElement) => {
            const refName = attr(sequence, "text:ref-name")
            if (!refName) {
                return
            }

            // Find the figure container
            let targetParent = sequence.parentElement
            while (targetParent) {
                if (targetParent.tagName === "draw:frame") {
                    const id = randomFigureId()
                    this.referenceableObjects[refName] = {
                        type: "figure",
                        id,
                        node: targetParent
                    }
                    break
                }
                targetParent = targetParent.parentElement
            }
        })
    }

    convert(): FidusDoc {
        const templateParts = this.template.content.content.slice()
        templateParts.shift()

        const document: {type: string; attrs: Record<string, unknown>; content: FidusNode[]} = {
            type: "doc",
            attrs: {
                import_id: this.importId
            },
            content: []
        }

        // Add title (required first element)
        const title = this.extractTitle()

        if (title.content.length) {
            document.content.push({
                type: "title",
                content: title.content
            })
        } else {
            // If no title found, use default title
            document.content.push({
                type: "title",
                content: [
                    {
                        type: "text",
                        text: gettext("Untitled")
                    }
                ]
            })
        }
        title.containerNodes.forEach((node: XMLElement) => {
            node.parentElement!.removeChild(node)
        })

        ;(document.attrs as Record<string, unknown>).title =
            title.content.map((node: FidusNode) => node.text || "").join("") ||
            gettext("Untitled")

        // Get all content sections from the ODT
        const body = this.contentDoc!.query("office:text")
        if (!body) {
            return document as FidusDoc
        }

        // Look for metadata sections first (author, abstract, etc.)
        const metadataContent = this.extractMetadata()
        metadataContent.forEach(({type, attrs, content}: MetadataItem) => {
            const templatePart = templateParts.find(
                (part: FidusNode) => part.attrs?.metadata === type
            )
            if (templatePart) {
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
                    node.parentElement!.removeChild(node)
                })
            }
        })

        // Group remaining content by sections based on style names/titles
        const sections = this.groupContentIntoSections(body)

        // Map ODT sections to template parts
        sections.forEach((section: Section) => {
            // Find matching template part
            const templatePart = this.findMatchingTemplatePart(
                section.title,
                templateParts
            )

            if (templatePart) {
                // If template part found, use its configuration
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
                (section: Section) =>
                    !this.findMatchingTemplatePart(section.title, templateParts)
            )
            .flatMap((section: Section) => section.content)

        if (unassignedContent.length) {
            // Find default body template part
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

    extractMetadata() {
        const metadata: MetadataItem[] = []

        // Try structured contributor data from meta.xml first
        const contributorsByRole = this.extractContributorsFromMeta()
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
            const authors = this.extractAuthors()
            if (authors.content.length) {
                metadata.push({
                    type: "authors",
                    content: authors
                })
            }
        }

        // Extract abstract if present
        const abstract = this.extractAbstract()
        if (abstract.content.length) {
            metadata.push({
                type: "abstract",
                content: abstract
            })
        }

        // Extract keywords if present
        const keywords = this.extractKeywords()
        if (keywords.content.length) {
            metadata.push({
                type: "keywords",
                content: keywords
            })
        }

        return metadata
    }

    extractContributorsFromMeta() {
        if (!this.metaDoc) {
            return {}
        }

        const userDefined = this.metaDoc.queryAll("meta:user-defined")
        const contributors: FidusNode[] = []

        userDefined.forEach((prop: XMLElement) => {
            const name = attr(prop, "meta:name")
            if (!name || !name.startsWith("fidus_contributor_")) {
                return
            }
            const match = name.match(/^fidus_contributor_(\d+)_(\w+)$/)
            if (!match) {
                return
            }
            const num = parseInt(match[1])
            const field = match[2]
            const value = prop.textContent || ""

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

    extractAuthors() {
        const authors: FidusNode[] = []

        // Try to find author information in metadata
        const metaAuthors = this.contentDoc!.queryAll("meta:user-defined", {
            "meta:name": "author"
        })
        metaAuthors.forEach((authorMeta: XMLElement) => {
            const authorText = authorMeta.textContent || ""
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
                containerNodes: metaAuthors
            }
        }

        // Also check for creator in document metadata
        const creator = this.contentDoc!.query("meta:creator")
        if (creator) {
            const [firstname = "", lastname = ""] = creator.textContent.split(
                " ",
                2
            )
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

    extractAbstract() {
        // Look for section titled "Abstract" or with abstract style
        const abstractSection =
            this.contentDoc!.query("text:section", {
                "text:style-name": "Abstract"
            }) ||
            this.contentDoc!.query("text:h", {
                "text:outline-level": "1"
            }) // Then check content for "Abstract"

        if (
            abstractSection &&
            (attr(abstractSection, "text:style-name") === "Abstract" ||
                abstractSection.textContent.includes("Abstract"))
        ) {
            return {
                content: this.convertContainer(abstractSection),
                containerNodes: [abstractSection]
            }
        }

        return {
            content: [],
            containerNodes: []
        }
    }

    extractKeywords() {
        // Look for keywords section or metadata
        const keywordsSection =
            this.contentDoc!.query("text:p", {"text:style-name": "Keywords"}) ||
            this.contentDoc!.query("meta:user-defined", {
                "meta:name": "keywords"
            })

        if (keywordsSection) {
            return {
                content: this.convertContainer(keywordsSection),
                containerNodes: [keywordsSection]
            }
        }

        return {content: [], containerNodes: []}
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
            // Try fuzzy matching if exact match fails
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
        // Remove special characters and extra spaces
        const normalize = (str: string) =>
            str
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "")
                .trim()

        const normalized1 = normalize(title1)
        const normalized2 = normalize(title2)

        // Check if one string contains the other
        return (
            normalized1.includes(normalized2) ||
            normalized2.includes(normalized1)
        )
    }

    extractTitle() {
        // First try to find paragraph with Title style
        const titleParagraph = this.contentDoc!.query("text:p", {
            "text:style-name": "Title"
        })
        if (titleParagraph) {
            return {
                content: (this.convertBlockNode(titleParagraph) as FidusNode | null)?.content || [],
                containerNodes: [titleParagraph]
            }
        }

        // Fall back to first heading
        const titleHeading = this.contentDoc!.query("text:h", {
            "text:outline-level": "1"
        })
        if (titleHeading) {
            return {
                content: (this.convertBlockNode(titleHeading) as FidusNode | null)?.content || [],
                containerNodes: [titleHeading]
            }
        }

        // Check for other common title style names
        const commonTitleStyles: string[] = [
            "title",
            "doctitle",
            "document-title",
            "heading-title"
        ]
        for (const styleName of commonTitleStyles) {
            const titleElement = this.contentDoc!.query("text:p", {
                "text:style-name": styleName
            })
            if (titleElement) {
                return {
                    content: (this.convertBlockNode(titleElement) as FidusNode | null)?.content || [],
                    containerNodes: [titleElement]
                }
            }
        }

        // Check style properties for title-like formatting
        const firstParagraph = this.contentDoc!.query("text:p")
        if (firstParagraph) {
            const styleName = attr(firstParagraph, "text:style-name")
            const style = this.styles[styleName]

            if (style && this.isTitleStyle(style)) {
                // Remove this node from the document so it's not processed again
                return {
                    content:
                        (this.convertBlockNode(firstParagraph) as FidusNode | null)?.content || [],
                    containerNodes: [firstParagraph]
                }
            }
        }

        return {
            content: [],
            containerNodes: []
        }
    }

    isTitleStyle(style: StyleProperties): boolean {
        // Check if style or its parent has characteristics of a title style.
        // Walk the parent chain iteratively and stop at the first repeated
        // parent name: ODT files (and mutated imports) can contain style
        // reference cycles, which made the recursive version overflow the
        // call stack.
        const visitedParents = new Set<string>()

        while (style) {
            // Check style name
            if (style.title?.toLowerCase().includes("title")) {
                return true
            }

            // Check text properties for title-like formatting
            const textProps = style.textProperties
            if (textProps) {
                // Title usually has larger font size and/or bold weight
                if ((textProps.fontSize ?? 0) > 14 || textProps.bold) {
                    return true
                }
            }

            // Check paragraph properties
            const paraProps = style.paragraphProperties
            if (paraProps) {
                // Titles are often centered and have larger margins
                if (
                    paraProps.textAlign === "center" ||
                    ((paraProps.marginTop ?? 0) > 0.5 && (paraProps.marginBottom ?? 0) > 0.5)
                ) {
                    return true
                }
            }

            // Check parent style if exists, without following cycles
            if (style.parentStyleName) {
                if (visitedParents.has(style.parentStyleName)) {
                    return false
                }
                visitedParents.add(style.parentStyleName)
                style = this.styles[style.parentStyleName]
            } else {
                return false
            }
        }

        return false
    }

    getSectionTitle(node: XMLElement, styleName: string) {
        if (!node || !styleName) {
            return null
        }

        // For headings, use the text content as section title
        if (node.tagName === "text:h") {
            // Get the heading level
            const level = parseInt(attr(node, "text:outline-level")) || 1

            // Only use level 1 and 2 headings as section titles
            if (level <= 2) {
                return node.textContent.trim()
            }
        }

        // Check if the style indicates a section title
        const style = this.styles[styleName]
        if (style) {
            // Check for explicit section title style
            if (
                style.title ||
                styleName.toLowerCase().includes("section") ||
                styleName.toLowerCase().includes("title")
            ) {
                // If it's a styled paragraph, use its content as title
                if (node.tagName === "text:p") {
                    return node.textContent.trim()
                }
            }

            // Check if it's a custom section style
            const parentStyle = style.parentStyleName
                ? this.styles[style.parentStyleName]
                : null
            if (parentStyle?.isSection) {
                return node.textContent.trim()
            }
        }

        // For text:section elements, check for section-name attribute
        if (node.tagName === "text:section") {
            const sectionName = attr(node, "text:name")
            if (sectionName) {
                return this.formatSectionName(sectionName)
            }
        }

        return null
    }

    formatSectionName(name: string) {
        // Remove common suffixes
        name = name.replace(/_?(section|part|chapter)$/i, "")

        // Split by underscores or hyphens
        const words = name.split(/[_-]/)

        // Capitalize first letter of each word and join
        return words
            .map(
                (word: string) =>
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            )
            .join(" ")
            .trim()
    }

    groupContentIntoSections(body: XMLElement) {
        const sections: Section[] = []
        let currentSection: {title: string | null; content: FidusNode[]} = {
            title: null,
            content: []
        }

        body.children
            .filter(isBlockElement)
            .forEach((node: XMLElement) => {
            const styleName = attr(node, "text:style-name")
            const title = this.getSectionTitle(node, styleName)

            if (title && this.isHeadingStyle(styleName)) {
                // Start new section
                if (currentSection.content.length) {
                    sections.push(currentSection)
                }
                currentSection = {
                    title: title,
                    content: []
                }
            }

            const converted = [this.convertBlockNode(node)]
                .filter((node): node is FidusNode | FidusNode[] => node !== null)
                .flat()
            converted.forEach((node: FidusNode) => currentSection.content.push(node))
        })

        // Add final section
        if (currentSection.content.length) {
            sections.push(currentSection)
        }

        return sections
    }

    isCodeBlockStyle(styleName: string, style: StyleProperties): boolean {
        // Walk the parent chain iteratively and stop at the first repeated
        // name: ODT style reference cycles (also produced by mutated
        // imports) made the recursive version overflow the call stack.
        const visited = new Set<string>()

        while (styleName) {
            if (visited.has(styleName)) {
                return false
            }
            visited.add(styleName)

            // Check if style name contains preformatted or code indicators
            const lowerStyleName = styleName.toLowerCase()
            if (
                lowerStyleName.includes("preformatted") ||
                lowerStyleName.includes("code") ||
                styleName === "Preformatted_20_Text"
            ) {
                return true
            }

            if (style?.parentStyleName) {
                // Check parent style for code block indicators
                styleName = style.parentStyleName
                style = this.styles[styleName]
                continue
            }

            // Check text properties for monospace fonts
            if (style?.textProperties?.fontFamily) {
                const fontFamily = style.textProperties.fontFamily.toLowerCase()
                const monospacePatterns: string[] = [
                    "courier",
                    "consolas",
                    "monaco",
                    "menlo",
                    "lucida console",
                    "liberation mono",
                    "dejavu sans mono",
                    "bitstream vera sans mono",
                    "source code pro",
                    "fira code"
                ]
                return monospacePatterns.some((pattern: string) =>
                    fontFamily.includes(pattern)
                )
            }

            return false
        }

        return false
    }

    isHeadingStyle(styleName: string): boolean {
        // Walk the parent chain iteratively and stop at the first repeated
        // name: ODT style reference cycles made the recursive version
        // overflow the call stack.
        const visited = new Set<string>()
        let style = styleName ? this.styles[styleName] : undefined

        while (styleName && style) {
            if (visited.has(styleName)) {
                return false
            }
            visited.add(styleName)

            // Check multiple indicators that this might be a heading style
            const heading = Boolean(
                // Direct heading indicators
                style.isHeading ||
                styleName.toLowerCase().includes("heading") ||
                styleName.toLowerCase().includes("title") ||
                // Check outline level property
                Boolean(style.outlineLevel) ||
                // Check specific formatting that's typical for headings
                (style.paragraphProperties &&
                    // Larger margins than normal paragraphs
                    ((style.paragraphProperties.marginTop ?? 0) > 0.3 ||
                        (style.paragraphProperties.marginBottom ?? 0) > 0.3 ||
                        // Different alignment
                        style.paragraphProperties.textAlign === "center")) ||
                // Check text properties typical for headings
                (style.textProperties &&
                    // Larger font size
                    ((style.textProperties.fontSize ?? 0) > 12 ||
                        // Bold text
                        style.textProperties.bold ||
                        // Different font family
                        style.textProperties.fontFamily))
            )
            if (heading) {
                return true
            }

            // Check if it's derived from a heading style
            if (style.parentStyleName) {
                styleName = style.parentStyleName
                style = this.styles[styleName]
            } else {
                return false
            }
        }

        return false
    }

    convertContainer(container: XMLElement): FidusNode[] {
        return container.children
            .filter(isBlockElement)
            .map((node: XMLElement) => this.convertBlockNode(node))
            .filter((node): node is FidusNode | FidusNode[] => node !== null)
            .flat()
    }

    convertBlockNode(node: XMLElement): ConvertResult {
        const track = this.currentTracks.map((track: TrackMark) => ({
            type: track.type,
            user: track.attrs.user,
            username: track.attrs.username,
            date: track.attrs.date
        }))

        const attrs = track.length ? {track} : {}

        switch (node.tagName) {
            case "text:p": {
                const firstChild = node.children[0]
                if (
                    node.children.length === 1 &&
                    typeof firstChild !== "string" &&
                    firstChild.tagName === "draw:frame"
                ) {
                    // Paragraph consists of only one figure/image.
                    return this.convertImage(firstChild, attrs)
                }
                return this.convertParagraph(node, attrs)
            }
            case "text:h":
                return this.convertHeading(node, attrs)
            case "text:list":
                return this.convertList(node, attrs)
            case "draw:frame":
                return this.convertImage(node, attrs)
            case "draw:object":
                return this.convertObject(node, attrs)
            case "table:table":
                return this.convertTable(node, attrs)
            case "text:sequence-decls":
            case "office:forms":
            case "text:tracked-changes":
                return null
            case "text:bibliography":
                // LibreOffice native bibliography — rendered output only,
                // skip entirely in favour of Fidus Writer's own system.
                return null
            case "text:section": {
                // Skip bibliography sections inserted by citation managers
                // (Zotero: name contains "ZOTERO_BIBL"/"CSL_BIBLIOGRAPHY",
                //  JabRef: name is "JR_bib" / "JR_BIB").
                const sectionName = attr(node, "text:name") || ""
                if (isOdtBibliographySection(sectionName)) {
                    return null
                }
                // Other named sections are not bibliographies — fall through
                // to default handling (treat children as block content).
                return this.convertContainer(node)
            }
            default:
                console.warn(`Unsupported block node: ${node.tagName}`)
                return null
        }
    }

    convertParagraph(node: XMLElement, attrs: Record<string, unknown> = {}): FidusNode {
        const styleName = attr(node, "text:style-name")
        const style = this.styles[styleName]

        // Check if this is a code block (preformatted text)
        if (this.isCodeBlockStyle(styleName, style)) {
            attrs = Object.assign(
                {
                    track: [],
                    language: "",
                    category: "",
                    title: "",
                    id: ""
                },
                attrs
            )
            return {
                type: "code_block",
                attrs,
                content: this.convertNodeChildren(node)
            }
        }

        // Check if this paragraph is title-like
        if (this.isTitleStyle(style)) {
            attrs = Object.assign(
                {
                    id: randomHeadingId()
                },
                attrs
            )
            return {
                type: "heading1",
                attrs,
                content: this.convertNodeChildren(node)
            }
        }

        if (this.isHeadingStyle(styleName)) {
            return this.convertHeading(node, attrs)
        }

        return {
            type: "paragraph",
            attrs,
            content: this.convertNodeChildren(node)
        }
    }

    convertHeading(node: XMLElement, attrs: Record<string, unknown> = {}) {
        const level =
            parseInt(attr(node, "text:outline-level") || "1") || 1

        // Check for bookmark
        let id = null
        const bookmarkStart = node.query("text:bookmark-start")
        if (bookmarkStart) {
            const refName = attr(bookmarkStart, "text:name")
            if (refName && this.referenceableObjects[refName]) {
                id = this.referenceableObjects[refName].id
            }
        }
        attrs = Object.assign(
            {
                id: id || randomHeadingId()
            },
            attrs
        )
        return {
            type: `heading${level}`,
            attrs,
            content: this.convertNodeChildren(node)
        }
    }

    convertNodeChildren(node: XMLElement, currentStyleMarks: FidusMark[] = []): FidusNode[] {
        let insideCitationReferenceMark = false
        let insideBibliographyReferenceMark = false

        return node.children
            .filter(isElement)
            .map((child: XMLElement) => {
                if (insideBibliographyReferenceMark) {
                    // Swallow all rendered bibliography content until the
                    // closing mark — we have our own bibliography system.
                    if (child.tagName === "text:reference-mark-end") {
                        const name = attr(child, "text:name")
                        if (name && isOdtBibliographyReferenceMark(name)) {
                            insideBibliographyReferenceMark = false
                        }
                    }
                    return null
                }

                if (insideCitationReferenceMark) {
                    if (child.tagName === "text:reference-mark-end") {
                        // Process citation when we hit the end mark
                        const name = attr(child, "text:name")
                        if (name && isOdtCitationMark(name)) {
                            insideCitationReferenceMark = false
                            return this.convertCitation(name, currentStyleMarks)
                        }
                    }
                    return null
                }

                switch (child.tagName) {
                    case "text:change-start": {
                        const changeId = attr(child, "text:change-id")
                        const track = this.tracks[changeId]
                        if (track) {
                            const trackMark: TrackMark = {
                                type: track.type,
                                attrs: {
                                    user: track.user,
                                    username: track.username,
                                    date: track.date
                                }
                            }
                            if (track.type === "insertion") {
                                trackMark.attrs.approved = track.approved
                            }
                            this.currentTracks.push(trackMark)
                        }
                        return null
                    }
                    case "text:change-end": {
                        const changeId = attr(child, "text:change-id")
                        const track = this.tracks[changeId]
                        if (track) {
                            this.currentTracks = this.currentTracks.filter(
                                (mark: TrackMark) => mark.type !== track.type
                            )
                        }
                        return null
                    }
                    case "#text":
                        return this.convertText(
                            String(child.textContent),
                            currentStyleMarks
                        )
                    case "text:s": // space
                        return this.convertText(" ", currentStyleMarks)
                    case "text:span": {
                        return this.convertSpan(child, currentStyleMarks)
                    }
                    case "text:a":
                        return this.convertLink(child, currentStyleMarks)
                    case "text:note":
                        return this.convertFootnote(child, currentStyleMarks)
                    case "office:annotation":
                        return this.convertAnnotationStart(child)
                    case "office:annotation-end":
                        return this.convertAnnotationEnd(child)
                    case "text:reference-mark-start": {
                        const name = attr(child, "text:name")
                        if (name && isOdtCitationMark(name)) {
                            insideCitationReferenceMark = true
                        } else if (
                            name &&
                            isOdtBibliographyReferenceMark(name)
                        ) {
                            insideBibliographyReferenceMark = true
                        }
                        return null
                    }
                    case "text:reference-mark-end":
                        // Closing mark for a reference region we are not
                        // treating as a citation/bibliography (e.g. mocked
                        // parsers in tests, or plain reference marks). The
                        // surrounding text has already been emitted, so just
                        // drop the marker.
                        return null
                    case "text:bibliography-mark":
                        return this.convertBibliographyMark(
                            child,
                            currentStyleMarks
                        )
                    case "text:bookmark-ref":
                        return this.convertHeadingReference(child)
                    case "text:sequence-ref":
                        return this.convertFigureReference(child)
                    case "text:soft-page-break":
                        return null
                    default:
                        console.warn(
                            `Unsupported inline node: ${child.tagName}`
                        )
                        return null
                }
            })
            .filter((node): node is FidusNode | FidusNode[] => node !== null)
            .flat()
    }

    getCurrentMarks(currentStyleMarks: FidusMark[] = []) {
        const commentMarks: FidusMark[] = []
        // Add comment marks for any active comment IDs
        this.currentCommentIds.forEach((commentId: string) => {
            commentMarks.push({
                type: "comment",
                attrs: {
                    id: commentId
                }
            })
        })
        return [...currentStyleMarks, ...this.currentTracks, ...commentMarks]
    }

    convertText(text: string, currentStyleMarks: FidusMark[]): FidusNode {
        const textNode: FidusNode = {
            type: "text",
            text
        }
        const marks = this.getCurrentMarks(currentStyleMarks)
        if (marks.length) {
            textNode.marks = marks
        }
        return textNode
    }

    convertSpan(node: XMLElement, currentStyleMarks: FidusMark[]): FidusNode[] {
        const styleName = attr(node, "text:style-name")
        const style = this.styles[styleName]
        if (style?.textProperties?.bold) {
            currentStyleMarks = [...currentStyleMarks, {type: "strong"}]
        }
        if (style?.textProperties?.italic) {
            currentStyleMarks = [...currentStyleMarks, {type: "em"}]
        }
        // Handle superscript and subscript
        if (style?.textProperties?.textPosition) {
            const position = style.textProperties.textPosition
            if (position.includes("super")) {
                currentStyleMarks = [...currentStyleMarks, {type: "sup"}]
            } else if (position.includes("sub")) {
                currentStyleMarks = [...currentStyleMarks, {type: "sub"}]
            }
        }
        // Handle inline code (monospace fonts)
        if (style?.textProperties?.fontFamily) {
            const fontFamily = style.textProperties.fontFamily.toLowerCase()
            const monospacePatterns: string[] = [
                "courier",
                "consolas",
                "monaco",
                "menlo",
                "lucida console",
                "liberation mono",
                "dejavu sans mono",
                "bitstream vera sans mono",
                "source code pro",
                "fira code",
                "ubuntu mono",
                "droid sans mono",
                "monospace"
            ]
            const isMonospace = monospacePatterns.some((pattern: string) =>
                fontFamily.includes(pattern)
            )
            if (isMonospace) {
                currentStyleMarks = [...currentStyleMarks, {type: "code"}]
            }
        }
        return this.convertNodeChildren(node, currentStyleMarks)
    }

    convertFootnote(node: XMLElement, currentStyleMarks: FidusMark[]): FidusNode | null {
        const noteBody = node.query("text:note-body")
        if (!noteBody) {
            return null
        }

        // Get the first paragraph in the footnote
        const firstParagraph = noteBody.query("text:p")
        if (!firstParagraph) {
            return null
        }

        // Check if this is a citation-only footnote
        const referenceMarkStart = firstParagraph.query(
            "text:reference-mark-start"
        )
        const referenceMarkEnd = firstParagraph.query("text:reference-mark-end")

        const markName = attr(referenceMarkStart, "text:name")
        if (
            referenceMarkStart &&
            referenceMarkEnd &&
            markName &&
            isOdtCitationMark(markName) &&
            // Check that there's no content outside the reference marks
            firstParagraph.children.filter(isElement).every(
                (child: XMLElement) =>
                    child.tagName === "text:reference-mark-start" ||
                    child.tagName === "text:reference-mark-end" ||
                    (child.tagName === "text:span" &&
                        child.previousSibling?.tagName ===
                            "text:reference-mark-start" &&
                        child.nextSibling?.tagName ===
                            "text:reference-mark-end")
            )
        ) {
            // If it's a citation-only footnote, convert it directly to a citation
            return this.convertCitation(markName, currentStyleMarks)
        }

        // Otherwise, convert as regular footnote
        return {
            type: "footnote",
            attrs: {
                footnote: this.convertContainer(noteBody)
            },
            marks: this.getCurrentMarks(currentStyleMarks)
        }
    }

    convertCitation(markName: string, currentStyleMarks: FidusMark[]) {
        const citationNode = parseOdtReferenceMark(
            markName,
            this.bibliography,
            this.bibDB
        )
        if (citationNode) {
            citationNode.marks = this.getCurrentMarks(currentStyleMarks)
            return citationNode
        }
        return null
    }

    convertBibliographyMark(bibMarkNode: XMLElement, currentStyleMarks: FidusMark[]) {
        const citationNode = parseOdtBibliographyMark(
            bibMarkNode,
            this.bibliography
        )
        if (citationNode) {
            citationNode.marks = this.getCurrentMarks(currentStyleMarks)
            return citationNode
        }
        return null
    }

    convertList(node: XMLElement, attrs: Record<string, unknown>) {
        const listStyle = attr(node, "text:style-name")
        const isOrdered = this.isOrderedList(listStyle)

        attrs = Object.assign(
            {
                id: randomListId()
            },
            attrs
        )

        if (isOrdered) {
            attrs.order = 1
        }

        return {
            type: isOrdered ? "ordered_list" : "bullet_list",
            attrs,
            content: node.queryAll("text:list-item").map((item: XMLElement) => ({
                type: "list_item",
                content: this.convertContainer(item)
            }))
        }
    }

    convertAnnotationStart(node: XMLElement) {
        const commentId = (attr(node, "office:name") || "")
            .replace(/\D/g, "")
            .slice(0, 9)
        if (commentId && this.comments[commentId]) {
            this.currentCommentIds.push(commentId)
        }
        return null
    }

    convertAnnotationEnd(node: XMLElement) {
        const commentId = (attr(node, "office:name") || "")
            .replace(/\D/g, "")
            .slice(0, 9)
        if (commentId) {
            const index = this.currentCommentIds.indexOf(commentId)
            if (index !== -1) {
                this.currentCommentIds.splice(index, 1)
            }
        }
        return null
    }

    convertHeadingReference(node: XMLElement) {
        const refName = attr(node, "text:ref-name")
        if (!refName || !this.referenceableObjects[refName]) {
            return null
        }

        const targetObject = this.referenceableObjects[refName]
        if (targetObject.type !== "heading") {
            return null
        }

        return {
            type: "cross_reference",
            attrs: {
                id: targetObject.id,
                title: targetObject.node.textContent
            }
        }
    }

    convertFigureReference(node: XMLElement) {
        const refName = attr(node, "text:ref-name")
        if (!refName || !this.referenceableObjects[refName]) {
            return null
        }

        const targetObject = this.referenceableObjects[refName]
        if (targetObject.type !== "figure") {
            return null
        }

        // Find the caption text within the figure
        const caption = targetObject.node.query("text:p")?.textContent || ""

        return {
            type: "cross_reference",
            attrs: {
                id: targetObject.id,
                title: caption
            }
        }
    }

    isOrderedList(styleName: string) {
        if (!this.stylesDoc) {
            return false
        }
        const listStyle = this.stylesDoc.query("text:list-style", {
            "style:name": styleName
        })
        return listStyle?.query("text:list-level-style-number") !== null
    }

    convertImage(node: XMLElement, attrs: Record<string, unknown> = {}) {
        const imageElement = node.query("draw:image")
        if (!imageElement) {
            return null
        }

        const frame = node.closest("draw:frame")
        if (!frame) {
            return null
        }

        const href = attr(imageElement, "xlink:href")
        if (!href || !href.startsWith("Pictures/")) {
            return null
        }

        const imageId = Math.floor(Math.random() * 1000000)
        const width = this.convertLength(attr(node, "svg:width"))
        const height = this.convertLength(attr(node, "svg:height"))

        const title = href.split("/").pop() || href
        this.images[imageId] = {
            id: imageId,
            title,
            copyright: {
                holder: false,
                year: false,
                freeToRead: true,
                licenses: []
            },
            image: href,
            file_type: this.getImageFileType(title),
            file: null,
            width,
            height,
            checksum: 0
        }

        // Find sequence element for figure reference
        const sequence = frame.query("text:sequence")
        let figureId = null
        if (sequence) {
            const refName = attr(sequence, "text:ref-name")
            if (refName && this.referenceableObjects[refName]) {
                figureId = this.referenceableObjects[refName].id
            }
        }

        const caption = node.query("text:p")
        const captionContent = caption ? this.convertNodeChildren(caption) : []

        attrs = Object.assign(
            {
                id: figureId || randomFigureId(),
                aligned: "center",
                width: Math.min(Math.round((width / 8.5) * 100), 100),
                caption: Boolean(captionContent.length)
            },
            attrs
        )

        const figureCaption: FidusNode = {type: "figure_caption"}
        if (captionContent.length) {
            figureCaption.content = captionContent
        }

        return {
            type: "figure",
            attrs,
            content: [
                {
                    type: "image",
                    attrs: {
                        image: imageId
                    }
                },
                figureCaption
            ]
        }
    }

    getImageFileType(filename: string) {
        const ext = filename.split(".").pop()?.toLowerCase() || ""
        switch (ext) {
            case "avif":
            case "avifs":
                return "image/avif"
            case "png":
                return "image/png"
            case "jpg":
            case "jpeg":
                return "image/jpeg"
            case "gif":
                return "image/gif"
            case "svg":
                return "image/svg+xml"
            case "webp":
                return "image/webp"
            default:
                return "image/png" // Default fallback
        }
    }

    convertLength(length: string) {
        if (!length) {
            return 0
        }

        // Match number and unit
        const match = length.match(/^(-?\d*\.?\d+)(pt|cm|mm|in|pc|px|%)?$/)
        if (!match) {
            return 0
        }

        const [_, value, unit = "pt"] = match
        const numValue = parseFloat(value)

        // Convert to inches first (as base unit)
        switch (unit) {
            case "pt": // points
                return numValue / 72
            case "pc": // picas (1 pica = 12 points)
                return (numValue * 12) / 72
            case "cm": // centimeters
                return numValue / 2.54
            case "mm": // millimeters
                return numValue / 25.4
            case "in": // inches
                return numValue
            case "px": // pixels (assuming 96 DPI)
                return numValue / 96
            case "%": // percentage (return as is)
                return numValue
            default:
                return 0
        }
    }

    convertTable(node: XMLElement, attrs: Record<string, unknown>): FidusNode {
        const width =
            attr(node, "style:rel-width")?.replace("%", "") || "100"
        const styleName = attr(node, "table:style-name")
        const style = this.styles[styleName]
        const aligned = style?.tableProperties?.align || "center"

        attrs = Object.assign(
            {
                id: randomTableId(),
                track: parseTracks(attr(node, "text:change-id")),
                width,
                aligned,
                layout: "fixed",
                category: "none",
                caption: false
            },
            attrs
        )
        return {
            type: "table",
            attrs,
            content: [
                {type: "table_caption"},
                {
                    type: "table_body",
                    content: node
                        .queryAll("table:table-row")
                        .map((row: XMLElement) => this.convertTableRow(row))
                }
            ]
        }
    }

    convertTableRow(row: XMLElement): FidusNode {
        return {
            type: "table_row",
            content: row
                .queryAll(["table:table-cell", "table:covered-table-cell"])
                .map((cell: XMLElement) => this.convertTableCell(cell))
                .filter((cell): cell is FidusNode => cell !== null)
        }
    }

    convertTableCell(node: XMLElement): FidusNode | null {
        if (node.tagName === "table:covered-table-cell") {
            return null
        }
        const cellAttrs: Record<string, unknown> = {
            colspan:
                parseInt(
                    attr(node, "table:number-columns-spanned")
                ) || 1,
            rowspan:
                parseInt(attr(node, "table:number-rows-spanned")) ||
                1,
            track: parseTracks(attr(node, "text:change-id"))
        }
        return {
            type: "table_cell",
            attrs: cellAttrs,
            content: this.convertContainer(node)
        }
    }

    convertLink(node: XMLElement, currentStyleMarks: FidusMark[]): FidusNode[] {
        const href = attr(node, "xlink:href")
        currentStyleMarks = currentStyleMarks.concat([
            {type: "link", attrs: {href}}
        ])
        return this.convertNodeChildren(node, currentStyleMarks)
    }

    detectLanguage() {
        // Try to detect document language in following order:
        // 1. From document content
        // 2. From document styles
        // 3. Default to "en-US"

        // Check content language
        if (this.contentDoc) {
            const langAttr =
                attr(this.contentDoc, "office:default-language") ||
                attr(this.contentDoc, "dc:language")
            if (langAttr) {
                return langAttr
            }

            const firstParagraph = this.contentDoc!.query("text:p")
            if (firstParagraph) {
                const paraLang = attr(firstParagraph, "xml:lang")
                if (paraLang) {
                    return paraLang
                }
            }
        }

        // Check styles language
        if (this.stylesDoc) {
            const defaultStyle = this.stylesDoc.query("style:default-style")
            if (defaultStyle) {
                const styleLang =
                    attr(defaultStyle, "fo:language") ||
                    attr(defaultStyle, "style:language-complex")
                if (styleLang) {
                    return styleLang
                }
            }
        }

        // Default to "en-US"
        return "en-US"
    }
}
