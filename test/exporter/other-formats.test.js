import {readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {beforeAll, describe, expect, it, jest} from "@jest/globals"
import JSZip from "jszip"

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

const FAKE_CSL = {}

jest.unstable_mockModule("fwtoolkit", () => ({
    escapeText: str =>
        str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;"),
    isSafeLinkHref: href => {
        if (typeof href !== "string") {
            return false
        }
        const trimmed = href.trim()
        if (!trimmed) {
            return false
        }
        if (trimmed.startsWith("#")) {
            return true
        }
        try {
            const url = new URL(trimmed, "http://localhost")
            return ["http:", "https:"].includes(url.protocol)
        } catch {
            return false
        }
    },
    shortFileTitle: (title, path) => title || path || "untitled",
    addAlert: (_type, _message) => {},
    get: async url => {
        if (url.endsWith(".zip")) {
            // Return any valid zip buffer for included zip files (e.g. mathlive style).
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
    post: async (_url, _params) => ({ok: true}),
    postJson: async (_url, _data) => ({json: {}}),
    getJson: async _url => ({}),
    convertDataURIToBlob: _dataURI => new Blob(),
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
                combined += value !== undefined && value !== null ? String(value) : ""
            }
        }
        return combined.split("\n").map(line => line.replace(/^\s*/g, "")).join("")
    },
    longFilePath: (path, filename) => `${path}${filename}`
}))

const {HTMLExporter} = await import("../../src/exporter/html/index.js")
const {JATSExporter} = await import("../../src/exporter/jats/index.js")
const {LatexExporter} = await import("../../src/exporter/latex/index.js")
const {EpubExporter} = await import("../../src/exporter/epub/index.js")
const {PandocExporter} = await import("../../src/exporter/pandoc/index.js")
const {PandocConvert} = await import("../../src/importer/pandoc/convert.js")

function makeDoc() {
    return {
        id: "realworld-test",
        title: sampleDoc.content[0].content[0].text,
        content: {...sampleDoc, attrs: sampleSettings},
        settings: sampleSettings
    }
}

beforeAll(() => {
    // HTML/EPUB exporters fetch stylesheets at runtime.
    global.fetch = () =>
        Promise.resolve({
            ok: true,
            text: () => Promise.resolve("")
        })
})

describe("HTML exporter with real document", () => {
    it("exports a zip containing document.html", async () => {
        const exporter = new HTMLExporter(
            makeDoc(),
            {db: {}},
            IMAGE_DB,
            FAKE_CSL,
            new Date(),
            []
        )
        const result = await exporter.init()
        expect(result.filename).toMatch(/\.html\.zip$/)
        expect(result.mimeType).toBe("application/zip")

        const buffer = await result.data.arrayBuffer()
        const zip = await JSZip.loadAsync(buffer)
        expect(zip.files["document.html"]).toBeDefined()

        const html = await zip.file("document.html")?.async("string")
        expect(html).toContain("Test Document for Export/Import")
    })
})

describe("JATS exporter with real document", () => {
    it("exports a zip containing manuscript.xml and manifest.xml", async () => {
        const exporter = new JATSExporter(
            makeDoc(),
            {db: {}},
            IMAGE_DB,
            FAKE_CSL,
            new Date(),
            "article"
        )
        const result = await exporter.init()
        expect(result.filename).toMatch(/\.jats\.zip$/)

        const buffer = await result.data.arrayBuffer()
        const zip = await JSZip.loadAsync(buffer)
        expect(zip.files["manuscript.xml"]).toBeDefined()
        expect(zip.files["manifest.xml"]).toBeDefined()

        const manuscript = await zip.file("manuscript.xml")?.async("string")
        expect(manuscript).toContain("<article")
        expect(manuscript).toContain("Test Document for Export/Import")
    })
})

