import { BibLatexExporter } from "bibliojson";
import download from "downloadjs";
import { gettext, shortFileTitle } from "fwtoolkit";
import { removeHidden } from "../tools/doc_content.js";
import { createSlug, getImageDBEntryFilename } from "../tools/file.js";
import { ZipFileCreator } from "fwtoolkit/file/zip";
import { TypstExporterConvert } from "./convert.js";
import { readMe } from "./readme.js";
/*
 Exporter to Typst (https://typst.app) markup.
*/
export class TypstExporter {
    doc;
    docTitle;
    bibDB;
    imageDB;
    updated;
    docContent;
    zipFileName;
    textFiles;
    httpFiles;
    conversion;
    progressCallback;
    constructor(doc, bibDB, imageDB, updated, progressCallback) {
        this.doc = doc;
        this.docTitle = shortFileTitle(this.doc.title, this.doc.path || "");
        this.bibDB = bibDB;
        this.imageDB = imageDB;
        this.updated = updated;
        this.progressCallback = progressCallback;
        this.docContent = false;
        this.zipFileName = false;
        this.textFiles = [];
        this.httpFiles = [];
    }
    async init() {
        this.progressCallback?.(gettext("Exporting to Typst..."), 0);
        this.zipFileName = `${createSlug(this.docTitle)}.typ.zip`;
        this.docContent = removeHidden(this.doc.content);
        const converter = new TypstExporterConvert(this.imageDB, this.bibDB, this.doc.settings);
        this.conversion = converter.init(this.docContent);
        this.progressCallback?.(gettext("Preparing Typst files..."), 50);
        this.textFiles.push({
            filename: "document.typ",
            contents: this.conversion.typst
        });
        if (Object.keys(this.conversion.usedBibDB).length > 0) {
            const bibExport = new BibLatexExporter(this.conversion.usedBibDB);
            this.textFiles.push({
                filename: "bibliography.bib",
                contents: bibExport.parse()
            });
        }
        this.conversion.imageIds.forEach(id => {
            const imageEntry = this.imageDB.db[id];
            if (!imageEntry) {
                return;
            }
            const imageValue = imageEntry.image;
            const filename = getImageDBEntryFilename(imageEntry, id);
            if (imageValue instanceof Blob) {
                this.httpFiles.push({
                    filename: `images/${filename}`,
                    url: `blob:${id}`,
                    blob: imageValue
                });
            }
            else if (imageValue instanceof ArrayBuffer) {
                this.httpFiles.push({
                    filename: `images/${filename}`,
                    url: `blob:${id}`,
                    blob: new Blob([imageValue], {
                        type: imageEntry.file_type || "image/png"
                    })
                });
            }
            else if (typeof imageValue === "string") {
                this.httpFiles.push({
                    filename: `images/${filename}`,
                    url: imageValue
                });
            }
        });
        this.textFiles.push({ filename: "README.txt", contents: readMe });
        await this.createZip();
        this.progressCallback?.(gettext("Export to Typst complete."), 100);
        return Promise.resolve();
    }
    createZip() {
        const zipper = new ZipFileCreator(this.textFiles, this.httpFiles, undefined, undefined, this.updated);
        return zipper.init().then(blob => this.download(blob));
    }
    download(blob) {
        return download(blob, this.zipFileName, "application/zip");
    }
}
//# sourceMappingURL=index.js.map