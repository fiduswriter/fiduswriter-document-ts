import { shortFileTitle, gettext } from "fwtoolkit";
import { ShrinkFidus } from "./shrink.js";
import { ZipFidus } from "./zip.js";
import { createSlug } from "../tools/file.js";
import { saveFile } from "../save.js";
export class ExportFidusFile {
    doc;
    bibDB;
    imageDB;
    includeTemplate;
    token;
    getTemplateFiles;
    progressCallback;
    shouldDownload;
    constructor(doc, bibDB, imageDB, includeTemplate = true, token = false, getTemplateFiles, progressCallback, download = true) {
        this.doc = doc;
        this.bibDB = bibDB;
        this.imageDB = imageDB;
        this.includeTemplate = includeTemplate;
        this.token = token;
        this.getTemplateFiles = getTemplateFiles;
        this.progressCallback = progressCallback;
        this.shouldDownload = download;
        return this.init();
    }
    init() {
        this.progressCallback?.(gettext("File export has been initiated."), 0);
        const shrinker = new ShrinkFidus(this.doc, this.imageDB, this.bibDB, this.progressCallback);
        return shrinker
            .init()
            .then(({ doc, shrunkImageDB, shrunkBibDB, httpIncludes }) => {
            const zipper = new ZipFidus(this.doc.id, doc, shrunkImageDB, shrunkBibDB, httpIncludes, this.includeTemplate, this.token, this.getTemplateFiles);
            return zipper.init();
        })
            .then(blob => {
            this.progressCallback?.(gettext("Export complete."), 100);
            if (this.shouldDownload) {
                this.download(blob);
            }
            return blob;
        });
    }
    download(blob) {
        const title = shortFileTitle(this.doc.title, this.doc.path || "") || "untitled";
        const filename = `${createSlug(title)}.fidus`;
        return saveFile(blob, filename, {
            description: "Fidus Writer document",
            mimeType: "application/vnd.fiduswriter+zip",
            extensions: [".fidus"]
        });
    }
}
//# sourceMappingURL=file.js.map