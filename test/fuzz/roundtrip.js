// Roundtrip fuzz harness: a random Fidus document is exported to the native
// .fidus container and imported back — the content must survive exactly.
// This is the only format where an exact oracle is possible; it protects
// the container format, the shrink/export step and the import/migration
// path as one unit.
//
// Invariants:
//  1. Export produces a container; import parses it (ok=true).
//  2. The imported document's content equals the original (JSON equality;
//     both sides pass through nodeFromJSON so defaults are normalized).
//  3. The imported bibliography equals the original.

import "../setup.js"

import {fc, runHarness} from "./config.js"
import {docArb} from "./doc-generator.js"
import {makeRng} from "./rng.js"

const {ZipFidus} = await import("../../dist/exporter/native/zip.js")
const {FidusFileImporter} = await import("../../dist/importer/native/index.js")
const {docSchema} = await import("../../dist/schema/document/index.js")

const backend = {
    createDoc: async () => ({id: 1, path: ""}),
    saveImages: async () => ({}),
    saveDocument: async () => ({})
}
const user = {id: 1, username: "fuzzer", is_authenticated: true}

const BIB_DB = {
    "1": {
        entry_key: "doe2024",
        bib_type: "article",
        fields: {title: "Example reference"},
        entry_cat: []
    },
    "2": {
        entry_key: "roe2025",
        bib_type: "book",
        fields: {title: "Another reference", author: [{literal: [{given: "A", family: "B"}]}]},
        entry_cat: []
    }
}

function makeFullDoc(docJson, rng) {
    // The native exporter expects the full document record the backend
    // stores; content is what the roundtrip must preserve.
    return {
        id: 1,
        title: "Roundtrip " + rng.int(0, 999),
        content: docJson,
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
        bibliography: BIB_DB
    }
}

const roundtripProp = fc.asyncProperty(
    fc.integer({min: 1, max: 2 ** 31 - 1}),
    async seed => {
        const rng = makeRng(seed)
        const {json: docJson} = fc.sample(docArb(fc), 1, {seed})[0]
        const fullDoc = makeFullDoc(docJson, rng)

        // Export: shrink (strip backend fields) then zip.
        const {ShrinkFidus} = await import("../../dist/exporter/native/shrink.js")
        const shrinker = new ShrinkFidus(
            fullDoc,
            {db: {}},
            {db: BIB_DB}
        )
        const shrunk = await shrinker.init()
        const zipper = new ZipFidus(
            1,
            shrunk.doc,
            shrunk.shrunkImageDB,
            shrunk.shrunkBibDB,
            shrunk.httpIncludes,
            false
        )
        const blob = await zipper.init()

        // Import back.
        const importer = new FidusFileImporter(blob, user, "", backend, {
            check: false
        })
        await importer.init()
        if (!importer.ok) {
            throw new Error(
                `roundtrip import failed: ${importer.statusText}`
            )
        }
        // Compare content through the schema so defaults normalize on both
        // sides (the editor may store attrs that differ only in defaults).
        const original = docSchema.nodeFromJSON(fullDoc.content)
        const imported = docSchema.nodeFromJSON(importer.doc.content)
        if (!original.eq(imported)) {
            throw new Error(
                `content changed across roundtrip:\n--- original ---\n${JSON.stringify(fullDoc.content).slice(0, 1200)}\n--- imported ---\n${JSON.stringify(importer.doc.content).slice(0, 1200)}`
            )
        }
        // Bibliography survives.
        const importedBib = importer.doc.bibliography || {}
        for (const key of Object.keys(BIB_DB)) {
            if (!importedBib[key]) {
                throw new Error(`bibliography entry ${key} lost in roundtrip`)
            }
        }
    }
)

runHarness("roundtrip", [
    {label: "native export/import preserves documents exactly", prop: roundtripProp}
])
