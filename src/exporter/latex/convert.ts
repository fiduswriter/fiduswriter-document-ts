import {gettext} from "fwtoolkit"
import {BIBLIOGRAPHY_HEADERS, getCat} from "../../schema/i18n.js"
import {descendantNodes} from "../tools/doc_content.js"
import {getImageDBEntryFilename} from "../tools/file.js"
import {escapeLatexText} from "./escape_latex.js"
import type {
    BibDB,
    BibDBEntries,
    Contributor,
    DocSettings,
    ExportDoc,
    FidusNode,
    FidusMark,
    ImageDB
} from "../../types.js"

/** Minimal interface the LaTeX converter needs from its host exporter. */
interface ILatexExporter {
    doc: ExportDoc
}

/** Options threaded through walkJson recursion. */
interface WalkOptions {
    ignoreHeading?: boolean
    madeTitle?: boolean
    noLineBreak?: boolean
    onlyFootnoteMarkers?: boolean
    unplacedFootnotes?: FidusNode[][]
}

/** A single citation reference stored in a citation node's attrs.references. */
interface CitationRef {
    id: string
    locator?: string
    prefix?: string
}

/** Author entry assembled while processing a contributors_part node. */
interface AuthorEntry {
    name: string
    affiliation: string | false
    email?: string
    id_type?: string
    id_value?: string
}

/** A license entry within a copyright block. */
interface License {
    url?: string
    start?: string
    title?: string
}

/** Copyright metadata for a document or image. */
interface CopyrightInfo {
    holder?: string
    year?: number | string
    // Legacy image databases store licenses as plain strings.
    licenses?: Array<License | string>
}

export class LatexExporterConvert {
    exporter: ILatexExporter
    settings: DocSettings
    imageDB: ImageDB
    bibDB: BibDB
    imageIds: string[]
    usedBibDB: BibDBEntries
    features: Record<string, boolean>
    internalLinks: string[]
    categoryCounter: Record<string, number>
    authorsTex: string

    constructor(
        exporter: ILatexExporter,
        imageDB: ImageDB,
        bibDB: BibDB,
        settings: DocSettings
    ) {
        this.exporter = exporter
        this.settings = settings
        this.imageDB = imageDB
        this.bibDB = bibDB
        this.imageIds = []
        this.usedBibDB = {}
        // While walking the tree, we take note of the kinds of features That
        // are present in the file, so that we can assemble an preamble and
        // epilogue based on our findings.
        this.features = {}
        this.internalLinks = []
        this.categoryCounter = {} // counters for each type of figure (figure/table/photo)
        this.authorsTex = ""
    }

    init(docContent: FidusNode): {
        latex: string
        imageIds: string[]
        usedBibDB: BibDBEntries
    } {
        this.preWalkJson(docContent)
        const rawTransformation = this.walkJson(docContent)
        const body = this.postProcess(rawTransformation)
        const copyright = this.assembleCopyright()
        const preamble = this.assemblePreamble()
        const epilogue = this.assembleEpilogue()
        const latex =
            copyright +
            this.docDeclaration +
            preamble +
            this.authorsTex +
            "\n\\begin{document}\n" +
            body +
            epilogue +
            "\n\\end{document}\n"
        const returnObject = {
            latex,
            imageIds: this.imageIds,
            usedBibDB: this.usedBibDB
        }
        return returnObject
    }

    get docDeclaration(): string {
        return "\\documentclass{article}\n"
    }

    // Check for things needed before creating raw transform
    preWalkJson(node: FidusNode): void {
        switch (node.type) {
            // Collect all internal links so that we only set the anchors for those
            // that are being linked to.
            case "text":
                if (node.marks) {
                    const hyperlink = node.marks.find(
                        (mark: FidusMark) => mark.type === "link"
                    )
                    if (hyperlink) {
                        const href = hyperlink.attrs?.href as string
                        if (
                            href[0] === "#" &&
                            !this.internalLinks.includes(href)
                        ) {
                            this.internalLinks.push(href.slice(1))
                        }
                    }
                }
                break
        }
        if (node.content) {
            node.content.forEach((child: FidusNode) => this.preWalkJson(child))
        }
    }

