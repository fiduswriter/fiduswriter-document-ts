import {readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it, jest, beforeAll} from "@jest/globals"

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
    addAlert: (_type, _message) => {},
    get: async url => {
        if (url.endsWith(".zip")) {
            const buffer = readFileSync(
                join(__dirname, "..", "fixtures", "input", "minimal.docx")
            )
            return {
                blob: () => Promise.resolve(buffer),
                json: () => Promise.resolve({})
            }
        }
        return {
            blob: () => Promise.resolve(Buffer.from([0])),
            json: () => Promise.resolve({})
        }
    },
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
            .split("\n")
            .map(line => line.replace(/^\s*/g, ""))
            .join("")
    },
    longFilePath: (path, filename) => `${path}${filename}`
}))

const {latexToTypstMath} = await import("../../src/exporter/typst/math.js")
const {escapeTypstText, labelName, fenceCode} = await import(
    "../../src/exporter/typst/escape.js"
)
const {expectCompilesWithTypst} = await import(
    "../helpers/typst-validation.js"
)

describe("typst math conversion", () => {
    it("passes through plain equations, splitting multi-letter runs", () => {
        expect(latexToTypstMath("E = mc^2")).toBe("E = m c^2")
        expect(latexToTypstMath("a^2 + b^2 = c^2")).toBe("a^2 + b^2 = c^2")
    })

    it("converts the integral fixture equation", () => {
        expect(latexToTypstMath("\\int_{a}^{b} f(x) \\, dx")).toBe(
            "integral_{a}^{b} f(x)  thin  d x"
        )
    })

    it("rebuilds fractions and roots", () => {
        expect(latexToTypstMath("\\frac{1}{2}")).toBe("(1)/(2)")
        expect(latexToTypstMath("\\frac{a+b}{c}")).toBe("(a+b)/(c)")
        expect(latexToTypstMath("\\sqrt{x}")).toBe("sqrt(x)")
        expect(latexToTypstMath("\\sqrt[3]{x}")).toBe("root(3, x)")
    })

    it("converts text commands to quoted strings", () => {
        expect(latexToTypstMath("\\text{if } x")).toBe('"if " x')
    })

    it("translates greek letters, symbols and delimiters", () => {
        expect(latexToTypstMath("\\alpha \\Sigma")).toBe("alpha Sigma")
        expect(latexToTypstMath("a \\leq b \\times c \\cdot d")).toBe(
            "a lt.eq b times c dot.op d"
        )
        expect(latexToTypstMath("\\left( x \\right)")).toBe("( x )")
        expect(latexToTypstMath("a \\to b")).toBe("a arrow b")
    })

    it("keeps unknown commands compilable as letter sequences", () => {
        expect(latexToTypstMath("\\unknowncmd")).toBe("u n k n o w n c m d")
    })
})

describe("typst escaping", () => {
    it("escapes the typst markup metacharacters", () => {
        expect(escapeTypstText("a#b$c_d*e[f]g<h>i@j~k\"l`m\\n")).toBe(
            'a\\#b\\$c\\_d\\*e\\[f\\]g\\<h\\>i\\@j\\~k\\"l\\`m\\\\n'
        )
    })

    it("escapes leading block markers on request", () => {
        expect(escapeTypstText("= heading", true)).toBe("\\= heading")
        expect(escapeTypstText("- item", true)).toBe("\\- item")
        expect(escapeTypstText("1. item", true)).toBe("1\\. item")
        expect(escapeTypstText("= heading")).toBe("= heading")
    })

    it("creates valid label names from arbitrary ids", () => {
        expect(labelName("intro-heading")).toBe("intro-heading")
        expect(labelName("H1")).toBe("H1")
        expect(labelName("1abc")).toBe("L1abc")
        expect(labelName("with space")).toBe("with-space")
    })

    it("fences code with extra backticks when needed", () => {
        // As in the markdown exporter, the fence is always at least four
        // characters so that triple backticks inside the code cannot
        // terminate it accidentally.
        const simple = fenceCode("a = 1")
        expect(simple.fence).toBe("````")
        const tricky = fenceCode("a ``` b")
        expect(tricky.fence).toBe("````")
        const trickier = fenceCode("a ```` b")
        expect(trickier.fence).toBe("`````")
    })
})

