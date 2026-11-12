/**
 * Block-level HTML → Fidus block nodes.
 * @module
 */
import { MathMLToLaTeX } from "mathml-to-latex";
import { attr, elementChildren, hasClass, queryOne, textOf } from "./dom.js";
import { convertImage, convertInlines } from "./inline.js";
/** Heading levels h1–h6 map onto heading1–heading6. */
const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];
/**
 * Convert one block-level element to zero or more Fidus block nodes.
 *
 * @param inFootnote whether we are inside a footnote aside (footnote content
 *   is stored as an array of block nodes; part wrappers are not allowed).
 */
export function convertBlocks(container, context, inFootnote = false) {
    const output = [];
    container.childNodes.forEach(node => {
        if (isElementNode(node)) {
            output.push(...convertBlock(node, context, inFootnote));
            return;
        }
        // Text outside any inline context: wrap the text in a paragraph.
        const text = (node.text || "").replace(/\s+/g, " ").trim();
        if (text.length) {
            output.push({ type: "paragraph", content: [{ type: "text", text }] });
        }
    });
    return output;
}
function isElementNode(node) {
    return typeof node.tagName === "string";
}
export function convertBlock(node, context, inFootnote = false) {
    const tagName = node.tagName.toLowerCase();
    // Footnote containers are handled via the footnotes map; the aside
    // element itself does not produce a node.
    if (tagName === "aside") {
        return [];
    }
    if (tagName === "p") {
        const content = convertInlines(node.childNodes, [], context, true);
        if (!content.length) {
            return [];
        }
        return [{ type: "paragraph", content }];
    }
    const headingLevel = HEADING_TAGS.indexOf(tagName);
    if (headingLevel >= 0) {
        const content = convertInlines(node.childNodes, [], context, true);
        const id = attr(node, "id");
        const attrs = {
            id: id && !isGeneratedId(id) ? id : false
        };
        if (!content.length) {
            return [];
        }
        return [
            {
                type: `heading${headingLevel + 1}`,
                attrs,
                content
            }
        ];
    }
    if (tagName === "blockquote") {
        const content = convertBlocks(node, context, inFootnote);
        return content.length ? [{ type: "blockquote", content }] : [];
    }
    if (tagName === "ul" || tagName === "ol") {
        const items = elementChildren(node).filter(child => child.tagName === "li");
        if (!items.length) {
            return [];
        }
        const listItems = items.map(item => ({
            type: "list_item",
            content: convertBlocks(item, context, inFootnote)
        }));
        if (tagName === "ol") {
            const start = Number.parseInt(attr(node, "start") || "1", 10);
            return [
                {
                    type: "ordered_list",
                    attrs: { order: Number.isNaN(start) ? 1 : start, track: [] },
                    content: listItems
                }
            ];
        }
        return [{ type: "bullet_list", attrs: { track: [] }, content: listItems }];
    }
    if (tagName === "li") {
        return convertBlocks(node, context, inFootnote);
    }
    if (tagName === "pre") {
        return [convertCodeBlock(node)];
    }
    if (tagName === "figure") {
        return convertFigure(node, context);
    }
    if (tagName === "table") {
        return convertTable(node, context);
    }
    if (tagName === "hr") {
        return [{ type: "horizontal_rule" }];
    }
    // Figure-like foreign HTML: a bare <img> with sibling caption text.
    if (tagName === "img") {
        const imageNode = convertImage(node, context);
        return imageNode
            ? [
                {
                    type: "figure",
                    attrs: {
                        id: "",
                        aligned: "inline",
                        width: "100",
                        caption: false,
                        category: "none"
                    },
                    content: [imageNode]
                }
            ]
            : [];
    }
    // Generic containers: recurse. This covers foreign wrapper divs/sections.
    if (tagName === "div" || tagName === "section" || tagName === "article") {
        return convertBlocks(node, context, inFootnote);
    }
    // Unknown block tags: keep their text as a paragraph (best effort).
    const text = textOf(node).trim();
    if (text.length) {
        const inlines = convertInlines(node.childNodes, [], context);
        return [
            {
                type: "paragraph",
                content: inlines.length ? inlines : [{ type: "text", text }]
            }
        ];
    }
    return [];
}
/** Ids the exporter generates for paragraphs/lists; not meaningful headings. */
function isGeneratedId(id) {
    return (/^p-\d+$/.test(id) ||
        /^list-\d+$/.test(id) ||
        /^fn-\d+$/.test(id) ||
        /^ref-\d+$/.test(id) ||
        /^aff-\d+$/.test(id));
}
/** `<pre><code …>` → code_block with the data-* attribute conventions. */
function convertCodeBlock(node) {
    const code = queryOne(node, "code") || node;
    // The exporter writes the data-* attributes on <pre>; accept them on
    // either element.
    const attrs = Object.assign({}, code.attributes, node.attributes);
    const codeAttrs = { track: [] };
    const language = attrs["data-language"];
    const category = attrs["data-category"];
    const title = attrs["data-title"];
    const id = attrs["data-id"];
    if (language) {
        codeAttrs.language = language;
    }
    if (category) {
        codeAttrs.category = category;
    }
    if (title) {
        codeAttrs.title = title;
    }
    if (id && !isGeneratedId(id)) {
        codeAttrs.id = id;
    }
    return {
        type: "code_block",
        attrs: codeAttrs,
        content: [
            {
                type: "text",
                text: textOf(code).replace(/^\n/, "")
            }
        ]
    };
}
/** `<figure>` → figure node with image/figure_equation and figure_caption. */
function convertFigure(node, context) {
    // Code blocks the exporter wrapped in a figure for numbering.
    if (hasClass(node, "code-block-figure")) {
        const pre = queryOne(node, "pre");
        if (pre) {
            return [convertCodeBlock(pre)];
        }
    }
    const figureAttrs = {
        id: attr(node, "id") || "",
        track: []
    };
    figureAttrs.aligned = attr(node, "data-aligned") || alignedFromClass(node);
    const width = widthFromAttrs(node);
    if (width !== undefined) {
        figureAttrs.width = width;
    }
    figureAttrs.category = attr(node, "data-category") || "none";
    const content = [];
    // Equation figures.
    const equationDiv = elementChildren(node).find(child => child.tagName === "div" && hasClass(child, "figure-equation"));
    if (equationDiv) {
        const dataEquation = attr(equationDiv, "data-equation");
        let equation = dataEquation;
        if (!equation) {
            const math = queryOne(equationDiv, "math");
            if (math) {
                equation = MathMLToLaTeX.convert(math.outerHTML);
            }
        }
        if (typeof equation === "string") {
            content.push({
                type: "figure_equation",
                attrs: { equation }
            });
        }
    }
    // Images.
    const img = queryOne(node, "img");
    if (img) {
        const imageNode = convertImage(img, context);
        if (imageNode) {
            content.push(imageNode);
        }
    }
    // Captions.
    const figcaption = queryOne(node, "figcaption");
    if (figcaption) {
        const captionContent = convertInlines(figcaption.childNodes.filter(child => !isElementNode(child) ||
            (!hasClass(child, "label") &&
                child.tagName.toLowerCase() !== "label")), [], context, true);
        if (captionContent.length) {
            figureAttrs.caption = true;
            content.push({
                type: "figure_caption",
                content: captionContent
            });
        }
        else {
            figureAttrs.caption = false;
        }
    }
    else {
        figureAttrs.caption = false;
    }
    // Content follows document order, which matches the schema's content
    // expressions (caption before or after the image/equation).
    if (!content.length) {
        return [];
    }
    return [{ type: "figure", attrs: figureAttrs, content }];
}
/** Width from data-width or the image-width-N class fallback. */
function widthFromAttrs(node) {
    const dataWidth = attr(node, "data-width");
    if (dataWidth) {
        return dataWidth;
    }
    const widthClass = attr(node, "class")
        .split(/\s+/)
        .find(className => /^image-width-\d+$/.test(className));
    if (widthClass) {
        return widthClass.replace("image-width-", "");
    }
    return undefined;
}
function alignedFromClass(node) {
    const alignedClass = attr(node, "class")
        .split(/\s+/)
        .find(className => /^aligned-(left|center|right)$/.test(className));
    return alignedClass ? alignedClass.replace("aligned-", "") : "";
}
/** `<table>` → table node. */
function convertTable(node, context) {
    const tableAttrs = {
        id: attr(node, "id") || "",
        track: []
    };
    if (attr(node, "data-width")) {
        tableAttrs.width = attr(node, "data-width");
    }
    if (attr(node, "data-aligned")) {
        tableAttrs.aligned = attr(node, "data-aligned");
    }
    if (attr(node, "data-layout")) {
        tableAttrs.layout = attr(node, "data-layout");
    }
    tableAttrs.category = attr(node, "data-category") || "none";
    const content = [];
    // Caption.
    const caption = queryOne(node, "caption");
    if (caption) {
        const captionContent = convertInlines(caption.childNodes.filter(child => !isElementNode(child) ||
            !child.tagName ||
            child.tagName.toLowerCase() !== "label"), [], context, true);
        if (captionContent.length) {
            tableAttrs.caption = true;
            content.push({ type: "table_caption", content: captionContent });
        }
    }
    else {
        tableAttrs.caption = false;
    }
    // Rows: thead rows first, then tbody rows. Header cells are
    // table_header nodes.
    const headRows = elementChildren(node).filter(child => child.tagName === "thead");
    const bodyRows = elementChildren(node).filter(child => child.tagName === "tbody");
    const rows = [
        ...headRows.flatMap(thead => rowElements(thead)),
        ...bodyRows.flatMap(tbody => rowElements(tbody))
    ];
    // Foreign HTML without thead/tbody: rows directly in the table.
    if (!headRows.length && !bodyRows.length) {
        rows.push(...rowElements(node));
    }
    const tableRows = rows.map(row => ({
        type: "table_row",
        content: elementChildren(row)
            .filter(cell => cell.tagName === "td" || cell.tagName === "th")
            .map(cell => {
            const cellAttrs = {};
            const colspan = Number.parseInt(attr(cell, "colspan") || "1", 10);
            const rowspan = Number.parseInt(attr(cell, "rowspan") || "1", 10);
            if (colspan > 1) {
                cellAttrs.colspan = colspan;
            }
            if (rowspan > 1) {
                cellAttrs.rowspan = rowspan;
            }
            return {
                type: cell.tagName === "th"
                    ? "table_header"
                    : "table_cell",
                attrs: cellAttrs,
                content: convertBlocks(cell, context, false)
            };
        })
    }));
    if (tableRows.length) {
        content.push({
            type: "table_body",
            content: tableRows
        });
    }
    if (!content.length) {
        return [];
    }
    // Document order: caption first, then the body — as in the schema.
    return [{ type: "table", attrs: tableAttrs, content }];
}
function rowElements(container) {
    return elementChildren(container).filter(child => child.tagName === "tr");
}
//# sourceMappingURL=blocks.js.map