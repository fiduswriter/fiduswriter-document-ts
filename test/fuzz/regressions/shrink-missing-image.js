// Regression test: ShrinkFidus crashed with a TypeError
// ("undefined.startsWith") when the document referenced an image id that
// has no entry in the imageDB — reachable when a document step referencing
// an image arrives before the corresponding `iu` imageDB update, or with
// documents from other clients whose images were never delivered. The
// export now skips dangling image references.
//
// Found by test/fuzz/roundtrip.js.
//
// Run: node test/fuzz/regressions/shrink-missing-image.js
import "../../setup.js"

import assert from "node:assert"

const {ShrinkFidus} = await import("../../../dist/exporter/native/shrink.js")

const fullDoc = {
    id: 1,
    title: "Dangling image",
    content: {
        type: "doc",
        content: [
            {type: "title", content: [{type: "text", text: "Dangling image"}]},
            {
                type: "richtext_part",
                attrs: {id: "body", title: "Body"},
                content: [
                    {
                        type: "figure",
                        attrs: {category: "figure", caption: true},
                        content: [
                            // image id 7 has no entry in the imageDB below
                            {type: "image", attrs: {image: 7}},
                            {
                                type: "figure_caption",
                                content: [{type: "text", text: "Caption"}]
                            }
                        ]
                    },
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "Body text"}]
                    }
                ]
            }
        ]
    },
    settings: {},
    version: "3.7",
    rights: "write",
    owner: 1,
    is_owner: true,
    added: 1,
    updated: 2,
    revisions: [],
    path: "",
    comments: {},
    bibliography: {}
}

const shrinker = new ShrinkFidus(fullDoc, {db: {}}, {db: {}})
const shrunk = await shrinker.init()

assert.strictEqual(shrunk.shrunkImageDB["7"], undefined)
assert.ok(shrunk.doc.content, "document content still exported")

console.log("shrink-missing-image regression passed")
