/**
 * Convert a Fidus Writer document into pandoc-flavoured markdown.
 *
 * The output uses the `markdown` (pandoc) flavour rather than GFM, because
 * only the pandoc flavour supports the constructs needed for a faithful
 * export: fenced divs for document parts, attribute blocks on headings, code
 * fences and spans, bracketed citations and `{.underline}` spans.
 *
 * Round-trip design (verified against pandoc 3.x):
 * - YAML front matter carries title, subtitle, authors, date, keywords,
 *   abstract, copyright and a `tags` map.
 * - Every document part is wrapped in a fenced div with the same class and
 *   id conventions as the HTML exporter (`doc-part doc-richtext` etc.), so a
 *   future markdown importer can reuse the same mapping.
 * - Tables are wrapped in a fenced div, because pandoc's markdown has no way
 *   of attaching attributes to a table directly.
 * - Figures with captions use `![caption](src){#id …}` (implicit_figures);
 *   figure equations use a fenced div with `data-equation` plus display math.
 * - Citations are exported as `[@key]`/`@key` referencing a `bibliography.bib`
 *   that is exported alongside the document.
 * @module
 */
import { fixTables, textContent } from "../tools/doc_content.js";
import { getImageDBEntryFilename } from "../tools/file.js";
import { escapeAttribute, escapeMarkdownText, escapeTableCell, fenceCode } from "./escape.js";
import { assembleFrontMatter, extractMetadata } from "./metadata.js";
/**
 * The CSS-ish class name the HTML exporter uses for each part type (the
 * `doc-…` class inside `div.doc-part …`).
 */
