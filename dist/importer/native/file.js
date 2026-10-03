import { escapeText, gettext } from "fwtoolkit";
import { FW_DOCUMENT_VERSION } from "../../schema/index.js";
import { updateFile } from "./update.js";
import { updateTemplateFile } from "./update_template.js";
import { NativeImporter } from "./importer.js";
export const MIN_FW_DOCUMENT_VERSION = 1.6;
export const MAX_FW_DOCUMENT_VERSION = Number.parseFloat(FW_DOCUMENT_VERSION);
/** Accepted `mimetype` entry values for `.fidus` files.
 * The canonical vendor type and the historical alias are both accepted so
 * that files produced by any Fidus Writer version can be imported.
 */
export const FIDUS_MIMETYPES = [
    "application/fidus+zip",
    "application/vnd.fiduswriter+zip"
];
const TEXT_FILENAMES = [
    "mimetype",
    "filetype-version",
    "document.json",
    "images.json",
    "bibliography.json"
];
export class FidusFileImporter {
    file;
    user;
    path;
    check;
    contacts;
    e2eeOptions;
    checkDocUsers;
    textFiles = [];
    otherFiles = [];
    ok = false;
    statusText = "";
    doc = null;
    docInfo = null;
    template = null;
    backend;
    constructor(file, user, path, backend, options = {}) {
        this.file = file;
        this.user = user;
        this.path = path;
        this.check = options.check ?? false;
        this.contacts = options.contacts || [];
        this.e2eeOptions = options.e2eeOptions ?? null;
        this.checkDocUsers = options.checkDocUsers;
        this.backend = backend;
    }
    init() {
        if (!this.check) {
            return this.initZipFileRead();
        }
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result;
                if (result.length > 60 &&
                    result.substring(0, 2) === "PK") {
                    this.initZipFileRead().then(() => resolve(this));
                }
                else {
                    this.statusText = gettext("The uploaded file does not appear to be a Fidus Writer file.");
                    resolve(this);
                }
            };
            reader.readAsText(this.file);
        });
    }
    initZipFileRead() {
        return import("jszip")
            .then(({ default: JSZip }) => new JSZip())
            .then(zipfs => zipfs.loadAsync(this.file))
            .then(zipfs => {
            const filenames = [];
            const p = [];
            let validFile = true;
            zipfs.forEach(filename => filenames.push(filename));
            TEXT_FILENAMES.forEach(filename => {
                if (filenames.indexOf(filename) === -1) {
                    validFile = false;
                }
            });
            if (!validFile) {
                this.statusText = gettext("The uploaded file does not appear to be a Fidus Writer file.");
                return this;
            }
            filenames
                .filter(filename => !filename.endsWith("/"))
                .forEach(filename => {
                p.push(new Promise(resolve => {
                    const isText = ["mimetype", "filetype-version"].includes(filename) || filename.endsWith(".json");
                    zipfs.files[filename]
                        .async(isText ? "string" : "blob")
                        .then(content => {
                        if (isText) {
                            this.textFiles.push({
                                filename,
                                content: content
                            });
                        }
                        else {
                            this.otherFiles.push({
                                filename,
                                content: content
                            });
                        }
                        resolve();
                    });
                }));
            });
            return Promise.all(p).then(() => this.processFidusFile());
        });
    }
    processFidusFile() {
        const filetypeVersionFile = this.textFiles.find(file => file.filename === "filetype-version"), mimeTypeFile = this.textFiles.find(file => file.filename === "mimetype");
        if (!filetypeVersionFile || !mimeTypeFile) {
            this.statusText = gettext("The uploaded file does not appear to be a Fidus Writer file.");
            return Promise.resolve(this);
        }
        const filetypeVersion = Number.parseFloat(filetypeVersionFile.content), mimeType = mimeTypeFile.content;
        if (FIDUS_MIMETYPES.includes(mimeType) &&
            filetypeVersion >= MIN_FW_DOCUMENT_VERSION &&
            filetypeVersion <= MAX_FW_DOCUMENT_VERSION) {
            const documentFile = this.textFiles.find(file => file.filename === "document.json"), bibliographyFile = this.textFiles.find(file => file.filename === "bibliography.json"), imagesFile = this.textFiles.find(file => file.filename === "images.json");
            if (!documentFile || !bibliographyFile || !imagesFile) {
                this.statusText = gettext("The uploaded file does not appear to be a Fidus Writer file.");
                return Promise.resolve(this);
            }
            const updatedFile = updateFile(JSON.parse(documentFile.content), filetypeVersion, JSON.parse(bibliographyFile.content), JSON.parse(imagesFile.content)), bibliography = updatedFile.bibliography, images = updatedFile.images;
            let doc = updatedFile.doc;
            if (this.check && this.checkDocUsers) {
                doc = this.checkDocUsers(doc, this.user, this.contacts);
            }
            const templateFiles = this.otherFiles.filter(file => file.filename.startsWith("exporttemplates/") ||
                file.filename.startsWith("documentstyles/"));
            this.otherFiles = this.otherFiles.filter(file => !file.filename.startsWith("exporttemplates/") &&
                !file.filename.startsWith("documentstyles/"));
            const templateFile = this.textFiles.find(file => file.filename === "template.json");
            if (templateFile) {
                const exporttemplatesFile = this.textFiles.find(file => file.filename === "exporttemplates.json"), documentstylesFile = this.textFiles.find(file => file.filename === "documentstyles.json");
                if (!exporttemplatesFile || !documentstylesFile) {
                    this.statusText = gettext("The uploaded file does not appear to be a Fidus Writer file.");
                    return Promise.resolve(this);
                }
                const templateDef = JSON.parse(templateFile.content);
                this.template = updateTemplateFile(templateDef.attrs.template, templateDef, JSON.parse(exporttemplatesFile.content), JSON.parse(documentstylesFile.content), filetypeVersion);
                this.template.files = templateFiles;
            }
            const safeTitle = doc.title.replace(/\//g, "");
            const importer = new NativeImporter(doc, bibliography, { db: images }, this.otherFiles, this.user, this.backend, {
                importId: null,
                requestedPath: this.path.endsWith("/")
                    ? this.path + safeTitle
                    : this.path,
                template: this.template,
                e2eeOptions: this.e2eeOptions
            });
            return importer.init().then(({ doc: importedDoc, docInfo }) => {
                this.ok = true;
                this.doc = importedDoc;
                this.docInfo = docInfo;
                this.statusText = `${escapeText(importedDoc.title)} ${gettext("successfully imported.")}`;
                return this;
            });
        }
        this.statusText =
            gettext("The uploaded file does not appear to be of the version used on this server: ") + FW_DOCUMENT_VERSION;
        return Promise.resolve(this);
    }
}
//# sourceMappingURL=file.js.map