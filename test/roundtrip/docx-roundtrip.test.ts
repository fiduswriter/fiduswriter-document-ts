import {readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it, jest} from "@jest/globals"
import {Window} from "happy-dom"
import JSZip from "jszip"
import type {FidusNode} from "../../src/types.js"

const window = new Window({url: "http://localhost"})
global.window = window as unknown as Window & typeof globalThis
global.document = window.document
global.DOMParser = window.DOMParser
global.gettext = (str: string) => str
global.interpolate = (str: string, args: Array<string | number>) =>
    str.replace(/%s/g, () => String(args.shift()))

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const FIXTURE_PATH = join(__dirname, "..", "fixtures", "input", "minimal.docx")

jest.unstable_mockModule("fwtoolkit", () => ({
    escapeText: (str: string) =>
        str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;"),
    shortFileTitle: (title: string, path: string) => title || path || "untitled",
    isSafeLinkHref: (href: unknown) => {
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
    addAlert: (_type: string, _message: string) => {},
    get: async (_url: string) => {
        const buffer = readFileSync(FIXTURE_PATH)
        return {
            blob: () => Promise.resolve(buffer),
            json: () => Promise.resolve({})
        }
    },
    post: async (_url: string, _params: unknown) => ({ok: true}),
    postJson: async (_url: string, _data: unknown) => ({json: {}}),
    getJson: async (_url: string) => ({}),
    convertDataURIToBlob: (_dataURI: string) => new Blob(),
    gettext: (str: string) => str,
    interpolate: (str: string, args: Array<string | number>) =>
        str.replace(/%s/g, () => String(args.shift())),
    noSpaceTmp: (strings: TemplateStringsArray, ...values: unknown[]) => {
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
    longFilePath: (path: string, filename: string) => `${path}${filename}`
}))

const {DocxConvert} = await import("../../src/importer/docx/convert.js")
const {DOCXExporter} = await import("../../src/exporter/docx/index.js")

const MINIMAL_TEMPLATE = {
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

describe("DOCX round-trip", () => {
    it("imports a real DOCX file and exports a valid DOCX file", async () => {
        const inputBuffer = readFileSync(FIXTURE_PATH)
        const inputZip = await JSZip.loadAsync(inputBuffer)

        const importer = new DocxConvert(
            inputZip,
            "roundtrip-test",
            MINIMAL_TEMPLATE,
            {}
        )
        const imported = (await importer.init()) as {
            content: {type: string; content: FidusNode[]}
            settings: Record<string, unknown>
            comments: Record<string, unknown>
        }

        expect(imported.content.type).toBe("doc")
        expect(imported.content.content.length).toBeGreaterThan(0)
        expect(imported.content.content[0].type).toBe("title")

        const doc = {
            title:
                imported.content.content[0].content?.[0]?.text || "Untitled",
            content: imported.content,
            settings: imported.settings,
            comments: imported.comments
        }

        const fakeCiteproc = {
            updateItems: () => {},
            appendCitationCluster: () => [],
            cslXml: {dataObj: {attrs: {class: "in-text"}}},
            makeBibliography: () => [{entry_ids: []}, []],
            citation: {opt: {}},
            sys: {}
        }
        const fakeCSL = {
            getEngine: () => Promise.resolve(fakeCiteproc)
        }

        const exporter = new DOCXExporter(doc, "template.docx", {}, {}, fakeCSL)
        const result = await exporter.init()
        expect(result.data).toBeDefined()

        const outputArrayBuffer = await result.data.arrayBuffer()
        const outputZip = await JSZip.loadAsync(outputArrayBuffer)

        const requiredFiles = [
            "[Content_Types].xml",
            "_rels/.rels",
            "word/document.xml"
        ]
        for (const file of requiredFiles) {
            expect(outputZip.files[file]).toBeDefined()
        }

        const documentXml = await outputZip
            .file("word/document.xml")
            ?.async("string")
        expect(documentXml).toBeDefined()
        expect(documentXml).toContain("<w:document")
        expect(documentXml).toContain("</w:document>")
        expect(documentXml).toContain(
            'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
        )
    })
})
