// Fuzz harness for the native .fidus import path (FidusFileImporter).
//
// The native container is the editor's own file format, exchanged between
// users and machines, so it is exactly as untrusted as a random upload.
// Mutations cover three layers:
//   * zip layer: truncated files, bit flips, garbage/missing/oversized
//     entries,
//   * container layer: mimetype and filetype-version tampering,
//   * content layer: structure-aware JSON mutations of document.json,
//     bibliography.json and images.json.
//
// Invariants: for every input the import either (a) resolves with
// ok=false plus a human-readable statusText, (b) resolves with ok=true and
// a parsed document, or (c) rejects with an Error. It must never hang and
// never throw outside the promise chain.

import "../setup.js"

import {readFileSync, readdirSync} from "node:fs"
import {join, dirname} from "node:path"
import {fileURLToPath} from "node:url"

import {fc, runHarness} from "./config.js"
import {makeRng} from "./rng.js"

const here = dirname(fileURLToPath(import.meta.url))
const SEEDS = readdirSync(join(here, "seeds")).map(name => ({
    name,
    bytes: readFileSync(join(here, "seeds", name))
}))

// The FW document version constants and importer live in dist — import
// dynamically so the happy-dom setup is in place first.
const {FidusFileImporter} = await import("../../dist/importer/native/index.js")
const {default: JSZip} = await import("jszip")

const backend = {
    createDoc: async () => ({id: 1, path: ""}),
    saveImages: async () => ({}),
    saveDocument: async () => ({})
}

const user = {id: 1, username: "fuzzer", is_authenticated: true}

async function importBytes(bytes, label) {
    const blob = new Blob([bytes])
    const importer = new FidusFileImporter(blob, user, "", backend, {
        check: false
    })
    try {
        await importer.init()
    } catch (error) {
        if (!(error instanceof Error)) {
            throw new Error(
                `import of ${label} rejected with a non-Error: ${String(error)}`
            )
        }
        return
    }
    if (!importer.ok) {
        if (!importer.statusText) {
            throw new Error(
                `import of ${label} failed without statusText — the user would see an empty error`
            )
        }
        return
    }
    // Parsed document: must at least be an object with content.
    if (typeof importer.doc !== "object" || importer.doc === null) {
        throw new Error(`import of ${label} reported ok without a document`)
    }
}

// --- mutations --------------------------------------------------------------

const JSON_KEYS = [
    "content",
    "settings",
    "title",
    "bibliography",
    "images",
    "comments"
]

const JSON_VALUES = [
    undefined,
    null,
    0,
    -1,
    1e9,
    "",
    "x",
    [],
    {},
    {type: "no_such_node"},
    {type: "doc", content: "not-an-array"},
    {type: "doc", content: [{type: "paragraph", content: [{type: 42}]}]},
    "LOOOOOOOONG".repeat(1000)
]

function mutateJson(value, rng, depth = 0) {
    if (depth > 4 || typeof value !== "object" || value === null) {
        return rng.pick(JSON_VALUES)
    }
    const copy = Array.isArray(value) ? [...value] : {...value}
    const keys = Object.keys(copy)
    if (!keys.length) {
        return copy
    }
    const key = keys[rng.int(0, keys.length - 1)]
    switch (rng.int(0, 3)) {
        case 0:
            delete copy[key]
            break
        case 1:
            copy[key] = mutateJson(copy[key], rng, depth + 1)
            break
        case 2:
            copy[key] = rng.pick(JSON_VALUES)
            break
        case 3:
            copy[rng.pick(JSON_KEYS)] = rng.pick(JSON_VALUES)
            break
    }
    return copy
}

async function mutateSeed(seedName, rng) {
    const seed = SEEDS.find(s => s.name === seedName) || SEEDS[0]
    const zip = await JSZip.loadAsync(seed.bytes)
    const strategy = rng.int(0, 5)
    if (strategy === 0) {
        // Raw byte mutations on the original file.
        const bytes = Uint8Array.from(seed.bytes)
        for (let i = 0; i < rng.int(1, 8); i++) {
            bytes[rng.int(0, bytes.length - 1)] = rng.int(0, 255)
        }
        return {bytes, label: `${seed.name} (bit flips)`}
    }
    if (strategy === 1) {
        // Truncation.
        const cut = rng.int(1, seed.bytes.length)
        return {
            bytes: seed.bytes.slice(0, cut),
            label: `${seed.name} (truncated at ${cut})`
        }
    }
    if (strategy === 2) {
        // Tamper with mimetype / filetype-version.
        const field = rng.pick(["mimetype", "filetype-version"])
        const value = rng.pick([
            "application/zip",
            "",
            "application/fidus+zip",
            "3.7",
            "9.9",
            "1.0",
            "abc",
            "0"
        ])
        zip.file(field, value)
        const bytes = await zip.generateAsync({type: "uint8array"})
        return {bytes, label: `${seed.name} (${field}=${value})`}
    }
    if (strategy === 3) {
        // Remove or add entries.
        const action = rng.int(0, 2)
        if (action === 0) {
            zip.remove("document.json")
        } else if (action === 1) {
            zip.remove("mimetype")
        } else {
            zip.file("garbage.bin", "GARBAGE".repeat(rng.int(1, 1000)))
        }
        const bytes = await zip.generateAsync({type: "uint8array"})
        return {bytes, label: `${seed.name} (entry change ${action})`}
    }
    if (strategy === 4) {
        // JSON content mutations.
        const jsonFiles = ["document.json", "bibliography.json", "images.json"]
        const file = jsonFiles[rng.int(0, jsonFiles.length - 1)]
        const entry = zip.file(file)
        if (!entry) {
            const bytes = await zip.generateAsync({type: "uint8array"})
            return {bytes, label: `${seed.name} (${file} absent)`}
        }
        const text = await entry.async("string")
        let json
        try {
            json = JSON.parse(text)
        } catch (_error) {
            json = {}
        }
        const mutated = mutateJson(json, rng)
        zip.file(file, JSON.stringify(mutated))
        const bytes = await zip.generateAsync({type: "uint8array"})
        return {bytes, label: `${seed.name} (${file} mutated)`}
    }
    // strategy 5: oversized entry (bounded — no real zip bombs in CI).
    zip.file("big.bin", "A".repeat(rng.int(1e5, 2e6)))
    const bytes = await zip.generateAsync({type: "uint8array"})
    return {bytes, label: `${seed.name} (oversized entry)`}
}

const nativeImportProp = fc.asyncProperty(
    fc.integer({min: 1, max: 2 ** 31 - 1}),
    async seed => {
        const rng = makeRng(seed)
        const seedName = rng.pick(SEEDS).name
        const {bytes, label} = await mutateSeed(seedName, rng)
        await importBytes(bytes, label)
    }
)

runHarness("native-fidus", [
    {label: "mutated .fidus containers import safely", prop: nativeImportProp}
])
