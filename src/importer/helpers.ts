import type {FidusNode} from "../types.js"

function textContent(node: FidusNode): string {
    let text = node.text || ""
    if (node.content) {
        node.content.forEach(child => {
            text += textContent(child)
        })
    }
    return text
}

/**
 * Flatten converted inline content to plain text nodes. Used for document
 * titles, which in the schema may only contain text nodes.
 */
export function inlineToPlainText(
    nodes: FidusNode[] | undefined
): FidusNode[] {
    const text = (nodes || []).map(node => textContent(node)).join("")
    return text ? [{type: "text", text}] : []
}
