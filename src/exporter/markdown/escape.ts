/**
 * Escaping helpers for pandoc-flavoured markdown output.
 * @module
 */

/**
 * Characters that pandoc's own markdown writer escapes. Escaping them
 * unconditionally is safe: a backslash before any punctuation is dropped
 * again when the text is read back.
 */
const ESCAPE_CHARS = new Set([
    "\\",
    "*",
    "_",
    "[",
    "]",
    "~",
    "^",
    "|",
    "$",
    "<",
    ">",
    '"',
    "`"
])

/**
 * Escape a piece of inline text so that it survives a pandoc `markdown`
 * round-trip.
 *
 * @param escapeLeading also escape a leading `#` or `-`; pass true for the
 *   first inline node of a block, where those characters would otherwise turn
 *   the paragraph into a heading or list.
 */
export function escapeMarkdownText(
    text: string,
    escapeLeading = false
): string {
    let escaped = ""
    for (let index = 0; index < text.length; index++) {
        const char = text[index]
        if (ESCAPE_CHARS.has(char)) {
            escaped += `\\${char}`
        } else if (
            escapeLeading &&
            index === 0 &&
            (char === "#" || char === "-" || char === "+")
        ) {
            escaped += `\\${char}`
        } else {
            escaped += char
        }
    }
    return escaped
}

/** Escape an attribute value for use inside `{#id key="value"}` attributes. */
export function escapeAttribute(value: string): string {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/**
 * Turn a code string into the content of a fenced code block. Tilde fences
 * are used so that code containing backticks (and even triple backticks) can
 * not break out of the fence.
 */
export function fenceCode(code: string, fenceLength?: number): {
    fence: string
    content: string
} {
    const longestRun = code.match(/~{3,}/g)?.reduce(
        (longest, run) => Math.max(longest, run.length),
        3
    )
    const length = Math.max(3, (longestRun || 3) + 1, fenceLength || 0)
    return {
        fence: "~".repeat(length),
        content: code.endsWith("\n") ? code : `${code}\n`
    }
}

/** Escape text for use inside a pipe table cell (pipes and newlines). */
export function escapeTableCell(text: string): string {
    return escapeMarkdownText(text).replace(/\n/g, " ")
}
