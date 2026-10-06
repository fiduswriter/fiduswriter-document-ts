/**
 * Fidus Writer HTML → Fidus document converter.
 *
 * Understands the HTML the HTML export filter writes (div.doc-part wrappers,
 * aside.footnote back matter, span.citation/data-references, MathML or
 * data-equation math) and degrades gracefully to generic HTML. Parts are
 * matched against the host template by metadata and id, in the same way the
 * ODT and pandoc importers do it.
 * @module
 */
import { parseHtml } from "./dom.js";
import { attr, classList, elementChildren, hasClass, isElement, matchesId, queryAll, queryOne, textOf } from "./dom.js";
import { convertBlock, convertBlocks } from "./blocks.js";
import { convertInlines } from "./inline.js";
/** Class names that carry the part type in the HTML export. */
const PART_TYPE_CLASSES = {
    "doc-title": "title",
    "doc-contributors": "contributors_part",
    "doc-tags": "tags_part",
    "doc-richtext": "richtext_part",
    "doc-heading": "heading_part",
    "doc-table": "table_part"
};
const RESERVED_IDS = [
    "title",
    "body",
    "back",
    "affiliations",
    "footnotes",
    "references"
];
export class HtmlConvert {
    html;
    importId;
    template;
    bibDB;
    zipImages;
    // Convert context and outputs.
    images;
    otherFiles;
    footnotes;
    affiliations;
    constructor(html, importId, template, bibDB = { db: {} }, zipImages = {}) {
        this.html = html;
        this.importId = importId;
        this.template = template;
        this.bibDB = bibDB;
        this.zipImages = zipImages;
        this.images = {};
        this.otherFiles = [];
        this.footnotes = new Map();
        this.affiliations = new Map();
    }
    init() {
        const root = parseHtml(this.html);
        const body = queryOne(root, "body") || root;
        const language = attr(root, "lang") || "en-US";
        this.harvestBackMatter(body);
        const contentDiv = queryOne(body, "div#body") || null;
        const parts = this.walkBody(contentDiv || body, language);
        const titleNode = parts.find(part => part.type === "title") ||
            { type: "title", content: [] };
        const contentParts = parts.filter(part => part !== titleNode);
        const document = {
            type: "doc",
            attrs: {
                import_id: this.importId,
                language
            },
            content: [titleNode, ...contentParts]
        };
        return {
            content: document,
            settings: {
                import_id: this.importId,
                tracked: false,
                language
            },
            comments: {},
            images: this.images,
            otherFiles: this.otherFiles
        };
    }
    /**
     * Collect the footnote asides and affiliations from the `#back` section
     * (or anywhere in the document, for foreign HTML).
     */
    harvestBackMatter(body) {
        queryAll(body, "aside")
            .filter(aside => hasClass(aside, "footnote"))
            .forEach(aside => {
            const id = attr(aside, "id");
            if (id) {
                this.footnotes.set(id, aside);
            }
        });
        const affiliations = elementChildren(body).find(child => child.tagName === "div" && matchesId(child, "back"));
        const affiliationSection = (affiliations && queryOne(affiliations, "section#affiliations")) ||
            queryOne(body, "section#affiliations");
        if (affiliationSection) {
            queryAll(affiliationSection, "aside").forEach(aside => {
                const id = attr(aside, "id");
                if (!id) {
                    return;
                }
                // The institution name is in the <div>; the <label> holds the
                // affiliation number.
                const nameDiv = queryOne(aside, "div");
                if (nameDiv) {
                    this.affiliations.set(id, textOf(nameDiv).trim());
                }
            });
        }
    }
    /** Walk the body content, producing the document's parts in order. */
    walkBody(container, language) {
        const context = {
            templateParts: this.templateParts(),
            footnotes: this.footnotes,
            bibDB: this.bibDB,
            images: this.images,
            otherFiles: this.otherFiles,
            zipImages: this.zipImages,
            imageIdsBySrc: new Map(),
            language
        };
        const parts = [];
        const pendingBody = [];
        let sawBackMatter = false;
        container.childNodes.forEach(node => {
            if (!isElement(node)) {
                return;
            }
            const tagName = node.tagName.toLowerCase();
            // Stop at the back matter; everything after it (copyright and
            // licence divs) is generated content.
            if (tagName === "div" && matchesId(node, "back")) {
                sawBackMatter = true;
                return;
            }
            if (sawBackMatter) {
                return;
            }
            if (tagName === "hr" && hasClass(node, "doc-part")) {
                parts.push(this.separatorPart(node));
                return;
            }
            if (tagName === "div" && classList(node).includes("table-of-contents")) {
                // Generated table of contents: skipped on import.
                return;
            }
            if (tagName === "div" && hasClass(node, "doc-part")) {
                const part = this.convertPart(node, context);
                if (part) {
                    parts.push(part);
                }
                return;
            }
            // Content outside any part: collect for the default body part.
            pendingBody.push(...convertBlock(node, context));
        });
        if (pendingBody.length) {
            parts.push(this.bodyPart(pendingBody));
        }
        return this.mergeSiblingParts(parts);
    }
    /**
     * Merge directly adjacent richtext parts that resolve to the same
     * template part (a document exported from an older schema can contain
     * several heading parts that all fall back to the body part).
     */
    mergeSiblingParts(parts) {
        const merged = [];
        parts.forEach(part => {
            const previous = merged[merged.length - 1];
            if (part.type === "richtext_part" &&
                previous &&
                previous.type === "richtext_part" &&
                previous.attrs?.id ===
                    part.attrs?.id) {
                previous.content = [
                    ...(previous.content || []),
                    ...(part.content || [])
                ];
                return;
            }
            merged.push(part);
        });
        return merged;
    }
    templateParts() {
        const content = this.template?.content?.content;
        if (!Array.isArray(content)) {
            return [];
        }
        return content.slice(1);
    }
    /** Find the template part matching a metadata value. */
    findTemplatePart(metadata, type) {
        const parts = this.templateParts();
        if (metadata) {
            const byMetadata = parts.find(part => part.attrs?.metadata === metadata);
            if (byMetadata) {
                return byMetadata;
            }
        }
        if (type) {
            return parts.find(part => part.type === type && !part.attrs?.metadata);
        }
        return undefined;
    }
    /** Default body template part (richtext_part without metadata). */
    bodyTemplatePart() {
        return this.templateParts().find(part => part.type === "richtext_part" && !part.attrs?.metadata);
    }
    partAttrsFromTemplate(templatePart, htmlAttrs, overrides = {}) {
        const attrs = {
            ...(templatePart?.attrs || {}),
            ...overrides
        };
        // The HTML part id wins unless it is missing or the literal
        // "undefined" the exporter writes for parts without an id.
        if (!attrs.id || attrs.id === "undefined") {
            attrs.id =
                htmlAttrs.id && htmlAttrs.id !== "undefined"
                    ? htmlAttrs.id
                    : templatePart?.attrs?.id || "";
        }
        if (!attrs.metadata) {
            attrs.metadata =
                htmlAttrs.metadata && htmlAttrs.metadata !== "other"
                    ? htmlAttrs.metadata
                    : templatePart?.attrs?.metadata || "";
        }
        if (!attrs.language && htmlAttrs.language) {
            attrs.language = htmlAttrs.language;
        }
        return attrs;
    }
    /** Read the part type/metadata/id from a doc-part div. */
    classifyPart(node) {
        const classes = classList(node);
        let partType = "richtext_part";
        Object.entries(PART_TYPE_CLASSES).forEach(([className, type]) => {
            if (classes.includes(className)) {
                partType = type;
            }
        });
        let metadata = attr(node, "data-metadata");
        if (!metadata) {
            // Fall back to the bare metadata class (the exporter emits the
            // metadata as a class before adding data-metadata).
            metadata =
                classes.find(className => !className.startsWith("doc-") &&
                    className !== "other") || "";
        }
        const id = this.stripReservedPrefix(attr(node, "id"));
        return { partType, metadata, id, language: attr(node, "lang") };
    }
    /**
     * Remove a leading idPrefix from reserved structural ids (the exporter
     * writes `id="${idPrefix}body"` when a prefix is configured).
     */
    stripReservedPrefix(id) {
        for (const reserved of RESERVED_IDS) {
            if (id === reserved) {
                return id;
            }
            if (id.length > reserved.length && id.endsWith(reserved)) {
                return reserved;
            }
        }
        return id;
    }
    convertPart(node, context) {
        const classification = this.classifyPart(node);
        switch (classification.partType) {
            case "title": {
                const inlines = convertInlines(node.childNodes, [], context, true);
                const fallback = textOf(node).trim();
                return {
                    type: "title",
                    content: inlines.length
                        ? inlines
                        : fallback
                            ? [{ type: "text", text: fallback }]
                            : []
                };
            }
            case "contributors_part":
                return this.contributorsPart(node, context, classification);
            case "tags_part":
                return this.tagsPart(node, context, classification);
            case "table_part":
                return this.tablePart(node, context, classification);
            case "heading_part":
                return this.headingPart(node, context, classification);
            default:
                return this.richtextPart(node, context, classification);
        }
    }
    richtextPart(node, context, classification) {
        const templatePart = this.findTemplatePart(classification.metadata === "other" ? "" : classification.metadata, "richtext_part");
        const content = convertBlocks(node, context);
        return {
            type: "richtext_part",
            attrs: this.partAttrsFromTemplate(templatePart, classification),
            content
        };
    }
    headingPart(node, context, classification) {
        const blocks = convertBlocks(node, context);
        const headings = blocks.filter(block => block.type.startsWith("heading"));
        if (headings.length === 1 && blocks.length === 1) {
            const templatePart = this.findTemplatePart(classification.metadata === "other" ? "" : classification.metadata, "heading_part");
            return {
                type: "heading_part",
                attrs: this.partAttrsFromTemplate(templatePart, classification),
                content: [headings[0]]
            };
        }
        // Old-schema documents kept several blocks inside one heading part.
        // Collapse them into a richtext part to keep the document valid.
        const templatePart = this.findTemplatePart(classification.metadata === "other" ? "" : classification.metadata);
        const fallback = templatePart || this.bodyTemplatePart();
        return {
            type: "richtext_part",
            attrs: this.partAttrsFromTemplate(fallback, classification, {
                metadata: classification.metadata && classification.metadata !== "other"
                    ? classification.metadata
                    : ""
            }),
            content: blocks
        };
    }
    tablePart(node, context, classification) {
        const templatePart = this.findTemplatePart(classification.metadata === "other" ? "" : classification.metadata, "table_part");
        const blocks = convertBlocks(node, context);
        const table = blocks.find(block => block.type === "table");
        if (!table) {
            return this.richtextPart(node, context, classification);
        }
        return {
            type: "table_part",
            attrs: this.partAttrsFromTemplate(templatePart, classification),
            content: [table]
        };
    }
    tagsPart(node, context, classification) {
        const templatePart = this.findTemplatePart(classification.metadata === "other" ? "" : classification.metadata, "tags_part");
        const tags = queryAll(node, "span")
            .filter(span => hasClass(span, "tag"))
            .map(span => ({
            type: "tag",
            attrs: { tag: textOf(span).trim() }
        }));
        return {
            type: "tags_part",
            attrs: this.partAttrsFromTemplate(templatePart, classification),
            content: tags
        };
    }
    contributorsPart(node, context, classification) {
        const templatePart = this.findTemplatePart(classification.metadata === "other" ? "" : classification.metadata, "contributors_part");
        const contributors = [];
        queryAll(node, "span").forEach(span => {
            const classes = classList(span);
            if (classes.includes("person")) {
                contributors.push({
                    type: "contributor",
                    attrs: this.personAttrs(span)
                });
            }
            else if (classes.includes("group")) {
                const name = queryOne(span, "span.name");
                contributors.push({
                    type: "contributor",
                    attrs: {
                        institution: name ? textOf(name).trim() : textOf(span).trim()
                    }
                });
            }
        });
        return {
            type: "contributors_part",
            attrs: this.partAttrsFromTemplate(templatePart, classification),
            content: contributors
        };
    }
    /** Contributor attributes from a span.person element. */
    personAttrs(span) {
        const attrs = {};
        const name = queryOne(span, "span.name");
        const source = name || span;
        const firstname = queryOne(source, "span.firstname");
        const lastname = queryOne(source, "span.lastname");
        if (firstname) {
            attrs.firstname = textOf(firstname).trim();
        }
        if (lastname) {
            attrs.lastname = textOf(lastname).trim();
        }
        if (!name && !firstname && !lastname) {
            attrs.lastname = textOf(span).trim();
        }
        const affiliationLink = elementChildren(span).find(child => child.tagName === "a" && hasClass(child, "affiliation"));
        if (affiliationLink) {
            const href = attr(affiliationLink, "href");
            const affId = href.startsWith("#") ? href.slice(1) : href;
            const institution = this.affiliations.get(affId);
            if (institution) {
                attrs.institution = institution;
            }
        }
        const contributorId = queryOne(span, "span.contributor-id");
        if (contributorId) {
            const value = textOf(contributorId).trim();
            const separator = value.indexOf(": ");
            if (separator >= 0) {
                attrs.id_type = value.slice(0, separator).trim();
                attrs.id_value = value.slice(separator + 2).trim();
            }
            else {
                attrs.id_value = value;
            }
        }
        return attrs;
    }
    separatorPart(node) {
        const classification = this.classifyPart(node);
        const templatePart = this.findTemplatePart("", "separator_part");
        return {
            type: "separator_part",
            attrs: this.partAttrsFromTemplate(templatePart, classification)
        };
    }
    /** The default body part for content found outside of any part. */
    bodyPart(blocks) {
        const templatePart = this.bodyTemplatePart();
        return {
            type: "richtext_part",
            attrs: {
                ...(templatePart?.attrs || {}),
                title: templatePart?.attrs?.title || "Body",
                id: templatePart?.attrs?.id || "body",
                marks: templatePart?.attrs?.marks || [
                    "strong",
                    "em",
                    "link"
                ]
            },
            content: blocks
        };
    }
}
export { convertBlocks, convertInlines };
export { attr, classList, elementChildren, hasClass, queryAll, queryOne, textOf };
//# sourceMappingURL=convert.js.map