/**
 * Convert a Fidus Writer document into Typst markup.
 *
 * The output is a single `document.typ` meant to be compiled with the
 * Typst CLI (`typst compile document.typ`), optionally together with the
 * exported `bibliography.bib` and the `images/` folder, all of which ship
 * in the export archive.
 *
 * Design notes:
 * - Headings use Typst's `=` markup; heading ids become Typst `<labels>`.
 * - Citations use Typst's built-in citation support (`#cite` + a BibLaTeX
 *   `bibliography.bib` exported alongside), so no external tool is needed.
 * - Equations are converted from the LaTeX source Fidus Writer stores to
 *   Typst math on a best-effort basis (see ./math.ts).
 * - Tables map to Typst `table` figures; colspan/rowspan become
 *   `table.cell(colspan:)`/`table.cell(rowspan:)`.
 * - A table_of_contents part becomes Typst's `#outline()` (with the part's
 *   title as `title:` when one is set).
 * - Document parts become `// doc-part …` comments so the structure stays
 *   visible without affecting the compiled output.
 * @module
 */
import { textContent } from "../tools/doc_content.js";
import { getImageDBEntryFilename } from "../tools/file.js";
import { BIBLIOGRAPHY_HEADERS, getCat } from "../../schema/i18n.js";
import { escapeTypstContent, escapeTypstString, escapeTypstText, fenceCode, labelName } from "./escape.js";
import { latexToTypstMath } from "./math.js";
import { extractMetadata } from "../markdown/metadata.js";
export class TypstExporterConvert {
    settings;
    imageDB;
    bibDB;
    language;
    imageIds;
    usedBibDB;
    usesCitations;
    usesHorizontalRule;
    usesTableFigure;
    /** Ids present in the document, for resolvable `#link(<...>)` targets. */
    labelIds;
    constructor(imageDB, bibDB, settings) {
        this.settings = settings;
        this.imageDB = imageDB;
        this.bibDB = bibDB;
        this.language = settings.language || "en-US";
        this.imageIds = [];
        this.usedBibDB = {};
        this.usesCitations = false;
        this.usesHorizontalRule = false;
        this.usesTableFigure = false;
        this.labelIds = new Set();
    }
    init(docContent) {
        const metadata = extractMetadata(docContent);
        this.collectLabelIds(docContent);
        const bodyParts = (docContent.content || []).filter(part => {
            if (part.type === "title" ||
                part.type === "contributors_part" ||
                part.type === "tags_part") {
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
            .filter(part => part.length)
            .join("\n\n");
        const titleBlock = this.titleBlock(metadata);
        const abstract = this.abstractBlock(metadata);
        const bibliography = this.usesCitations
            ? `#bibliography("bibliography.bib", title: [${this.bibliographyHeader()}])`
            : "";
        const sections = [
            this.preamble(metadata),
            titleBlock,
            abstract,
            body.trim(),
            bibliography
        ].filter(section => section.length);
        return {
            typst: `${sections.join("\n\n")}\n`,
            imageIds: this.imageIds,
            usedBibDB: this.usedBibDB
        };
    }
    /**
     * Collect the Typst labels the document defines (heading, figure, table
     * and code block ids, inline anchors) so that cross references can be
     * emitted as links only when the target exists — Typst errors on links
     * to unknown labels.
     */
    collectLabelIds(node) {
        const id = node.attrs?.id;
        if (typeof id === "string" &&
            id &&
            (node.type?.startsWith("heading") ||
                node.type === "figure" ||
                node.type === "table" ||
                node.type === "code_block")) {
            this.labelIds.add(labelName(id));
        }
        ;
        (node.marks || [])
            .filter(mark => mark.type === "anchor")
            .forEach(mark => {
            const anchorId = String(mark.attrs?.id || "");
            if (anchorId) {
                this.labelIds.add(labelName(anchorId));
            }
        });
        (node.content || []).forEach(child => this.collectLabelIds(child));
        if (Array.isArray(node.attrs?.footnote)) {
            ;
            node.attrs.footnote.forEach(child => this.collectLabelIds(child));
        }
    }
    /** The `#set document(...)`, language and helper definitions. */
    preamble(metadata) {
        const blocks = [];
        const documentArgs = [];
        if (metadata.title) {
            documentArgs.push(`title: [${this.walkInlinesContent(metadata.title)}]`);
        }
        const authorNames = metadata.authors
            .map(author => [author.firstname, author.lastname].filter(name => name).join(" "))
            .filter(name => name);
        if (authorNames.length) {
            documentArgs.push(`author: (${authorNames.map(name => `"${escapeTypstString(name)}"`).join(", ")})`);
        }
        if (metadata.keywords.length) {
            documentArgs.push(`keywords: (${metadata.keywords
                .map(keyword => `"${escapeTypstString(keyword)}"`)
                .join(", ")})`);
        }
        if (documentArgs.length) {
            blocks.push(`#set document(\n  ${documentArgs.join(",\n  ")},\n)`);
        }
        const lang = this.language.split("-")[0];
        if (lang) {
            blocks.push(`#set text(lang: "${escapeTypstString(lang)}")`);
        }
        if (this.usesTableFigure) {
            blocks.push("#show figure.where(kind: table): set figure.caption(position: top)");
        }
        if (this.usesHorizontalRule) {
            blocks.push("#let horizontalrule = line(start: (25%, 0%), end: (75%, 0%))");
        }
        return blocks.join("\n");
    }
    /** Centered title/subtitle/authors displayed above the document body. */
    titleBlock(metadata) {
        const blocks = [];
        if (metadata.title) {
            blocks.push(`#align(center)[#text(weight: "bold", size: 1.4em)[${this.walkInlinesContent(metadata.title)}]]`);
        }
        if (metadata.subtitle) {
            blocks.push(`#align(center)[#text(size: 1.1em)[${this.walkInlinesContent(metadata.subtitle)}]]`);
        }
        const authorNames = metadata.authors
            .map(author => [author.firstname, author.lastname].filter(name => name).join(" "))
            .filter(name => name);
        if (authorNames.length) {
            blocks.push(`#align(center)[${authorNames.map(name => escapeTypstText(name)).join(", ")}]`);
        }
        return blocks.join("\n\n");
    }
    /** The abstract part, rendered under an unnumbered heading. */
    abstractBlock(metadata) {
        if (!metadata.abstract?.content?.length) {
            return "";
        }
        const content = this.walkBlocks(metadata.abstract.content);
        return `#heading(level: 1, outlined: false, numbering: none)[Abstract]\n\n${content}`;
    }
    bibliographyHeader() {
        const settingsHeader = this.settings.bibliography_header?.[this.language];
        return escapeTypstContent(settingsHeader ||
            BIBLIOGRAPHY_HEADERS[this.language] ||
            "Bibliography");
    }
    /** One document part: a comment with the part's identity plus its blocks. */
    walkPart(part) {
        const attrs = part.attrs || {};
        const id = typeof attrs.id === "string" ? attrs.id : part.type;
        const metadataAttr = typeof attrs.metadata === "string" && attrs.metadata
            ? ` metadata=${attrs.metadata}`
            : "";
        const content = (part.content || [])
            .map(node => this.walkBlock(node))
            .filter(block => block.length)
            .join("\n\n");
        if (part.type === "table_of_contents") {
            return `// doc-part: ${id} (${part.type})${metadataAttr}\n${this.walkTableOfContents(part)}`;
        }
        return `// doc-part: ${id} (${part.type})${metadataAttr}\n${content}`;
    }
    /** A table of contents maps to Typst's built-in outline. */
    walkTableOfContents(node) {
        const title = node.attrs?.title;
        if (typeof title === "string" && title) {
            return `#outline(title: [${escapeTypstContent(title)}])`;
        }
        return "#outline()";
    }
    /** Walk a list of block nodes and join them with blank lines. */
    walkBlocks(nodes) {
        return nodes
            .map(node => this.walkBlock(node))
            .filter(block => block.length)
            .join("\n\n");
    }
    /** Convert a single block node to Typst markup. */
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
                const id = typeof node.attrs?.id === "string" && node.attrs.id
                    ? ` <${labelName(node.attrs.id)}>`
                    : "";
                return `${"=".repeat(level)} ${title}${id}`;
            }
            case "blockquote":
                return `#quote(block: true)[\n${this.walkBlocks(node.content || [])}\n]`;
            case "bullet_list":
            case "ordered_list":
                return this.walkList(node);
            case "code_block":
                return this.walkCodeBlock(node);
            case "figure":
                return this.walkFigure(node);
            case "table":
                return this.walkTableFigure(node);
            case "horizontal_rule":
                this.usesHorizontalRule = true;
                return "#horizontalrule";
            case "table_of_contents":
                return this.walkTableOfContents(node);
            default:
                return "";
        }
    }
    walkList(node) {
        const ordered = node.type === "ordered_list";
        const items = (node.content || []).filter(item => item.type === "list_item");
        const start = node.attrs?.order || 1;
        const lines = items
            .map(item => {
            const marker = ordered ? "+ " : "- ";
            const children = (item.content || [])
                .map(child => this.walkBlock(child))
                .filter(block => block.length);
            if (!children.length) {
                return marker.trimEnd();
            }
            const [first, ...rest] = children;
            const continuation = `${" ".repeat(marker.length)}`;
            const blocks = [
                `${marker}${first.replace(/\n/g, `\n${continuation}`)}`,
                ...rest.map(block => block
                    .split("\n")
                    .map(line => (line.length ? `${continuation}${line}` : line))
                    .join("\n"))
            ];
            return blocks.join("\n\n");
        })
            .join("\n");
        if (ordered && start > 1) {
            // An enumerated list starting above one needs an explicit
            // `#set enum(start:)` inside a block so the setting stays local.
            return `#block[\n#set enum(start: ${start})\n${lines}\n]`;
        }
        return lines;
    }
    walkCodeBlock(node) {
        const attrs = node.attrs || {};
        const code = textContent(node);
        const { fence, content } = fenceCode(code);
        const language = typeof attrs.language === "string" && attrs.language
            ? attrs.language
            : "";
        const fenceBlock = `${fence}${language}\n${content}${fence}`;
        const id = typeof attrs.id === "string" && attrs.id
            ? ` <${labelName(attrs.id)}>`
            : "";
        const title = typeof attrs.title === "string" && attrs.title ? attrs.title : "";
        if (title) {
            return `#figure(caption: [${escapeTypstContent(title)}], kind: raw)[${fenceBlock}]${id}`;
        }
        if (id) {
            return `${fenceBlock}\n${id.trim()}`;
        }
        return fenceBlock;
    }
    walkFigure(node) {
        const attrs = node.attrs || {};
        const category = String(attrs.category || "none");
        const figureEquation = node.content?.find(child => child.type === "figure_equation");
        const captionNode = node.content?.find(child => child.type === "figure_caption");
        const caption = attrs.caption && captionNode
            ? this.walkInlines(captionNode.content || [])
            : "";
        const id = typeof attrs.id === "string" && attrs.id
            ? ` <${labelName(attrs.id)}>`
            : "";
        const label = category !== "none" ? getCat(category, this.language) : "";
        if (figureEquation) {
            const equation = latexToTypstMath(String(figureEquation.attrs?.equation || ""));
            const captionBlock = caption
                ? `, caption: [${label ? `${label}: ` : ""}${caption}]`
                : "";
            return `#figure($ ${equation} $${captionBlock})${id}`;
        }
        const image = node.content?.find(child => child.type === "image");
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
        const width = attrs.width ? `, width: ${attrs.width}%` : "";
        const figureInner = `#figure(image("images/${filename}"${width})`;
        const captionBlock = caption
            ? `, caption: [${label ? `${label}: ` : ""}${caption}]`
            : "";
        const figure = `${figureInner}${captionBlock})${id}`;
        const aligned = String(attrs.aligned || "center");
        if (aligned === "left" || aligned === "right") {
            return `#align(${aligned})[${figure}]`;
        }
        return figure;
    }
    /** Wrap a table in a captioned `table` figure (pandoc convention). */
    walkTableFigure(tableNode) {
        this.usesTableFigure = true;
        const attrs = tableNode.attrs || {};
        const captionNode = tableNode.content?.find(child => child.type === "table_caption");
        const bodyNode = tableNode.content?.find(child => child.type === "table_body");
        const rows = bodyNode?.content || [];
        const columnCount = rows.reduce((count, row) => Math.max(count, (row.content || []).reduce((sum, cell) => sum + (cell.attrs?.colspan || 1), 0)), 1);
        const alignment = this.columnAlignment(String(attrs.aligned || "center"));
        const align = `align: (${Array.from({ length: columnCount }, () => `${alignment},`).join("")}),`;
        const headerRows = [];
        const bodyRows = [];
        rows.forEach(row => {
            const cells = row.content || [];
            if (cells.length &&
                cells.every(cell => cell.type === "table_header") &&
                !bodyRows.length) {
                headerRows.push(row);
            }
            else {
                bodyRows.push(row);
            }
        });
        const header = headerRows.length
            ? `  table.header(${this.tableCells(headerRows[0], true)}),\n`
            : "";
        const body = bodyRows
            .map(row => `  ${this.tableCells(row, true)},`)
            .join("\n");
        const caption = attrs.caption && captionNode?.content?.length
            ? `, caption: [${this.walkInlines(captionNode.content || [])}]`
            : "";
        const figure = `#figure(align(center)[#table(\n  columns: ${columnCount},\n  ${align}\n${header}${body}\n)], kind: table${caption})`;
        const id = typeof attrs.id === "string" && attrs.id
            ? ` <${labelName(attrs.id)}>`
            : "";
        return `${figure}${id}`;
    }
    /** Render one table row's cells; spanned cells become `table.cell()`. */
    tableCells(row, allowSpan) {
        return (row.content || [])
            .map(cell => {
            const text = this.tableCellText(cell);
            const colspan = cell.attrs?.colspan || 1;
            const rowspan = cell.attrs?.rowspan || 1;
            if (allowSpan && (colspan > 1 || rowspan > 1)) {
                const args = [];
                if (colspan > 1) {
                    args.push(`colspan: ${colspan}`);
                }
                if (rowspan > 1) {
                    args.push(`rowspan: ${rowspan}`);
                }
                return `table.cell(${args.join(", ")})[${text}]`;
            }
            return `[${text}]`;
        })
            .join(", ");
    }
    /** Table cells hold paragraph blocks; render their inline content. */
    tableCellText(cell) {
        return (cell.content || [])
            .map(child => {
            if (child.type === "text") {
                return this.walkInline(child);
            }
            if (child.content) {
                return this.walkInlines(child.content);
            }
            return "";
        })
            .filter(text => text.length)
            .join(" ");
    }
    columnAlignment(aligned) {
        switch (aligned) {
            case "left":
                return "left";
            case "right":
                return "right";
            default:
                return "center";
        }
    }
    /**
     * Inline content as Typst markup inside a content block `[...]`
     * (titles, captions).
     */
    walkInlinesContent(text) {
        return escapeTypstContent(text);
    }
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
                const equation = latexToTypstMath(String(node.attrs?.equation || ""));
                return equation.length ? `$${equation}$` : "";
            }
            case "footnote": {
                if (!Array.isArray(node.attrs?.footnote)) {
                    return "";
                }
                return `#footnote[\n${this.walkBlocks(node.attrs.footnote)}\n]`;
            }
            case "citation":
                return this.walkCitation(node);
            case "cross_reference": {
                const target = labelName(String(node.attrs?.id || ""));
                const title = String(node.attrs?.title || target);
                if (!this.labelIds.has(target)) {
                    // Typst errors on links to labels that do not exist;
                    // keep the text so no content is lost.
                    return escapeTypstText(title);
                }
                return `#link(<${target}>)[${escapeTypstText(title)}]`;
            }
            default:
                return "";
        }
    }
    /** A text node, wrapped in the Typst syntax of its marks. */
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
        const text = String(node.text || "");
        let result = escapeTypstText(text, escapeStart);
        if (codeMark) {
            const runs = text.match(/`+/g)?.reduce((longest, run) => Math.max(longest, run.length), 0);
            const ticks = "`".repeat(Math.max(1, (runs || 0) + 1));
            const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
            result = `${ticks}${padding}${text}${padding}${ticks}`;
        }
        else {
            if (em) {
                result = `#emph[${result}]`;
            }
            if (strong) {
                result = `#strong[${result}]`;
            }
            if (underline) {
                result = `#underline[${result}]`;
            }
            if (sup) {
                result = `#super[${result}]`;
            }
            if (sub) {
                result = `#sub[${result}]`;
            }
        }
        if (link) {
            const href = escapeTypstString(String(link.attrs?.href || ""));
            result = `#link("${href}")[${result}]`;
        }
        if (anchor) {
            result += `<${labelName(String(anchor.attrs?.id || ""))}>`;
        }
        return result;
    }
    walkCitation(node) {
        const references = node.attrs?.references || [];
        const format = String(node.attrs?.format || "autocite");
        if (!references.length) {
            return "";
        }
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
            const prefix = ref.prefix ? ref.prefix.trim() : "";
            const locator = ref.locator ? ref.locator.trim() : "";
            const supplement = [prefix, locator]
                .filter(part => part)
                .join(", ");
            const args = [`<${labelName(key)}>`];
            if (format === "textcite") {
                args.push('form: "prose"');
            }
            if (supplement) {
                args.push(`supplement: [${escapeTypstContent(supplement)}]`);
            }
            return `#cite(${args.join(", ")})`;
        })
            .filter((item) => item !== null);
        if (!items.length) {
            return "";
        }
        this.usesCitations = true;
        return items.join(" ");
    }
}
//# sourceMappingURL=convert.js.map