import { HTMLExporter } from "../html/index.js";
import { formatHtml, formatXml } from "../tools/format.js";
import { containerTemplate, navTemplate, ncxTemplate, opfTemplate } from "./templates.js";
import { buildHierarchy, getFontMimeType, getImageMimeType, getTimestamp } from "./tools.js";
export class EpubExporter extends HTMLExporter {
    documentFileName;
    lang;
    shortLang;
    progressCallback;
    constructor(doc, bibDB, imageDB, csl, updated, documentStyles, converterOptions = {}, progressCallback) {
        super(doc, bibDB, imageDB, csl, updated, documentStyles, {
            xhtml: true,
            epub: true,
            ...converterOptions
        });
        this.progressCallback = progressCallback;
        // Overriden properties
        this.documentFileName = "document.xhtml";
        this.contentFileName = "document.xhtml";
        this.fileEnding = "epub";
        this.mimeType = "application/epub+zip";
        this.lang = doc.settings.language || "en-US";
        this.shortLang = this.lang.split("-")[0];
    }
    async createZip() {
        this.prefixFiles();
        await this.createEPUBFiles();
        return super.createZip();
    }
    prefixFiles() {
        // prefix all files with "EPUB/"
        this.textFiles = this.textFiles.map(file => Object.assign({}, file, { filename: `EPUB/${file.filename}` }));
        this.httpFiles = this.httpFiles.map(file => Object.assign({}, file, { filename: `EPUB/${file.filename}` }));
        this.includeZips = this.includeZips.map(file => Object.assign({}, file, { directory: `EPUB/${file.directory}` }));
    }
    async createEPUBFiles() {
        // Generate the required EPUB-specific files using the converted content
        this.textFiles.push({
            filename: "META-INF/container.xml",
            contents: await formatXml(containerTemplate())
        }, {
            filename: "EPUB/document.opf",
            contents: await formatXml(this.createOPF())
        }, {
            filename: "EPUB/document.ncx",
            contents: await formatXml(this.createNCX())
        }, {
            filename: "EPUB/document-nav.xhtml",
            contents: await formatHtml(this.createNav())
        });
    }
    createOPF() {
        const timestamp = getTimestamp(this.updated);
        const images = this.httpFiles
            .map(file => Object.assign({ mimeType: getImageMimeType(file.filename) }, file))
            .filter(image => image.mimeType);
        const fontFiles = this.httpFiles
            .map(file => Object.assign({ mimeType: getFontMimeType(file.filename) }, file))
            .filter(file => file.mimeType);
        const styleSheets = this.textFiles.filter(file => file.filename.endsWith(".css"));
        // Extract authors and keywords from metaData
        const rawAuthors = this.converter.metaData.authors.map((node) => {
            const author = (node.attrs || {});
            if (author.firstname || author.lastname) {
                const nameParts = [];
                if (author.firstname) {
                    nameParts.push(author.firstname);
                }
                if (author.lastname) {
                    nameParts.push(author.lastname);
                }
                return nameParts.join(" ");
            }
            else if (author.institution) {
                return author.institution;
            }
            return undefined;
        });
        const authors = rawAuthors.filter((author) => typeof author === "string");
        return opfTemplate({
            language: this.lang,
            title: this.docTitle,
            authors,
            keywords: this.converter.metaData.keywords,
            idType: "fidus",
            id: String(this.doc.id),
            date: timestamp.slice(0, 10),
            modified: timestamp,
            styleSheets,
            math: this.converter.features.math &&
                this.converter.mathOutput !== "svg",
            images,
            fontFiles,
            copyright: this.doc.settings.copyright
        });
    }
    createNCX() {
        return ncxTemplate({
            shortLang: this.shortLang,
            title: this.docTitle,
            idType: "fidus",
            id: String(this.doc.id),
            toc: buildHierarchy(this.converter.metaData.toc)
        });
    }
    createNav() {
        const styleSheets = this.textFiles.filter(file => file.filename.endsWith(".css"));
        return navTemplate({
            shortLang: this.shortLang,
            toc: buildHierarchy(this.converter.metaData.toc),
            styleSheets
        });
    }
}
//# sourceMappingURL=index.js.map