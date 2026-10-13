import { docSchema } from "../../schema/document/index.js";
import { toFullJSON, toMiniJSON } from "../../schema/mini_json.js";
/**
 * Extract a document-template definition from a Fidus document's content node.
 */
export function extractTemplate(doc) {
    const template = toFullJSON(doc, docSchema);
    template.attrs.papersize = template.attrs.papersizes[0];
    template.content = template.content.filter((part) => !part.attrs || !part.attrs.deleted);
    template.content.forEach((part) => {
        delete part.content;
        if (part.type === "title") {
            delete part.attrs;
            return;
        }
        const attrs = (part.attrs || {});
        if (attrs.initial) {
            part.content = JSON.parse(JSON.stringify(attrs.initial));
        }
        else if (["heading_part", "richtext_part"].includes(part.type)) {
            part.content = [{ type: attrs.elements[0] }];
        }
        else if (part.type === "table") {
            part.content = [
                {
                    type: "table",
                    content: [
                        {
                            type: "table_row",
                            content: [
                                {
                                    type: "table_cell",
                                    content: [{ type: "paragraph" }]
                                }
                            ]
                        }
                    ]
                }
            ];
        }
        delete attrs.deleted;
        if (!attrs.help) {
            delete attrs.help;
        }
        if (!attrs.language) {
            delete attrs.language;
        }
        if (!attrs.locking) {
            delete attrs.locking;
        }
        if (!attrs.initial) {
            delete attrs.initial;
        }
        if (!attrs.metadata) {
            delete attrs.metadata;
        }
        delete attrs.hidden;
        if (attrs.optional === "hidden") {
            attrs.hidden = true;
        }
        if (!attrs.optional) {
            delete attrs.optional;
        }
    });
    const documentStyles = [
        {
            title: template.attrs.documentstyle,
            slug: template.attrs.documentstyle,
            contents: "",
            files: []
        }
    ];
    return {
        content: toMiniJSON(docSchema.nodeFromJSON(template)),
        documentStyles: documentStyles,
        exportTemplates: [],
        files: []
    };
}
//# sourceMappingURL=extract_template.js.map