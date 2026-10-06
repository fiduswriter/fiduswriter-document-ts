import { escapeText } from "fwtoolkit";
import { OdtConvert } from "./convert.js";
import { NativeImporter } from "../native/importer.js";
export class OdtImporter {
    file;
    user;
    path;
    importId;
    bibDB;
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
        this.getTemplate = options.getTemplate;
        this.nativeBackend = options.nativeBackend;
        this.e2eeOptions = options.e2eeOptions ?? null;
    }
    init() {
        return this.getTemplate(this.importId)
            .then(template => {
            this.template = template;
            return this.importOdt();
        })
            .catch(error => {
            this.output.statusText = error.message;
            return this.output;
        });
    }
    importOdt() {
        return import("jszip")
            .then(({ default: JSZip }) => this.file.arrayBuffer().then(ab => JSZip.loadAsync(ab)))
            .then(zip => {
            const contentPromise = zip.file("content.xml")?.async("string");
            const stylePromise = zip.file("styles.xml")?.async("string");
            const metaPromise = zip.file("meta.xml")?.async("string");
            const manifestPromise = zip
                .file("META-INF/manifest.xml")
                ?.async("string");
            if (!contentPromise) {
                this.output.statusText = "File does not contain content.xml";
                return Promise.resolve(this.output);
            }
            const imageFiles = {};
            zip.forEach((relativePath, zipEntry) => {
                if (relativePath.startsWith("Pictures/")) {
                    imageFiles[relativePath] = zipEntry;
                }
            });
            const imagePromises = Object.entries(imageFiles).map(([filename, zipEntry]) => zipEntry.async("blob").then((blob) => ({
                filename,
                blob
            })));
            return Promise.all([
                contentPromise,
                stylePromise,
                metaPromise,
                manifestPromise,
                Promise.all(imagePromises)
            ]).then(([contentXml, stylesXml, metaXml, manifestXml, images]) => {
                const imageObj = {};
                images.forEach(({ filename, blob }) => {
                    imageObj[filename] = blob;
                });
                return this.handleOdtContent(contentXml, stylesXml, metaXml, manifestXml, imageObj);
            });
        });
    }
    handleOdtContent(contentXml, stylesXml, metaXml, manifestXml, images = {}) {
        const bibliography = {};
        const converter = new OdtConvert(contentXml, stylesXml || "", metaXml || "", manifestXml || "", this.importId, this.template, bibliography, this.bibDB);
        let convertedDoc;
        try {
            convertedDoc = converter.init();
        }
        catch (error) {
            this.output.statusText = error instanceof Error ? error.message : String(error);
            console.error(error);
            return Promise.resolve(this.output);
        }
        const title = convertedDoc.content.content?.[0].content?.[0].text ||
            "Untitled";
        const nativeImporter = new NativeImporter({
            content: convertedDoc.content,
            title,
            comments: convertedDoc.comments,
            settings: convertedDoc.settings
        }, bibliography, { db: converter.images || {} }, Object.entries(images).map(([filename, blob]) => ({
            filename,
            content: blob
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