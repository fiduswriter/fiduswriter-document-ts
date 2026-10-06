import {readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {beforeAll, describe, expect, it, jest} from "@jest/globals"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const sampleDoc = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "sample-doc.json"), "utf-8")
)
const sampleSettings = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "sample-settings.json"), "utf-8")
)

const IMAGE_DB = {
    db: {
        "sample-image-1": {
            id: 1,
            title: "Sample image",
            image: "images/sample-image-1.png"
        }
    }
}

const BIB_DB = {
    db: {
        1: {
            entry_key: "doe2020test",
            bib_type: "article",
            fields: {title: "A test article", author: "Jane Doe", year: "2020"}
        },
        2: {
            entry_key: "smith2021another",
            bib_type: "book",
            fields: {title: "Another book", author: "John Smith", year: "2021"}
        },
        3: {
            entry_key: "wilm2026coverage",
            bib_type: "article",
            fields: {
                title: "A coverage article",
                author: "Johannes Wilm",
                year: "2026"
            }
        }
    }
}

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
    convertDataURIToBlob: () => new Blob(),
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

const {MarkdownExporter} = await import("../../src/exporter/markdown/index.js")
const {escapeMarkdownText, escapeTableCell} = await import(
    "../../src/exporter/markdown/escape.js"
)

const makeDoc = () => ({
    id: "markdown-test",
    title: sampleDoc.content[0].content[0].text,
    content: {...sampleDoc, attrs: sampleSettings},
    settings: sampleSettings
})

let exporter
let markdown
let bibFile

beforeAll(async () => {
    exporter = new MarkdownExporter(
        makeDoc(),
        BIB_DB,
        IMAGE_DB,
        new Date()
    )
    exporter.createZip = async () => {}
    await exporter.init()
    markdown = exporter.textFiles.find(file => file.filename === "document.md")
        .contents
    bibFile = exporter.textFiles.find(
        file => file.filename === "bibliography.bib"
    )
})

describe("markdown escaping", () => {
    it("escapes the pandoc metacharacters", () => {
        expect(escapeMarkdownText("a*b_c[d]e~f^g|h$i<j>k\"l`m\\n")).toBe(
            "a\\*b\\_c\\[d\\]e\\~f\\^g\\|h\\$i\\<j\\>k\\\"l\\`m\\\\n"
        )
    })

    it("escapes a leading hash and dash on request", () => {
        expect(escapeMarkdownText("# heading", true)).toBe("\\# heading")
        expect(escapeMarkdownText("- item", true)).toBe("\\- item")
        expect(escapeMarkdownText("# heading")).toBe("# heading")
    })

    it("escapes pipes in table cells", () => {
        expect(escapeTableCell("a | b")).toBe("a \\| b")
        expect(escapeTableCell("a\nb")).toBe("a b")
    })
})

describe("markdown exporter front matter", () => {
    it("carries title, authors and keywords", () => {
        expect(markdown).toMatch(/^---\n/)
        expect(markdown).toContain('title: "Test Document for Export/Import"')
        expect(markdown).toContain('name: "Jane Doe"')
        expect(markdown).toContain('affiliation: "Test University"')
        expect(markdown).toContain('email: "jane@example.com"')
        expect(markdown).toContain(
            'keywords: ["testing", "export", "fiduswriter"]'
        )
        expect(markdown).toContain('copyright: "© 2024 Jane Doe"')
    })

    it("carries the abstract as a block scalar", () => {
        expect(markdown).toMatch(/abstract: \|\n {2}This is a comprehensive/)
        expect(markdown).toContain("**bold**")
    })
})

