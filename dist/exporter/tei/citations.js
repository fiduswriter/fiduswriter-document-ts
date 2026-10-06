import { CSLExporter } from "bibliojson";
import { FormatCitations } from "../../citations/format.js";
import { BIBLIOGRAPHY_HEADERS } from "../../schema/i18n.js";
import { teiBib } from "./bibliography.js";
/**
 * Format citations and the bibliography for TEI export.
 *
 * Modeled after the JATS exporter: the citeproc layout is instrumented with
 * placeholder prefixes/suffixes/delimiters so that the individual citations
 * can be split up again and each item wrapped in a TEI `<ref>` pointing at the
 * corresponding `<bibl>` in the back matter. The bibliography itself is built
 * from CSL-JSON via bibliojson, so the TEI output contains structured
 * `<bibl>` elements rather than HTML.
 */
export class TeiCitationsExporter {
    docSettings;
    bibDB;
    csl;
    citationTexts;
    citFm;
    teiBibliography;
    teiIdConvert;
    bibliographyHeader;
    citInfos;
    constructor(docSettings, bibDB, csl) {
        this.docSettings = docSettings;
        this.bibDB = bibDB;
        this.csl = csl;
        const language = docSettings.language || "en-US";
        this.bibliographyHeader =
            docSettings.bibliography_header?.[language] || BIBLIOGRAPHY_HEADERS[language] || "Bibliography";
        this.citationTexts = [];
        this.citFm = false;
        this.teiBibliography = "";
        this.teiIdConvert = {};
        this.citInfos = [];
    }
    init(citInfos) {
        this.citInfos = citInfos;
        if (!citInfos.length) {
            return Promise.resolve();
        }
        return this.formatCitations();
    }
    // Citations are highly interdependent -- so we need to format them all
    // together before laying out the document.
    formatCitations() {
        if (!this.csl.getStyle) {
            return Promise.resolve();
        }
        return this.csl
            .getStyle(this.docSettings.citationstyle || "")
            .then(citationstyle => {
            const modStyle = JSON.parse(JSON.stringify(citationstyle));
            const citationLayout = modStyle.children
                .find(section => section.name === "citation")
                .children.find(section => section.name === "layout").attrs;
            const origCitationLayout = JSON.parse(JSON.stringify(citationLayout));
            citationLayout.prefix = "{{prefix}}";
            citationLayout.suffix = "{{suffix}}";
            citationLayout.delimiter = "{{delimiter}}";
            const citFm = new FormatCitations(this.csl, this.citInfos, modStyle, this.bibliographyHeader, this.bibDB, false, this.docSettings.language);
            this.citFm = citFm;
            return Promise.all([
                Promise.resolve(origCitationLayout),
                citFm.init()
            ]);
        })
            .then(([origCitationLayout]) => {
            if (!this.citFm) {
                return Promise.resolve();
            }
            const citFm = this.citFm;
            // We need to add links to the bibliography items. There may be
            // more than one work cited, so we first split, then add the
            // links and eventually put the citation back together again.
            // The ids used in the TEI bibliography are 1 and up in this
            // order.
            const bibliography = citFm.bibliography;
            if (!bibliography) {
                return Promise.resolve();
            }
            const entryIds = bibliography[0].entry_ids.map(id => String(id));
            const cslItems = new CSLExporter(this.bibDB.db, entryIds).parse();
            bibliography[0].entry_ids.forEach((id, index) => {
                this.teiIdConvert[id] = index + 1;
                this.teiBibliography +=
                    teiBib((cslItems[String(id)] || {}), index + 1) + "\n";
            });
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
                    const teiId = this.teiIdConvert[citId];
                    // Strip the HTML tags citeproc may have produced so
                    // that only plain text ends up inside the ref.
                    const plainText = citationText.replace(/<[^>]+>/g, "");
                    return `${prefix}<ref corresp="#ref-${teiId}">${plainText}</ref>${suffix}`;
                })
                    .join(origCitationLayout.delimiter || "");
                return content;
            });
            return Promise.resolve();
        });
    }
}
//# sourceMappingURL=citations.js.map