function partClass(partType) {
    switch (partType) {
        case "heading_part":
            return "heading";
        case "richtext_part":
            return "richtext";
        case "contributors_part":
            return "contributors";
        case "tags_part":
            return "tags";
        case "table_part":
            return "table";
        default:
            return partType;
    }
}
export class MarkdownExporterConvert {
    settings;
    imageDB;
    bibDB;
    imageIds;
    usedBibDB;
    footnotes;
    fnCounter;
    usesCitations;
    constructor(imageDB, bibDB, settings) {
        this.settings = settings;
        this.imageDB = imageDB;
        this.bibDB = bibDB;
        this.imageIds = [];
        this.usedBibDB = {};
        this.footnotes = [];
        this.fnCounter = 0;
        this.usesCitations = false;
    }
    init(docContent) {
        const metadata = extractMetadata(docContent);
        const frontMatter = assembleFrontMatter(metadata, nodes => this.walkBlocks(nodes));
        const bodyParts = (docContent.content || []).filter(part => {
            if (part.type === "title") {
                return false;
            }
            if (part.type === "contributors_part") {
                return false;
            }
            if (part.type === "tags_part") {
                return false;
            }
            if (part.type === "richtext_part") {
                const attrs = part.attrs || {};
                if (attrs.metadata === "abstract" || attrs.id === "abstract") {
                    return false;
                }
            }
            if (part.type === "heading_part") {
                const attrs = part.attrs || {};
                if (attrs.metadata === "subtitle" || attrs.id === "subtitle") {
                    return false;
                }
            }
            return true;
        });
        const body = bodyParts
            .map(part => this.walkPart(part))
            .join("\n");
        const footnotes = this.footnotes.length
            ? this.footnotes
                .map(definition => `[^${definition.marker}]: ${this.walkBlocks(definition.content, { indent: "    " }).trimStart()}`)
                .join("\n\n")
            : "";
        const references = this.usesCitations
            ? `::: {#references .references}\n:::`
            : "";
        const markdown = [
            frontMatter,
            body.trimEnd(),
            footnotes,
            references
        ]
            .filter(section => section.length)
            .join("\n\n");
        return {
            markdown: `${markdown}\n`,
            imageIds: this.imageIds,
            usedBibDB: this.usedBibDB
        };
    }
    /**
     * Wrap one document part in a fenced div carrying the part's attributes
     * (mirroring the HTML exporter's `div.doc-part` wrappers).
     */
    walkPart(part) {
        const attrs = part.attrs || {};
        const id = attrs.id;
        const metadata = attrs.metadata;
        const language = attrs.language;
        const attributes = [];
        if (typeof id === "string" && id && id !== "undefined") {
            attributes.push(`#${id}`);
        }
        attributes.push(".doc-part", `.doc-${partClass(part.type)}`);
        if (typeof metadata === "string" && metadata) {
            attributes.push(`data-metadata="${escapeAttribute(metadata)}"`);
        }
        if (typeof language === "string" && language) {
            attributes.push(`lang="${escapeAttribute(language)}"`);
        }
        let extraAttrs = "";
        if (part.type === "table_part") {
            const table = part.content?.find(node => node.type === "table");
            if (table) {
                extraAttrs = this.tableAttributes(table);
                if (table.attrs?.track) {
                    // Tracked changes on tables are not representable.
                }
            }
        }
        const content = (part.content || [])
            .map(node => this.walkBlock(node))
            .filter(block => block.length)
            .join("\n\n");
        return `::: {${attributes.join(" ")}${extraAttrs}}\n\n${content}\n\n:::`;
    }
    /** Attributes shared by tables inside and outside of table parts. */
    tableAttributes(table) {
        const attrs = table.attrs || {};
        const attributes = [];
        if (attrs.width) {
            attributes.push(`data-width="${escapeAttribute(String(attrs.width))}"`);
        }
        if (attrs.aligned) {
            attributes.push(`data-aligned="${escapeAttribute(String(attrs.aligned))}"`);
        }
        if (attrs.layout) {
            attributes.push(`data-layout="${escapeAttribute(String(attrs.layout))}"`);
        }
        if (attrs.category && attrs.category !== "none") {
            attributes.push(`data-category="${escapeAttribute(String(attrs.category))}"`);
        }
        return attributes.length ? ` ${attributes.join(" ")}` : "";
    }
    /**
     * Walk a list of block nodes, indenting every produced line. Used for the
     * contents of list items, footnotes and blockquotes.
     */
    walkBlocks(nodes, options = {}) {
        const blocks = nodes
            .map(node => this.walkBlock(node))
            .filter(block => block.length);
        const joined = blocks.join("\n\n");
        const indent = options.indent || "";
        const quote = options.quote;
        return joined
            .split("\n")
            .map(line => {
            let prefixed = line.length ? `${indent}${line}` : indent.replace(/\S/g, " ");
            if (quote && prefixed.length) {
                prefixed = `> ${prefixed}`;
            }
            return prefixed;
        })
            .join("\n");
    }
    /** Convert a single block node to markdown. */
    walkBlock(node) {
        switch (node.type) {
            case "paragraph":
                return this.walkInlines(node.content || [], true);
            case "heading1":
            case "heading2":
            case "heading3":
            case "heading4":
            case "heading5":
            case "heading6": {
                const level = Number(node.type.slice(-1));
                const title = this.walkInlines(node.content || [], true);
                const headingId = typeof node.attrs?.id === "string" && node.attrs.id
                    ? ` {#${node.attrs.id}}`
                    : "";
                return `${"#".repeat(level)} ${title}${headingId}`;
            }
            case "blockquote":
                return this.walkBlocks(node.content || [], { quote: true });
            case "bullet_list":
            case "ordered_list":
                return this.walkList(node);
            case "code_block":
                return this.walkCodeBlock(node);
            case "figure":
                return this.walkFigure(node);
            case "table":
                // Tables outside of table parts are wrapped in a doc-table
                // div so that the table attributes survive the round trip
                // (pandoc markdown cannot attach attributes to a table).
                return this.walkTableDiv(node);
            case "horizontal_rule":
                return "---";
            default:
                return "";
        }
    }
    walkList(node) {
        const ordered = node.type === "ordered_list";
        const items = (node.content || []).filter(item => item.type === "list_item");
        let number = node.attrs?.order || 1;
        return items
            .map(item => {
            const marker = ordered ? `${number}. ` : "-  ";
            if (ordered) {
                number++;
            }
            const children = item.content || [];
            const blocks = children.map((child, index) => {
                const block = this.walkBlock(child);
                if (index === 0) {
                    // First block shares the line with the list marker.
                    return `${marker}${block.replace(/\n/g, `\n${" ".repeat(marker.length)}`)}`;
                }
                return this.walkBlocks([child], {
                    indent: " ".repeat(marker.length)
                });
            });
            return blocks.filter(block => block.length).join("\n\n");
        })
            .join("\n");
    }
    walkCodeBlock(node) {
        const attrs = node.attrs || {};
        const code = textContent(node);
        const { fence, content } = fenceCode(code);
        const attributes = [];
        if (typeof attrs.language === "string" && attrs.language) {
            attributes.push(`.${attrs.language}`);
        }
        if (typeof attrs.id === "string" && attrs.id) {
            attributes.push(`#${attrs.id}`);
        }
        if (typeof attrs.category === "string" && attrs.category) {
            attributes.push(`category="${escapeAttribute(attrs.category)}"`);
        }
        if (typeof attrs.title === "string" && attrs.title) {
            attributes.push(`caption="${escapeAttribute(attrs.title)}"`);
        }
        const attrBlock = attributes.length ? `{${attributes.join(" ")}}` : "";
        return `${fence}${attrBlock}\n${content}${fence}`;
    }
    walkFigure(node) {
        const attrs = node.attrs || {};
        const category = String(attrs.category || "none");
        const image = node.content?.find(child => child.type === "image");
        const figureEquation = node.content?.find(child => child.type === "figure_equation");
        const captionNode = node.content?.find(child => child.type === "figure_caption");
        const caption = attrs.caption && captionNode
            ? this.walkInlines(captionNode.content || [])
            : "";
        if (figureEquation) {
            // Pandoc has no native figure-with-equation construct; a fenced
            // div carrying the LaTeX in data-equation plus display math is
            // the round-trippable representation.
            const attributes = [];
            if (typeof attrs.id === "string" && attrs.id) {
                attributes.push(`#${attrs.id}`);
            }
            attributes.push(".doc-figure");
            attributes.push(`data-equation="${escapeAttribute(String(figureEquation.attrs?.equation || ""))}"`);
            if (category !== "none") {
                attributes.push(`data-category="${escapeAttribute(category)}"`);
            }
            const equation = String(figureEquation.attrs?.equation || "");
            const captionBlock = caption ? `\n\n${caption}` : "";
            return `:::: {${attributes.join(" ")}}\n\n$$\n${equation}\n$$${captionBlock}\n\n::::`;
        }
        if (!image) {
            return "";
        }
        const imageId = image.attrs?.image;
        const imageEntry = imageId !== undefined ? this.imageDB.db[imageId] : undefined;
        if (!imageEntry) {
            return "";
        }
        const filename = getImageDBEntryFilename(imageEntry, imageId);
        if (!this.imageIds.includes(imageId)) {
            this.imageIds.push(imageId);
        }
        const attributes = [];
        if (typeof attrs.id === "string" && attrs.id) {
            attributes.push(`#${attrs.id}`);
        }
        if (attrs.width) {
            const width = String(attrs.width);
            attributes.push(`width=${width}${/^\d+$/.test(width) ? "%" : ""}`);
        }
        if (attrs.aligned) {
            attributes.push(`data-aligned="${escapeAttribute(String(attrs.aligned))}"`);
        }
        if (category !== "none") {
            attributes.push(`data-category="${escapeAttribute(category)}"`);
        }
        const attrBlock = attributes.length
            ? `{${attributes.join(" ")}}`
            : "";
        const src = `images/${filename}`;
        return `![${caption}](${src})${attrBlock}`;
    }
    /**
     * Wrap a table in a doc-table fenced div carrying its attributes.
     * (Tables inside table parts keep their part div instead.)
     */
    walkTableDiv(tableNode) {
        const attributes = [".doc-table"];
        const id = String(tableNode.attrs?.id || "");
        if (id && id !== "undefined") {
            attributes.push(`#${id}`);
        }
        return `::: {${attributes.join(" ")}${this.tableAttributes(tableNode)}}\n\n${this.walkTable(tableNode)}\n\n:::`;
    }
    walkTable(tableNode) {
        // Markdown pipe tables cannot express merged cells; fixTables adds
        // the covered cells so that the grid stays rectangular.
        const fixed = fixTables(JSON.parse(JSON.stringify(tableNode)));
        const captionNode = fixed.content?.find(child => child.type === "table_caption");
        const bodyNode = fixed.content?.find(child => child.type === "table_body");
        const rows = bodyNode?.content || [];
        if (!rows.length) {
            return "";
        }
        const firstRowCells = rows[0].content || [];
        const hasHeaderRow = firstRowCells.some(cell => cell.type === "table_header");
        const columns = firstRowCells.reduce((cols, cell) => cols + (cell.attrs?.colspan || 1), 0);
        const cellText = (cell) => escapeTableCell(textContent(cell).trim());
        // Covered-cell markers (rowspan=0 & colspan=0, inserted by
        // fixTables) occupy grid positions that the colspan padding of the
        // spanning cell already accounts for; they must not be counted.
        const isCoveredMarker = (cell) => cell.attrs?.rowspan === 0 &&
            cell.attrs?.colspan === 0;
        const headerCells = hasHeaderRow
            ? firstRowCells.filter(cell => !isCoveredMarker(cell)).map(cellText)
            : Array.from({ length: columns }, () => "");
        const bodyRows = (hasHeaderRow ? rows.slice(1) : rows).map(row => {
            const cells = [];
            (row.content || []).forEach(cell => {
                if (isCoveredMarker(cell)) {
                    return;
                }
                cells.push(cellText(cell));
                const colspan = cell.attrs?.colspan || 1;
                for (let i = 1; i < colspan; i++) {
                    cells.push("");
                }
            });
            while (cells.length < columns) {
                cells.push("");
            }
            return cells;
        });
        const widths = Array.from({ length: columns }, (_, column) => {
            const texts = [headerCells[column], ...bodyRows.map(row => row[column])];
            return Math.max(3, ...texts.map(text => text.length));
        });
        const line = (cells) => `| ${cells
            .map((cell, column) => cell.padEnd(widths[column]))
            .join(" | ")} |`;
        const separator = `| ${widths.map(width => "-".repeat(width)).join(" | ")} |`;
        const caption = captionNode?.content?.length
            ? this.walkInlines(captionNode.content || [])
            : "";
        const table = [
            line(headerCells),
            separator,
            ...bodyRows.map(row => line(row))
        ].join("\n");
        return caption ? `${table}\n\n: ${caption}` : table;
    }
    /**
     * Inline content → markdown text. When `escapeStart` is set, a leading
     * `#`/`-`/`+` of the first text node is escaped so that the block cannot
     * be misread as a heading or list.
     */
    walkInlines(nodes, escapeStart = false) {
        let first = true;
        return nodes
            .map(node => {
            const isText = node.type === "text";
            const result = this.walkInline(node, escapeStart && first);
            if (isText) {
                first = false;
            }
            return result;
        })
            .join("");
    }
    walkInline(node, escapeStart = false) {
        switch (node.type) {
            case "text":
                return this.walkText(node, escapeStart);
            case "hard_break":
                return "\\\n";
            case "equation": {
                const equation = String(node.attrs?.equation || "");
                return equation.includes("$")
                    ? `<span class="equation" data-equation="${escapeAttribute(equation)}"></span>`
                    : `$${equation}$`;
            }
            case "footnote": {
                if (!Array.isArray(node.attrs?.footnote)) {
                    return "";
                }
                this.fnCounter++;
                this.footnotes.push({
                    marker: this.fnCounter,
                    content: node.attrs.footnote
                });
                return `[^${this.fnCounter}]`;
            }
            case "citation":
                return this.walkCitation(node);
            case "cross_reference": {
                const target = String(node.attrs?.id || "");
                const title = String(node.attrs?.title || target);
                return title ? `[${escapeMarkdownText(title)}](#${target})` : "";
            }
            default:
                return "";
        }
    }
    /** A text node, wrapped in the markdown syntax of its marks. */
    walkText(node, escapeStart = false) {
        const marks = node.marks || [];
        const codeMark = marks.find(mark => mark.type === "code");
        const strong = marks.find(mark => mark.type === "strong");
        const em = marks.find(mark => mark.type === "em");
        const underline = marks.find(mark => mark.type === "underline");
        const sup = marks.find(mark => mark.type === "sup");
        const sub = marks.find(mark => mark.type === "sub");
        const link = marks.find(mark => mark.type === "link");
        const anchor = marks.find(mark => mark.type === "anchor");
        let start = "";
        let end = "";
        if (anchor) {
            const anchorId = String(anchor.attrs?.id || "");
            start += `<span id="${escapeAttribute(anchorId)}" class="anchor" data-id="${escapeAttribute(anchorId)}"></span>`;
        }
        if (codeMark) {
            // The code mark excludes all other formatting marks.
            return this.wrapCode(start + end, String(node.text || ""));
        }
        if (em) {
            start += "*";
            end = `*${end}`;
        }
        if (strong) {
            start += "**";
            end = `**${end}`;
        }
        let text = escapeMarkdownText(String(node.text || ""), escapeStart);
        if (underline) {
            text = `[${text}]{.underline}`;
        }
        if (sup) {
            text = String(node.text || "").includes(" ")
                ? `<sup>${text}</sup>`
                : `^${text}^`;
        }
        if (sub) {
            text = String(node.text || "").includes(" ")
                ? `<sub>${text}</sub>`
                : `~${text}~`;
        }
        if (link) {
            const href = String(link.attrs?.href || "");
            const title = link.attrs?.title
                ? ` "${escapeAttribute(String(link.attrs.title))}"`
                : "";
            text = `[${text}](${href}${title})`;
        }
        return start + text + end;
    }
    /** Inline code with doubled backticks when the text contains backticks. */
    wrapCode(wrapper, text) {
        const runs = text.match(/`+/g)?.reduce((longest, run) => Math.max(longest, run.length), 0);
        const ticks = "`".repeat(Math.max(1, (runs || 0) + 1));
        const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
        return `${wrapper}${ticks}${padding}${text}${padding}${ticks}`;
    }
    walkCitation(node) {
        const references = node.attrs?.references || [];
        const format = String(node.attrs?.format || "autocite");
        if (!references.length) {
            return "";
        }
        this.usesCitations = true;
        const items = references
            .map(ref => {
            const bibDBEntry = this.bibDB.db[ref.id];
            if (!bibDBEntry) {
                // Not present in the bibliography database; fall back to
                // plain text so that no fabricated keys are emitted.
                return null;
            }
            if (!this.usedBibDB[ref.id]) {
                this.usedBibDB[ref.id] = Object.assign({}, bibDBEntry);
            }
            const key = this.usedBibDB[ref.id].entry_key || String(ref.id);
            const suffix = ref.locator ? `, ${ref.locator}` : "";
            const prefix = ref.prefix
                ? ref.prefix.endsWith(" ")
                    ? ref.prefix
                    : `${ref.prefix} `
                : "";
            if (format === "textcite" && !ref.prefix) {
                return `@${key}${suffix}`;
            }
            return `${prefix}@${key}${suffix}`;
        })
            .filter((item) => item !== null);
        if (!items.length) {
            return "";
        }
        const textcite = format === "textcite" && items.every(item => item.startsWith("@"));
        if (textcite && items.length === 1) {
            return items[0];
        }
        return `[${items.join("; ")}]`;
    }
}
//# sourceMappingURL=convert.js.map