/**
 * Escaping helpers for Typst markup output.
 * @module
 */

/**
 * Characters with a special meaning in Typst markup. A backslash before any
 * of them produces the literal character.
 */
const ESCAPE_CHARS = new Set([
    "\\",
    "#",
    "$",
    "_",
    "*",
    "`",
    "[",
    "]",
    "<",
    ">",
    "@",
    "~",
    '"'
])

/**
 * Escape inline text so that it survives a Typst round-trip.
 *
 * @param escapeLeading also escape a leading block-marker character; pass
 *   true for text that starts a paragraph, where `=`, `-`, `+`, `/` or a
 *   numbered list marker would otherwise be parsed as block syntax.
 */
export function escapeTypstText(text: string, escapeLeading = false): string {
    let escaped = ""
    for (let index = 0; index < text.length; index++) {
        const char = text[index]
        if (ESCAPE_CHARS.has(char)) {
            escaped += `\\${char}`
        } else if (
            escapeLeading &&
            index === 0 &&
            (char === "=" || char === "-" || char === "+" || char === "/")
        ) {
            escaped += `\\${char}`
        } else if (
            escapeLeading &&
            (index === 0 || (index === 1 && /[0-9]/.test(text[0]))) &&
            (char === "." || char === ")") &&
            /[0-9]/.test(text[index - 1])
        ) {
            // A leading `1.`/`1)` would start an enumerated list.
            escaped += `\\${char}`
        } else {
            escaped += char
        }
    }
    return escaped
}

/** Escape a string for use inside `"..."` in Typst code mode. */
export function escapeTypstString(value: string): string {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/** Escape text for use inside a `[...]` content block. */
export function escapeTypstContent(value: string): string {
    return escapeTypstText(value).replace(/\n/g, " ")
}

/**
 * Turn a code string into a fenced code block. Backtick fences are used;
 * the fence length is raised when the code contains backtick runs so that
 * it cannot break out.
 */
export function fenceCode(
    code: string,
    fenceLength?: number
): {fence: string; content: string} {
    const longestRun = code.match(/`{3,}/g)?.reduce(
        (longest, run) => Math.max(longest, run.length),
        3
    )
    const length = Math.max(3, (longestRun || 3) + 1, fenceLength || 0)
    return {
        fence: "`".repeat(length),
        content: code.endsWith("\n") ? code : `${code}\n`
    }
}

/** Turn an arbitrary id into a valid Typst label reference name. */
export function labelName(id: string): string {
    return String(id)
        .trim()
        .replace(/[^A-Za-z0-9:._-]/g, "-")
        .replace(/^[^A-Za-z]/, match => `L${match}`)
}
