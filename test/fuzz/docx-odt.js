// Fuzz harness for the DOCX and ODT importers — the formats users upload
// from Word and LibreOffice. Seeds are the repo's own test files; mutations
// cover the zip layer and XML-aware mutations of the main part documents.
//
// Invariants: the import resolves with a structured result (ok true or
// false with statusText) or rejects with a catchable Error — never hangs
// and never crashes the process.

import "../setup.js"

import {readFileSync} from "node:fs"
import {join, dirname} from "node:path"
import {fileURLToPath} from "node:url"

import {fc, runHarness} from "./config.js"
import {makeRng} from "./rng.js"

const here = dirname(fileURLToPath(import.meta.url))

const {DocxImporter} = await import("../../dist/importer/docx/index.js")
const {OdtImporter} = await import("../../dist/importer/odt/index.js")
const {default: JSZip} = await import("jszip")

const backend = {
    createDoc: async () => ({id: 1, path: ""}),
    saveImages: async () => ({}),
    saveDocument: async () => ({})
}
const user = {id: 1, username: "fuzzer", is_authenticated: true}
const template = {
    content: {
        type: "doc",
        content: [
            {type: "title", content: [{type: "text", text: "Title"}]},
            {
                type: "richtext_part",
                attrs: {id: "body", title: "Body"},
                content: [{type: "paragraph"}]
            }
        ]
    },
    document_styles: [],
    export_templates: []
}
const getTemplate = async () => template

const DOCX_SEEDS = [
    join(here, "..", "fixtures", "input", "hello-world.docx"),
    join(here, "..", "fixtures", "input", "minimal.docx"),
    join(here, "..", "importer", "fixtures", "comprehensive-test.docx")
]
const ODT_SEEDS = [join(here, "..", "importer", "fixtures", "comprehensive-test.odt")]

// XML fragments spliced into the main part documents.
const XML_ATTACKS = [
    "<w:p>",
    "</w:p>",
    "<w:tbl><w:tr><w:tc>",
    "<!ENTITY xxe SYSTEM \"file:///etc/passwd\">",
    "&xxe;",
    "&lt;",
    "&#x10FFFF;",
    "<w:sectPr>",
    "<mc:AlternateContent>",
    "<w:footnote>",
    "id=\"rId",
    "\x00",
    "\t"
]

async function mutatedBytes(seedPath, rng) {
    const original = readFileSync(seedPath)
    const strategy = rng.int(0, 3)
    if (strategy === 0) {
        // Raw byte mutations.
        const bytes = Uint8Array.from(original)
        for (let i = 0; i < rng.int(1, 6); i++) {
            bytes[rng.int(0, bytes.length - 1)] = rng.int(0, 255)
        }
        return bytes
    }
    if (strategy === 1) {
        // Truncation.
        return original.slice(0, rng.int(1, original.length))
    }
    const zip = await JSZip.loadAsync(original)
    // Find the main XML part.
    const names = Object.keys(zip.files).filter(name =>
        name.endsWith(".xml")
    )
    const mainName =
        names.find(name => name.endsWith("document.xml")) ||
        names.find(name => name.endsWith("content.xml")) ||
        names[0]
    if (!mainName) {
        return original
    }
    const entry = zip.file(mainName)
    if (!entry) {
        return original
    }
    let xml = await entry.async("string")
    if (strategy === 2) {
        // Splice attack fragments at random positions.
        const count = rng.int(1, 4)
        for (let i = 0; i < count; i++) {
            const pos = rng.int(0, xml.length)
            const fragment = XML_ATTACKS[rng.int(0, XML_ATTACKS.length - 1)]
            xml = xml.slice(0, pos) + fragment + xml.slice(pos)
        }
    } else {
        // Drop structural tags.
        const tag = rng.pick(["</w:p>", "</w:tc>", "</w:tr>", "</w:body>", "</office:text>"])
        xml = xml.replace(tag, "")
    }
    zip.file(mainName, xml)
    return zip.generateAsync({type: "uint8array"})
}

const docxOdtProp = fc.asyncProperty(
    fc.integer({min: 1, max: 2 ** 31 - 1}),
    async seed => {
        const rng = makeRng(seed)
        const useDocx = rng.bool()
        const seedPath = useDocx
            ? DOCX_SEEDS[rng.int(0, DOCX_SEEDS.length - 1)]
            : ODT_SEEDS[rng.int(0, ODT_SEEDS.length - 1)]
        const bytes = await mutatedBytes(seedPath, rng)
        const blob = new Blob([bytes])
        const importer = useDocx
            ? new DocxImporter(blob, user, "", null, {
                  getTemplate,
                  nativeBackend: backend
              })
            : new OdtImporter(blob, user, "", null, {
                  getTemplate,
                  nativeBackend: backend
              })
        const timeout = new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error("import timed out")), 20000)
        )
        try {
            await Promise.race([importer.init(), timeout])
        } catch (error) {
            if (error.message === "import timed out") {
                throw error
            }
            if (!(error instanceof Error)) {
                throw new Error(
                    `import rejected with a non-Error: ${String(error)}`
                )
            }
            // catchable rejection is acceptable
        }
    }
)

runHarness("docx-odt", [
    {label: "mutated DOCX/ODT import safely", prop: docxOdtProp}
])
