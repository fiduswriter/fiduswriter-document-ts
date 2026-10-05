/**
 * Thin adapter around the HTML parser used by the HTML importer.
 *
 * `node-html-parser` parses HTML the same way in the browser and in Node,
 * with a tolerant HTML5-compatible tree construction, so no DOMParser is
 * needed. The adapter exposes only the small DOM surface the converter needs.
 * @module
 */

import {parse} from "node-html-parser"
import type {HTMLElement} from "node-html-parser"

export interface HtmlElement {
    tagName: string
    attributes: Record<string, string>
    childNodes: HtmlNode[]
    outerHTML: string
}

export type HtmlNode = HtmlElement | {tagName?: undefined; text?: string}

export function isElement(node: HtmlNode): node is HtmlElement {
    return typeof (node as HtmlElement).tagName === "string"
}

export function parseHtml(html: string): HtmlElement {
    const root = parse(html, {
        lowerCaseTagName: true,
        comment: false,
        blockTextElements: {
            script: true,
            noscript: false,
            style: true,
            pre: true
        }
    })
    return wrapNode(root) as HtmlElement
}

type ParserNode = HTMLElement | {nodeType: number; rawText: string}

export function wrapNode(node: ParserNode): HtmlNode {
    if (node.nodeType === 3) {
        // Text node
        return {text: (node as {rawText: string}).rawText}
    }
    const element = node as HTMLElement
    return {
        tagName: (element.rawTagName || "").toLowerCase(),
        attributes: {...element.attributes},
        childNodes: element.childNodes.map(childNode =>
            wrapNode(childNode as ParserNode)
        ),
        outerHTML: element.outerHTML
    }
}

/** Element children only (skips whitespace text nodes). */
export function elementChildren(node: HtmlElement): HtmlElement[] {
    return node.childNodes.filter(isElement)
}

/** Get an attribute, falling back to an empty string. */
export function attr(node: HtmlElement, name: string): string {
    const value = node.attributes[name]
    return typeof value === "string" ? value : ""
}

/** Whether an element has one of the given classes. */
export function hasClass(node: HtmlElement, className: string): boolean {
    return attr(node, "class")
        .split(/\s+/)
        .filter(Boolean)
        .includes(className)
}

/** The class list of an element. */
export function classList(node: HtmlElement): string[] {
    return attr(node, "class").split(/\s+/).filter(Boolean)
}

/** A minimal selector: `tag`, `tag#id`, `tag.class`, `#id` or `.class`. */
interface ParsedSelector {
    tagName: string
    id?: string
    className?: string
}

export function parseSelector(selector: string): ParsedSelector {
    let tagName = "*"
    let id: string | undefined
    let className: string | undefined
    const hashIndex = selector.indexOf("#")
    const dotIndex = selector.indexOf(".")
    if (hashIndex >= 0 || dotIndex >= 0) {
        const firstSpecial =
            hashIndex >= 0 && (dotIndex < 0 || hashIndex < dotIndex)
                ? hashIndex
                : dotIndex
        const tagPart = selector.slice(0, firstSpecial)
        const rest = selector.slice(firstSpecial)
        tagName = tagPart || tagName
        if (rest.startsWith("#")) {
            id = rest.slice(1)
        } else if (rest.startsWith(".")) {
            className = rest.slice(1)
        }
        if (rest.length && !rest.startsWith("#") && !rest.startsWith(".")) {
            // Unrecognized remainder: fall back to a plain tag match.
            tagName = selector
            id = undefined
            className = undefined
        }
    } else {
        tagName = selector
    }
    return {tagName, id, className}
}

function matchesSelector(node: HtmlElement, selector: ParsedSelector): boolean {
    if (selector.tagName !== "*" && node.tagName !== selector.tagName) {
        return false
    }
    if (selector.id && !matchesId(node, selector.id)) {
        return false
    }
    if (selector.className && !hasClass(node, selector.className)) {
        return false
    }
    return true
}

/**
 * Direct and indirect element children matching the selector, in document
 * order. Supported selectors: `tag`, `tag#id`, `tag.class`, `#id`,
 * `.class`, `*`.
 */
export function queryAll(node: HtmlElement, selector: string): HtmlElement[] {
    const parsed = parseSelector(selector)
    const result: HtmlElement[] = []
    const walk = (current: HtmlElement): void => {
        elementChildren(current).forEach(child => {
            if (matchesSelector(child, parsed)) {
                result.push(child)
            }
            walk(child)
        })
    }
    walk(node)
    return result
}

/** First descendant matching the selector, or null. */
export function queryOne(
    node: HtmlElement,
    selector: string
): HtmlElement | null {
    return queryAll(node, selector)[0] || null
}

/**
 * The concatenated text of a subtree, treating `<br>` elements as line
 * breaks. Script/style text is excluded.
 */
export function textOf(node: HtmlElement): string {
    let text = ""
    node.childNodes.forEach(child => {
        if (!isElement(child)) {
            text += child.text || ""
            return
        }
        if (child.tagName === "script" || child.tagName === "style") {
            return
        }
        if (child.tagName === "br") {
            text += "\n"
            return
        }
        text += textOf(child)
    })
    return text
}

/**
 * Whether an element matches a reserved structural id, tolerating the
 * `idPrefix` the HTML exporter may have added in front of it.
 */
export function matchesId(node: HtmlElement, id: string): boolean {
    const actual = attr(node, "id")
    return actual === id || (actual.length > id.length && actual.endsWith(id))
}
