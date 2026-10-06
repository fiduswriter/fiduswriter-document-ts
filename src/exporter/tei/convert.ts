/**
 * All functions in this module take a blob of data and return a string of TEI
 * XML markup.
 *
 * Ported from the DHd-Verband TEI exporter (AGPL-3.0), translated to
 * TypeScript. Extended node/mark coverage (hard break, horizontal rule,
 * underline, sup/sub/code marks, anchors), equation figures, localized figure
 * labels and robust image filename resolution.
 * @module
 */

import {escapeText} from "fwtoolkit"
import {getCat} from "../../schema/i18n.js"
import type {
    Contributor,
    FidusNode,
    ImageDB,
    NodeAttrs
} from "../../types.js"
import {textContent} from "../tools/doc_content.js"
import {getImageDBEntryFilename} from "../tools/file.js"

import {extract, extractImageIDs} from "./extract.js"
import type {ExtractedFields} from "./extract.js"
import {escapeXmlText, tag, wrap, wrapText} from "./utils.js"
import {header} from "./templates/header.js"
import {body as bodyTemplate} from "./templates/body.js"
import {back} from "./templates/back.js"
import {TEITemplate} from "./templates/index.js"
import type {TeiCitationsExporter} from "./citations.js"
import type {TeiExporterMath} from "./math.js"

interface TeiConvertSettings {
    language?: string
    [key: string]: unknown
}

export interface TeiConversion {
    tei: string
    imageIds: Array<string | number>
}

function authors(data: Contributor[]): string {
    return data
        .map(contributor => {
            const {firstname, lastname, institution, email, id_type, id_value} =
                contributor
            const name = wrap(
                "persName",
                `${wrapText("surname", lastname || "")}${wrapText(
                    "forename",
                    firstname || ""
                )}`
            )
            const inst = wrapText("affiliation", institution || "")
            const mail = wrapText("email", email || "")

            const contents = [name, inst, mail]
            if (id_type === "ORCID" && id_value) {
                contents.push(wrapText("idno", id_value, {type: "ORCID"}))
            }
            return wrap("author", contents.join(""))
        })
        .join("\n")
}

function keywords(
    data: string[],
    keywordName = "keywords",
    scheme = "ConfTool"
): string {
    if (data.length) {
        const keywordTags = data.map(keyword => wrapText("term", keyword)).join("\n")
        return wrap("keywords", keywordTags, {scheme, n: keywordName})
    }
    return ""
}

/**
 * Parse a leaf element of docContents, i.e. an element with type 'text' and
 * (optionally) some marks for emphasis.
 */
export function convertTextToTei(node: FidusNode): string {
    let start = ""
    let end = ""
    let strong: FidusNode | undefined
    let em: FidusNode | undefined
    let underline: FidusNode | undefined
    let hyperlink: FidusNode | undefined
    let anchor: FidusNode | undefined
    let sup: FidusNode | undefined
    let sub: FidusNode | undefined
    let code: FidusNode | undefined
    if (node.marks) {
        strong = node.marks.find(mark => mark.type === "strong")
        em = node.marks.find(mark => mark.type === "em")
        underline = node.marks.find(mark => mark.type === "underline")
        hyperlink = node.marks.find(mark => mark.type === "link")
        anchor = node.marks.find(mark => mark.type === "anchor")
        sup = node.marks.find(mark => mark.type === "sup")
        sub = node.marks.find(mark => mark.type === "sub")
        code = node.marks.find(mark => mark.type === "code")
    }
    const open = (openTag: string, closeTag: string): void => {
        start += openTag
        end = `${closeTag}${end}`
    }
    if (anchor) {
        open(`<anchor xml:id="${escapeXmlText(String(anchor.attrs?.id || ""))}">`, "</anchor>")
    }
    if (em) {
        open("<hi rend=\"italic\">", "</hi>")
    }
    if (strong) {
        open("<hi rend=\"bold\">", "</hi>")
    }
    if (underline) {
        open("<hi rend=\"underline\">", "</hi>")
    }
    if (sup) {
        open("<hi rend=\"superscript\">", "</hi>")
    }
    if (sub) {
        open("<hi rend=\"subscript\">", "</hi>")
    }
    if (code) {
        open("<hi rend=\"code\">", "</hi>")
    }
    if (hyperlink) {
        const href = (hyperlink.attrs?.href as string) || ""
        if (href.startsWith("#")) {
            // Internal links are not represented in the TEI output.
            open("", "")
        } else {
            open(
                `<ref target="${escapeXmlText(href)}">`,
                "</ref>"
            )
        }
    }
    return start + escapeXmlText(node.text || "") + end
}

