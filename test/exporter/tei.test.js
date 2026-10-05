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

const {
    tag,
    wrap,
    wrapText,
    linkRef,
    linkPtr,
    linkify,
    escapeXmlText,
    escapeAttribute
} = await import("../../src/exporter/tei/utils.js")
const {extract, extractFootnotes} = await import(
    "../../src/exporter/tei/extract.js"
)
const {authors, keywords, convertTextToTei} = await import(
    "../../src/exporter/tei/convert.js"
)

describe("TEI XML utils", () => {
    it("escapeXmlText escapes <, > and &", () => {
        expect(escapeXmlText("<h1>&</h1>")).toBe("&lt;h1&gt;&amp;&lt;/h1&gt;")
    })

    it("escapeAttribute additionally escapes quotes", () => {
        expect(escapeAttribute('"x"&<')).toBe("&quot;x&quot;&amp;&lt;")
    })

    it("tag creates empty XML tags with attributes", () => {
        expect(tag("lb")).toBe("<lb />")
        expect(tag("graphic", {url: "images/x.png"})).toBe(
            '<graphic url="images/x.png" />'
        )
        expect(tag("ref", {target: "a\"b"})).toBe(
            '<ref target="a&quot;b" />'
        )
    })

    it("wrap wraps content in a tag with attributes", () => {
        expect(wrap("hi", "text", {rend: "bold"})).toBe(
            '<hi rend="bold">text</hi>'
        )
    })

    it("wrapText escapes the wrapped content", () => {
        expect(wrapText("title", "a<b")).toBe("<title>a&lt;b</title>")
    })

    it("linkRef and linkPtr create links", () => {
        expect(linkRef("https://example.org", "Example")).toBe(
            '<ref target="https://example.org">Example</ref>'
        )
        expect(linkPtr("https://example.org")).toBe(
            '<ptr target="https://example.org" />'
        )
    })

    it("linkify converts URLs and DOIs to refs", () => {
        const text = linkify("See https://example.org/x and doi:10.1000/xyz.")
        expect(text).toContain(
            '<ref target="https://example.org/x">https://example.org/x</ref>'
        )
        expect(text).toContain(
            '<ref target="https://doi.org/10.1000/xyz">https://doi.org/10.1000/xyz</ref>.'
        )
    })
})

describe("TEI text conversion", () => {
    it("converts a plain text node", () => {
        expect(convertTextToTei({type: "text", text: "a & b"})).toBe("a &amp; b")
    })

    it("nests marks (em inside strong)", () => {
        expect(
            convertTextToTei({
                type: "text",
                text: "word",
                marks: [{type: "strong"}, {type: "em"}]
            })
        ).toBe('<hi rend="italic"><hi rend="bold">word</hi></hi>')
    })

    it("converts underline, sup, sub and code marks", () => {
        expect(
            convertTextToTei({
                type: "text",
                text: "u",
                marks: [{type: "underline"}]
            })
        ).toBe('<hi rend="underline">u</hi>')
        expect(
            convertTextToTei({type: "text", text: "2", marks: [{type: "sup"}]})
        ).toBe('<hi rend="superscript">2</hi>')
        expect(
            convertTextToTei({type: "text", text: "i", marks: [{type: "sub"}]})
        ).toBe('<hi rend="subscript">i</hi>')
        expect(
            convertTextToTei({
                type: "text",
                text: "x",
                marks: [{type: "code"}]
            })
        ).toBe('<hi rend="code">x</hi>')
    })

    it("converts links and anchors", () => {
        expect(
            convertTextToTei({
                type: "text",
                text: "link",
                marks: [{type: "link", attrs: {href: "https://x.org"}}]
            })
        ).toBe('<ref target="https://x.org">link</ref>')
        expect(
            convertTextToTei({
                type: "text",
                text: "a",
                marks: [{type: "anchor", attrs: {id: "A123"}}]
            })
        ).toBe('<anchor xml:id="A123">a</anchor>')
    })
})

describe("TEI extraction", () => {
    const fields = extract(sampleDoc)

    it("extracts title and keywords", () => {
        expect(fields.title).toBe("Test Document for Export/Import")
        expect(fields.tags.keywords).toEqual([
            "testing",
            "export",
            "fiduswriter"
        ])
    })

    it("extracts authors with all fields", () => {
        expect(fields.authors.length).toBe(2)
        expect(fields.authors[0]).toMatchObject({
            firstname: "Jane",
            lastname: "Doe",
            institution: "Test University",
            email: "jane@example.com"
        })
    })

    it("extracts footnotes", () => {
        const footnotes = extractFootnotes(sampleDoc)
        expect(footnotes.length).toBeGreaterThan(0)
        expect(JSON.stringify(footnotes[0])).toContain("italic")
    })
})

