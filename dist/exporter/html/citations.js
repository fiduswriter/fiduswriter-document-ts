import { escapeText } from "fwtoolkit";
import { FormatCitations } from "../../citations/format.js";
import { BIBLIOGRAPHY_HEADERS } from "../../schema/i18n.js";
export class HTMLExporterCitations {
    docSettings;
    bibDB;
    csl;
    citationTexts;
    citFm;
    bibHTML;
    bibCSS;
    htmlIdConvert;
    citInfos;
    constructor(docSettings, bibDB, csl) {
        this.docSettings = docSettings;
        this.bibDB = bibDB;
        this.csl = csl;
        this.citationTexts = [];
        this.citFm = false;
        this.bibHTML = "";
        this.bibCSS = "";
        this.htmlIdConvert = {};
        this.citInfos = [];
    }
    async init(citInfos) {
        this.citInfos = citInfos;
        if (!citInfos.length) {
            return this.getOutput();
        }
        await this.formatCitations();
        return this.getOutput();
    }
    getOutput() {
        return {
            type: this.citFm ? this.citFm.citationType : "",
            bibCSS: this.bibCSS,
            bibHTML: this.bibHTML,
            citationTexts: this.citationTexts
        };
    }
    // Citations are highly interdependent -- so we need to format them all
    // together before laying out the document.
    async formatCitations() {
        if (!this.csl.getStyle) {
            return;
        }
        const citationstyle = await this.csl.getStyle(this.docSettings.citationstyle || "");
        const modStyle = JSON.parse(JSON.stringify(citationstyle));
        const citationLayout = modStyle.children
            .find(section => section.name === "citation")
            .children.find(section => section.name === "layout").attrs;
        const origCitationLayout = JSON.parse(JSON.stringify(citationLayout));
        citationLayout.prefix = "{{prefix}}";
        citationLayout.suffix = "{{suffix}}";
        citationLayout.delimiter = "{{delimiter}}";
        const citFm = new FormatCitations(this.csl, this.citInfos, modStyle, "", this.bibDB, false, this.docSettings.language);
        this.citFm = citFm;
        await citFm.init();
        // We need to add links to the bibliography items. And there may be more than one work cited
        // so we need to first split, then add the links and eventually put the citation back together
        // again.
        // The IDs used in the html bibliography are 1 and up in this order
        const bibliography = citFm.bibliography;
        if (!bibliography) {
            return;
        }
        bibliography[0].entry_ids.forEach((id, index) => (this.htmlIdConvert[id] = index + 1));
        this.citationTexts = citFm.citationTexts.map((ref, index) => {
            const content = ref
                .split("{{delimiter}}")
                .map((citationText, conIndex) => {
                const prefixSplit = citationText.split("{{prefix}}");
                const prefix = prefixSplit.length > 1
                    ? prefixSplit.shift() +
                        (origCitationLayout.prefix || "")
                    : "";
                citationText = prefixSplit[0];
                const suffixSplit = citationText.split("{{suffix}}");
                const suffix = suffixSplit.length > 1
                    ? (origCitationLayout.suffix || "") +
                        suffixSplit.pop()
                    : "";
                citationText = suffixSplit[0];
                const sortedItems = (citFm.citations[index].sortedItems);
                const citId = sortedItems[conIndex][1].id;
                const htmlId = this.htmlIdConvert[citId];
                return `${prefix}<a class="bibliography" href="#ref-${htmlId}">${citationText}</a>${suffix}`;
            })
                .join(origCitationLayout.delimiter || "");
            return content;
        });
        if (bibliography?.length &&
            bibliography[0].entry_ids.length) {
            this.assembleBib(citFm, bibliography);
        }
    }
    assembleBib(citFm, bibliography) {
        const bibliographyHeader = this.docSettings.bibliography_header?.[this.docSettings.language || "en-US"] ||
            BIBLIOGRAPHY_HEADERS[this.docSettings.language || "en-US"];
        let bibHTML = `<h1 class="doc-bibliography-header">${escapeText(bibliographyHeader || "Bibliography")}</h1>`;
        bibHTML += bibliography[0].bibstart;
        bibHTML += bibliography[1]
            .map((reference, index) => `<div id="ref-${index + 1}">${reference}</div>`)
            .join("");
        bibHTML += bibliography[0].bibend;
        this.bibHTML = bibHTML;
        this.bibCSS = citFm.bibCSS;
    }
}
//# sourceMappingURL=citations.js.map