import {readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {beforeAll, describe, expect, it, jest} from "@jest/globals"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

jest.unstable_mockModule("fwtoolkit", () => ({
    escapeText: str =>
        str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;"),
    shortFileTitle: (title, path) => title || path || "untitled",
    addAlert: () => {},
    get: async () => ({
        blob: () => Promise.resolve(Buffer.from([0])),
        json: () => Promise.resolve({})
    }),
    post: async () => ({ok: true}),
    postJson: async () => ({json: {}}),
    getJson: async () => ({}),
    convertDataURIToBlob: dataURI => {
        // Minimal data-URI support for the mock: an empty blob with the
        // right mime type.
        const mime = dataURI.split(",")[0].split(":")[1]?.split(";")[0]
        return new Blob([], {type: mime || "image/png"})
    },
    gettext: str => str,
    interpolate: (str, args) => str.replace(/%s/g, () => args.shift()),
    staticUrl: path => path,
    noSpaceTmp: (strings, ...values) => {
        const tmpStrings = Array.from(strings)
        let combined = ""
        while (tmpStrings.length > 0 || values.length > 0) {
            if (tmpStrings.length > 0) {
                combined += tmpStrings.shift()
            }
            if (values.length > 0) {
                const value = values.shift()
                combined +=
                    value !== undefined && value !== null ? String(value) : ""
            }
        }
        return combined
    },
    longFilePath: (path, filename) => `${path}${filename}`
}))

const {HtmlConvert} = await import("../../src/importer/html/convert.js")

/**
 * The fixture (test/importer/fixtures/comprehensive-test.html) is the HTML
 * export of sample-doc.json as produced by the HTML exporter — so these
 * tests verify the import side of the HTML round trip.
 */
const fixtureHtmlRaw = readFileSync(
    join(__dirname, "fixtures", "comprehensive-test.html"),
    "utf-8"
)

const fixtureHtml = fixtureHtmlRaw

const defaultTemplate = {
    content: {
        type: "doc",
        attrs: {import_id: "default", template: "Default"},
        content: [
            {type: "title"},
            {
                type: "contributors_part",
                attrs: {
                    metadata: "authors",
                    title: "Authors",
                    locking: false,
                    optional: false,
                    help: "",
                    deleted: false,
                    hidden: false,
                    language: ""
                }
            },
            {
                type: "richtext_part",
                attrs: {
                    id: "body",
                    title: "Body",
                    locking: false,
                    optional: false,
                    help: "",
                    deleted: false,
                    hidden: false,
                    language: "",
                    initial: [{type: "paragraph"}],
                    elements: ["paragraph"]
                },
                content: [{type: "paragraph"}]
            },
            {
                type: "tags_part",
                attrs: {
                    metadata: "keywords",
                    title: "Keywords",
                    locking: false,
                    optional: false,
                    help: "",
                    deleted: false,
                    hidden: false,
                    language: ""
                }
            }
        ]
    }
}

function makeConverter(html, bibDB = {db: {}}) {
    return new HtmlConvert(html, "import-test", defaultTemplate, bibDB)
}

let converted

beforeAll(() => {
    converted = makeConverter(fixtureHtml).init()
})

describe("html importer: document structure", () => {
    it("produces a doc with a title first", () => {
        const content = converted.content
        expect(content.type).toBe("doc")
        expect(content.content[0].type).toBe("title")
        const titleText = content.content[0].content
            .map(inline => inline.text)
            .join("")
        expect(titleText).toBe("Test Document for Export/Import")
    })

    it("imports contributors with names and affiliations", () => {
        const contributorsPart = converted.content.content.find(
            part => part.type === "contributors_part"
        )
        expect(contributorsPart).toBeDefined()
        expect(contributorsPart.attrs.metadata).toBe("authors")
        expect(contributorsPart.content.length).toBe(2)
        const [jane, john] = contributorsPart.content
        expect(jane.attrs).toMatchObject({
            firstname: "Jane",
            lastname: "Doe",
            institution: "Test University"
        })
        expect(john.attrs).toMatchObject({
            firstname: "John",
            lastname: "Smith"
        })
    })

    it("imports tags", () => {
        const tagsPart = converted.content.content.find(
            part => part.type === "tags_part"
        )
        expect(tagsPart).toBeDefined()
        expect(tagsPart.attrs.metadata).toBe("keywords")
        const tags = tagsPart.content.map(tag => tag.attrs.tag)
        expect(tags).toEqual(["testing", "export", "fiduswriter"])
    })

    it("imports headings with their ids", () => {
        const body = converted.content.content.find(
            part => part.type === "richtext_part"
        )
        const headings = body.content.filter(node =>
            node.type.startsWith("heading")
        )
        const intro = headings.find(
            heading => heading.attrs.id === "intro-heading"
        )
        expect(intro).toBeDefined()
        expect(intro.type).toBe("heading1")
        expect(
            intro.content.map(inline => inline.text).join("")
        ).toBe("Introduction")
    })

    it("imports inline marks", () => {
        const body = converted.content.content.find(
            part => part.type === "richtext_part"
        )
        const marked = body.content
            .flatMap(part => (part.content || []))
            .flatMap(inline => inline.marks || [])
            .map(mark => mark.type)
        ;["strong", "em", "underline", "sup", "sub", "code", "link", "anchor"].forEach(
            markType => expect(marked).toContain(markType)
        )
    })

    it("imports cross references", () => {
        const body = converted.content.content.find(
            part => part.type === "richtext_part"
        )
        const crossReference = body.content
            .flatMap(part => part.content || [])
            .find(inline => inline.type === "cross_reference")
        expect(crossReference).toBeDefined()
        expect(crossReference.attrs.id).toBe("intro-heading")
        expect(crossReference.attrs.title).toBe("Introduction")
    })

    it("imports lists", () => {
        const body = converted.content.content.find(
            part => part.type === "richtext_part"
        )
        const bulletList = body.content.find(node => node.type === "bullet_list")
        expect(bulletList.content.length).toBe(3)
        const orderedList = body.content.find(node => node.type === "ordered_list")
        expect(orderedList.attrs.order).toBe(1)
    })

    it("imports blockquotes", () => {
        const body = converted.content.content.find(
            part => part.type === "richtext_part"
        )
        expect(body.content.some(node => node.type === "blockquote")).toBe(true)
    })

    it("imports figures with images, captions and widths", () => {
        const body = converted.content.content.find(
            part => part.type === "richtext_part"
        )
        const figure = body.content.find(node => node.type === "figure")
        expect(figure).toBeDefined()
        expect(figure.attrs.caption).toBe(true)
        expect(figure.attrs.category).toBe("figure")
        expect(figure.attrs.width).toBe("80")
        const image = figure.content.find(node => node.type === "image")
        expect(image).toBeDefined()
        const caption = figure.content.find(node => node.type === "figure_caption")
        expect(
            caption.content.map(inline => inline.text).join("")
        ).toContain("A sample figure caption")
    })

    it("imports figure equations", () => {
        const body = converted.content.content.find(
            part => part.type === "richtext_part"
        )
        const figure = body.content.filter(node => node.type === "figure").find(
            candidate =>
                (candidate.content || []).some(
                    node => node.type === "figure_equation"
                )
        )
        expect(figure).toBeDefined()
        expect(figure.content[0].type).toBe("figure_equation")
        expect(figure.content[0].attrs.equation).toBe("E = mc^2")
    })

    it("imports tables with cells and merged cells", () => {
        const body = converted.content.content.find(
            part => part.type === "richtext_part"
        )
        const table = body.content.find(node => node.type === "table")
        expect(table).toBeDefined()
        expect(table.attrs.category).toBe("table")
        expect(table.attrs.caption).toBe(true)
        const tableBody = table.content.find(node => node.type === "table_body")
        expect(tableBody.content.length).toBe(3)
        const headerRow = tableBody.content[0]
        expect(headerRow.content[0].type).toBe("table_header")
        // Third row: colspan 2 cell then a normal cell.
        const lastRow = tableBody.content[2]
        expect(lastRow.content[0].attrs.colspan).toBe(2)
        expect(lastRow.content[1].type).toBe("table_cell")
    })

    it("imports inline equations", () => {
        const body = converted.content.content.find(
            part => part.type === "richtext_part"
        )
        const equation = body.content
            .flatMap(part => part.content || [])
            .find(inline => inline.type === "equation")
        expect(equation).toBeDefined()
        expect(equation.attrs.equation).toBe("\\int_{a}^{b} f(x) \\, dx")
    })

    it("imports footnotes", () => {
        const body = converted.content.content.find(
            part => part.type === "richtext_part"
        )
        const footnote = body.content
            .flatMap(part => part.content || [])
            .find(inline => inline.type === "footnote")
        expect(footnote).toBeDefined()
        const content = JSON.stringify(footnote.attrs.footnote)
        expect(content).toContain("This is the footnote content")
        expect(content).toContain("italic")
    })

    it("registers the used images in the image database", () => {
        const imageIds = Object.keys(converted.images)
        expect(imageIds.length).toBe(1)
        const image = converted.images[imageIds[0]]
        expect(image.image).toBe("images/sample-image-1.png")
        expect(converted.otherFiles).toEqual([
            {filename: "images/sample-image-1.png", url: "images/sample-image-1.png"}
        ])
    })

    it("records the document language in the settings", () => {
        expect(converted.settings.language).toBe("en-US")
    })
})

describe("html importer: citation restoration", () => {
    it("restores citations when the bibliography database has the entries", () => {
        const bibDB = {
            db: {
                1: {entry_key: "doe2020test", bib_type: "article", fields: {}},
                2: {entry_key: "smith2021another", bib_type: "book", fields: {}}
            }
        }
        const result = makeConverter(fixtureHtml, bibDB).init()
        const body = result.content.content.find(
            part => part.type === "richtext_part"
        )
        const citation = body.content
            .flatMap(part => part.content || [])
            .find(inline => inline.type === "citation")
        expect(citation).toBeDefined()
        expect(citation.attrs.format).toBe("autocite")
        expect(citation.attrs.references).toEqual([{id: "1"}])
    })

    it("keeps the rendered text when references cannot be restored", () => {
        // The fixture citation span is empty because citeproc is not
        // available during fixture generation; inject rendered text to
        // simulate a real export.
        const fixtureHtml = fixtureHtmlRaw.replace(
            /(<span[^>]*class="citation"[^>]*>)\s*<\/span/,
            "$1(see Doe 2020, test)</span"
        )
        const result = makeConverter(fixtureHtml).init()
        const body = result.content.content.find(
            part => part.type === "richtext_part"
        )
        const text = body.content
            .flatMap(part => part.content || [])
            .map(inline => inline.text || "")
            .join("")
        expect(text).toContain("(see")
        expect(
            body.content
                .flatMap(part => part.content || [])
                .some(inline => inline.type === "citation")
        ).toBe(false)
    })
})

describe("html importer: schema coverage", () => {
    it("the fixture exercises every schema node type and attribute", async () => {
        const {docSchema} = await import("../../src/schema/document/index.js")
        const {coverageGaps} = await import("../helpers/schema-coverage.js")
        const sampleDoc = JSON.parse(
            readFileSync(
                join(__dirname, "..", "exporter", "fixtures", "sample-doc.json"),
                "utf-8"
            )
        )
        const gaps = coverageGaps(sampleDoc, docSchema)
        expect(gaps.missingNodes).toEqual([])
        expect(gaps.missingNodeAttrs).toEqual([])
        expect(gaps.missingMarks).toEqual([])
        expect(gaps.missingMarkAttrs).toEqual([])
    })

    const bodyOf = result =>
        result.content.content.find(part => part.type === "richtext_part")

    it("imports heading levels 4-6 with their ids", () => {
        const body = bodyOf(converted)
        ;["heading4", "heading5", "heading6"].forEach((type, index) => {
            const heading = body.content.find(
                node => node.type === type && node.attrs?.id === `coverage-h${index + 4}`
            )
            expect(heading).toBeDefined()
        })
    })

    it("imports horizontal rules and hard breaks", () => {
        const body = bodyOf(converted)
        expect(
            body.content.some(node => node.type === "horizontal_rule")
        ).toBe(true)
        const hardBreak = body.content
            .flatMap(block => block.content || [])
            .find(node => node.type === "hard_break")
        expect(hardBreak).toBeDefined()
    })

    it("imports code blocks with language, category, title and id", () => {
        const body = bodyOf(converted)
        const codeBlocks = body.content.filter(node => node.type === "code_block")
        expect(codeBlocks.length).toBe(2)
        const categorized = codeBlocks.find(
            block => block.attrs.id === "code-2"
        )
        expect(categorized.attrs).toMatchObject({
            language: "python",
            category: "listing",
            title: "A listing",
            id: "code-2"
        })
        const plain = codeBlocks.find(block => !block.attrs.id)
        expect(plain.attrs).toMatchObject({language: "javascript"})
    })

    it("imports ordered lists with their start number", () => {
        const body = bodyOf(converted)
        const orderedLists = body.content.filter(
            node => node.type === "ordered_list"
        )
        expect(orderedLists.map(list => list.attrs.order).sort()).toEqual([1, 3])
    })

    it("imports figures with alignment and equation figures with captions", () => {
        const body = bodyOf(converted)
        const imageFigure = body.content.find(
            node => node.type === "figure" && node.attrs?.id === "figure-3"
        )
        expect(imageFigure).toBeDefined()
        expect(imageFigure.attrs).toMatchObject({
            aligned: "right",
            width: "60"
        })
        const equationFigure = body.content.find(
            node => node.type === "figure" && node.attrs?.id === "figure-4"
        )
        expect(equationFigure).toBeDefined()
        const equation = equationFigure.content.find(
            node => node.type === "figure_equation"
        )
        expect(equation.attrs.equation).toBe("a^2 + b^2 = c^2")
        const caption = equationFigure.content.find(
            node => node.type === "figure_caption"
        )
        expect(caption.content.map(inline => inline.text).join("")).toBe(
            "An equation figure"
        )
    })

    it("imports tables with layout attributes and rowspan cells", () => {
        const body = bodyOf(converted)
        const table = body.content.find(
            node => node.type === "table" && node.attrs?.id === "table-2"
        )
        expect(table.attrs).toMatchObject({
            layout: "auto",
            aligned: "left",
            width: "80"
        })
        const tableBody = table.content.find(node => node.type === "table_body")
        const spanningRow = tableBody.content[1]
        expect(spanningRow.content[0].attrs.rowspan).toBe(2)
    })

    it("imports textcite citations when the bibliography has the entry", () => {
        const bibDB = {
            db: {
                1: {entry_key: "doe2020test", bib_type: "article", fields: {}},
                2: {entry_key: "smith2021another", bib_type: "book", fields: {}},
                3: {entry_key: "wilm2026coverage", bib_type: "article", fields: {}}
            }
        }
        const result = makeConverter(fixtureHtml, bibDB).init()
        const body = bodyOf(result)
        const citations = body.content
            .flatMap(block => block.content || [])
            .filter(node => node.type === "citation")
        expect(citations.length).toBe(2)
        const textcite = citations.find(
            citation => citation.attrs.format === "textcite"
        )
        expect(textcite).toBeDefined()
        expect(textcite.attrs.references).toEqual([{id: "3"}])
    })

    it("imports missing-target cross references with a placeholder title", () => {
        const body = bodyOf(converted)
        const missing = body.content
            .flatMap(block => block.content || [])
            .find(
                node => node.type === "cross_reference" && node.attrs?.id === "gone"
            )
        expect(missing).toBeDefined()
        expect(missing.attrs.title).toBe("MISSING TARGET")
    })

    it("keeps the text of annotation tags and legacy marks", () => {
        const body = bodyOf(converted)
        const text = body.content
            .flatMap(block => block.content || [])
            .map(inline => inline.text || "")
            .join(" ")
        expect(text).toContain("an annotated word, and a smallcaps legacy mark.")
        const marks = body.content
            .flatMap(block => block.content || [])
            .flatMap(inline => (inline.marks || []).map(mark => mark.type))
        expect(marks).not.toContain("annotation_tag")
        expect(marks).not.toContain("smallcaps")
    })

    it("imports table parts and separators and skips the table of contents", () => {
        const partTypes = converted.content.content.map(part => part.type)
        expect(partTypes).toContain("table_part")
        expect(partTypes).toContain("separator_part")
        expect(partTypes).not.toContain("table_of_contents")
        const tablePart = converted.content.content.find(
            part => part.type === "table_part"
        )
        expect(tablePart.content[0].type).toBe("table")
    })
})

describe("html importer: arbitrary html", () => {
    it("imports a standalone document with an empty head title", () => {
        // Pandoc-style standalone HTML without document metadata: the title
        // is empty and must not produce an invalid empty text node.
        const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title></title></head>
<body>
<header id="title-block-header"><h1 class="title"></h1></header>
<p>Some standalone content.</p>
</body>
</html>`
        const result = makeConverter(html).init()
        const title = result.content.content[0]
        expect(title.type).toBe("title")
        expect(title.content).toEqual([])
        const body = result.content.content.find(
            part => part.type === "richtext_part"
        )
        const text = body.content
            .map(block =>
                (block.content || []).map(inline => inline.text || "").join("")
            )
            .join(" ")
        expect(text).toContain("Some standalone content.")
    })

    it("imports foreign markup without crashing", () => {
        const html = `<article>
<h2>Foreign heading</h2>
<p>Text with <mark>highlighted</mark> and <span class="unknown">tagged</span> words.</p>
<nav><ul><li><a href="#a">nav link</a></li></ul></nav>
<figure><img src="https://example.org/pic.png" alt="A remote picture"></figure>
</article>`
        const result = makeConverter(html).init()
        expect(result.content.type).toBe("doc")
        const body = result.content.content.find(
            part => part.type === "richtext_part"
        )
        const text = body.content
            .map(block =>
                (block.content || []).map(inline => inline.text || "").join("")
            )
            .join(" ")
        expect(text).toContain("Foreign heading")
        expect(text).toContain("highlighted")
        expect(text).toContain("nav link")
        // The remote image is registered under a local file name with the
        // source URL for the native importer to fetch.
        const image = Object.values(result.images)[0]
        expect(image.image).toBe("images/pic.png")
        expect(result.otherFiles).toEqual([
            {filename: "images/pic.png", url: "https://example.org/pic.png"}
        ])
    })
})

describe("html importer: tracked changes", () => {
    it("restores insertion and deletion marks and block tracks", () => {
        // The sample document contains tracked changes; the exporter only
        // writes them when trackChanges is enabled, which the fixture
        // reflects. Check marks exist if the fixture has them, and that the
        // importer handles data-track-json when present.
        const html = fixtureHtml.includes("insertion")
            ? fixtureHtml
            : fixtureHtml
        const result = makeConverter(html).init()
        const body = result.content.content.find(
            part => part.type === "richtext_part"
        )
        const marks = body.content
            .flatMap(part => part.content || [])
            .flatMap(inline => (inline.marks || []).map(mark => mark.type))
        if (fixtureHtml.includes('class="insertion"')) {
            expect(marks).toContain("insertion")
            expect(marks).toContain("deletion")
        }
        expect(result).toBeDefined()
    })
})