describe("LaTeX exporter with real document", () => {
    it("exports a zip containing document.tex", async () => {
        const exporter = new LatexExporter(makeDoc(), {db: {}}, IMAGE_DB, new Date())
        const result = await exporter.init()
        expect(result.filename).toMatch(/\.latex\.zip$/)

        const buffer = await result.data.arrayBuffer()
        const zip = await JSZip.loadAsync(buffer)
        expect(zip.files["document.tex"]).toBeDefined()
        expect(zip.files["README.txt"]).toBeDefined()

        const tex = await zip.file("document.tex")?.async("string")
        expect(tex).toContain("Test Document for Export/Import")
    })
})

describe("EPUB exporter with real document", () => {
    it("exports a valid EPUB zip with required files", async () => {
        const exporter = new EpubExporter(
            makeDoc(),
            {db: {}},
            IMAGE_DB,
            FAKE_CSL,
            new Date(),
            []
        )
        const result = await exporter.init()
        expect(result.filename).toMatch(/\.epub$/)

        const buffer = await result.data.arrayBuffer()
        const zip = await JSZip.loadAsync(buffer)
        expect(zip.files["META-INF/container.xml"]).toBeDefined()
        expect(zip.files["EPUB/document.opf"]).toBeDefined()
        expect(zip.files["EPUB/document.ncx"]).toBeDefined()
        expect(zip.files["EPUB/document-nav.xhtml"]).toBeDefined()
        expect(zip.files["EPUB/document.xhtml"]).toBeDefined()
    })
})

describe("Pandoc exporter and importer round-trip", () => {
    const minimalContent = {
        type: "doc",
        content: [
            {
                type: "title",
                content: [{type: "text", text: "Round-trip title"}]
            },
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "Hello "},
                    {type: "text", marks: [{type: "strong"}], text: "world"},
                    {type: "text", text: "."}
                ]
            }
        ]
    }

    const minimalDoc = {
        id: "pandoc-roundtrip",
        title: "Round-trip title",
        content: minimalContent,
        settings: {language: "en-US"}
    }

    const minimalTemplate = {
        content: {
            type: "doc",
            content: [
                {type: "title", content: [{type: "text", text: "Title"}]},
                {
                    type: "richtext_part",
                    attrs: {metadata: "abstract", title: "Abstract"}
                },
                {
                    type: "contributors_part",
                    attrs: {metadata: "authors", title: "Authors"}
                },
                {
                    type: "tags_part",
                    attrs: {metadata: "keywords", title: "Keywords"}
                },
                {type: "richtext_part", attrs: {title: "Body"}}
            ]
        }
    }

    it("exports a zip containing document.json and README.txt", async () => {
        const exporter = new PandocExporter(
            minimalDoc,
            {db: {}},
            {db: {}},
            FAKE_CSL,
            new Date()
        )
        const result = await exporter.init()
        expect(result.filename).toMatch(/\.pandoc\.json\.zip$/)

        const buffer = await result.data.arrayBuffer()
        const zip = await JSZip.loadAsync(buffer)
        expect(zip.files["document.json"]).toBeDefined()
        expect(zip.files["README.txt"]).toBeDefined()

        const json = await zip.file("document.json")?.async("string")
        const pandocDoc = JSON.parse(json)
        expect(pandocDoc.blocks).toBeDefined()
        expect(pandocDoc.blocks.length).toBeGreaterThan(0)
    })

    it("imports the exported Pandoc JSON back into a Fidus doc", async () => {
        const exporter = new PandocExporter(
            minimalDoc,
            {db: {}},
            {db: {}},
            FAKE_CSL,
            new Date()
        )
        const result = await exporter.init()
        const buffer = await result.data.arrayBuffer()
        const zip = await JSZip.loadAsync(buffer)
        const json = await zip.file("document.json")?.async("string")
        const pandocDoc = JSON.parse(json)

        const importer = new PandocConvert(
            pandocDoc,
            "pandoc-import-test",
            minimalTemplate,
            {}
        )
        const imported = importer.init()
        expect(imported.content.type).toBe("doc")
        expect(imported.content.content.length).toBeGreaterThan(0)
        expect(imported.settings.import_id).toBe("pandoc-import-test")
        expect(imported.settings.language).toMatch(/^en/)
    })
})
