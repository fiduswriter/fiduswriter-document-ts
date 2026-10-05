/**
 * Inline HTML → Fidus inline nodes.
 * @module
 */

import {convertDataURIToBlob} from "fwtoolkit"
import {MathMLToLaTeX} from "mathml-to-latex"

import type {BibDB, FidusMark, FidusNode} from "../../types.js"

import type {HtmlElement, HtmlNode} from "./dom.js"
import {attr, hasClass, isElement, queryOne, textOf} from "./dom.js"
import {convertBlocks} from "./blocks.js"

/** Shared state threaded through the inline and block converters. */
export interface ConvertContext {
    templateParts: FidusNode[]
    /** Footnote asides keyed by the id referenced by the marker href. */
    footnotes: Map<string, HtmlElement>
    bibDB: BibDB
    /** The image database being assembled (numeric ids). */
    images: Record<string | number, Record<string, unknown>>
    /** Files handed to the native importer (blobs or URLs to fetch). */
    otherFiles: Array<{filename: string; content?: Blob; url?: string}>
    /** Image blobs available in the imported zip bundle. */
    zipImages: Record<string, Blob>
    language: string
}

const WHITESPACE = /\s+/g

/** Collapse HTML whitespace runs to single spaces. */
function normalizeText(text: string): string {
    return text.replace(WHITESPACE, " ")
}

/** Marks for the elements that map 1:1 onto Fidus marks. */
const MARK_ELEMENTS: Record<string, string> = {
    strong: "strong",
    b: "strong",
    em: "em",
    i: "em",
    sup: "sup",
    sub: "sub",
    ins: "insertion",
    del: "deletion"
}

/**
 * Convert a list of HTML nodes (mixed text/elements) to Fidus inline nodes.
 *
 * `marks` carries the marks inherited from enclosing elements. Anchor spans
 * are empty in the HTML output; their mark is attached to the next inline
 * node that is produced.
 *
 * At block level (`trimEdges`), leading/trailing whitespace of the produced
 * inline list is removed — matching HTML's whitespace handling, where
 * whitespace at the start and end of a block is not rendered.
 */
export function convertInlines(
    nodes: HtmlNode[],
    marks: FidusMark[],
    context: ConvertContext,
    trimEdges = false
): FidusNode[] {
    const output: FidusNode[] = []
    let pendingAnchor: FidusMark | undefined

    const pushNode = (node: FidusNode): void => {
        if (pendingAnchor && node.type === "text") {
            node.marks = [...(node.marks || []), pendingAnchor]
            pendingAnchor = undefined
        }
        const previous = output[output.length - 1]
        if (
            previous &&
            node.type === "text" &&
            previous.type === "text" &&
            JSON.stringify(previous.marks || []) ===
                JSON.stringify(node.marks || [])
        ) {
            previous.text = (previous.text || "") + (node.text || "")
            return
        }
        output.push(node)
    }

    nodes.forEach(node => {
        if (!isElement(node)) {
            const normalized = normalizeText(node.text || "")
            if (normalized.length) {
                pushNode(
                    marks.length
                        ? {type: "text", text: normalized, marks}
                        : {type: "text", text: normalized}
                )
            }
            return
        }

        const tagName = node.tagName.toLowerCase()

        // Empty anchor spans: remember the mark for the next inline node.
        if (hasClass(node, "anchor")) {
            pendingAnchor = {
                type: "anchor",
                attrs: {id: attr(node, "data-id") || attr(node, "id")}
            }
            return
        }

        // Citations with restorable references.
        if (hasClass(node, "citation")) {
            const citation = convertCitation(node, context)
            if (citation) {
                pushNode(citation)
            }
            return
        }

        // Cross references.
        if (hasClass(node, "reference") && tagName === "a") {
            const href = attr(node, "href")
            pushNode({
                type: "cross_reference",
                attrs: {
                    id: href.startsWith("#") ? href.slice(1) : href,
                    title: textOf(node).trim()
                }
            })
            return
        }

        // Footnote markers.
        if (hasClass(node, "footnote") && tagName === "a") {
            const href = attr(node, "href")
            const footnoteId = href.startsWith("#") ? href.slice(1) : href
            const aside = context.footnotes.get(footnoteId)
            if (aside) {
                pushNode({
                    type: "footnote",
                    attrs: {
                        footnote: convertBlocks(aside, context, true)
                    }
                })
                return
            }
            // Unknown footnote target: keep the marker text.
            pushNode({type: "text", text: normalizeText(textOf(node))})
            return
        }

        // Bibliography links without a citation span wrapper (older
        // exports): keep the rendered text.
        if (hasClass(node, "bibliography") && tagName === "a") {
            pushNode({type: "text", text: normalizeText(textOf(node))})
            return
        }

        // Equations.
        if (hasClass(node, "equation")) {
            const equation = convertEquation(node)
            if (equation) {
                pushNode(equation)
            }
            return
        }

        // Bare <math> element (equation without the Fidus span wrapper).
        if (tagName === "math") {
            pushNode({
                type: "equation",
                attrs: {equation: MathMLToLaTeX.convert(node.outerHTML)}
            })
            return
        }

        // Hard line breaks.
        if (tagName === "br") {
            pushNode({type: "hard_break"})
            return
        }

        // Underline / code spans.
        if (hasClass(node, "underline")) {
            output.push(
                ...convertInlines(
                    node.childNodes,
                    [...marks, {type: "underline"}],
                    context
                )
            )
            return
        }
        if (tagName === "code") {
            output.push(
                ...convertInlines(
                    node.childNodes,
                    [...marks, {type: "code"}],
                    context
                )
            )
            return
        }

        const markType = MARK_ELEMENTS[tagName]
        if (markType) {
            output.push(
                ...convertInlines(
                    node.childNodes,
                    [...marks, {type: markType}],
                    context
                )
            )
            return
        }

        // Links.
        if (tagName === "a") {
            const href = attr(node, "href")
            if (href) {
                const linkAttrs: Record<string, string> = {href}
                const title = attr(node, "title")
                if (title) {
                    linkAttrs.title = title
                }
                output.push(
                    ...convertInlines(
                        node.childNodes,
                        [...marks, {type: "link", attrs: linkAttrs}],
                        context
                    )
                )
                return
            }
        }

        // Standalone images outside a figure: treat as caption-less figures.
        if (tagName === "img") {
            const imageNode = convertImage(node, context)
            if (imageNode) {
                pushNode({
                    type: "figure",
                    attrs: {
                        id: "",
                        aligned: "inline",
                        width: "100",
                        caption: false,
                        category: "none"
                    },
                    content: [imageNode]
                })
            }
            return
        }

        // Everything else (plain spans, small, mark, unknown elements):
        // recurse transparently.
        output.push(...convertInlines(node.childNodes, marks, context))
    })

    if (trimEdges) {
        trimEdgeWhitespace(output, true)
        trimEdgeWhitespace(output, false)
    }

    return output
}

