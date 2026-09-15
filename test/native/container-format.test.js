import {beforeAll, describe, expect, it} from "@jest/globals"

beforeAll(() => {
    // Native code uses window.Blob / FileReader in the browser.
    global.window = globalThis
})

const {ZipFidus} = await import("../../src/exporter/native/zip.js")

const MIMETYPE = "application/vnd.fiduswriter+zip"

const minimalDoc = {
    id: 1,
    title: "Container test",
    content: {
        type: "doc",
        content: [
            {
                type: "title",
                content: [{type: "text", text: "Container test"}]
            },
            {
                type: "paragraph",
                content: [{type: "text", text: "Body"}]
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
    path: ""
}

describe("Fidus container hardening", () => {
    it("writes the mimetype entry first, uncompressed, at offset 38", async () => {
        const zipper = new ZipFidus(1, minimalDoc, {}, {}, [], false)
        const blob = await zipper.init()
        const bytes = new Uint8Array(await blob.arrayBuffer())

        // ZIP local file header signature.
        expect(
            String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
        ).toBe("PK\x03\x04")

        // Compression method (little-endian uint16 at offset 8) must be 0
        // (STORE) for the first entry, so that content sniffers can read the
        // mimetype at a fixed offset.
        const compressionMethod = bytes[8] | (bytes[9] << 8)
        expect(compressionMethod).toBe(0)

        // The first entry must be named "mimetype" ...
        const nameLength = bytes[26] | (bytes[27] << 8)
        expect(nameLength).toBe("mimetype".length)
        expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe("mimetype")

        // ... and the media type string starts at byte offset 38.
        const mimetype = new TextDecoder().decode(
            bytes.slice(38, 38 + MIMETYPE.length)
        )
        expect(mimetype).toBe(MIMETYPE)
    })
})