describe("typst exporter: schema coverage", () => {
    let TypstExporter
    let docSchema
    let typst
    let bibContents
    let exporter

    const makeDoc = () => ({
        id: "typst-coverage",
        title: sampleDoc.content[0].content[0].text,
        content: {...sampleDoc, attrs: sampleSettings},
        settings: sampleSettings
    })

    beforeAll(async () => {
        ;({TypstExporter} = await import("../../src/exporter/typst/index.js"))
        ;({docSchema} = await import("../../src/schema/document/index.js"))
        exporter = new TypstExporter(
            makeDoc(),
            BIB_DB,
            IMAGE_DB,
            new Date()
        )
        await exporter.init()
        typst = exporter.textFiles.find(
            file => file.filename === "document.typ"
        ).contents
        const bibFile = exporter.textFiles.find(
            file => file.filename === "bibliography.bib"
        )
        bibContents = bibFile ? bibFile.contents : undefined
    })

    it("the fixture exercises every schema node type and attribute", async () => {
        const {coverageGaps} = await import("../helpers/schema-coverage.js")
        const gaps = coverageGaps(sampleDoc, docSchema)
        expect(gaps.missingNodes).toEqual([])
        expect(gaps.missingNodeAttrs).toEqual([])
        expect(gaps.missingMarks).toEqual([])
        expect(gaps.missingMarkAttrs).toEqual([])
    })

    it("sets the document metadata, language and title block", () => {
        expect(typst).toContain("#set document(")
        expect(typst).toContain("title: [Test Document for Export/Import]")
        expect(typst).toContain('author: ("Jane Doe", "John Smith")')
        expect(typst).toContain('keywords: ("testing", "export", "fiduswriter")')
        expect(typst).toContain('#set text(lang: "en")')
        expect(typst).toContain(
            '#align(center)[#text(weight: "bold", size: 1.4em)[Test Document for Export/Import]]'
        )
        expect(typst).toContain("#align(center)[Jane Doe, John Smith]")
    })

    it("renders the abstract under an unnumbered heading", () => {
        expect(typst).toContain(
            "#heading(level: 1, outlined: false, numbering: none)[Abstract]"
        )
        expect(typst).toContain("This is a comprehensive test document")
    })

    it("marks document parts with comments", () => {
        expect(typst).toContain("// doc-part: introduction (heading_part)")
        expect(typst).toContain("// doc-part: coverage (richtext_part)")
    })

    it("exports headings with labels for all six levels", () => {
        expect(typst).toContain("= Introduction <intro-heading>")
        expect(typst).toContain("====== Level Six <coverage-h6>")
        expect(typst).toContain("== Text Formatting <text-formatting>")
    })

    it("exports inline marks, links and anchors", () => {
        expect(typst).toContain("#strong[bold]")
        expect(typst).toContain("#emph[italic]")
        expect(typst).toContain("#underline[underline]")
        expect(typst).toContain("#super[superscript]")
        expect(typst).toContain("#sub[subscript]")
        expect(typst).toContain("`code`")
        expect(typst).toContain('#link("https://fiduswriter.org")[a hyperlink]')
        expect(typst).toContain("<my-anchor>")
    })

    it("exports cross references as links when the target exists", () => {
        expect(typst).toContain("#link(<intro-heading>)[Introduction]")
        // The fixture also references a target that does not exist; Typst
        // errors on links to unknown labels, so only the text survives.
        expect(typst).toContain("a missing-target gone cross reference.")
        expect(typst).not.toContain("#link(<gone>")
    })

    it("exports code blocks and captioned code listings", () => {
        expect(typst).toMatch(/```javascript\nfunction hello\(\) \{/)
        expect(typst).toContain(
            "#figure(caption: [A listing], kind: raw)[````python"
        )
        expect(typst).toContain("<code-2>")
    })

    it("exports bullet and ordered lists, with enum start for late starters", () => {
        expect(typst).toMatch(/- First bullet item/)
        expect(typst).toMatch(/\+ First ordered item/)
        expect(typst).toMatch(/#block\[\n#set enum\(start: 3\)\n/)
        expect(typst).toContain("+ Ordered item starting at three")
    })

    it("exports blockquotes and horizontal rules", () => {
        expect(typst).toContain("#quote(block: true)[")
        expect(typst).toContain("#horizontalrule")
        expect(typst).toContain(
            "#let horizontalrule = line(start: (25%, 0%), end: (75%, 0%))"
        )
    })

    it("exports hard breaks as a trailing backslash", () => {
        expect(typst).toMatch(/hard break\\\nafter the break/)
    })

    it("exports image figures with width, captions, alignment and labels", () => {
        expect(typst).toContain(
            '#figure(image("images/sample-image-1.png", width: 80%), caption: [Figure: A sample figure caption]) <figure-1>'
        )
        expect(typst).toContain(
            '#align(right)[#figure(image("images/sample-image-1.png", width: 60%), caption: [Figure: A right-aligned figure]) <figure-3>]'
        )
    })

    it("exports equation figures with typst math", () => {
        expect(typst).toContain("#figure($ E = m c^2 $) <figure-2>")
        expect(typst).toContain(
            "#figure($ a^2 + b^2 = c^2 $, caption: [Figure: An equation figure]) <figure-4>"
        )
    })

    it("exports tables as captioned table figures with spans", () => {
        expect(typst).toContain("#table(")
        expect(typst).toContain("columns: 3")
        expect(typst).toContain("align: (center,center,center,)")
        expect(typst).toContain(
            "table.header([#strong[Header 1]], [#strong[Header 2]], [#strong[Header 3]])"
        )
        expect(typst).toContain(
            "table.cell(colspan: 2)[Merged cell (colspan=2)]"
        )
        expect(typst).toContain("table.cell(rowspan: 2)[Tall cell]")
        expect(typst).toContain("kind: table, caption: [A sample table])")
        expect(typst).toContain("<table-1>")
        // Table figures get their caption above the table.
        expect(typst).toContain(
            "#show figure.where(kind: table): set figure.caption(position: top)"
        )
    })

    it("exports footnotes, including lists inside footnotes", () => {
        expect(typst).toContain("#footnote[\nThis is the footnote content")
        expect(typst).toMatch(
            /#footnote\[\nFootnote with a list:\n\n- Footnote bullet\n\]/
        )
    })

    it("exports inline equations as typst math", () => {
        expect(typst).toContain(
            "$integral_{a}^{b} f(x)  thin  d x$"
        )
    })

    it("exports citations with supplements and a bibliography", () => {
        expect(typst).toContain(
            "#cite(<doe2020test>, supplement: [see, 45])"
        )
        expect(typst).toContain(
            '#cite(<wilm2026coverage>, form: "prose", supplement: [see also, 12-14])'
        )
        expect(typst).toContain(
            '#bibliography("bibliography.bib", title: [Bibliography])'
        )
        expect(bibContents).toContain("@article{doe2020test")
    })

    it("ships duplicate images only once", () => {
        const imageFiles = exporter.httpFiles.filter(file =>
            file.filename.includes("sample-image-1")
        )
        expect(imageFiles.length).toBe(1)
    })

    it("names the archive and includes a README", () => {
        expect(exporter.zipFileName).toMatch(/\.typ\.zip$/)
        const readme = exporter.textFiles.find(
            file => file.filename === "README.txt"
        )
        expect(readme).toBeDefined()
    })

    it("the exported document compiles with typst", () => {
        expectCompilesWithTypst(typst, bibContents)
    })
})

describe("typst exporter with custom content", () => {
    let TypstExporter
    beforeAll(async () => {
        ;({TypstExporter} = await import("../../src/exporter/typst/index.js"))
    })

    const makeDoc = () => ({
        id: "typst-test",
        title: sampleDoc.content[0].content[0].text,
        content: {...sampleDoc, attrs: sampleSettings},
        settings: sampleSettings
    })

    it("escapes typst special characters in the text", async () => {
        const doc = makeDoc()
        const firstParagraph = doc.content.content
            .find(part => part.type === "heading_part")
            .content.find(node => node.type === "paragraph")
        firstParagraph.content = [{type: "text", text: "a # b $ c * d"}]
        const exporter = new TypstExporter(doc, BIB_DB, IMAGE_DB, new Date())
        await exporter.init()
        const typst = exporter.textFiles.find(
            file => file.filename === "document.typ"
        ).contents
        expect(typst).toContain("a \\# b \\$ c \\* d")
        expectCompilesWithTypst(
            typst,
            exporter.textFiles.find(file => file.filename === "bibliography.bib")
                ?.contents
        )
    })

    it("compiles a document without citations without a bibliography", async () => {
        const doc = makeDoc()
        // Strip all citations from the document.
        const strip = nodes => {
            nodes.forEach(node => {
                if (node.content) {
                    node.content = node.content.filter(
                        child => child.type !== "citation"
                    )
                    strip(node.content)
                }
                if (Array.isArray(node.attrs?.footnote)) {
                    node.attrs.footnote = node.attrs.footnote.filter(
                        child => child.type !== "citation"
                    )
                    strip(node.attrs.footnote)
                }
            })
        }
        strip(doc.content.content)
        const exporter = new TypstExporter(doc, BIB_DB, IMAGE_DB, new Date())
        await exporter.init()
        const typst = exporter.textFiles.find(
            file => file.filename === "document.typ"
        ).contents
        expect(typst).not.toContain("#cite(")
        expect(typst).not.toContain("#bibliography(")
        expect(
            exporter.textFiles.find(file => file.filename === "bibliography.bib")
        ).toBeUndefined()
        expectCompilesWithTypst(typst)
    })
})
