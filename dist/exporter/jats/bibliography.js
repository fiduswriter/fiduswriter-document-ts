import { escapeText } from "fwtoolkit";
// This list is based on values listed at https://jats.nlm.nih.gov/archiving/tag-library/1.2/attribute/publication-type.html
// And the advice given here: https://jats4r.org/citations/#recommendation
const PUBLICATION_TYPES = {
    article: "journal",
    "article-journal": "journal",
    "article-magazine": "journal",
    "article-newspaper": "journal",
    book: "book",
    bookinbook: "book",
    booklet: "book",
    chapter: "book",
    collection: "standard",
    dataset: "dataset",
    "entry-dictionary": "standard",
    "entry-encyclopedia": "standard",
    inbook: "book",
    incollection: "book",
    inproceedings: "standard",
    inreference: "standard",
    manual: "book",
    misc: "standard",
    mvbook: "book",
    mvcollection: "standard",
    mvproceedings: "book",
    mvreference: "standard",
    online: "standard",
    patent: "patent",
    periodical: "book",
    post: "standards",
    "post-weblog": "standard",
    proceedings: "book",
    reference: "standard",
    report: "report",
    review: "review",
    suppbook: "book",
    suppcollection: "book",
    suppperiodical: "journal",
    thesis: "standard",
    unpublished: "standard"
};
function text(value) {
    if (value === undefined || value === null) {
        return "";
    }
    if (Array.isArray(value)) {
        return value.map(text).join("");
    }
    return escapeText(String(value));
}
function renderName(name) {
    if (name.literal) {
        return `<collab>${text(name.literal)}</collab>`;
    }
    let nameStart = "<name>";
    if (name.family) {
        nameStart += `<surname>${text(name.family)}</surname>`;
    }
    if (name.given) {
        nameStart += ` <given-names>${text(name.given)}</given-names>`;
    }
    if (name.prefix) {
        nameStart += ` <prefix>${text(name.prefix)}</prefix>`;
    }
    if (name.suffix) {
        nameStart += ` <suffix>${text(name.suffix)}</suffix>`;
    }
    return nameStart + "</name>";
}
function renderNameList(names, personGroupType) {
    if (!names || !names.length) {
        return "";
    }
    return `<person-group person-group-type="${personGroupType}">${names
        .map(renderName)
        .join(", ")}</person-group>`;
}
function parseDateParts(dateParts) {
    return {
        year: dateParts && dateParts[0] ? String(dateParts[0]) : "",
        month: dateParts && dateParts[1] ? String(dateParts[1]) : "",
        day: dateParts && dateParts[2] ? String(dateParts[2]) : ""
    };
}
function renderDate(issued, dateType) {
    if (!issued) {
        return "";
    }
    let isoDate;
    let year = "";
    let month = "";
    let day = "";
    if (typeof issued === "string") {
        isoDate = issued;
        const parts = issued.split("-");
        year = parts[0] || "";
        month = parts[1] || "";
        day = parts[2] || "";
    }
    else if (issued["date-parts"] && issued["date-parts"][0]) {
        const parts = parseDateParts(issued["date-parts"][0]);
        year = parts.year;
        month = parts.month;
        day = parts.day;
        isoDate = `${year}${month ? "-" + month.padStart(2, "0") : ""}${day ? "-" + day.padStart(2, "0") : ""}`;
    }
    else if (issued.literal) {
        isoDate = issued.literal;
        year = isoDate.split("-")[0] || "";
    }
    else {
        return "";
    }
    return `<date iso-8601-date="${escapeText(isoDate)}" date-type="${dateType}">${day ? `<day>${text(day)}</day>` : ""}${month ? `<month>${text(month)}</month>` : ""}<year>${text(year)}</year></date>`;
}
export function jatsBib(bib, id) {
    let start = `<ref id="ref-${id}">`;
    let end = "</ref>";
    const publicationType = PUBLICATION_TYPES[bib.type || ""] ?? "standard";
    start += `<element-citation publication-type="${publicationType}">`;
    end = "</element-citation>" + end;
    start += renderNameList(bib.author, "author");
    const containerTitle = bib["container-title"];
    if (containerTitle) {
        start += `<source>${text(containerTitle)}</source>`;
        if (bib.title) {
            const titleTag = bib.type === "chapter" ? "chapter-title" : "article-title";
            start += `<${titleTag}>${text(bib.title)}</${titleTag}>`;
        }
    }
    else if (bib.title) {
        start += `<source>${text(bib.title)}</source>`;
    }
    start += renderNameList(bib.editor, "editor");
    if (bib.publisher) {
        const publishers = Array.isArray(bib.publisher)
            ? bib.publisher
            : [bib.publisher];
        publishers.forEach(publisher => (start += `<publisher-name>${text(publisher)}</publisher-name>`));
    }
    if (bib["publisher-place"]) {
        const places = Array.isArray(bib["publisher-place"])
            ? bib["publisher-place"]
            : [bib["publisher-place"]];
        places.forEach(place => (start += `<publisher-loc>${text(place)}</publisher-loc>`));
    }
    start += renderDate(bib.issued, "published");
    if (bib.volume) {
        start += `<volume>${text(bib.volume)}</volume>`;
    }
    if (bib.issue) {
        start += `<issue>${text(bib.issue)}</issue>`;
    }
    if (bib.page) {
        const pageStr = String(bib.page);
        const pageParts = pageStr.split("-");
        start += `<fpage>${text(pageParts[0])}</fpage>`;
        if (pageParts.length > 1) {
            start += `<lpage>${text(pageParts[pageParts.length - 1])}</lpage>`;
        }
        if (pageParts.length > 2) {
            start += `<page-range>${text(pageStr)}</page-range>`;
        }
    }
    if (bib.DOI) {
        start += `<pub-id pub-id-type="doi">${text(bib.DOI)}</pub-id>`;
    }
    if (bib.URL) {
        start += `<ext-link ext-link-type="web" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="${escapeText(bib.URL)}"/>`;
    }
    if (bib.accessed) {
        start += renderDate(bib.accessed, "access-date").replace('date-type="access-date"', 'content-type="access-date"');
    }
    return start + end;
}
//# sourceMappingURL=bibliography.js.map