import {execFileSync} from "node:child_process"
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {beforeAll, afterAll, describe, expect, it, jest} from "@jest/globals"

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
            "![A sample figure caption](images/sample-image-1.png){#figure-1 width=80% data-category=\"figure\"}"
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

describe("markdown output parses with pandoc", () => {
    const hasPandoc = (() => {
        try {
            execFileSync("pandoc", ["--version"], {stdio: "ignore"})
            return true
        } catch {
            return false
        }
    })()

    let workDir
    beforeAll(() => {
        if (!hasPandoc) {
            return
        }
        workDir = mkdtempSync(join(tmpdir(), "fw-markdown-"))
        writeFileSync(join(workDir, "document.md"), markdown, "utf-8")
    })

    afterAll(() => {
        if (workDir) {
            rmSync(workDir, {recursive: true, force: true})
        }
    })

    it("round-trips through pandoc's markdown reader", () => {
        if (!hasPandoc) {
            // Skip silently when pandoc is not installed.
            return
        }
        const json = JSON.parse(
            execFileSync("pandoc", ["-f", "markdown", "-t", "json", "document.md"], {
                cwd: workDir,
                encoding: "utf-8"
            })
        )
        const types = new Set()
        const walk = blocks => {
            blocks.forEach(block => {
                types.add(block.t)
                if (block.t === "Div" || block.t === "Figure") {
                    walk(block.c[block.c.length - 1] || block.c[2])
                } else if (block.t === "BlockQuote") {
                    walk(block.c)
                } else if (block.t === "BulletList") {
                    block.c.forEach(item => walk(item))
                } else if (block.t === "OrderedList") {
                    walk(block.c[block.c.length - 1])
                } else if (block.t === "Para" || block.t === "Plain") {
                    block.c.forEach(inline => {
                        if (
                            !["Str", "Space", "SoftBreak"].includes(inline.t)
                        ) {
                            types.add(`inline:${inline.t}`)
                        }
                        if (inline.t === "Note") {
                            walk(inline.c)
                        }
                    })
                }
            })
        }
        walk(json.blocks)
        // The essential constructs survive the round trip.
        ;["Header", "Para", "BlockQuote", "BulletList", "OrderedList", "CodeBlock", "Table", "Figure", "Div"].forEach(
            type => expect(types.has(type)).toBe(true)
        )
        ;[
            "inline:Link",
            "inline:Image",
            "inline:Math",
            "inline:Note",
            "inline:Cite",
            "inline:Span"
        ].forEach(type => expect(types.has(type)).toBe(true))
        // Metadata survives.
        expect(json.meta.title).toBeDefined()
        expect(json.meta.author).toBeDefined()
        expect(json.meta.keywords).toBeDefined()
        expect(json.meta.abstract).toBeDefined()
    })
})
