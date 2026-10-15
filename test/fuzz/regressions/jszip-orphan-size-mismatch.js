// Regression test: the ODT importer could crash the Node.js process with an
// unhandled rejection ("Bug : uncompressed data size mismatch") when a
// mutated .odt byte-flipped a zip header such that jszip 3.10.2's
// post-inflate size check (`getContentWorker`'s "end" handler in
// jszip/lib/compressedObject.js) fired in a detached stream worker after the
// awaited import chain had already settled. The import itself settled
// normally; the stray rejection killed the process under Node's strict
// unhandled-rejection default. `src/importer/zip_guard.ts` now installs a
// process-level listener that swallows that exact jszip assertion and
// re-raises everything else.
//
// Found by test/fuzz/docx-odt.js (campaign seed 992001, property seed
// 1279640667: three byte flips in comprehensive-test.odt).
//
// Without the guard this script dies before printing the final line, so
// simply reaching the end (exit 0) is the assertion.
//
// Run: node test/fuzz/regressions/jszip-orphan-size-mismatch.js
import "../../setup.js"

import assert from "node:assert"
import {readFileSync} from "node:fs"
import {join} from "node:path"

const {OdtImporter} = await import("../../../dist/importer/odt/index.js")

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

const buf = Buffer.from(
    readFileSync(join("test", "importer", "fixtures", "comprehensive-test.odt"))
)
// Byte flips recorded from the fuzz counterexample: [offset, expected, flipped-to]
for (const [offset, expected, flipped] of [
    [6, 0, 73],
    [1623, 123, 102],
    [110, 111, 71]
]) {
    assert.strictEqual(buf[offset], expected, `unexpected byte at ${offset}`)
    buf[offset] = flipped
}

const importer = new OdtImporter(new Blob([buf]), user, "", null, {
    getTemplate,
    nativeBackend: backend
})
const output = await importer.init()
assert.ok(output, "import settled with an output object")

// Give detached jszip stream workers time to land their stray throws.
await new Promise(resolve => setTimeout(resolve, 500))

console.log("jszip-orphan-size-mismatch regression passed")
