import download from "downloadjs";
import { gettext, shortFileTitle } from "fwtoolkit";
import { formatXml } from "../tools/format.js";
import { createSlug, getImageExtension } from "../tools/file.js";
import { ZipFileCreator } from "fwtoolkit/file/zip";
import { JATSExporterConverter } from "./convert.js";
import { articleTemplate, bookPartWrapperTemplate, darManifest } from "./templates.js";
/*
 Exporter to JATS
*/
export class JATSExporter {
    doc;
    docTitle;
    bibDB;
    imageDB;
    csl;
    updated;
    type;
    zipFileName;
    textFiles;
    httpFiles;
    converter;
    progressCallback;
    constructor(doc, bibDB, imageDB, csl, updated, type, progressCallback) {
        this.doc = doc;
        this.docTitle = shortFileTitle(this.doc.title, this.doc.path || "");
        this.bibDB = bibDB;
        this.imageDB = imageDB;
        this.csl = csl;
        this.updated = updated;
        this.type = type; // "article", "book-part-wrapper" (for documents) or "book" (for document collections)
        this.progressCallback = progressCallback;
        this.zipFileName = false;
        this.textFiles = [];
        this.httpFiles = [];
    }
    async init() {
        this.progressCallback?.(gettext("Exporting to JATS..."), 0);
        const fileFormat = this.type === "article" ? "jats" : "bits";
        this.zipFileName = `${createSlug(this.docTitle)}.${fileFormat}.zip`;
        this.converter = new JATSExporterConverter(this.type, this.doc, this.csl, this.imageDB, this.bibDB);
        const { front, body, back, imageIds } = await this.converter.init();
        this.progressCallback?.(gettext("Assembling JATS archive..."), 70);
        const jats = this.type === "article"
            ? articleTemplate({ front, body, back })
            : bookPartWrapperTemplate({ front, body, back });
        this.textFiles.push({
            filename: "manuscript.xml",
            contents: await formatXml(jats)
        });
        const images = imageIds.map(id => {
            const imageEntry = this.imageDB.db[id];
            const imageValue = imageEntry.image;
            let filename;
            let url;
            let blob;
            if (imageValue instanceof Blob) {
                const ext = getImageExtension(imageEntry.file_type, imageValue.type);
                filename = `image-${id}.${ext}`;
                url = `blob:${id}`;
                blob = imageValue;
            }
            else {
                filename = imageValue.split("/").pop();
                url = imageValue;
            }
            return {
                title: imageEntry.title || "",
                filename,
                url,
                blob
            };
        });
        this.textFiles.push({
            filename: "manifest.xml",
            contents: await formatXml(darManifest({
                title: this.docTitle,
                type: this.type,
                images
            }))
        });
        images.forEach(image => {
            this.httpFiles.push({
                filename: image.filename,
                url: image.url,
                blob: image.blob
            });
        });
        const downloadResult = await this.createZip();
        this.progressCallback?.(gettext("Export to JATS complete."), 100);
        return downloadResult;
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