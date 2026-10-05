import {escapeText} from "fwtoolkit"

import {FormatCitations} from "../../citations/format.js"
import type {CitationInfo} from "../../citations/format.js"
import {BIBLIOGRAPHY_HEADERS} from "../../schema/i18n.js"
import type {BibDB, CSL, CSLNode, DocSettings} from "../../types.js"

interface CitationLayout {
    prefix?: string
    suffix?: string
    delimiter?: string
}

interface CSLStyleChild {
    name: string
    children?: CSLStyleChild[]
    attrs?: Record<string, unknown>
}

export class HTMLExporterCitations {
    docSettings: DocSettings
    bibDB: BibDB
    csl: CSL

    citationTexts: string[]
    citFm: FormatCitations | false
    bibHTML: string
    bibCSS: string
    htmlIdConvert: Record<string, number>
    citInfos: Record<string, unknown>[]

    constructor(docSettings: DocSettings, bibDB: BibDB, csl: CSL) {
        this.docSettings = docSettings
        this.bibDB = bibDB
        this.csl = csl

        this.citationTexts = []
        this.citFm = false
        this.bibHTML = ""
        this.bibCSS = ""
        this.htmlIdConvert = {}
        this.citInfos = []
    }

    async init(citInfos: Record<string, unknown>[]): Promise<{
        type: string
        bibCSS: string
        bibHTML: string
        citationTexts: string[]
    }> {
        this.citInfos = citInfos
        if (!citInfos.length) {
            return this.getOutput()
        }
        await this.formatCitations()
        return this.getOutput()
    }

    getOutput(): {
        type: string
        bibCSS: string
        bibHTML: string
        citationTexts: string[]
    } {
        return {
            type: this.citFm ? this.citFm.citationType : "",
            bibCSS: this.bibCSS,
            bibHTML: this.bibHTML,
            citationTexts: this.citationTexts
        }
    }

    // Citations are highly interdependent -- so we need to format them all
    // together before laying out the document.
    async formatCitations(): Promise<void> {
        if (!this.csl.getStyle) {
            return
        }
        const citationstyle = await this.csl.getStyle(
            this.docSettings.citationstyle || ""
        )

        const modStyle = JSON.parse(JSON.stringify(citationstyle)) as {
            children: CSLStyleChild[]
        }
        const citationLayout = modStyle.children
            .find(section => section.name === "citation")!
            .children!.find(section => section.name === "layout")!.attrs as CitationLayout
        const origCitationLayout = JSON.parse(
            JSON.stringify(citationLayout)
        ) as CitationLayout
        citationLayout.prefix = "{{prefix}}"
        citationLayout.suffix = "{{suffix}}"
        citationLayout.delimiter = "{{delimiter}}"
        const citFm = new FormatCitations(
            this.csl,
            this.citInfos as unknown as CitationInfo[],
            modStyle as unknown as CSLNode,
            "",
            this.bibDB,
            false,
            this.docSettings.language
        )
        this.citFm = citFm

        await (citFm.init() as Promise<void>)

        // We need to add links to the bibliography items. And there may be more than one work cited
        // so we need to first split, then add the links and eventually put the citation back together
        // again.
        // The IDs used in the html bibliography are 1 and up in this order
        const bibliography = citFm.bibliography
        if (!bibliography) {
            return
        }
        bibliography[0].entry_ids.forEach(
            (id, index) => (this.htmlIdConvert[id] = index + 1)
        )
        this.citationTexts = citFm.citationTexts.map((ref, index) => {
            const content = ref
                .split("{{delimiter}}")
                .map((citationText, conIndex) => {
                    const prefixSplit = citationText.split("{{prefix}}")
                    const prefix =
                        prefixSplit.length > 1
                            ? prefixSplit.shift()! +
                              (origCitationLayout.prefix || "")
                            : ""
                    citationText = prefixSplit[0]
                    const suffixSplit = citationText.split("{{suffix}}")
                    const suffix =
                        suffixSplit.length > 1
                            ? (origCitationLayout.suffix || "") +
                              suffixSplit.pop()!
                            : ""
                    citationText = suffixSplit[0]
                    const sortedItems = ((citFm.citations[index] as unknown as {sortedItems: Array<[unknown, {id: string}]>}).sortedItems)
                    const citId = sortedItems[conIndex][1].id
                    const htmlId = this.htmlIdConvert[citId]
                    // data-references carries the internal bibliography
                    // database id so that importers can map the link back to
                    // the original entry without relying on the order of the
                    // rendered bibliography.
                    return `${prefix}<a class="bibliography" href="#ref-${htmlId}" data-references="${escapeText(String(citId))}">${citationText}</a>${suffix}`
                })
                .join(origCitationLayout.delimiter || "")
            return content
        })

        if (
            bibliography?.length &&
            bibliography[0].entry_ids.length
        ) {
            this.assembleBib(citFm, bibliography)
        }
    }

    assembleBib(citFm: FormatCitations, bibliography: import("../../types.js").BibliographyResult): void {
        const bibliographyHeader =
            (this.docSettings.bibliography_header as Record<string, string> | undefined)?.[this.docSettings.language || "en-US"] ||
            (BIBLIOGRAPHY_HEADERS as Record<string, string>)[this.docSettings.language || "en-US"]
        let bibHTML = `<h1 class="doc-bibliography-header">${escapeText(bibliographyHeader || "Bibliography")}</h1>`
        bibHTML += bibliography[0].bibstart
        bibHTML += bibliography[1]
            .map(
                (reference, index) =>
                    `<div id="ref-${index + 1}">${reference}</div>`
            )
            .join("")
        bibHTML += bibliography[0].bibend
        this.bibHTML = bibHTML
        this.bibCSS = citFm.bibCSS
    }
}