describe("markdown exporter body", () => {
    it("wraps parts in fenced divs with the HTML exporter class conventions", () => {
        expect(markdown).toContain("::: {#introduction .doc-part .doc-heading}")
        // The abstract lives in the YAML front matter, not in a part div.
        expect(markdown).not.toContain("doc-abstract")
    })

    it("exports headings with ids", () => {
        expect(markdown).toContain("# Introduction {#intro-heading}")
        expect(markdown).toContain("## Text Formatting {#text-formatting}")
    })

    it("exports inline marks", () => {
        expect(markdown).toContain("***Bold and italic combined***")
        expect(markdown).toContain('[underline]{.underline}')
        expect(markdown).toContain("^superscript^")
        expect(markdown).toContain("~subscript~")
        expect(markdown).toContain("`code`")
        expect(markdown).toContain(
            '[a hyperlink](https://fiduswriter.org "Fidus Writer")'
        )
        expect(markdown).toContain(
            '<span id="my-anchor" class="anchor" data-id="my-anchor"></span>'
        )
        expect(markdown).toContain("[Introduction](#intro-heading)")
    })

    it("exports code blocks with attributes", () => {
        expect(markdown).toMatch(/~~~\{\.javascript\}\nfunction hello/)
    })

    it("exports figures with captions and width", () => {
        expect(markdown).toContain(
            "![A sample figure caption](images/sample-image-1.png){#figure-1 width=80% data-aligned=\"center\" data-category=\"figure\"}"
        )
    })

    it("exports figure equations as fenced divs with display math", () => {
        expect(markdown).toMatch(
            /:::: \{#figure-2 \.doc-figure data-equation="E = mc\^2"\}\n\n\$\$\nE = mc\^2\n\$\$/
        )
    })

    it("exports tables inside a fenced div with a caption", () => {
        expect(markdown).toMatch(/::: \{[^}]*\.doc-table[^}]*#table-1/)
        expect(markdown).toContain("| Header 1")
        expect(markdown).toContain("| Merged cell (colspan=2) |")
        expect(markdown).toContain("| Row 2, Cell 3 |")
        expect(markdown).toContain(": A sample table")
    })

    it("exports footnotes and citations", () => {
        expect(markdown).toContain("[^1]")
        expect(markdown).toMatch(
            /\[\^1\]: This is the footnote content with \*italic text\*\./
        )
        expect(markdown).toContain("[see @doe2020test, 45]")
        expect(markdown).toContain("::: {#references .references}")
    })

    it("exports a bibliography.bib for used citations", () => {
        expect(bibFile).toBeDefined()
        expect(bibFile.contents).toContain("@article{doe2020test")
        expect(bibFile.contents).toContain("@article{wilm2026coverage")
        // Only the cited entries are exported.
        expect(bibFile.contents).not.toContain("smith2021another")
    })

    it("collects the image ids and ships the images", () => {
        expect(exporter.conversion.imageIds).toEqual(["sample-image-1"])
        expect(exporter.httpFiles).toEqual([
            {
                filename: "images/sample-image-1.png",
                url: "images/sample-image-1.png"
            }
        ])
    })
})

describe("markdown exporter: schema coverage", () => {
    it("the fixture exercises every schema node type and attribute", async () => {
        const {docSchema} = await import("../../src/schema/document/index.js")
        const {coverageGaps} = await import("../helpers/schema-coverage.js")
        const gaps = coverageGaps(sampleDoc, docSchema)
        expect(gaps.missingNodes).toEqual([])
        expect(gaps.missingNodeAttrs).toEqual([])
        expect(gaps.missingMarks).toEqual([])
        expect(gaps.missingMarkAttrs).toEqual([])
    })

    it("exports heading levels 4-6 with their ids", () => {
        expect(markdown).toContain("#### Level Four {#coverage-h4}")
        expect(markdown).toContain("##### Level Five {#coverage-h5}")
        expect(markdown).toContain("###### Level Six {#coverage-h6}")
    })

    it("exports hard breaks and horizontal rules", () => {
        // Pandoc markdown represents a hard break as a trailing backslash.
        expect(markdown).toMatch(/hard break\\\nafter the break/)
        expect(markdown).toMatch(/\n---\n/)
    })

    it("keeps the text of annotation tags and legacy marks", () => {
        // The annotation_tag mark itself is not representable in markdown;
        // the marked text survives.
        expect(markdown).toContain(
            "after the break, an annotated word, and a smallcaps legacy mark."
        )
        expect(markdown).not.toContain("annotation-tag")
    })

    it("exports code blocks with language, category, title and id", () => {
        expect(markdown).toMatch(
            /~~~~\{\.python #code-2 category="listing" caption="A listing"\}\ndef hello\(\):/
        )
    })

    it("exports ordered lists with their start number", () => {
        expect(markdown).toContain("3. Ordered item starting at three")
        expect(markdown).toContain("4. Second item")
    })

    it("exports tracked lists and blockquotes without the track data", () => {
        expect(markdown).toContain("-  Tracked bullet item")
        expect(markdown).toMatch(/\n> A tracked blockquote with \*\*bold\*\* text\.\n/)
    })

    it("exports figures with alignment and equation figures with captions", () => {
        expect(markdown).toContain(
            "![A right-aligned figure](images/sample-image-1.png){#figure-3 width=60% data-aligned=\"right\" data-category=\"figure\"}"
        )
        // Equation figures carry the LaTeX in data-equation and the caption
        // as a paragraph inside the fenced div.
        expect(markdown).toMatch(
            /:::: \{#figure-4 \.doc-figure data-equation="a\^2 \+ b\^2 = c\^2" data-category="figure"\}\n\n\$\$\na\^2 \+ b\^2 = c\^2\n\$\$\n\nAn equation figure\n\n::::/
        )
    })

    it("exports tables with their layout attributes", () => {
        expect(markdown).toMatch(
            /::: \{\.doc-table #table-2 data-width="80" data-aligned="left" data-layout="auto" data-category="table"\}/
        )
        expect(markdown).toContain("| Wide header | Narrow header |")
        expect(markdown).toContain(": A second table")
    })

    it("exports footnotes containing lists", () => {
        expect(markdown).toMatch(
            /\[\^2\]: Footnote with a list:\n {4}\n {4}-\x20{2}Footnote bullet/
        )
    })

    it("exports textcite citations with prefix and locator", () => {
        expect(markdown).toContain(
            "A textcite citation [see also @wilm2026coverage, 12-14]"
        )
    })

    it("exports missing-target cross references by their id", () => {
        expect(markdown).toContain("a missing-target [gone](#gone) cross reference")
    })

    it("exports table parts, the table of contents part and separators as fenced divs", () => {
        expect(markdown).toMatch(
            /::: \{#table-section \.doc-part \.doc-table /
        )
        expect(markdown).toContain("::: {#toc .doc-part .doc-table_of_contents}")
        expect(markdown).toContain("::: {#separator .doc-part .doc-separator_part}")
    })
})
