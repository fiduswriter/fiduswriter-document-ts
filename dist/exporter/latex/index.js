import { BibLatexExporter } from "bibliojson";
import download from "downloadjs";
import { gettext, shortFileTitle } from "fwtoolkit";
import { fixTables, removeHidden } from "../tools/doc_content.js";
import { createSlug, getImageExtension } from "../tools/file.js";
import { ZipFileCreator } from "fwtoolkit/file/zip";
import { LatexExporterConvert } from "./convert.js";
import { readMe } from "./readme.js";
/*
 Exporter to LaTeX
*/
export class LatexExporter {
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
    init() {
        this.progressCallback?.(gettext("Exporting to LaTeX..."), 0);
        this.zipFileName = `${createSlug(this.docTitle)}.latex.zip`;
        this.docContent = fixTables(removeHidden(this.doc.content));
        const converter = new LatexExporterConvert(this, this.imageDB, this.bibDB, this.doc.settings);
        this.conversion = converter.init(this.docContent);
        this.progressCallback?.(gettext("Preparing LaTeX files..."), 50);
        if (Object.keys(this.conversion.usedBibDB).length > 0) {
            const bibExport = new BibLatexExporter(this.conversion.usedBibDB);
            this.textFiles.push({
                filename: "bibliography.bib",
                contents: bibExport.parse()
            });
        }
        this.textFiles.push({
            filename: "document.tex",
            contents: this.conversion.latex
        });
        this.textFiles.push({ filename: "README.txt", contents: readMe });
        this.conversion.imageIds.forEach((id) => {
            const imageEntry = this.imageDB.db[id];
            const imageValue = imageEntry.image;
            if (imageValue instanceof Blob) {
                const ext = getImageExtension(imageEntry.file_type, imageValue.type);
                this.httpFiles.push({
                    filename: `image-${id}.${ext}`,
                    url: `blob:${id}`,
                    blob: imageValue
                });
            }
            else {
                this.httpFiles.push({
                    filename: imageValue.split("/").pop(),
                    url: imageValue
                });
            }
        });
        return this.createZip().then(downloadResult => {
            this.progressCallback?.(gettext("Export to LaTeX complete."), 100);
            return downloadResult;
        });
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