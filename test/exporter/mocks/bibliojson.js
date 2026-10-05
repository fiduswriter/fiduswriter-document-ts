// Mock for bibliojson

function emptyCheck() {
    return {isCitation: false, isBibliography: false}
}

export class CSLExporter {
    constructor() {
        this.items = []
    }
    addEntry(entry) {
        this.items.push(entry)
    }
    parse() {
        return {}
    }
}

export class BibLatexExporter {
    constructor(bibDB) {
        this.bibDB = bibDB
        this.items = []
    }

    // Minimal but valid BibLaTeX output for the exported entries.
    parse() {
        let bib = ""
        Object.entries(this.bibDB).forEach(([, entry]) => {
            const fields = entry.fields || {}
            const fieldStrings = Object.entries(fields)
                .filter(([key]) => key !== "entry_key" && key !== "entry_type")
                .map(
                    ([key, value]) => `${key} = {${String(value).replace(/[{}]/g, "")}}`
                )
            bib += `@${entry.bib_type || "misc"}{${entry.entry_key || "Undefined"},\n`
            bib += fieldStrings.length
                ? `${fieldStrings.map(line => `  ${line}`).join(",\n")}\n`
                : ""
            bib += "}\n\n"
        })
        return bib
    }
}

export class DocxCitationsParser {
    static fieldCitation() {
        return emptyCheck()
    }
    static fieldBibliography() {
        return emptyCheck()
    }
    static sdtCitation() {
        return emptyCheck()
    }
    static sdtBibliography() {
        return emptyCheck()
    }
}

export class OdtCitationsParser {
    static referenceMarkBibliography() {
        return emptyCheck()
    }
    static sectionBibliography() {
        return emptyCheck()
    }
    static referenceMarkCitation() {
        return emptyCheck()
    }
    static bibliographyMark() {
        return emptyCheck()
    }
}

export function parseCSL() {
    return {}
}

export const cslBibSpec = {
    nodes: {
        doc: {content: "cslbib"},
        cslbib: {content: "cslentry*"},
        cslentry: {content: "block*"},
        cslinline: {group: "block", content: "text*", marks: "_"},
        cslblock: {group: "block", content: "text*", marks: "_"},
        cslleftmargin: {group: "block", content: "text*", marks: "_"},
        cslrightinline: {group: "block", content: "text*", marks: "_"},
        cslindent: {group: "block", content: "text*", marks: "_"},
        text: {group: "inline"}
    },
    marks: {
        em: {},
        strong: {},
        smallcaps: {},
        sup: {},
        sub: {}
    }
}

export default {
    CSLExporter,
    BibLatexExporter,
    DocxCitationsParser,
    OdtCitationsParser,
    parseCSL,
    cslBibSpec
}
