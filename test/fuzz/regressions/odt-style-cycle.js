// Regression test: the ODT importer overflowed the call stack
// ("Maximum call stack size exceeded") on files whose style definitions
// reference each other in a cycle (A -> B -> A), reached from both
// `isTitleStyle` and `isCodeBlockStyle` following `style:parent-style-name`
// recursively. The RangeError was caught by the importer's outer handler,
// but it turned an otherwise importable document into an error — and it
// spammed a 1000+-frame stack trace. Both walks now stop at the first
// repeated parent name.
//
// Found by test/fuzz/docx-odt.js (campaign seed 992001).
//
// Run: node test/fuzz/regressions/odt-style-cycle.js
import "../../setup.js"

import assert from "node:assert"

const {default: JSZip} = await import("jszip")
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

const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body>
    <office:text>
      <text:p text:style-name="CycleA">Cyclic body text</text:p>
    </office:text>
  </office:body>
</office:document-content>`

// Neither style matches any title/code indicator (no "title" in the name,
// font size under the threshold, not bold, not centered, no monospace
// font), so both parent-chain walks must traverse the whole cycle before
// the fix recursed forever.
const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
  <office:styles>
    <style:style style:name="CycleA" style:family="paragraph" style:parent-style-name="CycleB"/>
    <style:style style:name="CycleB" style:family="paragraph" style:parent-style-name="CycleA"/>
  </office:styles>
</office:document-styles>`

const zip = new JSZip()
zip.file("mimetype", "application/vnd.oasis.opendocument.text")
zip.file("content.xml", contentXml)
zip.file("styles.xml", stylesXml)
const zipBytes = await zip.generateAsync({type: "uint8array"})

const importer = new OdtImporter(new Blob([zipBytes]), user, "", null, {
    getTemplate,
    nativeBackend: backend
})
const output = await importer.init()

assert.ok(
    !(output.statusText || "").includes("call stack"),
    `import must not overflow the call stack, got: ${output.statusText}`
)
assert.ok(output.ok, `import must succeed, got statusText: "${output.statusText}"`)
assert.ok(
    JSON.stringify(output.doc ?? {}).includes("Cyclic body text"),
    "document body must survive the cyclic style chain"
)

console.log("odt-style-cycle regression passed")
