import {beforeAll, describe, expect, it} from "@jest/globals"

beforeAll(() => {
    // saveFile checks for the File System Access API on `window`.
    global.window = globalThis
})

const {saveFile} = await import("../../src/exporter/save.js")
const {downloadCalls} = await import("downloadjs")

const fidusOptions = {
    description: "Fidus Writer document",
    mimeType: "application/vnd.fiduswriter+zip",
    extensions: [".fidus"]
}

describe("saveFile", () => {
    it("falls back to a download when the save picker is unavailable", async () => {
        delete global.window.showSaveFilePicker
        const before = downloadCalls.length
        const result = await saveFile(new Blob(["x"]), "a.fidus", fidusOptions)
        expect(result).toBe(true)
        expect(downloadCalls.length).toBe(before + 1)
        expect(downloadCalls[downloadCalls.length - 1].filename).toBe("a.fidus")
        expect(downloadCalls[downloadCalls.length - 1].mimeType).toBe(
            "application/vnd.fiduswriter+zip"
        )
    })

    it("writes through the save picker without a download", async () => {
        const written = []
        global.window.showSaveFilePicker = async options => {
            expect(options.suggestedName).toBe("a.fidus")
            expect(
                options.types[0].accept["application/vnd.fiduswriter+zip"]
            ).toEqual([".fidus"])
            return {
                createWritable: async () => ({
                    write: async blob => {
                        written.push(blob)
                    },
                    close: async () => {}
                })
            }
        }
        const before = downloadCalls.length
        const result = await saveFile(new Blob(["x"]), "a.fidus", fidusOptions)
        expect(result).toBe(true)
        expect(written.length).toBe(1)
        expect(downloadCalls.length).toBe(before)
        delete global.window.showSaveFilePicker
    })

    it("returns false and does not download when the user aborts", async () => {
        global.window.showSaveFilePicker = async () => {
            throw {name: "AbortError"}
        }
        const before = downloadCalls.length
        const result = await saveFile(new Blob(["x"]), "a.fidus", fidusOptions)
        expect(result).toBe(false)
        expect(downloadCalls.length).toBe(before)
        delete global.window.showSaveFilePicker
    })

    it("falls back to a download when the save picker throws", async () => {
        global.window.showSaveFilePicker = async () => {
            throw new Error("no gesture")
        }
        const before = downloadCalls.length
        const result = await saveFile(new Blob(["x"]), "a.fidus", fidusOptions)
        expect(result).toBe(true)
        expect(downloadCalls.length).toBe(before + 1)
        delete global.window.showSaveFilePicker
    })
})
