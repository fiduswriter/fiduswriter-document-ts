import { addAlert, gettext } from "fwtoolkit";
import { GetImages } from "./get_images.js";
import { extractTemplate } from "./extract_template.js";
export class NativeImporter {
    doc;
    docId;
    path;
    bibliography;
    images;
    otherFiles;
    user;
    importId;
    requestedPath;
    template;
    e2eeOptions;
    backend;
    constructor(doc, bibliography, images, otherFiles, user, backend, options = {}) {
        this.doc = doc;
        this.docId = 0;
        this.path = "";
        this.bibliography = bibliography;
        this.images = images;
        this.otherFiles = otherFiles;
        this.user = user;
        this.importId = options.importId ?? null;
        this.requestedPath = options.requestedPath || "";
        this.template = options.template ?? null;
        this.e2eeOptions = options.e2eeOptions ?? null;
        this.backend = backend;
    }
    init() {
        const imageGetter = new GetImages(this.images, this.otherFiles);
        return imageGetter
            .init()
            .then(() => {
            const missingImage = Object.values(this.images.db).find(imageEntry => !imageEntry.file);
            if (missingImage) {
                throw new Error(`Could not create document. Missing image file: ${String(missingImage.image)}`);
            }
        })
            .then(() => this.createDoc())
            .then(() => {
            if (!this.docId) {
                addAlert("error", gettext("Could not create document. You may have reached your document limit."));
                return Promise.reject(new Error("document not created"));
            }
            return this.saveImages();
        })
            .then((imageTranslationTable) => {
            this.translateReferenceIds(imageTranslationTable);
            return this.saveDocument();
        });
    }
    createDoc() {
        const template = this.template
            ? this.template
            : (this.backend.extractTemplate || extractTemplate)(this.doc.content);
        const jsonData = {
            template: template.content,
            export_templates: template.exportTemplates,
            document_styles: template.documentStyles,
            import_id: this.importId
                ? this.importId
                : template.content.attrs?.import_id,
            template_title: template.content.attrs
                ?.template,
            path: this.requestedPath
        };
        if (this.e2eeOptions?.enabled) {
            jsonData.e2ee = true;
            if (this.e2eeOptions.salt) {
                jsonData.e2ee_salt = this.e2eeOptions.salt;
            }
            if (this.e2eeOptions.iterations) {
                jsonData.e2ee_iterations = this.e2eeOptions.iterations;
            }
        }
        const files = {};
        if (template.files?.length) {
            files.files = template.files.map(({ filename, content }) => new File([content], filename));
        }
        return this.backend
            .createDoc(template, this.importId, this.requestedPath, this.e2eeOptions, files)
            .then(({ id, path, e2ee, template }) => {
            this.docId = id;
            this.path = path;
            this.doc.e2ee = e2ee || false;
            this.doc.template = template;
        });
    }
    saveImages() {
        return this.backend.saveImages(this.images, this.docId, this.e2eeOptions);
    }
    translateReferenceIds(imageTranslationTable) {
        const walkTree = (node) => {
            switch (node.type) {
                case "image":
                    if (node.attrs && node.attrs.image !== false) {
                        const oldId = node.attrs.image;
                        const newId = imageTranslationTable[oldId];
                        if (newId !== undefined) {
                            node.attrs.image = newId;
                        }
                        else {
                            console.warn("NativeImporter: image reference not found in translation table.", { oldId, imageTranslationTable });
                        }
                    }
                    break;
                case "footnote":
                    if (node.attrs?.footnote) {
                        ;
                        node.attrs.footnote.forEach(childNode => walkTree(childNode));
                    }
                    break;
            }
            if (node.content) {
                node.content.forEach(childNode => walkTree(childNode));
            }
        };
        walkTree(this.doc.content);
    }
    async saveDocument() {
        let saveData;
        if (this.e2eeOptions?.enabled && this.e2eeOptions.key) {
            const encryptedContent = await this.backend.encryptObject(this.doc.content, this.e2eeOptions.key);
            const encryptedComments = await this.backend.encryptObject(this.doc.comments || {}, this.e2eeOptions.key);
            const encryptedBibliography = await this.backend.encryptObject(this.bibliography, this.e2eeOptions.key);
            const encryptedTitle = await this.backend.encrypt(this.doc.title, this.e2eeOptions.key);
            saveData = {
                id: this.docId,
                title: encryptedTitle,
                content: encryptedContent,
                comments: encryptedComments,
                bibliography: encryptedBibliography
            };
        }
        else {
            saveData = {
                id: this.docId,
                title: this.doc.title,
                content: this.doc.content,
                comments: this.doc.comments,
                bibliography: this.bibliography
            };
        }
        return this.backend
            .saveDocument(saveData, this.e2eeOptions)
            .then(({ added, updated }) => {
            const docInfo = {
                is_owner: true,
                access_rights: "write",
                id: this.docId
            };
            this.doc.owner = {
                id: this.user.id,
                name: this.user.name,
                avatar: this.user.avatar
            };
            this.doc.is_owner = true;
            this.doc.version = 0;
            this.doc.comment_version = 0;
            this.doc.id = this.docId;
            this.doc.added = added;
            this.doc.updated = updated;
            this.doc.revisions = [];
            this.doc.rights = "write";
            this.doc.path = this.path;
            this.doc.e2ee = this.doc.e2ee || false;
            if (this.e2eeOptions?.enabled &&
                this.e2eeOptions.key &&
                this.docId &&
                this.backend.storeKeyInSession) {
                this.backend.storeKeyInSession(this.docId, this.e2eeOptions.key);
            }
            return { doc: this.doc, docInfo };
        });
    }
}
//# sourceMappingURL=importer.js.map