/** Trim leading (or trailing) whitespace at the edge of an inline list. */
function trimEdgeWhitespace(nodes: FidusNode[], leading: boolean): void {
    let index = 0
    while (nodes.length && index < nodes.length) {
        const node = nodes[leading ? index : nodes.length - 1 - index]
        if (node.type !== "text") {
            return
        }
        const trimmed = leading
            ? (node.text || "").replace(/^\s+/, "")
            : (node.text || "").replace(/\s+$/, "")
        if (!trimmed.length) {
            nodes.splice(leading ? index : nodes.length - 1 - index, 1)
            continue
        }
        node.text = trimmed
        return
    }
}

/** Restore an inline equation node from a span.equation element. */
export function convertEquation(node: HtmlElement): FidusNode | undefined {
    const dataEquation = attr(node, "data-equation")
    if (dataEquation) {
        return {type: "equation", attrs: {equation: dataEquation}}
    }
    const math = queryOne(node, "math")
    if (math) {
        return {
            type: "equation",
            attrs: {equation: MathMLToLaTeX.convert(math.outerHTML)}
        }
    }
    return undefined
}

/**
 * Restore a citation node from a span.citation element. The references are
 * only restored when the accompanying bibliography database contains the
 * referenced entries; otherwise the rendered text is kept as plain text.
 */
function convertCitation(
    node: HtmlElement,
    context: ConvertContext
): FidusNode | undefined {
    const dataReferences = attr(node, "data-references")
    const format = attr(node, "data-format") || "autocite"
    if (dataReferences) {
        const references = dataReferences
            .split(",")
            .map(id => id.trim())
            .filter(id => id && context.bibDB.db[id])
            .map(id => ({id}))
        if (references.length) {
            return {
                type: "citation",
                attrs: {references, format}
            }
        }
    }
    // Fall back to the rendered citation text.
    const rendered = normalizeText(textOf(node)).trim()
    if (rendered.length) {
        return {type: "text", text: rendered}
    }
    return undefined
}

/**
 * Convert an `<img>` element into an image node, registering the image in
 * the image database being assembled by the converter.
 *
 * Sources are handled in three ways: zip bundle paths become blob file
 * entries, data URIs are decoded immediately, and remote/relative URLs are
 * registered as URL entries for the native importer to fetch.
 */
export function convertImage(
    node: HtmlElement,
    context: ConvertContext,
    extraAttrs: Record<string, unknown> = {}
): FidusNode | undefined {
    const src = attr(node, "src")
    if (!src) {
        return undefined
    }
    const imageId = Math.floor(Math.random() * 1000000)
    let imageRef: string
    let fileType: string

    if (src.startsWith("data:")) {
        const blob = convertDataURIToBlob(src)
        const extension = (blob.type.split("/")[1] || "png").split("+")[0]
        imageRef = `images/image-${imageId}.${extension}`
        fileType = blob.type
        context.otherFiles.push({filename: imageRef, content: blob})
    } else if (context.zipImages[src]) {
        imageRef = src
        fileType = `image/${(src.split(".").pop() || "png").toLowerCase()}`
        context.otherFiles.push({
            filename: src,
            content: context.zipImages[src]
        })
    } else {
        const basename = decodeURIComponent(src.split("/").pop() || src)
        imageRef = `images/${basename}`
        fileType = `image/${(basename.split(".").pop() || "png").toLowerCase()}`
        context.otherFiles.push({filename: imageRef, url: src})
    }

    const title = decodeURIComponent(src.split("/").pop() || src)
    context.images[imageId] = {
        id: imageId,
        title,
        copyright: {
            holder: false,
            year: false,
            freeToRead: true,
            licenses: []
        },
        image: imageRef,
        file_type: fileType,
        file: null,
        checksum: 0
    }

    return {
        type: "image",
        attrs: Object.assign({image: imageId}, extraAttrs)
    }
}