    walkJson(node: FidusNode, options: WalkOptions = {}): string {
        let start = "",
            content = "",
            end = "",
            placeFootnotesAfterBlock = false
        switch (node.type) {
            case "doc":
                break
            case "title":
                start += "\n\\title{"
                end = "}" + end
                break
            case "heading_part":
                if (node.attrs?.metadata === "subtitle" && node.content) {
                    start += "\n\\subtitle{"
                    end = "}" + end
                    this.features.subtitle = true
                    options = Object.assign({}, options)
                    options.ignoreHeading = true
                } else if (!options.madeTitle) {
                    start += "\n\n\\maketitle\n"
                    options.madeTitle = true
                }
                break
            case "contributor":
                // Ignore - we deal with contributors_part instead.
                break
            case "contributors_part":
                if (node.content) {
                    const contributorLabels: Record<string, string> = {
                        authors: gettext("Authors"),
                        editors: gettext("Editors"),
                        translators: gettext("Translators"),
                        reviewers: gettext("Reviewers"),
                        contributors: gettext("Contributors")
                    }
                    const roleLabel =
                        contributorLabels[node.attrs?.metadata as string]

                    if (node.attrs?.metadata === "authors") {
                        const authorsPerAffil = node.content
                            .map((authorNode: FidusNode) => {
                                const author = (
                                    authorNode.attrs || {}
                                ) as Contributor,
                                    nameParts: string[] = []
                                let affiliation: string | false = false
                                if (author.firstname) {
                                    nameParts.push(author.firstname)
                                }
                                if (author.lastname) {
                                    nameParts.push(author.lastname)
                                }
                                if (nameParts.length && author.institution) {
                                    affiliation = author.institution
                                } else if (author.institution) {
                                    // We have an institution but no names. Use institution as name.
                                    nameParts.push(author.institution)
                                }
                                return {
                                    name: nameParts.join(" "),
                                    affiliation,
                                    email: author.email,
                                    id_type: author.id_type,
                                    id_value: author.id_value
                                } as AuthorEntry
                            })
                            .reduce(
                                (
                                    affils: Record<string, AuthorEntry[]>,
                                    author: AuthorEntry
                                ) => {
                                    const affilKey = String(author.affiliation)
                                    affils[affilKey] = affils[affilKey] || []
                                    affils[affilKey].push(author)
                                    return affils
                                },
                                {} as Record<string, AuthorEntry[]>
                            )

                        Object.values(authorsPerAffil).forEach(
                            (affil: AuthorEntry[]) => {
                                affil.forEach((author: AuthorEntry) => {
                                    let thanks = ""
                                    if (author.email) {
                                        thanks += `\\thanks{${escapeLatexText(author.email)}}`
                                    }
                                    if (author.id_type && author.id_value) {
                                        thanks += `\\thanks{${escapeLatexText(author.id_type)}: ${escapeLatexText(author.id_value)}}`
                                    }
                                    this.authorsTex += `\n\\author{${escapeLatexText(author.name)}${thanks}}`
                                })

                                this.authorsTex += `\n\\affil{${
                                    affil[0].affiliation
                                        ? escapeLatexText(affil[0].affiliation)
                                        : ""
                                }}`
                            }
                        )
                        this.authorsTex += "\n\n"
                        this.features.authors = true
                    } else {
                        if (!options.madeTitle) {
                            start += "\n\n\\maketitle\n"
                            options.madeTitle = true
                        }
                        const contributorNames = node.content
                            .map((contributorNode: FidusNode) => {
                                const attrs = (
                                    contributorNode.attrs || {}
                                ) as Contributor
                                const nameParts: string[] = []
                                if (attrs.firstname) {
                                    nameParts.push(attrs.firstname)
                                }
                                if (attrs.lastname) {
                                    nameParts.push(attrs.lastname)
                                }
                                if (!nameParts.length && attrs.institution) {
                                    // We have an institution but no names. Use institution as name.
                                    nameParts.push(attrs.institution)
                                }
                                let name = nameParts.join(" ")
                                if (attrs.id_type && attrs.id_value) {
                                    name += ` (${escapeLatexText(attrs.id_type)}: ${escapeLatexText(attrs.id_value)})`
                                }
                                return name
                            })
                            .filter((name: string) => name.length)
                            .join(", ")
                        if (contributorNames.length) {
                            content += `\n\\noindent\\textbf{${roleLabel}:} ${contributorNames}\n\n`
                        }
                    }
                }

                break
            case "tags_part":
                if (node.content) {
                    if (node.attrs?.metadata === "keywords") {
                        start += "\n\\keywords{"
                        end = "}" + end
                        this.features.keywords = true
                    } else if (!options.madeTitle) {
                        start += "\n\n\\maketitle\n"
                        options.madeTitle = true
                    }
                    content += node.content
                        .map((keyword: FidusNode) =>
                            escapeLatexText(keyword.attrs!.tag as string)
                        )
                        .join("\\sep ")
                }
                break
            case "tag":
                // Ignore - we already took all the tags_part from the keywords node.
                break
            case "richtext_part":
                if (!options.madeTitle) {
                    start += "\n\n\\maketitle\n"
                    options.madeTitle = true
                }
                if (node.content && node.attrs?.metadata === "abstract") {
                    start += "\n\\begin{abstract}\n"
                    end = "\n\\end{abstract}\n" + end
                }
                break
            case "table_of_contents":
                start += "\n\n\\tableofcontents\n"
                break
            case "separator_part":
            case "table_part":
                // part separators as in page breaks should usually already be handled
                // by LaTeX and table parts will simply show the table inside of them.
                break
            case "paragraph":
                start += "\n\n"
                end = "\n" + end
                break
            case "heading1":
            case "heading2":
            case "heading3":
            case "heading4":
            case "heading5":
            case "heading6": {
                if (options.ignoreHeading) {
                    break
                }
                const level = Number.parseInt(node.type.slice(-1))
                switch (level) {
                    case 1:
                        start += "\n\n\\section{"
                        break
                    case 2:
                        start += "\n\n\\subsection{"
                        break
                    case 3:
                    case 4:
                    case 5:
                    case 6:
                        // TODO: Add support for levels 4/5/6
                        start += "\n\n\\subsubsection{"
                        break
                }
                end = `}\\label{${node.attrs?.id}}\n\n` + end
                // Check if this heading is being linked to. If this is the case,
                // place a protected hypertarget here that does not add an extra
                // entry into the PDF TOC.
                if (node.attrs?.id && this.internalLinks.includes(node.attrs.id)) {
                    // Add a link target
                    end =
                        end +
                        `\\texorpdfstring{\\protect\\hypertarget{${node.attrs.id}}{}}{}`
                }
                options = Object.assign({}, options)
                options.noLineBreak = true
                if (!options.onlyFootnoteMarkers) {
                    placeFootnotesAfterBlock = true
                    options.onlyFootnoteMarkers = true
                    options.unplacedFootnotes = []
                }
                break
            }
            case "code_block": {
                // Support language and category attributes
                if (node.attrs?.category && node.attrs.id) {
                    const language = this.settings.language || "en-US"
                    const categoryLabel = getCat(
                        node.attrs.category as string,
                        language
                    )

                    // Count code blocks to get the number
                    const categories: Record<string, number> = {}
                    for (const n of descendantNodes(this.exporter.doc.content)) {
                        if (
                            n.type === "code_block" &&
                            n.attrs?.category &&
                            n.attrs.id
                        ) {
                            const category = n.attrs.category as string
                            if (!categories[category]) {
                                categories[category] = 0
                            }
                            categories[category]++
                            if (n.attrs.id === node.attrs.id) {
                                break
                            }
                        }
                    }
                    const number =
                        categories[node.attrs.category as string] || 1
                    const caption = node.attrs.title
                        ? `${categoryLabel} ${number}: ${this.convertText(node.attrs.title as string)}`
                        : `${categoryLabel} ${number}`

                    start += `\n\\begin{listing}\n\\caption{${caption}}\\label{${node.attrs.id}}\n\\begin{code}\n\n`
                    end = `\n\n\\end{code}\n\\end{listing}\n` + end
                    this.features.listing = true
                } else if (node.attrs?.language) {
                    start += `\n\\begin{code}[${this.convertText(node.attrs.language as string)}]\n\n`
                    end = `\n\n\\end{code}\n` + end
                } else {
                    start += "\n\\begin{code}\n\n"
                    end = "\n\n\\end{code}\n" + end
                }
                this.features.code = true
                break
            }
            case "blockquote":
                start += "\n\\begin{quote}\n\n"
                end = "\n\n\\end{quote}\n" + end
                break
            case "ordered_list": {
                const order = (node.attrs?.order as number | undefined) ?? 1
                if (order !== 1) {
                    start += `\n\\begin{enumerate}[start=${order}]`
                    this.features.orderedListStart = true
                } else {
                    start += "\n\\begin{enumerate}"
                }
                end = "\n\\end{enumerate}" + end
                if (!options.onlyFootnoteMarkers) {
                    placeFootnotesAfterBlock = true
                    options = Object.assign({}, options)
                    options.onlyFootnoteMarkers = true
                    options.unplacedFootnotes = []
                }
                break
            }
            case "bullet_list":
                start += "\n\\begin{itemize}"
                end = "\n\\end{itemize}" + end
                if (!options.onlyFootnoteMarkers) {
                    placeFootnotesAfterBlock = true
                    options = Object.assign({}, options)
                    options.onlyFootnoteMarkers = true
                    options.unplacedFootnotes = []
                }
                break
            case "list_item":
                start += "\n\\item "
                end = "\n" + end
                break
            case "footnote": {
                const footnote = node.attrs!.footnote as FidusNode[]
                if (options.onlyFootnoteMarkers) {
                    // We are inside a headline or a list and can only place a
                    // footnote marker here. The footnote will have to be put
                    // beyond the block node instead.
                    start += "\\protect\\footnotemark{}"
                    options.unplacedFootnotes!.push(footnote)
                } else {
                    if (
                        !footnote.find((par: FidusNode) => par.type === "figure")
                    ) {
                        // LaTeX doesn't allow figures in footnotes, so well move
                        // this footnote into the regular text.
                        start += "\\footnote{"
                        end = "}" + end
                    }
                    let fnContent = ""
                    footnote.forEach((footPar: FidusNode) => {
                        fnContent += this.walkJson(footPar, options)
                    })
                    content += fnContent.replace(/^\s+|\s+$/g, "")
                }
                break
            }
            case "text": {
                let strong: FidusMark | undefined,
                    em: FidusMark | undefined,
                    underline: FidusMark | undefined,
                    hyperlink: FidusMark | undefined,
                    anchor: FidusMark | undefined,
                    sup: FidusMark | undefined,
                    sub: FidusMark | undefined,
                    code: FidusMark | undefined
                // Check for hyperlink, bold/strong, italic/em and underline
                if (node.marks) {
                    strong = node.marks.find(
                        (mark: FidusMark) => mark.type === "strong"
                    )
                    em = node.marks.find(
                        (mark: FidusMark) => mark.type === "em"
                    )
                    underline = node.marks.find(
                        (mark: FidusMark) => mark.type === "underline"
                    )
                    hyperlink = node.marks.find(
                        (mark: FidusMark) => mark.type === "link"
                    )
                    anchor = node.marks.find(
                        (mark: FidusMark) => mark.type === "anchor"
                    )
                    sup = node.marks.find(
                        (mark: FidusMark) => mark.type === "sup"
                    )
                    sub = node.marks.find(
                        (mark: FidusMark) => mark.type === "sub"
                    )
                    code = node.marks.find(
                        (mark: FidusMark) => mark.type === "code"
                    )
                }
                if (em) {
                    start += "\\emph{"
                    end = "}" + end
                }
                if (strong) {
                    start += "\\textbf{"
                    end = "}" + end
                }
                if (underline) {
                    start += "\\underline{"
                    end = "}" + end
                }
                if (sup) {
                    start += "\\textsuperscript{"
                    end = "}" + end
                }
                if (sub) {
                    start += "\\textsubscript{"
                    end = "}" + end
                }
                if (code) {
                    start += "\\texttt{"
                    end = "}" + end
                }
                if (hyperlink) {
                    const href = hyperlink.attrs?.href as string
                    if (href[0] === "#") {
                        // Internal link
                        start += `\\hyperlink{${href.slice(1)}}{`
                    } else {
                        // External link
                        start += `\\href{${href}}{`
                    }
                    end = "}" + end
                    this.features.hyperlinks = true
                }
                if (
                    anchor &&
                    anchor.attrs?.id &&
                    this.internalLinks.includes(anchor.attrs.id)
                ) {
                    // Add a link target
                    start += `\\hypertarget{${anchor.attrs.id}}{`
                    end = "}" + end
                }
                content += escapeLatexText(node.text ?? "")
                break
            }
            case "cross_reference": {
                content += `\\hyperref[${node.attrs?.id}]{${(node.attrs?.title as string | undefined) || "MISSING TARGET"}}`
                this.features.hyperlinks = true
                break
            }
            case "citation": {
                const references = node.attrs!.references as CitationRef[]
                const format = node.attrs!.format as string
                let citationCommand: string | false

                if (
                    references.length > 1 &&
                    references.every(
                        (ref: CitationRef) => !ref.locator && !ref.prefix
                    )
                ) {
                    // multi source citation without page numbers or text before.
                    const citationEntryKeys: string[] = []
                    let cmd = "\\" + format

                    const allCitationItemsPresent = references
                        .map((ref: CitationRef) => ref.id)
                        .every((citationEntry: string) => {
                            const bibDBEntry = this.bibDB.db[citationEntry]
                            if (bibDBEntry) {
                                if (!bibDBEntry) {
                                    // Not present in bibliography database, skip it.
                                    // TODO: Throw an error?
                                    return false
                                }
                                if (!this.usedBibDB[citationEntry]) {
                                    const citationKey =
                                        this.createUniqueCitationKey(
                                            bibDBEntry.entry_key
                                        )
                                    this.usedBibDB[citationEntry] =
                                        Object.assign({}, bibDBEntry)
                                    this.usedBibDB[citationEntry].entry_key =
                                        citationKey
                                }
                                citationEntryKeys.push(
                                    this.usedBibDB[citationEntry].entry_key!
                                )
                            }
                            return true
                        })
                    if (allCitationItemsPresent) {
                        citationCommand = cmd + `{${citationEntryKeys.join(",")}}`
                    } else {
                        citationCommand = false
                    }
                } else {
                    let cmd = "\\" + format
                    if (references.length > 1) {
                        cmd += "s" // Switching from \autocite to \autocites
                    }

                    const allCitationItemsPresent = references.every(
                        (ref: CitationRef) => {
                            const bibDBEntry = this.bibDB.db[ref.id]
                            if (!bibDBEntry) {
                                // Not present in bibliography database, skip it.
                                // TODO: Throw an error?
                                return false
                            }

                            if (ref.prefix) {
                                cmd += `[${ref.prefix}]`
                                if (!ref.locator) {
                                    cmd += "[]"
                                }
                            }
                            if (ref.locator) {
                                cmd += `[${ref.locator}]`
                            }
                            cmd += "{"

                            if (!this.usedBibDB[ref.id]) {
                                const citationKey =
                                    this.createUniqueCitationKey(
                                        bibDBEntry.entry_key
                                    )
                                this.usedBibDB[ref.id] = Object.assign(
                                    {},
                                    bibDBEntry
                                )
                                this.usedBibDB[ref.id].entry_key = citationKey
                            }
                            cmd += this.usedBibDB[ref.id].entry_key!
                            cmd += "}"

                            return true
                        }
                    )

                    citationCommand = allCitationItemsPresent ? cmd : false
                }
                if (citationCommand) {
                    content += citationCommand
                    this.features.citations = true
                }
                break
            }
            case "figure": {
                const category = node.attrs!.category as string
                const captionContent = node.attrs!.caption
                    ? node.content
                          ?.find((n: FidusNode) => n.type === "figure_caption")
                          ?.content ?? []
                    : []
                let caption: string
                if (category !== "none") {
                    if (!this.categoryCounter[category]) {
                        this.categoryCounter[category] = 1
                    }
                    const catCount = this.categoryCounter[category]++
                    const catLabel = `${getCat(category, this.settings.language ?? "en-US")} ${catCount}`
                    if (captionContent.length) {
                        caption = `${catLabel}: ${captionContent.map((n: FidusNode) => this.walkJson(n)).join("")}`
                    } else {
                        caption = catLabel
                    }
                } else {
                    caption = captionContent
                        .map((n: FidusNode) => this.walkJson(n))
                        .join("")
                }
                let innerFigure = ""
                let copyright: CopyrightInfo | undefined
                const image =
                    (node.content
                        ?.find((n: FidusNode) => n.type === "image")
                        ?.attrs?.image as string | undefined) || false
                if (image) {
                    this.imageIds.push(image)
                    const imageDBEntry = this.imageDB.db[image],
                        filename = getImageDBEntryFilename(imageDBEntry, image)
                    copyright =
                        imageDBEntry.copyright as unknown as
                            | CopyrightInfo
                            | undefined
                    if (filename.split(".").pop() === "svg") {
                        innerFigure += `\\includesvg[width=${Number.parseInt(node.attrs!.width as string) / 100}\\textwidth]{${filename}}\n`
                        this.features.SVGs = true
                    } else {
                        innerFigure += `\\scaledgraphics{${filename}}{${Number.parseInt(node.attrs!.width as string) / 100}}\n`
                        this.features.images = true
                    }
                } else {
                    const equation =
                        (node.content
                            ?.find(
                                (n: FidusNode) => n.type === "figure_equation"
                            )
                            ?.attrs?.equation as string | undefined) ?? ""
                    innerFigure += `\\begin{displaymath}\n${equation}\n\\end{displaymath}\n`
                }
                if (category === "table") {
                    const aligned =
                        node.attrs!.width === "100"
                            ? "left"
                            : (node.attrs!.aligned as string)
                    if (aligned === "center") {
                        start += "\n\n\\begin{center}"
                        end = "\n\n\\end{center}\n" + end
                    } else if (aligned === "right") {
                        start += "\n\n{\\raggedleft" // This is not a typo - raggedleft = aligned: right
                        end = "\n\n}\n" + end
                    } // aligned === 'left' is default
                    start += "\n\\begin{table}\n"
                    content += caption.length ? `\\caption*{${caption}}` : ""
                    content += `\\label{${node.attrs?.id}}\n${innerFigure}`
                    end = "\\end{table}\n" + end
                } else {
                    // TODO: handle photo figure types in a special way
                    if (
                        node.attrs!.width === "100" ||
                        node.attrs!.aligned === "center"
                    ) {
                        start += "\n\\begin{figure}\n"
                        end = "\\end{figure}\n" + end
                    } else {
                        const aligned = (node.attrs!.aligned as string)[0]
                        start += `\n\\begin{wrapfigure}{${aligned}}{${Number.parseInt(node.attrs!.width as string) / 100}\\textwidth}\n`
                        end = "\\end{wrapfigure}\n" + end
                        this.features.wrapfig = true
                    }
                    content += `${innerFigure}${caption.length ? `\\caption*{${caption}}` : ""}\\label{${node.attrs?.id}}\n`
                }
                if (copyright?.holder) {
                    content += `% © ${copyright.year ? copyright.year : new Date().getFullYear()} ${copyright.holder}\n`
                }
                if (copyright?.licenses?.length) {
                    copyright.licenses.forEach((license: License | string) => {
                        content +=
                            typeof license === "string"
                                ? `% ${license}\n`
                                : `% ${license.title}: ${license.url}${license.start ? ` (${license.start})` : ""}\n`
                    })
                }
                if (node.attrs?.id && this.internalLinks.includes(node.attrs.id)) {
                    // Add a link target
                    end =
                        `\\texorpdfstring{\\protect\\hypertarget{${node.attrs.id}}{}}{}\n` +
                        end
                }
                this.features.captions = true
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
            case "table":
                if (node.content?.length) {
                    const category = node.attrs!.category as string

                    const captionContent = node.attrs!.caption
                        ? node.content[0].content ?? []
                        : []
                    let caption: string
                    if (category !== "none") {
                        if (!this.categoryCounter[category]) {
                            this.categoryCounter[category] = 1
                        }
                        const catCount = this.categoryCounter[category]++
                        const catLabel = `${getCat(category, this.settings.language ?? "en-US")} ${catCount}`
                        if (captionContent.length) {
                            caption = `${catLabel}: ${captionContent.map((n: FidusNode) => this.walkJson(n)).join("")}`
                        } else {
                            caption = catLabel
                        }
                    } else {
                        caption = captionContent
                            .map((n: FidusNode) => this.walkJson(n))
                            .join("")
                    }
                    let columns = 1
                    if (
                        node.content.length > 1 &&
                        node.content[1].content?.length
                    ) {
                        columns = node.content[1].content![0].content!.reduce(
                            (columns: number, n: FidusNode) =>
                                columns +
                                ((n.attrs?.colspan as number | undefined) || 1),
                            0
                        )
                    }
                    const aligned =
                        node.attrs!.width === "100"
                            ? "left"
                            : (node.attrs!.aligned as string)
                    if (aligned === "center") {
                        start += "\n\n\\begin{center}"
                        end = "\n\n\\end{center}\n" + end
                    } else if (aligned === "right") {
                        start += "\n\n{\\raggedleft" // This is not a typo - raggedleft = aligned: right
                        end = "\n\n}\n"
                    } // aligned === 'left' is default
                    if (caption.length) {
                        start += "\n\\begin{table}\n"
                        start += `\\caption*{${caption}}\\label{${node.attrs?.id}}`
                        end = "\\end{table}\n" + end
                        this.features.captions = true
                    }
                    start += `\n\n\\begin{tabu} to ${
                        node.attrs!.width === "100"
                            ? ""
                            : Number.parseInt(node.attrs!.width as string) / 100
                    }\\textwidth { |${"X|".repeat(columns)} }\n\\hline\n\n`
                    end = "\\hline\n\n\\end{tabu}" + end
                    this.features.tables = true
                }
                break
            case "table_body":
                // Pass through to table.
                break
            case "table_caption":
                // We already deal with this in 'table'.
                return ""
            case "table_row":
                end += " \\\\\n"
                break
            case "table_cell":
            case "table_header": {
                const colspan = (node.attrs?.colspan as number | undefined) ?? 0
                const rowspan = (node.attrs?.rowspan as number | undefined) ?? 0
                if (colspan > 1) {
                    start += `\\multicolumn{${colspan}}{c}{`
                    end += "}"
                }
                // TODO: these multirow outputs don't work very well with longer text.
                // If there is another alternative, please change!
                if (rowspan > 1) {
                    start += `\\multirow{${rowspan}}{*}{`
                    end += "}"
                    this.features.rowspan = true
                }
                end += " & "
                break
            }
            case "equation":
                content += `$${node.attrs?.equation as string}$`
                break
            case "hard_break":
                if (!options.noLineBreak) {
                    content += "\n\n"
                }
                break
            default:
                break
        }

        if (node.content) {
            node.content.forEach((child: FidusNode) => {
                content += this.walkJson(child, options)
            })
        }
        if (placeFootnotesAfterBlock && options.unplacedFootnotes?.length) {
            // There are footnotes that needed to be placed behind the node.
            // This happens in the case of headlines and lists.
            end += `\\addtocounter{footnote}{-${options.unplacedFootnotes.length}}`
            options.unplacedFootnotes.forEach((footnote: FidusNode[]) => {
                end += "\\stepcounter{footnote}\n"
                end += "\\footnotetext{"
                let fnContent = ""
                footnote.forEach((footPar: FidusNode) => {
                    fnContent += this.walkJson(footPar, options)
                })
                end += fnContent.replace(/^\s+|\s+$/g, "")
                end += "}"
            })
            options.unplacedFootnotes = []
        }
        if (
            ["table_cell", "table_header"].includes(node.type) &&
            ((node.attrs?.rowspan as number | undefined) ?? 0) > 1
        ) {
            // \multirow doesn't allow multiple paragraphs.
            content = content.trim().replace(/\n\n/g, " \\\\ ")
        }

        return start + content + end
    }

    convertText(text: string): string {
        return text
    }

    // The database doesn't ensure that citation keys are unique.
    // So here we need to make sure that the same key is not used twice in one
    // document.
    createUniqueCitationKey(suggestedKey: string | undefined): string {
        suggestedKey = suggestedKey || "key"
        const usedKeys = Object.keys(this.usedBibDB).map(key => {
            return this.usedBibDB[key].entry_key
        })
        if (usedKeys.includes(suggestedKey)) {
            suggestedKey += "X"
            return this.createUniqueCitationKey(suggestedKey)
        } else {
            return suggestedKey
        }
    }

    postProcess(latex: string): string {
        return (
            latex
                // join blocks of the same type that follow oneanother.
                .replace(/\\end\{code\}\n\n\\begin\{code\}\n\n/g, "")
                .replace(/\\end\{quote\}\n\n\\begin\{quote\}\n\n/g, "")
                // Remove the last divider in any any table row.
                .replace(/& {2}\\\\/g, "\\\\")
                // Remove new lines between table cells.
                .replace(/\n & \n\n/g, " & ")
                // Remove new lines within itemization
                .replace(/\\item \n\n/g, "\\item ")
        )
    }

    assembleEpilogue(): string {
        let epilogue = ""
        if (this.features.citations) {
            const lang = this.settings.language as string
            const bibliographyHeader =
                (this.settings.bibliography_header as
                    | Record<string, string>
                    | undefined)?.[lang] ||
                (BIBLIOGRAPHY_HEADERS as Record<string, string>)[lang]
            epilogue += `\n\n\\printbibliography[title={${escapeLatexText(bibliographyHeader)}}]`
        }
        return epilogue
    }

    assembleCopyright(): string {
        let note = ""
        const copyright = this.settings.copyright as CopyrightInfo | undefined
        if (copyright) {
            if (copyright.holder) {
                note += `% © ${copyright.year ? copyright.year : new Date().getFullYear()} ${copyright.holder}\n`
            }
            if (copyright.licenses?.length) {
                copyright.licenses.forEach((license: License | string) => {
                    note +=
                        typeof license === "string"
                            ? `% ${license}\n`
                            : `% ${license.url}${license.start ? ` (${license.start})` : ""}\n`
                })
            }
        }

        if (note.length) {
            note += "\n\n"
        }
        return note
    }

    assemblePreamble(): string {
        let preamble = ""

        if (this.features.subtitle) {
            preamble += `
                \n\\usepackage{titling}
                \n\\newcommand{\\subtitle}[1]{%
                    \n\t\\posttitle{%
                        \n\t\t\\par\\end{center}
                        \n\t\t\\begin{center}\\large#1\\end{center}
                        \n\t\t\\vskip 0.5em}%
                }
            `
        }
        if (this.features.authors) {
            preamble += `
                \n\\usepackage{authblk}
                \n\\makeatletter
                \n\\let\\@fnsymbol\\@alph
                \n\\makeatother
            `
        }

        if (this.features.keywords) {
            preamble += `
                \n\\def\\keywords{\\vspace{.5em}
                \n{\\textit{Keywords}:\\,\\relax%
                \n}}
                \n\\def\\endkeywords{\\par}
                \n\\newcommand{\\sep}{, }
            `
        }

        if (this.features.hyperlinks) {
            preamble += "\n\\usepackage{hyperref}"
        }

        if (this.features.captions) {
            preamble += "\n\\usepackage{caption}"
        }

        if (this.features.wrapfig) {
            preamble += "\n\\usepackage{wrapfig}"
        }

        if (this.features.citations) {
            preamble += `
                \n\\usepackage[backend=biber,hyperref=false,citestyle=authoryear,bibstyle=authoryear]{biblatex}
                \n\\bibliography{bibliography}
            `
        }

        if (this.features.SVGs) {
            preamble += "\n\\usepackage{svg}"
        }

        if (this.features.images) {
            preamble += "\n\\usepackage{graphicx}"
            // The following scales graphics down to text width, but not scaling them up if they are smaller
            preamble += `
                \n\\usepackage{calc}
                \n\\newlength{\\imgwidth}
                \n\\newcommand\\scaledgraphics[2]{%
                \n\\settowidth{\\imgwidth}{\\includegraphics{#1}}%
                \n\\setlength{\\imgwidth}{\\minof{\\imgwidth}{#2\\textwidth}}%
                \n\\includegraphics[width=\\imgwidth,height=\\textheight,keepaspectratio]{#1}%
                \n}
            `
        }

        if (this.features.tables) {
            preamble += "\n\\usepackage{tabu}"
        }

        if (this.features.orderedListStart) {
            preamble += "\n\\usepackage{enumitem}"
        }

        if (this.features.rowspan) {
            preamble += "\n\\usepackage{multirow}"
        }

        if (this.features.code) {
            // See https://tex.stackexchange.com/questions/445424/making-a-multiline-code-environment
            preamble += `
            \n\\usepackage{xcolor}
            \\definecolor{mygray}{gray}{0.9}
            \\usepackage{fvextra}
            \\usepackage{tcolorbox}
            \\newenvironment{code}%
            {\\VerbatimEnvironment
            \\begin{tcolorbox}[colback=mygray, boxsep=0pt, arc=0pt, boxrule=0pt]
            \\begin{Verbatim}[fontsize=\\scriptsize, commandchars=\\\\\\{\\},
            breaklines, breakafter=*, breaksymbolsep=0.5em,
            breakaftersymbolpre={\\,\\tiny\\ensuremath{\\rfloor}}]}%
            {\\end{Verbatim}%
             \\end{tcolorbox}}
            `
        }

        return preamble
    }
}
