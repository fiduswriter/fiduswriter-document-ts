import { escapeText } from "fwtoolkit";
import { PandocConvert } from "./convert.js";
import { NativeImporter } from "../native/importer.js";
export class PandocImporter {
    file;
    user;
    path;
    importId;
    additionalFiles;
    e2eeOptions;
    getTemplate;
    importBibliography;
    nativeBackend;
    template = null;
    output = {
        ok: false,
        statusText: "",
        doc: null,
        docInfo: null
    };
    title = "Untitled";
    constructor(file, user, path, importId, options) {
        this.file = file;
        this.user = user;
        this.path = path;
        this.importId = importId;
        this.additionalFiles =
            options.files || {};
        this.e2eeOptions = options.e2eeOptions ?? null;
        this.getTemplate = options.getTemplate;
        this.importBibliography = options.importBibliography;
        this.nativeBackend = options.nativeBackend;
    }
    async init() {
        await this.getTemplate(this.importId)
            .then(template => {
            this.template = template;
        })
            .catch(error => {
            this.output.statusText = error.message;
        });
        if (this.output.statusText) {
            return this.output;
        }
        const text = await this.file.text();
        return this.handlePandocJson(text, this.additionalFiles?.images, this.additionalFiles?.bibliography);
    }
    handlePandocJson(jsonString, images = {}, bibString = "") {
        let pandocJson;
        try {
            pandocJson = JSON.parse(jsonString);
        }
        catch (error) {
            this.output.statusText = error.message;
            return Promise.resolve(this.output);
        }
        return this.importBibliography(bibString)
            .then(bibliography => {
            const converter = new PandocConvert(pandocJson, this.importId, this.template, bibliography);
            let convertedDoc;
            try {
                convertedDoc = converter.init();
            }
            catch (error) {
                this.output.statusText = error.message;
                console.error(error);
                return this.output;
            }
            const firstText = convertedDoc.content.content?.[0]?.content?.[0]?.text;
            if (["Untitled", ""].includes(firstText || "")) {
                const firstContentNode = convertedDoc.content
                    .content?.[0]?.content?.[0];
                if (firstContentNode) {
                    firstContentNode.text = this.title;
                }
            }
            else {
                this.title = firstText || this.title;
            }
            const nativeImporter = new NativeImporter({
                content: convertedDoc.content,
                title: this.title,
                comments: {},
                settings: convertedDoc.settings
            }, bibliography, { db: converter.images || {} }, Object.entries(images).map(([filename, blob]) => ({
                filename,
                content: blob
            })), this.user, this.nativeBackend, {
                importId: null,
                requestedPath: this.path + this.title,
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
        })
            .catch(error => {
            this.output.statusText = error.message;
            console.error(error);
            return this.output;
        });
    }
}
//# sourceMappingURL=index.js.map