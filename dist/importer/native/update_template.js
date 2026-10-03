import { updateDoc } from "../../schema/convert.js";
/**
 * Update a template definition that has been read from a fidus/template file
 * to the current document schema version.
 */
export function updateTemplateFile(title, content, exportTemplates, documentStyles, filetypeVersion) {
    const oldDoc = {
        content,
        diffs: [],
        bibliography: {},
        comments: {},
        title,
        version: 1,
        id: 1
    };
    const doc = updateDoc(oldDoc, filetypeVersion);
    return { title, content: doc.content, exportTemplates, documentStyles };
}
//# sourceMappingURL=update_template.js.map