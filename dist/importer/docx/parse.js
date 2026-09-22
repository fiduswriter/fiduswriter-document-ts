import { xmlDOM } from "../../exporter/tools/xml.js";
import { randomCommentId } from "../../schema/common/index.js";
import { gettext } from "fwtoolkit";
function attr(node, name) {
    if (node && typeof node === "object" && "getAttribute" in node) {
        return String(node.getAttribute(name) || "");
    }
    return "";
}
const DEFAULT_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
</w:styles>`;
export class DocxParser {
    zip;
    styles;
    numbering;
    comments;
    footnotes;
    endnotes;
    relationships;
    images;
    coreDoc;
    document;
    customDoc;
    constructor(zip) {
        this.zip = zip;
        this.styles = {};
        this.numbering = {};
        this.comments = {};
        this.footnotes = {};
        this.endnotes = {};
        this.relationships = {};
        this.images = {};
        this.coreDoc = null;
        this.document = null;
        this.customDoc = null;
    }
    init() {
        return this.parseStyles()
            .then(() => this.parseNumbering())
            .then(() => this.parseComments())
            .then(() => this.parseCommentsExtended())
            .then(() => this.parseFootnotes())
            .then(() => this.parseEndnotes())
            .then(() => this.parseRelationships())
            .then(() => this.parseImages())
            .then(() => this.parseCoreDoc())
            .then(() => this.parseCustomDoc())
            .then(() => this.parseDocument());
    }
    async parseStyles() {
        try {
            const content = await this.zip
                .file("word/styles.xml")
                ?.async("string");
            const stylesDoc = xmlDOM(content || DEFAULT_STYLES_XML);
            const styles = stylesDoc.queryAll("w:style");
            styles.forEach((style) => {
                const id = attr(style, "w:styleId");
                const type = attr(style, "w:type");
                const name = attr(style.query("w:name"), "w:val");
                const basedOn = attr(style.query("w:basedOn"), "w:val");
                this.styles[id] = {
                    id,
                    type,
                    name,
                    isHeading: Boolean((id && /heading\d+/i.test(id)) ||
                        (basedOn && /heading\d+/i.test(basedOn))),
                    isCaption: Boolean((id && /caption/i.test(id)) ||
                        (basedOn && /caption/i.test(basedOn))),
                    level: id ? parseInt(id.match(/\d+/)?.[0] || "0") : 0,
                    basedOn,
                    paragraphProps: this.extractParagraphProperties(style),
                    runProps: this.extractRunProperties(style)
                };
            });
        }
        catch (err) {
            console.warn("Could not parse styles", err);
        }
    }
    isCodeStyle(styleId) {
        let current = styleId;
        const visited = new Set();
        while (current && !visited.has(current)) {
            visited.add(current);
            const style = this.styles[current];
            if (!style) {
                return false;
            }
            const name = style.name?.toLowerCase() || "";
            if (/^code(\s|$)/i.test(style.id) ||
                name === "code" ||
                name.includes("code") ||
                /^html(\s|$)/i.test(style.id) ||
                /^pre(\s|$)/i.test(style.id)) {
                return true;
            }
            // Check font family on the style
            if (style.runProps?.fontFamily) {
                const fontFamily = style.runProps.fontFamily.toLowerCase();
                const monospacePatterns = [
                    "courier",
                    "consolas",
                    "monaco",
                    "menlo",
                    "lucida console",
                    "liberation mono",
                    "dejavu sans mono",
                    "bitstream vera sans mono",
                    "source code pro",
                    "fira code",
                    "ubuntu mono",
                    "droid sans mono",
                    "monospace"
                ];
                if (monospacePatterns.some(p => fontFamily.includes(p))) {
                    return true;
                }
            }
            current = style.basedOn;
        }
        return false;
    }
    extractParagraphProperties(style) {
        const pPr = style.query("w:pPr");
        if (!pPr) {
            return {};
        }
        return {
            indent: this.extractIndentation(pPr),
            alignment: attr(pPr.query("w:jc"), "w:val"),
            numbering: this.extractNumbering(pPr),
            keepNext: Boolean(pPr.query("w:keepNext"))
        };
    }
    extractIndentation(pPr) {
        const ind = pPr.query("w:ind");
        if (!ind) {
            return {};
        }
        return {
            left: parseInt(attr(ind, "w:left") || attr(ind, "w:start") || "0"),
            right: parseInt(attr(ind, "w:right") || attr(ind, "w:end") || "0"),
            hanging: parseInt(attr(ind, "w:hanging") || "0"),
            firstLine: parseInt(attr(ind, "w:firstLine") || "0")
        };
    }
    extractNumbering(pPr) {
        const numPr = pPr.query("w:numPr");
        if (!numPr) {
            return null;
        }
        return {
            id: attr(numPr.query("w:numId"), "w:val"),
            level: parseInt(attr(numPr.query("w:ilvl"), "w:val") || "0")
        };
    }
    extractRunProperties(rPr) {
        if (!rPr) {
            return {};
        }
        return {
            bold: Boolean(rPr.query("w:b")),
            italic: Boolean(rPr.query("w:i")),
            underline: attr(rPr.query("w:u"), "w:val") || false,
            strike: Boolean(rPr.query("w:strike")),
            smallCaps: Boolean(rPr.query("w:smallCaps")),
            vertAlign: attr(rPr.query("w:vertAlign"), "w:val") || false,
            fontSize: parseInt(attr(rPr.query("w:sz"), "w:val") || "0") / 2,
            color: attr(rPr.query("w:color"), "w:val") || false,
            fontFamily: attr(rPr.query("w:rFonts"), "w:ascii") || false
        };
    }
    async parseNumbering() {
        try {
            const content = await this.zip
                .file("word/numbering.xml")
                ?.async("string");
            if (!content) {
                return;
            }
            const numberingDoc = xmlDOM(content);
            // Parse abstract numbering definitions
            const abstractNums = numberingDoc.queryAll("w:abstractNum");
            const abstractNumbering = {};
            abstractNums.forEach((abstractNum) => {
                const id = attr(abstractNum, "w:abstractNumId");
                const levels = abstractNum.queryAll("w:lvl").map((lvl) => ({
                    level: attr(lvl, "w:ilvl"),
                    format: attr(lvl.query("w:numFmt"), "w:val"),
                    text: attr(lvl.query("w:lvlText"), "w:val"),
                    start: parseInt(attr(lvl.query("w:start"), "w:val") || "1")
                }));
                abstractNumbering[id] = levels;
            });
            // Parse numbering instances
            const nums = numberingDoc.queryAll("w:num");
            nums.forEach((num) => {
                const numId = attr(num, "w:numId");
                const abstractNumId = attr(num
                    .query("w:abstractNumId"), "w:val");
                this.numbering[numId] = {
                    abstractId: abstractNumId,
                    levels: abstractNumbering[abstractNumId] || [],
                    overrides: this.extractNumberingOverrides(num)
                };
            });
        }
        catch (err) {
            console.warn("Could not parse numbering", err);
        }
    }
    extractNumberingOverrides(num) {
        return num.queryAll("w:lvlOverride").map((override) => ({
            level: attr(override, "w:ilvl"),
            start: parseInt(attr(override.query("w:startOverride"), "w:val") || "1")
        }));
    }
    async parseComments() {
        try {
            const content = await this.zip
                .file("word/comments.xml")
                ?.async("string");
            if (!content) {
                return;
            }
            const commentsDoc = xmlDOM(content);
            const commentList = commentsDoc.queryAll("w:comment");
            // First pass: parse all comments into the expected format
            commentList.forEach((comment) => {
                const id = attr(comment, "w:id");
                const dateStr = attr(comment, "w:date");
                this.comments[id] = {
                    user: 0,
                    username: attr(comment, "w:author") || gettext("Unknown"),
                    date: dateStr ? new Date(dateStr).getTime() : Date.now(),
                    comment: this.extractCommentContent(comment),
                    answers: [],
                    resolved: false,
                    isMajor: false
                };
            });
        }
        catch (err) {
            console.warn("Could not parse comments", err);
        }
    }
    async parseCommentsExtended() {
        try {
            const content = await this.zip
                .file("word/commentsExtended.xml")
                ?.async("string");
            if (!content) {
                return;
            }
            const commentsExDoc = xmlDOM(content);
            const extendedEntries = commentsExDoc.queryAll("w15:commentEx");
            if (!extendedEntries.length) {
                return;
            }
            // Parse extended entries into main (no parentParaId) and answer entries
            const mainEntries = [];
            const answerEntries = [];
            extendedEntries.forEach((entry) => {
                const paraId = attr(entry, "w15:paraId");
                const done = attr(entry, "w15:done") === "1";
                const paraIdParent = attr(entry, "w15:paraIdParent");
                if (paraId) {
                    if (paraIdParent) {
                        answerEntries.push({
                            paraId,
                            parentParaId: paraIdParent,
                            done
                        });
                    }
                    else {
                        mainEntries.push({ paraId, done });
                    }
                }
            });
            // Map resolved status to comments by position/order.
            // Main comments are written first in comments.xml, and their
            // extended entries appear first in commentsExtended.xml.
            const commentIds = Object.keys(this.comments)
                .map(Number)
                .sort((a, b) => a - b)
                .map(String);
            // Track which comment IDs are parents vs answers
            const parentCommentIds = [];
            commentIds.forEach((commentId, index) => {
                if (index < mainEntries.length) {
                    // This is a main comment - apply resolved status
                    this.comments[commentId].resolved = mainEntries[index].done;
                    parentCommentIds.push(commentId);
                }
                else {
                    // This is an answer comment - group under nearest parent
                    const answerComment = this.comments[commentId];
                    if (answerComment) {
                        // Find the parent - answers are written right after
                        // their parent comment in comments.xml
                        const answerIndex = index - mainEntries.length;
                        const answerEntry = answerEntries[answerIndex];
                        if (answerEntry) {
                            // Map answer to its parent comment
                            const parentId = parentCommentIds.length
                                ? parentCommentIds[parentCommentIds.length - 1]
                                : null;
                            if (parentId && this.comments[parentId]?.answers) {
                                this.comments[parentId].answers.push({
                                    id: randomCommentId(),
                                    user: 0,
                                    username: answerComment.username,
                                    date: answerComment.date,
                                    answer: answerComment.comment
                                });
                                // Remove the answer from top-level
                                delete this.comments[commentId];
                            }
                        }
                    }
                }
            });
        }
        catch (err) {
            console.warn("Could not parse comments extended", err);
        }
    }
    extractCommentContent(comment) {
        const content = [];
        comment.queryAll("w:p").forEach((p) => {
            content.push({
                type: "paragraph",
                content: this.extractParagraphContent(p)
            });
        });
        return content;
    }
    async parseFootnotes() {
        try {
            const content = await this.zip
                .file("word/footnotes.xml")
                ?.async("string");
            if (!content) {
                return;
            }
            const footnotesDoc = xmlDOM(content);
            footnotesDoc.queryAll("w:footnote").forEach((footnote) => {
                const id = attr(footnote, "w:id");
                if (id === "0" || id === "-1") {
                    return; // Skip separator footnotes
                }
                this.footnotes[id] = {
                    id,
                    content: this.extractBlockContent(footnote)
                };
            });
        }
        catch (err) {
            console.warn("Could not parse footnotes", err);
        }
    }
    // async parseFootnotes() {
    //     try {
    //         const content = await this.zip
    //             .file("word/footnotes.xml")
    //             ?.async("string")
    //         if (!content) {
    //             return
    //         }
    //         const footnotesDoc = xmlDOM(content)
    //         footnotesDoc.queryAll("w:footnote").forEach(footnote => {
    //             const id = footnote.getAttribute("w:id")
    //             if (id === "0" || id === "-1") {
    //                 return // Skip separator footnotes
    //             }
    //             // Process each paragraph in the footnote
    //             const paragraphs = []
    //             footnote.queryAll("w:p").forEach(p => {
    //                 paragraphs.push({
    //                     type: "paragraph",
    //                     content: this.extractParagraphContent(p)
    //                 })
    //             })
    //             this.footnotes[id] = {
    //                 id,
    //                 content: paragraphs
    //             }
    //         })
    //     } catch (err) {
    //         console.warn("Could not parse footnotes", err)
    //     }
    // }
    // extractParagraphContent(p) {
    //     const content = []
    //     // Handle field codes (for cross-references)
    //     const fieldRuns = []
    //     let currentFieldCode = null
    //     let collectingField = false
    //     p.queryAll("w:r").forEach(r => {
    //         const fieldChar = r.query("w:fldChar")
    //         if (fieldChar) {
    //             const type = fieldChar.getAttribute("w:fldCharType")
    //             if (type === "begin") {
    //                 collectingField = true
    //                 currentFieldCode = { code: "", result: "" }
    //             } else if (type === "separate") {
    //                 collectingField = false
    //             } else if (type === "end") {
    //                 if (currentFieldCode) {
    //                     fieldRuns.push(currentFieldCode)
    //                     currentFieldCode = null
    //                 }
    //             }
    //         } else if (collectingField && currentFieldCode) {
    //             const instrText = r.query("w:instrText")
    //             if (instrText) {
    //                 currentFieldCode.code += instrText.textContent
    //             }
    //         } else if (currentFieldCode) {
    //             const text = r.query("w:t")?.textContent
    //             if (text) {
    //                 currentFieldCode.result += text
    //             }
    //         }
    //         // Normal text processing
    //         const text = r.query("w:t")?.textContent
    //         if (!text && !r.query("w:drawing") && !r.query("w:pict")) {
    //             // Check for breaks
    //             if (r.query("w:br")) {
    //                 content.push({ type: "hard_break" })
    //             }
    //             return
    //         }
    //         // Check for hyperlinks
    //         const hyperlink = r.closest("w:hyperlink")
    //         if (hyperlink && !r.query("w:drawing") && !r.query("w:pict")) {
    //             // This will be handled separately
    //             return
    //         }
    //         const rPr = r.query("w:rPr")
    //         const formatting = rPr ? this.extractRunProperties(rPr) : {}
    //         if (text) {
    //             content.push({
    //                 type: "text",
    //                 text,
    //                 marks: this.createMarksFromFormatting(formatting)
    //             })
    //         }
    //     })
    //     // Process hyperlinks in the paragraph
    //     p.queryAll("w:hyperlink").forEach(hyperlink => {
    //         const rId = hyperlink.getAttribute("r:id")
    //         const anchor = hyperlink.getAttribute("w:anchor")
    //         // Collect all text from the hyperlink
    //         let linkText = ""
    //         hyperlink.queryAll("w:r").forEach(r => {
    //             const t = r.query("w:t")
    //             if (t) {
    //                 linkText += t.textContent
    //             }
    //         })
    //         if (linkText) {
    //             let href = "#"
    //             if (rId && this.relationships[rId]) {
    //                 href = this.relationships[rId].target
    //             } else if (anchor) {
    //                 href = `#${anchor}`
    //             }
    //             content.push({
    //                 type: "text",
    //                 text: linkText,
    //                 marks: [{
    //                     type: "link",
    //                     attrs: {
    //                         href,
    //                         title: linkText
    //                     }
    //                 }]
    //             })
    //         }
    //     })
    //     // Process field runs for cross-references
    //     fieldRuns.forEach(field => {
    //         if (field.code.startsWith("REF ")) {
    //             const target = field.code.substring(4).trim().split(/\s+/)[0]
    //             content.push({
    //                 type: "cross_reference",
    //                 attrs: {
    //                     id: target,
    //                     title: field.result || target
    //                 }
    //             })
    //         }
    //     })
    //     // Handle equations
    //     const oMath = p.query("m:oMath")
    //     if (oMath) {
    //         // Very basic LaTeX conversion (would need a proper OMML to LaTeX converter)
    //         const latex = "x^2" // Placeholder - should use a proper converter
    //         content.push({
    //             type: "equation",
    //             attrs: {
    //                 equation: latex
    //             }
    //         })
    //     }
    //     return content
    // }
    async parseEndnotes() {
        try {
            const content = await this.zip
                .file("word/endnotes.xml")
                ?.async("string");
            if (!content) {
                return;
            }
            const endnotesDoc = xmlDOM(content);
            endnotesDoc.queryAll("w:endnote").forEach((endnote) => {
                const id = attr(endnote, "w:id");
                if (id === "0" || id === "-1") {
                    return; // Skip separator endnotes
                }
                this.endnotes[id] = {
                    id,
                    content: this.extractBlockContent(endnote)
                };
            });
        }
        catch (err) {
            console.warn("Could not parse endnotes", err);
        }
    }
    async parseRelationships() {
        try {
            const content = await this.zip
                .file("word/_rels/document.xml.rels")
                ?.async("string");
            if (!content) {
                return;
            }
            const relsDoc = xmlDOM(content);
            relsDoc.queryAll("Relationship").forEach((rel) => {
                const id = attr(rel, "Id");
                this.relationships[id] = {
                    id,
                    type: attr(rel, "Type"),
                    target: attr(rel, "Target")
                };
            });
        }
        catch (err) {
            console.warn("Could not parse relationships", err);
        }
    }
    async parseImages() {
        // Find and extract image files
        const imageFiles = Object.keys(this.zip.files).filter((path) => path.startsWith("word/media/"));
        for (const path of imageFiles) {
            try {
                const file = this.zip.file(path);
                if (!file) {
                    continue;
                }
                const blob = await file.async("blob");
                const filename = path.split("/").pop() || "";
                const content = this.addMimeType(blob, filename);
                this.images[filename] = content;
            }
            catch (err) {
                console.warn(`Could not parse image ${path}`, err);
            }
        }
    }
    addMimeType(blob, filename) {
        return new File([blob], filename, {
            type: this.getImageFileType(filename)
        });
    }
    getImageFileType(filename) {
        const ext = filename.split(".").pop()?.toLowerCase();
        switch (ext) {
            case "avif":
            case "avifs":
                return "image/avif";
            case "png":
                return "image/png";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "gif":
                return "image/gif";
            case "svg":
                return "image/svg+xml";
            case "webp":
                return "image/webp";
            default:
                return "image/png"; // Default fallback
        }
    }
    extractBlockContent(node) {
        const content = [];
        node.queryAll("w:p").forEach((p) => {
            content.push({
                type: "paragraph",
                content: this.extractParagraphContent(p)
            });
        });
        return content;
    }
    extractParagraphContent(p) {
        const content = [];
        p.queryAll("w:r").forEach((r) => {
            const text = r.query("w:t")?.textContent;
            if (!text) {
                return;
            }
            const rPr = r.query("w:rPr");
            const formatting = rPr ? this.extractRunProperties(rPr) : {};
            content.push({
                type: "text",
                text,
                marks: this.createMarksFromFormatting(formatting)
            });
        });
        return content;
    }
    createMarksFromFormatting(formatting) {
        const marks = [];
        if (formatting.bold) {
            marks.push({ type: "strong" });
        }
        if (formatting.italic) {
            marks.push({ type: "em" });
        }
        if (formatting.underline) {
            marks.push({ type: "underline" });
        }
        return marks;
    }
    async parseCoreDoc() {
        try {
            const content = await this.zip
                .file("docProps/core.xml")
                ?.async("string");
            if (!content) {
                return;
            }
            this.coreDoc = xmlDOM(content);
        }
        catch (err) {
            console.warn("Could not parse core doc", err);
        }
    }
    async parseCustomDoc() {
        try {
            const content = await this.zip
                .file("docProps/custom.xml")
                ?.async("string");
            if (!content) {
                return;
            }
            this.customDoc = xmlDOM(content);
        }
        catch (err) {
            console.warn("Could not parse custom doc", err);
        }
    }
    async parseDocument() {
        try {
            const content = await this.zip
                .file("word/document.xml")
                ?.async("string");
            if (!content) {
                return;
            }
            this.document = xmlDOM(content);
        }
        catch (err) {
            console.warn("Could not parse document", err);
        }
    }
}
//# sourceMappingURL=parse.js.map