import { escapeText } from "fwtoolkit";
import { HtmlConvert } from "./convert.js";
import { NativeImporter } from "../native/importer.js";
export class HtmlImporter {
    file;
    user;
    path;
    importId;
    bibDB;
    zipImages;
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
        this.bibDB = options.bibDB || { db: {} };
        this.zipImages = options.files?.images || {};
        this.e2eeOptions = options.e2eeOptions ?? null;
        this.getTemplate = options.getTemplate;
        this.nativeBackend = options.nativeBackend;
    }
    init() {
        return this.getTemplate(this.importId)
            .then(template => {
            this.template = template;
            return this.importHtml();
        })
            .catch(error => {
            this.output.statusText = error.message;
            return this.output;
        });
    }
    async importHtml() {
        const html = await this.file.text();
        return this.handleHtmlContent(html);
    }
    handleHtmlContent(html) {
        const converter = new HtmlConvert(html, this.importId, this.template, this.bibDB, this.zipImages);
        let convertedDoc;
        try {
            convertedDoc = converter.init();
        }
        catch (error) {
            this.output.statusText =
                error instanceof Error ? error.message : String(error);
            console.error(error);
            return Promise.resolve(this.output);
        }
        const title = convertedDoc.content.content?.[0].content
            ?.map(inline => inline.text || "")
            .join("")
            .trim() || "Untitled";
        const nativeImporter = new NativeImporter({
            content: convertedDoc.content,
            title,
            comments: convertedDoc.comments,
            settings: convertedDoc.settings
        }, { db: {} }, { db: convertedDoc.images }, convertedDoc.otherFiles.map(file => ({
            filename: file.filename,
            content: file.content,
            url: file.url
        })), this.user, this.nativeBackend, {
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
    }
}
//# sourceMappingURL=index.js.map