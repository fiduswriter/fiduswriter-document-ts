import download from "downloadjs";
import { gettext, shortFileTitle } from "fwtoolkit";
import { fixTables, removeHidden, textContent } from "../tools/doc_content.js";
import { createSlug } from "../tools/file.js";
import { XmlZip as XmlZipImpl } from "../tools/xml_zip.js";
import { ODTExporterCitations } from "./citations.js";
import { ODTExporterFootnotes } from "./footnotes.js";
import { ODTExporterImages } from "./images.js";
import { ODTExporterMath } from "./math.js";
import { ODTExporterMetadata } from "./metadata.js";
import { ODTExporterRender } from "./render.js";
import { ODTExporterRichtext } from "./richtext.js";
import { ODTExporterStyles } from "./styles.js";
import { ODTExporterTracks } from "./track.js";
/*
Exporter to Open Document Text (LibreOffice)
*/
/*
TODO:
* - Export tracked changes of block changes and inline format changes
*    (this feature is lacking in ODT files created with LibreOffice 7.6.7.2)
*/
export class ODTExporter {
    doc;
    templateUrl;
    bibDB;
    imageDB;
    csl;
    templateBlob;
    pmCits;
    docContent;
    docTitle;
    mimeType;
    progressCallback;
    constructor(doc, templateUrl, bibDB, imageDB, csl, templateBlob, progressCallback) {
        this.doc = doc;
        this.templateUrl = templateUrl;
        this.bibDB = bibDB;
        this.imageDB = imageDB;
        this.csl = csl;
        this.templateBlob = templateBlob;
        this.progressCallback = progressCallback;
        this.pmCits = false;
        this.docContent = fixTables(removeHidden(this.doc.content));
        this.docTitle = shortFileTitle(this.doc.title, this.doc.path || "");
        this.mimeType = "application/vnd.oasis.opendocument.text";
    }
    init() {
        this.progressCallback?.(gettext("Exporting to ODT..."), 0);
        const xml = new XmlZipImpl(this.templateUrl, this.mimeType, this.templateBlob);
        const styles = new ODTExporterStyles(xml);
        const math = new ODTExporterMath(xml);
        const tracks = new ODTExporterTracks(xml);
        const metadata = new ODTExporterMetadata(xml, styles, this.getBaseMetadata(), this.csl);
        const citations = new ODTExporterCitations(this.docContent, this.doc.settings, styles, this.bibDB, this.csl);
        const footnotes = new ODTExporterFootnotes(this.docContent, this.doc.settings, xml, citations, styles, this.bibDB, this.imageDB, this.csl);
        const images = new ODTExporterImages(this.docContent, xml, this.imageDB);
        const richtext = new ODTExporterRichtext(this.doc.comments || {}, this.doc.settings, styles, tracks, footnotes, citations, math, images);
        const render = new ODTExporterRender(xml);
        return xml
            .init()
            .then(() => styles.init())
            .then(() => tracks.init())
            .then(() => math.init())
            .then(() => metadata.init())
            .then(() => citations.init())
            .then(() => render.init())
            .then(() => {
            this.progressCallback?.(gettext("Rendering document..."), 50);
            return images.init();
        })
            .then(() => footnotes.init())
            .then(() => {
            const pmBib = footnotes.pmBib || citations.pmBib;
            render.render(this.docContent, pmBib, this.doc.settings, richtext, citations);
            return xml.prepareBlob();
        })
            .then(blob => {
            this.progressCallback?.(gettext("Export to ODT complete."), 100);
            return this.download(blob);
        });
    }
    getBaseMetadata() {
        const contributors = this.docContent.content.reduce((contributors, part) => {
            if (part.type === "contributors_part" &&
                part.attrs?.metadata &&
                part.content) {
                return contributors.concat(part.content.map((node) => ({
                    ...node.attrs,
                    role: part.attrs.metadata
                })));
            }
            else {
                return contributors;
            }
        }, []);
        return {
            authors: contributors.filter((c) => c.role === "authors"),
            contributors,
            keywords: this.docContent.content.reduce((keywords, part) => {
                if (part.type === "tags_part" &&
                    part.attrs?.metadata === "keywords" &&
                    part.content) {
                    return keywords.concat(part.content.map((keywordNode) => keywordNode.attrs.tag));
                }
                else {
                    return keywords;
                }
            }, []),
            title: textContent(this.docContent.content[0]),
            language: this.doc.settings.language,
            citationStyle: this.doc.settings.citationstyle
        };
    }
    download(blob) {
        return download(blob, createSlug(this.docTitle) + ".odt", this.mimeType);
    }
}
//# sourceMappingURL=index.js.map