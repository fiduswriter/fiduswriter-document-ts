/**
 * All functions in this module operate on the complete docContents object.
 *
 * Ported from the DHd-Verband TEI exporter (AGPL-3.0), translated to
 * TypeScript. Front-matter detection is template-agnostic: everything that is
 * not title/contributors/tags/abstract/subtitle belongs to the body.
 * @module
 */

import type {Contributor, FidusNode} from "../../types.js"

export interface TagLists {
    contributionTypes: string[]
    keywords: string[]
    topics: string[]
}

export interface ExtractedFields {
    title: string
    subtitle: string
    authors: Contributor[]
    tags: TagLists
    abstract: FidusNode | undefined
    body: FidusNode[]
    citations: Record<string, unknown>[]
    date: string
}

function extractAuthors(docContents: FidusNode): Contributor[] {
    const authors = docContents.content
        ?.find(part => part.type === "contributors_part")
        ?.content?.filter(item => item.type === "contributor")
        .map(contributor => contributor.attrs as Contributor)
    return (authors || []) as unknown as Contributor[]
}

function extractCitations(
    node: FidusNode,
    citations: Record<string, unknown>[] = []
): Record<string, unknown>[] {
    switch (node.type) {
        case "citation":
            citations.push(
                JSON.parse(JSON.stringify(node.attrs)) as Record<string, unknown>
            )
            break
        case "footnote":
            if (Array.isArray(node.attrs?.footnote)) {
                ;(node.attrs.footnote as FidusNode[]).forEach(child =>
                    extractCitations(child, citations)
                )
            }
            break
        default:
            break
    }
    if (node.content) {
        node.content.forEach(child => extractCitations(child, citations))
    }
    return citations
}

/**
 * For every node of type 'footnote', extract the array with the actual text
 * contents. So, this returns an array of arrays.
 */
export function extractFootnotes(docContents: FidusNode): FidusNode[][] {
    const fns: FidusNode[][] = []
    const stack: FidusNode[] = [docContents]

    while (stack.length) {
        const curr = stack.pop()!
        if (curr.type === "footnote" && Array.isArray(curr.attrs?.footnote)) {
            fns.push(curr.attrs.footnote as FidusNode[])
        } else if (curr.content !== undefined) {
            for (const value of curr.content) {
                stack.push(value)
            }
        }
    }
    return fns
}

/** Collect the image ids of all figures, in document order. */
export function extractImageIDs(docContents: FidusNode): Array<string | number> {
    const images: Array<string | number> = []
    const stack: FidusNode[] = [docContents]

    while (stack.length) {
        const node = stack.pop()!
        if (node.type === "figure") {
            const ids = (node.content || [])
                .filter(child => child.type === "image")
                .map(child => child.attrs?.image)
                .filter(
                    (id): id is string | number =>
                        typeof id === "string" || typeof id === "number"
                )
            images.push(...ids)
        } else if (node.content) {
            for (const child of node.content) {
                stack.push(child)
            }
        }
    }
    return images
}

function extractTagList(docContents: FidusNode, metadata: string): string[] {
    const tags = docContents.content
        ?.find(
            part =>
                part.type === "tags_part" &&
                (part.attrs?.metadata === metadata ||
                    part.attrs?.id === metadata)
        )
        ?.content?.filter(item => item.type === "tag")
        .map(tag => tag.attrs?.tag)
    return (tags || []).filter((tag): tag is string => typeof tag === "string")
}

function extractAbstract(docContents: FidusNode): FidusNode | undefined {
    return docContents.content?.find(
        part =>
            part.type === "richtext_part" &&
            (part.attrs?.metadata === "abstract" ||
                part.attrs?.id === "abstract")
    )
}

function extractSubtitle(docContents: FidusNode): string {
    const subtitlePart = docContents.content?.find(
        part =>
            part.type === "heading_part" &&
            (part.attrs?.metadata === "subtitle" ||
                part.attrs?.id === "subtitle")
    )
    const subtitle = subtitlePart?.content
        ?.filter(item => item.type?.startsWith("heading"))
        .map(heading => heading.content || [])
        .flat()
        .filter(item => item.type === "text")
        .map(item => item.text)
        .join("")
    return subtitle || ""
}

function extractTitle(docContents: FidusNode): string {
    const title = docContents.content
        ?.find(part => part.type === "title")
        ?.content?.find(item => item.type === "text")?.text
    return title || ""
}

function isSubtitlePart(part: FidusNode): boolean {
    return (
        part.type === "heading_part" &&
        (part.attrs?.metadata === "subtitle" || part.attrs?.id === "subtitle")
    )
}

function isAbstractPart(part: FidusNode): boolean {
    return (
        part.type === "richtext_part" &&
        (part.attrs?.metadata === "abstract" || part.attrs?.id === "abstract")
    )
}

/**
 * The body consists of every part that does not carry front-matter
 * information. Unlike the original DHd exporter this does not rely on a part
 * being marked up with `id="body"` — documents built from arbitrary templates
 * may have several body parts, including heading and table parts.
 */
function extractBody(docContents: FidusNode): FidusNode[] {
    const bodyParts = (docContents.content || []).filter(part => {
        if (part.type === "title") {
            return false
        }
        if (part.type === "contributors_part") {
            return false
        }
        if (part.type === "tags_part") {
            return false
        }
        if (isAbstractPart(part) || isSubtitlePart(part)) {
            return false
        }
        return true
    })
    // Flatten the part containers so that richText() receives a plain list of
    // block nodes, exactly like the content of the original single body part.
    const blocks: FidusNode[] = []
    bodyParts.forEach(part => {
        if (part.content?.length) {
            blocks.push(...part.content)
        }
    })
    return blocks
}

function extractTextNodes(node: FidusNode, texts: FidusNode[] = []): FidusNode[] {
    if (node.type === "text") {
        texts.push(node)
    }
    node.content?.forEach(child => extractTextNodes(child, texts))
    return texts
}

/**
 * This is the main entry point of this module.
 */
export function extract(docContents: FidusNode): ExtractedFields {
    const currentDate = new Date().toISOString()

    return {
        title: extractTitle(docContents),
        subtitle: extractSubtitle(docContents),
        authors: extractAuthors(docContents),
        tags: {
            contributionTypes: extractTagList(docContents, "contributionTypes"),
            keywords: extractTagList(docContents, "keywords"),
            topics: extractTagList(docContents, "topics")
        },
        abstract: extractAbstract(docContents),
        body: extractBody(docContents),
        citations: extractCitations(docContents),
        date: currentDate
    }
}

export {extractCitations, extractTextNodes}
