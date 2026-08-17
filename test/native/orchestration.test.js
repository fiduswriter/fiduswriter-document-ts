import {beforeAll, describe, expect, it, jest} from "@jest/globals"

beforeAll(() => {
    // Native code uses window.Blob / FileReader in the browser.
    global.window = globalThis
})

const {ZipFidus} = await import("../../src/exporter/native/zip.js")
const {ExportFidusFile} = await import("../../src/exporter/native/file.js")
const {SaveRevision} = await import("../../src/exporter/native/revision.js")
const {SaveCopy} = await import("../../src/exporter/native/copy.js")
const {NativeImporter} = await import("../../src/importer/native/importer.js")
const {FidusFileImporter} = await import("../../src/importer/native/file.js")
const {FW_DOCUMENT_VERSION} = await import("../../src/schema/index.js")

const minimalDoc = {
    type: "doc",
    content: [
        {
            type: "title",
            content: [{type: "text", text: "Native orchestration test"}]
        },
        {
            type: "paragraph",
            content: [{type: "text", text: "A paragraph without images."}]
        }
    ]
}

const minimalDocWithImage = {
    type: "doc",
    content: [
        {
            type: "title",
            content: [{type: "text", text: "Image test"}]
        },
        {
            type: "paragraph",
            content: [
                {
                    type: "image",
                    attrs: {
                        image: 42
                    }
                }
            ]
        }
    ]
}

const fullDoc = {
    id: "native-test",
    title: "Native orchestration test",
    content: minimalDoc,
    settings: {},
    version: "3.5",
    rights: "write",
    owner: 1,
    is_owner: true,
    added: 123,
    updated: 456,
    revisions: [],
    path: ""
}

const bibDB = {db: {}}

describe("native exporter orchestration", () => {
    it("ZipFidus creates a fidus zip without a template fetcher", async () => {
        const zipper = new ZipFidus(fullDoc.id, fullDoc, {}, {}, [], false)
        const blob = await zipper.init()
        expect(blob).toBeInstanceOf(Blob)

        const {default: JSZip} = await import("jszip")
        const arrayBuffer = await blob.arrayBuffer()
        const zip = await JSZip.loadAsync(arrayBuffer)
        expect(zip.file("mimetype")).not.toBeNull()
        expect(await zip.file("mimetype").async("string")).toBe(
            "application/vnd.fiduswriter+zip"
        )
        expect(await zip.file("filetype-version").async("string")).toBe(
            FW_DOCUMENT_VERSION
        )
        expect(zip.file("document.json")).not.toBeNull()
        expect(zip.file("images.json")).not.toBeNull()
        expect(zip.file("bibliography.json")).not.toBeNull()
    })

    it("ExportFidusFile returns the generated blob", async () => {
        const blob = await new ExportFidusFile(fullDoc, bibDB, {db: {}}, false)
        expect(blob).toBeInstanceOf(Blob)
    })

    it("SaveRevision uploads the generated blob", async () => {
        const uploadRevision = jest.fn().mockResolvedValue({ok: true})
        const saver = new SaveRevision(
            fullDoc,
            {db: {}},
            bibDB,
            "test revision",
            uploadRevision,
            {token: false}
        )
        await saver.init()
        expect(uploadRevision).toHaveBeenCalledTimes(1)
        expect(uploadRevision.mock.calls[0][0]).toBeInstanceOf(Blob)
        expect(uploadRevision.mock.calls[0][1]).toBe(fullDoc)
    })

    it("SaveCopy delegates to the importDocument callback", async () => {
        const importDocument = jest.fn().mockResolvedValue({
            doc: {id: 99, title: "Copied"},
            docInfo: {id: 99}
        })
        const copier = new SaveCopy(
            fullDoc,
            bibDB,
            {db: {}},
            {id: 1, name: "Tester"},
            {importDocument}
        )
        const result = await copier.init()
        expect(importDocument).toHaveBeenCalledTimes(1)
        expect(result.doc.id).toBe(99)
    })
})

describe("native importer orchestration", () => {
    it("NativeImporter translates image ids via the backend", async () => {
        const backend = {
            createDoc: jest.fn().mockResolvedValue({
                id: 7,
                path: "test/path",
                e2ee: false
            }),
            saveImages: jest.fn().mockResolvedValue({42: 100}),
            saveDocument: jest.fn().mockResolvedValue({added: 1, updated: 2})
        }

        const importer = new NativeImporter(
            {
                content: minimalDocWithImage,
                title: "Test",
                comments: {},
                settings: {}
            },
            {},
            {
                db: {
                    42: {
                        id: 42,
                        image: "images/test.png",
                        file_type: "image/png",
                        file: new Blob(["x"])
                    }
                }
            },
            [],
            {id: 1, name: "Tester"},
            backend
        )

        const {doc} = await importer.init()
        expect(backend.createDoc).toHaveBeenCalledTimes(1)
        expect(backend.saveImages).toHaveBeenCalledWith(
            expect.any(Object),
            7,
            null
        )
        expect(backend.saveDocument).toHaveBeenCalledTimes(1)
        expect(doc.id).toBe(7)
        expect(doc.content.content[1].content[0].attrs.image).toBe(100)
    })

    it("FidusFileImporter round-trips a zip produced by ZipFidus", async () => {
        const zipper = new ZipFidus(fullDoc.id, fullDoc, {}, {}, [], false)
        const blob = await zipper.init()
        const arrayBuffer = await blob.arrayBuffer()

        const backend = {
            createDoc: jest.fn().mockResolvedValue({
                id: 8,
                path: "",
                e2ee: false
            }),
            saveImages: jest.fn().mockResolvedValue({}),
            saveDocument: jest.fn().mockResolvedValue({added: 1, updated: 2})
        }

        const fileImporter = new FidusFileImporter(
            arrayBuffer,
            {id: 1, name: "Tester"},
            "",
            backend
        )
        const result = await fileImporter.init()
        expect(result.ok).toBe(true)
        expect(result.doc.id).toBe(8)
        expect(backend.createDoc).toHaveBeenCalledTimes(1)
        expect(backend.saveDocument).toHaveBeenCalledTimes(1)
    })

    it("FidusFileImporter still accepts a file with the legacy mimetype", async () => {
        const zipper = new ZipFidus(fullDoc.id, fullDoc, {}, {}, [], false)
        const blob = await zipper.init()
        const {default: JSZip} = await import("jszip")
        const zip = await JSZip.loadAsync(await blob.arrayBuffer())
        // Rewrite the mimetype entry to the legacy alias string.
        zip.file("mimetype", "application/fidus+zip")
        const legacyBlob = await zip.generateAsync({type: "blob"})
        const arrayBuffer = await legacyBlob.arrayBuffer()

        const backend = {
            createDoc: jest.fn().mockResolvedValue({
                id: 9,
                path: "",
                e2ee: false
            }),
            saveImages: jest.fn().mockResolvedValue({}),
            saveDocument: jest.fn().mockResolvedValue({added: 1, updated: 2})
        }

        const fileImporter = new FidusFileImporter(
            arrayBuffer,
            {id: 1, name: "Tester"},
            "",
            backend
        )
        const result = await fileImporter.init()
        expect(result.ok).toBe(true)
        expect(result.doc.id).toBe(9)
        expect(backend.createDoc).toHaveBeenCalledTimes(1)
    })
})
