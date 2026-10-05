import {CSLExporter} from "bibliojson"
import type {BibDB as BibliojsonBibDB} from "bibliojson"

import {FormatCitations} from "../../citations/format.js"
import type {CitationInfo} from "../../citations/format.js"
import {BIBLIOGRAPHY_HEADERS} from "../../schema/i18n.js"
import type {BibDB, CSL, CSLNode, DocSettings} from "../../types.js"
import {teiBib} from "./bibliography.js"
import type {CSLItem} from "./bibliography.js"

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
    docSettings: DocSettings
    bibDB: BibDB
    csl: CSL

    citationTexts: string[]
    citFm: FormatCitations | false
    teiBibliography: string
    teiIdConvert: Record<string, number>
    bibliographyHeader: string
    citInfos: Record<string, unknown>[]

    constructor(docSettings: DocSettings, bibDB: BibDB, csl: CSL) {
        this.docSettings = docSettings
        this.bibDB = bibDB
        this.csl = csl

        const language = docSettings.language || "en-US"
        this.bibliographyHeader =
            (docSettings.bibliography_header as Record<string, string> | undefined)?.[
                language
            ] || (BIBLIOGRAPHY_HEADERS as Record<string, string>)[language] || "Bibliography"

        this.citationTexts = []
        this.citFm = false
        this.teiBibliography = ""
        this.teiIdConvert = {}
        this.citInfos = []
    }

    init(citInfos: Record<string, unknown>[]): Promise<void> {
        this.citInfos = citInfos
        if (!citInfos.length) {
            return Promise.resolve()
        }
        return this.formatCitations()
    }

    // Citations are highly interdependent -- so we need to format them all
    // together before laying out the document.
    formatCitations(): Promise<void> {
        if (!this.csl.getStyle) {
            return Promise.resolve()
        }
        return this.csl
            .getStyle(this.docSettings.citationstyle || "")
            .then(citationstyle => {
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
                    this.bibliographyHeader,
                    this.bibDB,
                    false,
                    this.docSettings.language
                )
                this.citFm = citFm
                return Promise.all([
                    Promise.resolve(origCitationLayout),
                    citFm.init() as Promise<void>
                ])
            })
            .then(([origCitationLayout]) => {
                if (!this.citFm) {
                    return Promise.resolve()
                }
                const citFm = this.citFm
                // We need to add links to the bibliography items. There may be
                // more than one work cited, so we first split, then add the
                // links and eventually put the citation back together again.
                // The ids used in the TEI bibliography are 1 and up in this
                // order.
                const bibliography = citFm.bibliography
                if (!bibliography) {
                    return Promise.resolve()
                }
                const entryIds = bibliography[0].entry_ids.map(id => String(id))
                const cslItems = new CSLExporter(
                    this.bibDB.db as unknown as BibliojsonBibDB,
                    entryIds
                ).parse() as Record<string, Record<string, unknown>>
                bibliography[0].entry_ids.forEach((id, index) => {
                    this.teiIdConvert[id] = index + 1
                    this.teiBibliography +=
                        teiBib((cslItems[String(id)] || {}) as CSLItem, index + 1) + "\n"
                })
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
                            const sortedItems = ((citFm.citations[index] as unknown as {
                                sortedItems: Array<[unknown, {id: string}]>
                            }).sortedItems)
                            const citId = sortedItems[conIndex][1].id
                            const teiId = this.teiIdConvert[citId]
                            // Strip the HTML tags citeproc may have produced so
                            // that only plain text ends up inside the ref.
                            const plainText = citationText.replace(/<[^>]+>/g, "")
                            return `${prefix}<ref corresp="#ref-${teiId}">${plainText}</ref>${suffix}`
                        })
                        .join(origCitationLayout.delimiter || "")
                    return content
                })
                return Promise.resolve()
            })
    }
}
