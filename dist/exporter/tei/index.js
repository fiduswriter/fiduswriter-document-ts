import download from "downloadjs";
import { gettext, shortFileTitle } from "fwtoolkit";
import { formatXml } from "../tools/format.js";
import { createSlug, getImageDBEntryFilename } from "../tools/file.js";
import { ZipFileCreator } from "fwtoolkit/file/zip";
import { TeiExporterMath } from "./math.js";
import { TeiCitationsExporter } from "./citations.js";
import { convert } from "./convert.js";
import { extractCitations } from "./extract.js";
import { removeHidden } from "../tools/doc_content.js";
export class TEIExporter {
    doc;
    docTitle;
    bibDB;
    imageDB;
    csl;
    updated;
    options;
    zipFileName;
    textFiles;
    httpFiles;
    conversion;
    progressCallback;
    constructor(doc, bibDB, imageDB, csl, updated, options = {}, progressCallback) {
        this.doc = doc;
        this.docTitle = shortFileTitle(this.doc.title, this.doc.path || "");
        this.bibDB = bibDB;
        this.imageDB = imageDB;
        this.csl = csl;
        this.updated = updated;
        this.options = options;
        this.progressCallback = progressCallback;
        this.zipFileName = false;
        this.textFiles = [];
        this.httpFiles = [];
    }
    async init() {
        this.progressCallback?.(gettext("Exporting to TEI..."), 0);
        this.zipFileName = `${createSlug(this.docTitle)}.tei.xml.zip`;
        const docContent = removeHidden(this.doc.content);
        const citations = new TeiCitationsExporter(this.doc.settings, this.bibDB, this.csl);
        this.progressCallback?.(gettext("Formatting citations..."), 30);
        await citations.init(extractCitations(docContent));
        const mathExporter = new TeiExporterMath();
        this.conversion = convert(createSlug(this.docTitle), docContent, this.imageDB, citations, mathExporter, Object.assign({}, this.doc.settings, this.options));
        this.progressCallback?.(gettext("Assembling TEI archive..."), 70);
        this.textFiles.push({
            filename: `${createSlug(this.docTitle)}.tei.xml`,
            contents: await formatXml(this.conversion.tei)
        });
        this.addImages(this.conversion.imageIds);
        await this.createZip();
        this.progressCallback?.(gettext("Export to TEI complete."), 100);
        return Promise.resolve();
    }
    addImages(imageIds) {
        imageIds.forEach(id => {
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