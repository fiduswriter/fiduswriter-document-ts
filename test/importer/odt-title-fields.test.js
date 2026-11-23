import {dirname} from "node:path"
import {fileURLToPath} from "node:url"
import {beforeAll, describe, expect, it} from "@jest/globals"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const {OdtConvert} = await import("../../src/importer/odt/convert.js")

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

const CONTENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
    office:version="1.2">
  <office:body>
    <office:text>
      <text:p text:style-name="Title">My <text:page-number>3</text:page-number> title</text:p>
      <text:p>Page <text:page-number>3</text:page-number> of <text:page-count>12</text:page-count></text:p>
    </office:text>
  </office:body>
</office:document-content>`

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    office:version="1.2">
</office:document-styles>`

const flatten = (node, result = []) => {
    result.push(node)
    if (node.content) {
        node.content.forEach(child => flatten(child, result))
    }
    return result
}

describe("ODT importer title and field handling", () => {
    let imported

    beforeAll(async () => {
        const importer = new OdtConvert(
            CONTENT_XML,
            STYLES_XML,
            "",
            "",
            "odt-title-fields-test",
            MINIMAL_TEMPLATE,
            {},
            {}
        )
        imported = importer.init()
    })

    it("flattens fields in the title to plain text", () => {
        const title = imported.content.content.find(
            node => node.type === "title"
        )
        expect(title).toBeDefined()
        expect(title.content).toEqual([{type: "text", text: "My 3 title"}])
    })

    it("keeps the displayed text of page fields", () => {
        const descendants = flatten(imported.content)
        const texts = descendants
            .filter(node => node.type === "text")
            .map(node => node.text)
        // "Page 3 of 12" — the page-number/page-count field text is kept.
        expect(texts).toContain("Page ")
        expect(texts).toContain("3")
        expect(texts).toContain(" of ")
        expect(texts).toContain("12")
    })
})