describe("TEI template helpers", () => {
    it("authors() includes name, affiliation, email and ORCID", () => {
        const tei = authors([
            {
                firstname: "Jane",
                lastname: "Doe",
                institution: "Test University",
                email: "jane@example.com",
                id_type: "ORCID",
                id_value: "0000-0001-2345-6789"
            }
        ])
        expect(tei).toContain("<surname>Doe</surname>")
        expect(tei).toContain("<forename>Jane</forename>")
        expect(tei).toContain("<affiliation>Test University</affiliation>")
        expect(tei).toContain("<email>jane@example.com</email>")
        expect(tei).toContain(
            '<idno type="ORCID">0000-0001-2345-6789</idno>'
        )
    })

    it("authors() omits ORCID for other id types", () => {
        const tei = authors([{lastname: "Doe", id_type: "ISNI", id_value: "x"}])
        expect(tei).not.toContain("<idno")
    })

    it("keywords() creates a keywords element", () => {
        const tei = keywords(["a", "b"], "keywords")
        expect(tei).toContain('scheme="ConfTool"')
        expect(tei).toContain("<term>a</term>")
        expect(tei).toContain("<term>b</term>")
    })

    it("keywords() returns an empty string for empty lists", () => {
        expect(keywords([])).toBe("")
    })
})

describe("TEI exporter with real document", () => {
    let TEIExporter
    beforeAll(async () => {
        ;({TEIExporter} = await import("../../src/exporter/tei/index.js"))
    })

    const makeDoc = () => ({
        id: "tei-test",
        title: sampleDoc.content[0].content[0].text,
        content: {...sampleDoc, attrs: sampleSettings},
        settings: sampleSettings
    })

    it("exports a zip with a well-formed TEI XML file", async () => {
        const exporter = new TEIExporter(
            makeDoc(),
            {db: {}},
            IMAGE_DB,
            {},
            new Date()
        )
        await exporter.init()
        expect(exporter.zipFileName).toMatch(/\.tei\.xml\.zip$/)
        const teiFile = exporter.textFiles.find(file =>
            file.filename.endsWith(".tei.xml")
        )
        expect(teiFile).toBeDefined()
        expect(teiFile.contents).toContain("<TEI")
        expect(teiFile.contents).toContain('xmlns="http://www.tei-c.org/ns/1.0"')
        expect(teiFile.contents).toContain("<teiHeader>")
        expect(teiFile.contents).toContain("<title type=\"main\">Test Document for Export/Import</title>")
        expect(teiFile.contents).toContain("<body>")
        // Headings are numbered and wrapped in divs.
        expect(teiFile.contents).toContain("<head>1. Introduction</head>")
        expect(teiFile.contents).toContain('<div type="div1" rend="DH-Heading1">')
        // Images are referenced and shipped in the zip.
        expect(teiFile.contents).toContain(
            '<graphic url="images/sample-image-1.png" />'
        )
        expect(exporter.httpFiles.map(file => file.filename)).toContain(
            "images/sample-image-1.png"
        )
        // Footnotes are referenced in the text and defined in the back.
        expect(teiFile.contents).toContain('<ref n="1" target="ftn1" />')
        expect(teiFile.contents).toContain('rend="footnote text"')
        // The closing tags balance.
        expect(teiFile.contents).toContain("</TEI>")
    })

    it("escapes XML special characters in the text", async () => {
        const doc = makeDoc()
        // Replace the first paragraph's content with tricky text.
        const titlePart = doc.content.content[0]
        const firstParagraph = doc.content.content.find(
            part => part.type === "heading_part"
        ).content.find(node => node.type === "paragraph")
        firstParagraph.content = [{type: "text", text: "a < b & c"}]
        expect(titlePart).toBeDefined()
        const exporter = new TEIExporter(
            doc,
            {db: {}},
            IMAGE_DB,
            {},
            new Date()
        )
        await exporter.init()
        const teiFile = exporter.textFiles.find(file =>
            file.filename.endsWith(".tei.xml")
        )
        expect(teiFile.contents).toContain("a &lt; b &amp; c")
    })

    it("supports a custom publicationStmt option", async () => {
        const exporter = new TEIExporter(
            makeDoc(),
            {db: {}},
            IMAGE_DB,
            {},
            new Date(),
            {publicationStmt: "<publisher>Test Press</publisher>"}
        )
        await exporter.init()
        const teiFile = exporter.textFiles.find(file =>
            file.filename.endsWith(".tei.xml")
        )
        expect(teiFile.contents).toContain("<publisher>Test Press</publisher>")
    })
})
