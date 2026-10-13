import { ZipFileCreator } from "fwtoolkit/file/zip";
import { FW_DOCUMENT_VERSION } from "../../schema/index.js";
export class ZipFidus {
    docId;
    doc;
    shrunkImageDB;
    shrunkBibDB;
    httpFiles;
    includeTemplate;
    token;
    getTemplateFiles;
    textFiles = [];
    constructor(docId, doc, shrunkImageDB, shrunkBibDB, httpFiles, includeTemplate = true, token = false, getTemplateFiles) {
        this.docId = docId;
        this.doc = doc;
        this.shrunkImageDB = shrunkImageDB;
        this.shrunkBibDB = shrunkBibDB;
        this.httpFiles = httpFiles;
        this.includeTemplate = includeTemplate;
        this.token = token;
        this.getTemplateFiles = getTemplateFiles;
        this.textFiles = [
            {
                filename: "document.json",
                contents: JSON.stringify(this.doc)
            },
            {
                filename: "images.json",
                contents: JSON.stringify(this.shrunkImageDB)
            },
            {
                filename: "bibliography.json",
                contents: JSON.stringify(this.shrunkBibDB)
            },
            {
                filename: "filetype-version",
                contents: FW_DOCUMENT_VERSION
            }
        ];
    }
    init() {
        if (!this.includeTemplate || !this.getTemplateFiles) {
            return this.createZip();
        }
        return this.getTemplateFiles(this.docId, this.token).then(({ textFiles, httpFiles }) => {
            this.textFiles = this.textFiles.concat(textFiles);
            this.httpFiles = this.httpFiles.concat(httpFiles);
            return this.createZip();
        });
    }
    createZip() {
        const zipper = new ZipFileCreator(this.textFiles, this.httpFiles, [], "application/vnd.fiduswriter+zip");
        return zipper.init();
    }
}
//# sourceMappingURL=zip.js.map