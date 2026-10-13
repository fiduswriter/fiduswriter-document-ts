import {describe, expect, it} from "@jest/globals"

// Regression: image DB entries in the desktop hold data URLs, and deriving
// export file names with `image.split("/").pop()` used a random base64 tail
// (e.g. "vJ1MfMy7AAAAABJRU5ErkJggg==") as the file name.
const {getImageDBEntryFilename, isDataUrlValue} = await import(
    "../../src/exporter/tools/file.js"
)

const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

describe("getImageDBEntryFilename with data URLs", () => {
    it("derives a stable name for a data URL whose base64 contains slashes", () => {
        const entry = {
            id: 17,
            image: `data:image/png;base64,${PNG_BASE64}`,
            file_type: "image/png"
        }
        expect(getImageDBEntryFilename(entry, 17)).toBe("image-17.png")
        expect(getImageDBEntryFilename(entry, 17)).not.toContain("/")
    })

    it("prefers the file_type over the data URL mime", () => {
        const entry = {
            id: 3,
            image: `data:image/png;base64,${PNG_BASE64}`,
            file_type: "png"
        }
        expect(getImageDBEntryFilename(entry, 3)).toBe("image-3.png")
    })

    it("keeps the last path segment for plain URLs", () => {
        const entry = {id: 5, image: "images/2406.png", file_type: "image/png"}
        expect(getImageDBEntryFilename(entry, 5)).toBe("2406.png")
    })

    it("isDataUrlValue recognizes data URLs only", () => {
        expect(isDataUrlValue(`data:image/png;base64,${PNG_BASE64}`)).toBe(true)
        expect(isDataUrlValue("data:image/png;base64,abc")).toBe(true)
        expect(isDataUrlValue("images/2406.png")).toBe(false)
        expect(isDataUrlValue("")).toBe(false)
        expect(isDataUrlValue(null)).toBe(false)
    })
})
