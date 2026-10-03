import { escapeText } from "fwtoolkit";
import { DocxConvert } from "./convert.js";
import { NativeImporter } from "../native/importer.js";
export class DocxImporter {
    file;
    user;
    path;
    importId;
    e2eeOptions;
    getTemplate;
    nativeBackend;
    template = null;
    output = {
        ok: false,
        statusText: "",
        doc: null,
        docInfo: null
    };
    constructor(file, user, path, importId, options) {
        this.file = file;
        this.user = user;
        this.path = path;
        this.importId = importId;
        this.getTemplate = options.getTemplate;
        this.nativeBackend = options.nativeBackend;
        this.e2eeOptions = options.e2eeOptions ?? null;
    }
    init() {
        return this.getTemplate(this.importId)
            .then(template => {
            this.template = template;
            return this.importDocx();
        })
            .catch(error => {
            this.output.statusText = error.message;
            return this.output;
        });
    }
    importDocx() {
        const bibliography = {};
        return import("jszip")
            .then(({ default: JSZip }) => this.file.arrayBuffer().then(ab => JSZip.loadAsync(ab)))
            .then(zip => {
            const docx = new DocxConvert(zip, this.importId, this.template, bibliography);
            return docx.init().then(convertedDoc => {
                const title = convertedDoc.content.content?.[0].content?.[0]
                    .text || "Untitled";
                const nativeImporter = new NativeImporter({
                    content: convertedDoc.content,
                    title,
                    comments: convertedDoc.comments,
                    settings: convertedDoc.settings
                }, bibliography, { db: docx.images || {} }, [], this.user, this.nativeBackend, {
                    importId: this.importId,
                    requestedPath: this.path + title,
                    template: null,
                    e2eeOptions: this.e2eeOptions
                });
                return nativeImporter
                    .init()
                    .then(({ doc, docInfo }) => {
                    this.output.ok = true;
                    this.output.doc = doc;
                    this.output.docInfo = docInfo;
                    this.output.statusText = `${escapeText(doc.title)} successfully imported.`;
                    return this.output;
                })
                    .catch(error => {
                    this.output.statusText = error.message;
                    console.error(error);
                    return this.output;
                });
            });
        });
    }
}
//# sourceMappingURL=index.js.map