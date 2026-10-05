/**
 * YAML front matter for markdown export.
 *
 * The front matter carries the document metadata in pandoc's meta block
 * format: title, subtitle, authors, date, keywords, abstract, copyright and a
 * `tags` map with the non-standard tag lists. All of it round-trips through
 * pandoc's `markdown` reader as documented in the pandoc manual.
 * @module
 */

import {escapeText} from "fwtoolkit"
import type {Contributor, DocSettings, FidusNode} from "../../types.js"

export interface ExtractedMetadata {
    title: string
    subtitle: string
    authors: Contributor[]
    keywords: string[]
    tags: {contributionTypes: string[]; topics: string[]}
    abstract: FidusNode | undefined
    settings: DocSettings
}

/** Collect the front-matter pieces from the document content. */
export function extractMetadata(docContent: FidusNode): ExtractedMetadata {
    const parts = docContent.content || []
    const title =
        parts
            .find(part => part.type === "title")
            ?.content?.find(item => item.type === "text")?.text || ""
    const subtitlePart = parts.find(
        part =>
            part.type === "heading_part" &&
            (part.attrs?.metadata === "subtitle" || part.attrs?.id === "subtitle")
    )
    const subtitle =
        subtitlePart?.content
            ?.filter(item => item.type?.startsWith("heading"))
            .flatMap(heading => heading.content || [])
            .filter(item => item.type === "text")
            .map(item => item.text)
            .join("") || ""
    const authors = parts
        .find(part => part.type === "contributors_part")
        ?.content?.filter(item => item.type === "contributor")
        .map(contributor => contributor.attrs as Contributor) || []
    const keywordPart = parts.find(
        part =>
            part.type === "tags_part" &&
            (part.attrs?.metadata === "keywords" || part.attrs?.id === "keywords")
    )
    const keywords = keywordPart?.content
        ?.filter(item => item.type === "tag")
        .map(tag => tag.attrs?.tag)
        .filter((tag): tag is string => typeof tag === "string") || []
    const contributionTypes = collectTagList(parts, "contributionTypes")
    const topics = collectTagList(parts, "topics")
    const abstract = parts.find(
        part =>
            part.type === "richtext_part" &&
            (part.attrs?.metadata === "abstract" || part.attrs?.id === "abstract")
    )
    return {
        title,
        subtitle,
        authors,
        keywords,
        tags: {contributionTypes, topics},
        abstract,
        settings: (docContent.attrs || {}) as DocSettings
    }
}

function collectTagList(parts: FidusNode[], metadata: string): string[] {
    const part = parts.find(
        part =>
            part.type === "tags_part" &&
            (part.attrs?.metadata === metadata || part.attrs?.id === metadata)
    )
    return (
        part?.content
            ?.filter(item => item.type === "tag")
            .map(tag => tag.attrs?.tag)
            .filter((tag): tag is string => typeof tag === "string") || []
    )
}

/** Quote a string as a double-quoted YAML scalar. */
function yamlString(value: string): string {
    return `"${String(value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")}"`
}

/** Render a flow sequence of strings: `[a, b]`. */
function yamlStringList(values: string[]): string {
    return `[${values.map(yamlString).join(", ")}]`
}

/**
 * Render a block scalar for multi-line text. Empty text becomes an empty
 * quoted string.
 */
function yamlBlockScalar(lines: string[], indent: string): string {
    const nonEmpty = lines.filter(line => line.trim().length)
    if (!nonEmpty.length) {
        return `""`
    }
    return `|\n${lines.map(line => `${indent}${line}`).join("\n")}`
}

function copyrightLine(settings: DocSettings): string | false {
    const copyright = settings.copyright as
        | {holder?: string | false; year?: number | false}
        | undefined
    if (!copyright?.holder) {
        return false
    }
    const year = copyright.year ? `${copyright.year} ` : ""
    return `© ${year}${copyright.holder}`
}

/**
 * Assemble the YAML front matter block (including the `---` fences).
 *
 * @param blocksToMarkdown renders the abstract part's block content to
 *   markdown text.
 */
export function assembleFrontMatter(
    metadata: ExtractedMetadata,
    blocksToMarkdown: (nodes: FidusNode[]) => string
): string {
    const lines: string[] = ["---"]
    lines.push(`title: ${yamlString(metadata.title)}`)
    if (metadata.subtitle) {
        lines.push(`subtitle: ${yamlString(metadata.subtitle)}`)
    }
    if (metadata.authors.length) {
        lines.push("author:")
        metadata.authors.forEach(author => {
            const name = [author.firstname, author.lastname]
                .filter(name => name)
                .join(" ")
            const entries: string[] = []
            if (name) {
                entries.push(`name: ${yamlString(name)}`)
            }
            if (author.institution) {
                entries.push(`affiliation: ${yamlString(author.institution)}`)
            }
            if (author.email) {
                entries.push(`email: ${yamlString(author.email)}`)
            }
            if (author.id_type === "ORCID" && author.id_value) {
                entries.push(`orcid: ${yamlString(author.id_value)}`)
            }
            if (entries.length) {
                lines.push(`  - ${entries[0]}`)
                entries.slice(1).forEach(entry => lines.push(`    ${entry}`))
            }
        })
    }
    const date = metadata.settings.date
    if (typeof date === "string" || typeof date === "number") {
        lines.push(`date: ${yamlString(String(date))}`)
    }
    if (metadata.keywords.length) {
        lines.push(`keywords: ${yamlStringList(metadata.keywords)}`)
    }
    const copyright = copyrightLine(metadata.settings)
    if (copyright) {
        lines.push(`copyright: ${yamlString(copyright)}`)
    }
    if (
        metadata.tags.contributionTypes.length ||
        metadata.tags.topics.length
    ) {
        lines.push("tags:")
        if (metadata.tags.contributionTypes.length) {
            lines.push(
                `  contributionTypes: ${yamlStringList(metadata.tags.contributionTypes)}`
            )
        }
        if (metadata.tags.topics.length) {
            lines.push(`  topics: ${yamlStringList(metadata.tags.topics)}`)
        }
    }
    if (metadata.abstract?.content?.length) {
        // The abstract paragraphs as markdown text.
        const abstractText = blocksToMarkdown(metadata.abstract.content)
        lines.push(
            `abstract: ${yamlBlockScalar(abstractText.split("\n"), "  ")}`
        )
    }
    lines.push("---")
    return `${lines.join("\n")}\n`
}

/** Localized "Bibliography" heading fallback used by the references div. */
export function bibliographyTitle(language: string): string {
    return escapeText(language)
}
