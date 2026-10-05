import {escapeText} from "fwtoolkit"

// CSL-JSON item as produced by bibliojson's CSLExporter.
interface CSLName {
    family?: string
    given?: string
    literal?: string
    prefix?: string
    suffix?: string
}

interface CSLDate {
    "date-parts"?: number[][]
    literal?: string
}

export interface CSLItem {
    type?: string
    title?: string
    "container-title"?: string
    author?: CSLName[]
    editor?: CSLName[]
    publisher?: string | string[]
    "publisher-place"?: string | string[]
    issued?: CSLDate | string
    volume?: string
    issue?: string
    page?: string
    DOI?: string
    URL?: string
    accessed?: CSLDate | string
    [key: string]: unknown
}

function text(value: unknown): string {
    if (value === undefined || value === null) {
        return ""
    }
    if (Array.isArray(value)) {
        return value.map(text).join("")
    }
    return escapeText(String(value))
}

function renderName(name: CSLName): string {
    if (name.literal) {
        return `<orgName>${text(name.literal)}</orgName>`
    }
    let nameStart = "<persName>"
    if (name.family) {
        nameStart += `<surname>${text(name.family)}</surname>`
    }
    if (name.given) {
        nameStart += ` <forename>${text(name.given)}</forename>`
    }
    if (name.prefix) {
        nameStart += ` <addName>${text(name.prefix)}</addName>`
    }
    if (name.suffix) {
        nameStart += ` <genName>${text(name.suffix)}</genName>`
    }
    return nameStart + "</persName>"
}

function renderNameList(
    names: CSLName[] | undefined,
    tagName: string
): string {
    if (!names || !names.length) {
        return ""
    }
    return names.map(name => wrapName(tagName, renderName(name))).join("")
}

function wrapName(tagName: string, content: string): string {
    return `<${tagName}>${content}</${tagName}>`
}

function parseDateParts(dateParts?: number[]): {
    year: string
    month: string
    day: string
} {
    return {
        year: dateParts?.[0] ? String(dateParts[0]) : "",
        month: dateParts?.[1] ? String(dateParts[1]).padStart(2, "0") : "",
        day: dateParts?.[2] ? String(dateParts[2]).padStart(2, "0") : ""
    }
}

/** Render a `<date>` element with an ISO `when` attribute. */
function renderDate(
    issued: CSLDate | string | undefined,
    displayDate?: string
): string {
    if (!issued) {
        return ""
    }
    let year = ""
    let month = ""
    let day = ""
    let isoDate = ""
    if (typeof issued === "string") {
        const parts = issued.split("-")
        year = parts[0] || ""
        month = parts[1] || ""
        day = parts[2] || ""
        isoDate = [year, month && month.padStart(2, "0"), day && day.padStart(2, "0")]
            .filter(part => part)
            .join("-")
    } else if (issued["date-parts"]?.[0]) {
        const parts = parseDateParts(issued["date-parts"][0])
        year = parts.year
        month = parts.month
        day = parts.day
        isoDate = [year, month, day].filter(part => part).join("-")
    } else if (issued.literal) {
        isoDate = issued.literal
        year = isoDate.split("-")[0] || ""
    } else {
        return ""
    }
    const display = displayDate || isoDate || year
    return `<date when="${escapeText(isoDate || year)}">${text(display)}</date>`
}

/**
 * Render one bibliography entry as a TEI `<bibl>` element. Modeled after the
 * JATS exporter's bibliography renderer.
 */
export function teiBib(bib: CSLItem, id: number): string {
    let start = `<bibl xml:id="ref-${id}">`

    const containerTitle = bib["container-title"]
    if (bib.title) {
        const level = containerTitle ? "a" : "m"
        start += `<title level="${level}">${text(bib.title)}</title>`
    }
    if (containerTitle) {
        start += `<title level="j">${text(containerTitle)}</title>`
    }

    start += renderNameList(bib.author, "author")
    start += renderNameList(bib.editor, "editor")

    if (bib.edition) {
        start += `<edition>${text(bib.edition)}</edition>`
    }

    start += renderDate(bib.issued)

    if (bib["publisher-place"]) {
        const places = Array.isArray(bib["publisher-place"])
            ? bib["publisher-place"]
            : [bib["publisher-place"]]
        places.forEach(place => (start += `<pubPlace>${text(place)}</pubPlace>`))
    }

    if (bib.publisher) {
        const publishers = Array.isArray(bib.publisher)
            ? bib.publisher
            : [bib.publisher]
        publishers.forEach(
            publisher => (start += `<publisher>${text(publisher)}</publisher>`)
        )
    }

    if (bib.volume) {
        start += `<biblScope unit="volume">${text(bib.volume)}</biblScope>`
    }
    if (bib.issue) {
        start += `<biblScope unit="issue">${text(bib.issue)}</biblScope>`
    }
    if (bib.page) {
        start += `<biblScope unit="page">${text(bib.page)}</biblScope>`
    }

    if (bib.DOI) {
        start += `<idno type="DOI">${text(bib.DOI)}</idno>`
    }
    if (bib.URL) {
        start += `<ptr target="${escapeText(bib.URL)}"/>`
    }

    if (bib.accessed) {
        start += renderDate(bib.accessed)
    }

    return start + "</bibl>"
}