/**
 * Build two strings of TEI from the 'richtext' part of a document. The first
 * string represents the content and the second any footnotes.
 */
export function richText(
    richTextContent: FidusNode[],
    imgDB: ImageDB,
    citationTexts: string[],
    mathExporter: TeiExporterMath,
    language: string
): [string, string] {
    let divLevel = 0 // the number of currently open divs
    let fnCount = 0 // the number of footnotes we have encountered
    let figCount = 0 // the number of figures we have encountered
    let citeCount = 0 // the number of citations we have encountered
    // For heading prefixes (1.1, …) — one counter per heading level 1-6.
    const headingCounts = [0, 0, 0, 0, 0, 0]
    const footnotesTei: string[] = []

    function nextHeadingPrefix(atLevel: number): string {
        const level = atLevel - 1
        if (isNaN(level) || level < 0 || level >= headingCounts.length) {
            return ""
        }
        headingCounts[level] += 1
        for (let idx = level + 1; idx < headingCounts.length; idx++) {
            headingCounts[idx] = 0
        }
        return (
            headingCounts.slice(0, level + 1).join(".") +
            (level === 0 ? ". " : " ")
        )
    }

    function f(item: FidusNode): string {
        /* This is a base case because we have arrived at a leaf node. */
        if (item.type === "text") {
            return convertTextToTei(item)
        }

        if (item.type === "hard_break") {
            return tag("lb")
        }

        if (item.type === "horizontal_rule") {
            return tag("lb", {rend: "rule"})
        }

        if (item.type === "equation" && item.attrs?.equation) {
            return wrap("formula", mathExporter.latexToMathML(String(item.attrs.equation)))
        }

        /* Another base case, since the actual content of the footnote is only
         * needed at the bottom of the text. */
        if (item.type === "footnote") {
            if (!Array.isArray(item.attrs?.footnote)) {
                return ""
            }
            fnCount += 1
            footnotesTei.push(
                wrap(
                    "note",
                    (item.attrs.footnote as FidusNode[])
                        .map(child => f(child))
                        .join(""),
                    {n: fnCount, rend: "footnote text", "xml:id": `ftn${fnCount}`}
                )
            )
            // Return only the markup for footnotes inside the regular text.
            return tag("ref", {n: fnCount, target: `ftn${fnCount}`})
        }

        /* Various recursive cases which require further parsing. */

        if (item.type === "figure") {
            figCount++
            const image = item.content?.find(child => child.type === "image")
            const figureEquation = item.content?.find(
                child => child.type === "figure_equation"
            )
            const captionNode = item.attrs?.caption
                ? item.content?.find(child => child.type === "figure_caption")
                : undefined
            const caption = captionNode?.content
                ?.map(child => f(child))
                .join("")
            const category = String(item.attrs?.category || "none")
            const label = getCat(category, language)
            let figureInner: string
            if (figureEquation?.attrs?.equation !== undefined) {
                figureInner = wrap(
                    "formula",
                    mathExporter.latexToMathML(
                        String(figureEquation.attrs.equation)
                    )
                )
            } else {
                const imageId = image?.attrs?.image as string | number | undefined
                const imageEntry = imageId !== undefined ? imgDB.db[imageId] : undefined
                const imageFilename = imageEntry
                    ? getImageDBEntryFilename(imageEntry, imageId as string | number)
                    : ""
                figureInner = tag("graphic", {url: `images/${imageFilename}`})
            }
            return wrap(
                "figure",
                figureInner +
                    wrap(
                        "head",
                        `${label} ${figCount}${caption ? ": " : ""}${caption || ""}`
                    )
            )
        }

        if (
            item.type === "image" ||
            item.type === "figure_equation" ||
            item.type === "figure_caption"
        ) {
            /* Handled when we encounter the surrounding figure node. */
            return ""
        }

        /* Handle table nodes and all their contents */
        if (item.type === "table") {
            let caption = ""
            if (item.attrs?.caption) {
                const captionNode = item.content?.find(
                    child => child.type === "table_caption"
                )
                const captionTei = (captionNode?.content || [])
                    .map(child => f(child))
                    .join("")
                caption = wrap("head", captionTei)
            }
            const tableBody = item.content?.find(
                child => child.type === "table_body"
            )
            const tableTei = (tableBody?.content || [])
                .map(row => {
                    const rowTei = (row.content || [])
                        .map(cell => {
                            const attrs: Record<string, string | number> = {}
                            if (cell.type === "table_header") {
                                attrs.role = "label"
                            }
                            const cellAttrs = cell.attrs as NodeAttrs | undefined
                            if (typeof cellAttrs?.rowspan === "number" && cellAttrs.rowspan > 1) {
                                attrs.rows = cellAttrs.rowspan
                            }
                            if (typeof cellAttrs?.colspan === "number" && cellAttrs.colspan > 1) {
                                attrs.cols = cellAttrs.colspan
                            }
                            return wrap(
                                "cell",
                                (cell.content || []).map(child => f(child)).join(""),
                                attrs
                            )
                        })
                        .join("")
                    const isLabel =
                        (row.content || []).filter(
                            child => child.type === "table_header"
                        ).length === (row.content || []).length &&
                        (row.content || []).length > 0
                    return isLabel
                        ? wrap("row", rowTei, {role: "label"})
                        : wrap("row", rowTei)
                })
                .join("")
            return wrap("table", caption + tableTei)
        }

        if (item.type.startsWith("table_")) {
            /* Handled by the table element itself. */
            return ""
        }

        if (item.type === "blockquote") {
            return wrap("quote", (item.content || []).map(child => f(child)).join(""))
        }

        if (item.type === "code_block") {
            // TEI P5 has no <code> element; <ab> (anonymous block) is the
            // standard container for pre-formatted code.
            return wrapText("ab", textContent(item), {rend: "code"})
        }

        if (item.type === "ordered_list") {
            const items = (item.content || [])
                .filter(child => child.type === "list_item")
                .map(listItem => {
                    const itemTei = (listItem.content || [])
                        .map(innerChild => f(innerChild))
                        .join("")
                    return wrap("item", itemTei)
                })
                .join("")
            // Earlier versions of the TEI guidelines recommended
            // <list type="numbered"> instead.
            return wrap("list", items, {type: "ordered"})
        }
        if (item.type === "bullet_list") {
            const items = (item.content || [])
                .filter(child => child.type === "list_item")
                .map(listItem => {
                    const itemTei = (listItem.content || [])
                        .map(innerChild => f(innerChild))
                        .join("")
                    return wrap("item", itemTei)
                })
                .join("")
            // Earlier versions of the TEI guidelines recommended
            // <list type="bulleted"> instead.
            return wrap("list", items, {type: "unordered"})
        }
        if (item.type === "list_item") {
            // Handled in 'bullet_list' or 'ordered_list'.
            return ""
        }

        if (item.type === "paragraph") {
            if (item.content === undefined) {
                return tag("lb")
            }
            return wrap("p", item.content.map(child => f(child)).join(""))
        }

        if (item.type.startsWith("heading")) {
            // A heading without content: do nothing (probably an artifact from
            // pasting).
            const content = (item.content || [])
                .map(child => f(child))
                .join("")
            if (!content) {
                return ""
            }
            // Whenever the new heading is of a higher order (i.e. the number is
            // smaller) or the same as the preceding heading, we need to close
            // our previous div(s).
            const order = parseInt(item.type.slice(-1))
            const closing =
                order <= divLevel ? "</div>".repeat(divLevel + 1 - order) : ""
            let opening: string
            if (order > divLevel + 1) {
                // Skipped levels (the first heading is deeper than h1 or a
                // level is skipped): open the intermediate divs without
                // heads so the number of open divs matches divLevel and the
                // final closing balances.
                const divs: string[] = []
                for (let level = divLevel + 1; level <= order; level++) {
                    divs.push(
                        `<div type="div${level}" rend="DH-Heading${level}">`
                    )
                }
                opening = divs.join("")
            } else {
                opening = `<div type="div${order}" rend="DH-Heading${order}">`
            }
            divLevel = order
            const head = wrap("head", nextHeadingPrefix(order) + content)
            return `${closing}${opening}${head}`
        }

        if (item.type === "cross_reference") {
            return item.attrs?.title ? escapeXmlText(String(item.attrs.title)) : ""
        }

        if (item.type === "citation") {
            return citationTexts[citeCount++] || ""
        }

        return ""
    }

    const result = richTextContent.map(child => f(child)).join("")
    const closing = "</div>".repeat(divLevel)
    const text = `${result}${closing}`

    const footnotes = footnotesTei.length
        ? wrap("div", footnotesTei.join("\n"), {type: "notes"})
        : ""
    return [text, footnotes]
}

