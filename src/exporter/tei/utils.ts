/**
 * Small helpers to build strings of TEI XML markup.
 *
 * Ported from the DHd-Verband TEI exporter (AGPL-3.0), translated to
 * TypeScript and extended with attribute escaping.
 * @module
 */

/**
 * Escape a string for use inside an XML text node. Quotes are left as-is,
 * which is safe for text nodes but not for attribute values — use
 * `escapeAttribute` there.
 */
export function escapeXmlText(text: string): string {
    return String(text).replace(/[<>&]/g, char => {
        switch (char) {
            case "<":
                return "&lt;"
            case ">":
                return "&gt;"
            case "&":
                return "&amp;"
            default:
                return char
        }
    })
}

/** Escape a string for use inside a double-quoted XML attribute value. */
export function escapeAttribute(value: string): string {
    return escapeXmlText(String(value)).replace(/"/g, "&quot;")
}

/**
 * Create a string of an empty XML tag, e.g. `<lb />`.
 */
export function tag(tagName: string, attrs: Record<string, string | number> = {}): string {
    const attributes = Object.entries(attrs)
        .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
        .join(" ")
    if (attributes.length) {
        return `<${tagName} ${attributes} />`
    }
    return `<${tagName} />`
}

/**
 * Wrap content in a string with opening and closing XML tags.
 */
export function wrap(
    tagName: string,
    content: string,
    attrs: Record<string, string | number> = {}
): string {
    const attributes = Object.entries(attrs)
        .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
        .join(" ")
    const openTag = attributes.length
        ? `<${tagName} ${attributes}>`
        : `<${tagName}>`
    return `${openTag}${content}</${tagName}>`
}

/**
 * Convenience function to wrap elements where only text is expected.
 */
export function wrapText(
    tagName: string,
    content: string,
    attrs: Record<string, string | number> = {}
): string {
    return wrap(tagName, escapeXmlText(content), attrs)
}

/** External link reference carrying the visible text. */
export function linkRef(target: string, text: string): string {
    return wrap("ref", text, {target})
}

/** External link reference without visible text. */
export function linkPtr(target: string): string {
    return tag("ptr", {target})
}

const LINK_REGEX = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/gi
// https://www.crossref.org/blog/dois-and-matching-regular-expressions/
const DOI_REGEX = /doi:(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i
const TRAILING = /[.,]$/

/**
 * Turn URLs and DOIs in plain text into TEI `<ref>` elements.
 */
export function linkify(text: string): string {
    const linkified = text.replace(LINK_REGEX, url => linkRef(url, url))
    return linkified.replace(DOI_REGEX, (_substring, doiGroup: string) => {
        const trailing = doiGroup.match(TRAILING)
        if (trailing) {
            const url = `https://doi.org/${doiGroup.replace(TRAILING, "")}`
            return linkRef(url, url) + trailing[0]
        }
        const url = `https://doi.org/${doiGroup}`
        return linkRef(url, url)
    })
}
