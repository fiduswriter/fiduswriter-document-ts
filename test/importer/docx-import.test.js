import {readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {beforeAll, describe, expect, it, jest} from "@jest/globals"
import {Window} from "happy-dom"
import JSZip from "jszip"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const TEMPLATE_FIXTURE_PATH = join(
    __dirname,
    "..",
    "fixtures",
    "input",
    "minimal.docx"
)

jest.unstable_mockModule("fwtoolkit", () => ({
    escapeText: str =>
        str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;"),
    shortFileTitle: (title, path) => title || path || "untitled",
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
    addAlert: (_type, _message) => {},
    get: async _url => {
        const buffer = readFileSync(TEMPLATE_FIXTURE_PATH)
        return {
            blob: () => Promise.resolve(buffer),
            json: () => Promise.resolve({})
        }
    },
    post: async (_url, _params) => ({ok: true}),
    postJson: async (_url, _data) => ({json: {}}),
    getJson: async _url => ({}),
    convertDataURIToBlob: _dataURI => new Blob(),
    gettext: str => str,
    interpolate: (str, args) => str.replace(/%s/g, () => String(args.shift())),
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
            {type: "richtext_part", attrs: {title: "Body", id: "body"}}
        ]
    }
}

const TEMPLATE_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh wp14">
<w:body>
<w:p><w:r><w:t>{title}</w:t></w:r></w:p>
<w:p><w:r><w:t>{@body}</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
</w:body>
</w:document>`

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r><w:t>My </w:t></w:r>
      <w:fldSimple w:instr="PAGE"><w:r><w:t>Doc</w:t></w:r></w:fldSimple>
    </w:p>
    <w:p><w:r><w:t>Body text.</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="5000" w:type="pct"/>
        <w:jc w:val="left"/>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="3000"/>
        <w:gridCol w:w="3000"/>
        <w:gridCol w:w="3000"/>
      </w:tblGrid>
      <w:tr>
        <w:trPr><w:tblHeader/></w:trPr>
        <w:tc>
          <w:tcPr><w:gridSpan w:val="2"/></w:tcPr>
          <w:p><w:r><w:t>A1</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:vMerge w:val="restart"/></w:tcPr>
          <w:p><w:r><w:t>B1</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc>
        <w:tc>
          <w:tcPr><w:vMerge/></w:tcPr>
          <w:p><w:r><w:t>ignored</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:p>
      <w:moveFrom w:author="Alice" w:date="2024-01-01T00:00:00Z">
        <w:r><w:delText>moved away</w:delText></w:r>
      </w:moveFrom>
      <w:moveTo w:author="Alice" w:date="2024-01-01T00:00:00Z">
        <w:r><w:t>moved here</w:t></w:r>
      </w:moveTo>
      <w:proofErr w:id="1"/>
      <w:bookmarkStart w:id="2" w:name="bm1"/>
      <w:bookmarkEnd w:id="2"/>
    </w:p>
    <w:p>
      <w:fldSimple w:instr="PAGE"><w:r><w:t>3</w:t></w:r></w:fldSimple>
    </w:p>
    <w:sdt>
      <w:sdtPr/>
      <w:sdtContent>
        <w:p><w:r><w:t>inside sdt</w:t></w:r></w:p>
      </w:sdtContent>
    </w:sdt>
    <w:sectPr/>
  </w:body>
</w:document>`

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`

const flatten = (node, result = []) => {
    result.push(node)
    if (node.content) {
        node.content.forEach(child => flatten(child, result))
    }
    return result
}

describe("DOCX importer integration", () => {
    let imported

    beforeAll(async () => {
        const zip = new JSZip()
        zip.file("word/document.xml", DOCUMENT_XML)
        zip.file("word/styles.xml", STYLES_XML)
        const docx = new DocxConvert(
            zip,
            "docx-integration-test",
            MINIMAL_TEMPLATE,
            {}
        )
        imported = await docx.init()
    })

    it("returns a doc node with a title", () => {
        expect(imported.content.type).toBe("doc")
        const title = imported.content.content.find(
            node => node.type === "title"
        )
        expect(title).toBeDefined()
    })

    it("flattens non-text content in the title to plain text", () => {
        const title = imported.content.content.find(
            node => node.type === "title"
        )
        expect(title.content).toEqual([{type: "text", text: "My Doc"}])
    })

    it("imports tables with colspan and rowspan", () => {
        const descendants = flatten(imported.content)
        const table = descendants.find(node => node.type === "table")
        expect(table).toBeDefined()
        expect(table.attrs.width).toBe("100")
        expect(table.attrs.aligned).toBe("left")
        const body = table.content.find(node => node.type === "table_body")
        expect(body.content.length).toBe(2)

        const [row1, row2] = body.content
        expect(row1.content.length).toBe(2)
        expect(row1.content[0].type).toBe("table_header")
        expect(row1.content[0].attrs.colspan).toBe(2)
        expect(row1.content[0].attrs.rowspan).toBe(1)
        expect(row1.content[1].attrs.rowspan).toBe(2)

        // The vMerge-continuation cell is folded into the rowspan above.
        expect(row2.content.length).toBe(2)
        expect(
            row2.content.every(cell => cell.type === "table_cell")
        ).toBe(true)
    })

    it("keeps the table cell text", () => {
        const descendants = flatten(imported.content)
        const texts = descendants
            .filter(node => node.type === "text")
            .map(node => node.text)
        expect(texts).toContain("A1")
        expect(texts).toContain("B1")
        expect(texts).toContain("A2")
        expect(texts).toContain("B2")
        expect(texts).not.toContain("ignored")
    })

    it("imports tracked moves as insertion/deletion marks", () => {
        const descendants = flatten(imported.content)
        const texts = descendants.filter(node => node.type === "text")
        const movedAway = texts.find(node => node.text === "moved away")
        const movedHere = texts.find(node => node.text === "moved here")
        expect(movedAway).toBeDefined()
        expect(movedHere).toBeDefined()
        expect(
            movedAway.marks?.some(mark => mark.type === "deletion")
        ).toBe(true)
        expect(
            movedHere.marks?.some(mark => mark.type === "insertion")
        ).toBe(true)
    })

    it("keeps the display text of simple fields", () => {
        const descendants = flatten(imported.content)
        const texts = descendants
            .filter(node => node.type === "text")
            .map(node => node.text)
        expect(texts).toContain("3")
    })

    it("unwraps block-level content controls", () => {
        const descendants = flatten(imported.content)
        const texts = descendants
            .filter(node => node.type === "text")
            .map(node => node.text)
        expect(texts).toContain("inside sdt")
    })
})

describe("DOCX import/export round trip with tables", () => {
    it("exports imported tables and re-imports them intact", async () => {
        const window = new Window({url: "http://localhost"})
        const prevWindow = global.window
        const prevDocument = global.document
        const prevDOMParser = global.DOMParser
        global.window = window
        global.document = window.document
        global.DOMParser = window.DOMParser
        try {
            const zip = new JSZip()
            zip.file("word/document.xml", DOCUMENT_XML)
            zip.file("word/styles.xml", STYLES_XML)
            const docx = new DocxConvert(
                zip,
                "docx-roundtrip-test",
                MINIMAL_TEMPLATE,
                {}
            )
            const imported = await docx.init()

            const doc = {
                title:
                    imported.content.content[0].content?.[0]?.text ||
                    "Untitled",
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
            // Build an export template with real placeholders from the
            // minimal.docx fixture.
            const templateZip = await JSZip.loadAsync(
                readFileSync(TEMPLATE_FIXTURE_PATH)
            )
            templateZip.file("word/document.xml", TEMPLATE_DOCUMENT_XML)
            const templateBlob = await templateZip.generateAsync({
                type: "blob"
            })
            const exporter = new DOCXExporter(
                doc,
                "template.docx",
                {},
                {},
                fakeCSL,
                templateBlob
            )
            const result = await exporter.init()
            const outputZip = await JSZip.loadAsync(
                await result.data.arrayBuffer()
            )
            const documentXml = await outputZip
                .file("word/document.xml")
                ?.async("string")
            expect(documentXml).toContain("<w:tbl>")

            // Re-import the exported file: the tables must come back.
            const reimported = new DocxConvert(
                outputZip,
                "docx-roundtrip-test-2",
                MINIMAL_TEMPLATE,
                {}
            )
            const second = await reimported.init()
            const descendants = flatten(second.content)
            const tables = descendants.filter(node => node.type === "table")
            expect(tables.length).toBe(1)
            const body = descendants.find(
                node => node.type === "table_body"
            )
            expect(body.content.length).toBe(2)
            const texts = descendants
                .filter(node => node.type === "text")
                .map(node => node.text)
            expect(texts).toContain("A1")
            expect(texts).toContain("B1")
            expect(texts).toContain("A2")
            expect(texts).toContain("B2")
        } finally {
            global.window = prevWindow
            global.document = prevDocument
            global.DOMParser = prevDOMParser
        }
    })
})
