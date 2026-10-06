import { BibLatexExporter } from "bibliojson";
import download from "downloadjs";
import { gettext, shortFileTitle } from "fwtoolkit";
import { fixTables, removeHidden } from "../tools/doc_content.js";
import { createSlug, getImageExtension } from "../tools/file.js";
import { ZipFileCreator } from "fwtoolkit/file/zip";
import { PandocExporterCitations } from "./citations.js";
import { PandocExporterConvert } from "./convert.js";
import { readMe } from "./readme.js";
/*
 Exporter to Pandoc JSON
*/
export class PandocExporter {
    doc;
    docTitle;
    bibDB;
    imageDB;
    csl;
    updated;
    docContent;
    zipFileName;
    textFiles;
    httpFiles;
    citations;
    progressCallback;
    constructor(doc, bibDB, imageDB, csl, updated, progressCallback) {
        this.doc = doc;
        this.docTitle = shortFileTitle(this.doc.title, this.doc.path || "");
        this.bibDB = bibDB;
        this.imageDB = imageDB;
        this.csl = csl;
        this.updated = updated;
        this.progressCallback = progressCallback;
        this.docContent = false;
        this.zipFileName = "";
        this.textFiles = [];
        this.httpFiles = [];
    }
    init() {
        this.progressCallback?.(gettext("Exporting to Pandoc..."), 0);
        //this.docContent = removeHidden(this.doc.content) //
        const docContent = fixTables(removeHidden(this.doc.content));
        this.docContent = docContent;
        const citations = new PandocExporterCitations(this, this.bibDB, this.csl, docContent);
        this.citations = citations;
        const converter = new PandocExporterConvert(this, this.imageDB, this.bibDB, this.doc.settings);
        return citations.init().then(() => {
            this.progressCallback?.(gettext("Converting document..."), 40);
            this.conversion = converter.init(docContent);
            if (Object.keys(this.conversion.usedBibDB).length > 0) {
                const bibExport = new BibLatexExporter(this.conversion.usedBibDB);
                this.textFiles.push({
                    filename: "bibliography.bib",
                    contents: bibExport.parse()
                });
            }
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
                    const imageUrl = imageValue;
                    this.httpFiles.push({
                        filename: imageUrl.split("/").pop(),
                        url: imageUrl
                    });
                }
            });
            return this.createExport();
        });
    }
    conversion;
    createExport() {
        // Override this function if adding a conversion-through-pandoc step.
        this.textFiles.push({
            filename: "document.json",
            contents: JSON.stringify(this.conversion.json, null, 4)
        });
        this.textFiles.push({ filename: "README.txt", contents: readMe });
        this.zipFileName = `${createSlug(this.docTitle)}.pandoc.json.zip`;
        this.progressCallback?.(gettext("Creating Pandoc archive..."), 90);
        return this.createDownload().then(downloadResult => {
            this.progressCallback?.(gettext("Export to Pandoc complete."), 100);
            return downloadResult;
        });
    }
    createDownload() {
        const zipper = new ZipFileCreator(this.textFiles, this.httpFiles, undefined, undefined, this.updated);
        return zipper
            .init()
            .then(blob => this.download(blob));
    }
    download(blob) {
        return download(blob, this.zipFileName, "application/zip");
    }
}
//# sourceMappingURL=index.js.map