function bibliography(bibliographyText: string): string {
    return bibliographyText || ""
}

interface ConvertOptions {
    publicationStmt?: string
}

/**
 * This is the main entry point of this module. It takes the title-slug of the
 * document and the document's content object and generates a string of TEI XML
 * suitable for download.
 */
export function convert(
    slug: string,
    docContents: FidusNode,
    imgDB: ImageDB,
    citationsExporter: TeiCitationsExporter,
    mathExporter: TeiExporterMath,
    settings: TeiConvertSettings & ConvertOptions = {}
): TeiConversion {
    const language = settings.language || "en-US"
    const fields: ExtractedFields = extract(docContents)

    // All the fields used in the TEI header:
    const authorsTei = authors(fields.authors)
    const date = fields.date
    const keywordsTei = [
        keywords(["Paper"], "category"),
        keywords(fields.tags.contributionTypes, "subcategory"),
        keywords(fields.tags.keywords, "keywords"),
        keywords(fields.tags.topics, "topics")
    ].join("\n")
    const title = wrapText("title", fields.title, {type: "main"})
    const subtitle = wrapText("title", fields.subtitle, {type: "sub"})

    const [abstract] = richText(
        fields.abstract?.content || [],
        imgDB,
        [],
        mathExporter,
        language
    )

    const TEIheader = header({
        authors: authorsTei,
        title,
        date,
        keywords: keywordsTei,
        subtitle,
        abstract,
        publicationStmt: settings.publicationStmt || tag("publisher")
    })

    // All the fields used in the TEI body:
    const [text, footnotes] = richText(
        fields.body,
        imgDB,
        citationsExporter.citationTexts,
        mathExporter,
        language
    )
    const TEIbody = bodyTemplate(text)

    // All the fields used in the TEI back:
    const bibItems = bibliography(citationsExporter.teiBibliography)
    const TEIback = back(footnotes, escapeText(citationsExporter.bibliographyHeader), bibItems)

    return {
        tei: TEITemplate(slug, TEIheader, TEIbody, TEIback),
        imageIds: extractImageIDs(docContents)
    }
}

export {authors, keywords}
