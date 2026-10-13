import {describe, expect, it} from "@jest/globals"

// Regression: legacy image databases store copyright licenses as plain
// strings (e.g. "CC BY-SA 4.0"), which crashed the JATS/BITS exporter with
// "undefined is not an object (evaluating 'text.replace')" and produced
// "undefined" garbage in LaTeX. The real escapeText is used on purpose: it
// throws on undefined input, so these tests fail if a license without a
// string URL ever reaches it again.
const {JATSExporterConverter} = await import(
    "../../src/exporter/jats/convert.js"
)

const cslStub = {}

function figureDoc(docAttrs = {}) {
    return {
        content: {
            type: "doc",
            attrs: docAttrs,
            content: [
                {
                    type: "title",
                    attrs: {},
                    content: [{type: "text", text: "My Title"}]
                },
                {
                    type: "figure",
                    attrs: {id: "fig1", caption: true, category: "figure"},
                    content: [
                        {type: "image", attrs: {image: 2715}},
                        {
                            type: "figure_caption",
                            attrs: {},
                            content: [{type: "text", text: "A caption."}]
                        }
                    ]
                }
            ]
        },
        settings: {language: "en-US"}
    }
}

describe("JATSExporterConverter copyright licenses", () => {
    it("skips string licenses in figure permissions instead of crashing", async () => {
        const imageDB = {
            db: {
                2715: {
                    id: 2715,
                    image: "images/oil.png",
                    copyright: {
                        year: 2012,
                        holder: "Juan Carlos Fonseca Mata",
                        licenses: ["CC BY-SA 4.0"]
                    }
                }
            }
        }
        const converter = new JATSExporterConverter(
            "book",
            figureDoc(),
            cslStub,
            imageDB,
            {db: {}}
        )
        const {body} = await converter.init()
        expect(body).toContain(
            "<copyright-holder>Juan Carlos Fonseca Mata</copyright-holder>"
        )
        expect(body).not.toContain("license_ref")
        expect(body).not.toContain("undefined")
    })

    it("renders object licenses and skips string licenses in front matter", async () => {
        const doc = figureDoc({
            copyright: {
                holder: "The Publisher",
                year: 2020,
                freeToRead: true,
                licenses: [
                    "CC0",
                    {url: "https://example.com/license", start: "2019"}
                ]
            }
        })
        const converter = new JATSExporterConverter(
            "article",
            doc,
            cslStub,
            {db: {2715: {id: 2715, image: "images/oil.png"}}},
            {db: {}}
        )
        const {front} = await converter.init()
        expect(front).toContain("<copyright-holder>The Publisher</copyright-holder>")
        expect(front).toContain(
            '<ali:license_ref start_date="2019">https://example.com/license</ali:license_ref>'
        )
        expect(front.match(/<license>/g)).toHaveLength(1)
        expect(front).not.toContain("undefined")
    })

    it("tolerates a copyright block without a licenses key", async () => {
        const imageDB = {
            db: {
                2715: {
                    id: 2715,
                    image: "images/oil.png",
                    copyright: {holder: "The Photographer"}
                }
            }
        }
        const converter = new JATSExporterConverter(
            "book",
            figureDoc(),
            cslStub,
            imageDB,
            {db: {}}
        )
        const {body} = await converter.init()
        expect(body).toContain(
            "<copyright-holder>The Photographer</copyright-holder>"
        )
        expect(body).not.toContain("undefined")
    })
})
