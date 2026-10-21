import {describe, expect, it, jest} from "@jest/globals"

jest.unstable_mockModule("fwtoolkit", () => ({
    escapeText: str =>
        String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;"),
    isSafeLinkHref: href => {
        if (typeof href !== "string") {
            return false
        }
        const trimmed = href.trim()
        if (!trimmed) {
            return false
        }
        if (trimmed.startsWith("#")) {
            return true
        }
        try {
            const url = new URL(trimmed, "http://localhost")
            return ["http:", "https:"].includes(url.protocol)
        } catch {
            return false
        }
    },
}))

const {jatsBib} = await import("../../src/exporter/jats/bibliography.js")

describe("jatsBib", () => {
    it("renders a journal article with CSL-string authors and title", () => {
        const bib = {
            type: "article-journal",
            title: "My title",
            "container-title": "My journal",
            author: [
                {family: "Doe", given: "John"},
                {family: "Smith", given: "Jane"}
            ],
            issued: {"date-parts": [[2012]]},
            volume: "7",
            issue: "3",
            page: "1-10"
        }
        const xml = jatsBib(bib, 1)
        expect(xml).toContain("My title")
        expect(xml).toContain("My journal")
        expect(xml).toContain("Doe")
        expect(xml).toContain("John")
        expect(xml).toContain("Smith")
        expect(xml).toContain("Jane")
        expect(xml).toContain('<ref id="ref-1">')
        expect(xml).toContain("<volume>7</volume>")
        expect(xml).toContain("<issue>3</issue>")
        expect(xml).toContain("<fpage>1</fpage>")
        expect(xml).toContain("<lpage>10</lpage>")
    })

    it("renders a book with a string literal author", () => {
        const bib = {
            type: "book",
            title: "A book",
            author: [{literal: "Acme Corporation"}],
            issued: {"date-parts": [[2020]]},
            publisher: "Penguin",
            "publisher-place": "New York"
        }
        const xml = jatsBib(bib, 2)
        expect(xml).toContain("A book")
        expect(xml).toContain("Acme Corporation")
        expect(xml).toContain("<publisher-name>Penguin</publisher-name>")
        expect(xml).toContain("<publisher-loc>New York</publisher-loc>")
        expect(xml).toContain('<ref id="ref-2">')
    })

    it("renders a chapter with editor and page range", () => {
        const bib = {
            type: "chapter",
            title: "My chapter",
            "container-title": "Edited volume",
            author: [{family: "Doe", given: "John"}],
            editor: [{family: "Smith", given: "Jane"}],
            issued: {literal: "2021"},
            page: "15-25"
        }
        const xml = jatsBib(bib, 3)
        expect(xml).toContain("<chapter-title>My chapter</chapter-title>")
        expect(xml).toContain("<source>Edited volume</source>")
        expect(xml).toContain("Doe")
        expect(xml).toContain("Smith")
        expect(xml).toContain("<fpage>15</fpage>")
        expect(xml).toContain("<lpage>25</lpage>")
    })

    it("escapes special characters in titles and names", () => {
        const bib = {
            type: "article-journal",
            title: "A <b>title</b>",
            author: [{family: "O'Brien", given: "Anne & Bob"}]
        }
        const xml = jatsBib(bib, 4)
        expect(xml).toContain("A &lt;b&gt;title&lt;/b&gt;")
        expect(xml).toContain("O'Brien")
        expect(xml).toContain("Anne &amp; Bob")
    })

    it("handles missing fields gracefully", () => {
        const bib = {type: "misc"}
        const xml = jatsBib(bib, 5)
        expect(xml).toContain('<ref id="ref-5">')
    })
})
