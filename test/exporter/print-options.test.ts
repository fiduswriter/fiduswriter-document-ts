import {describe, expect, it} from "@jest/globals"

import type {ExportDoc} from "../../src/types.js"
import {PrintExporter} from "../../src/exporter/print/index.js"

const makeDoc = (): ExportDoc =>
    ({
        title: "Test doc",
        path: "",
        content: {
            type: "doc",
            attrs: {},
            content: [
                {
                    type: "richtext_part",
                    attrs: {title: "Body", id: "body"},
                    content: [
                        {
                            type: "paragraph",
                            content: [{type: "text", text: "Hello"}]
                        },
                        {
                            type: "figure",
                            attrs: {
                                category: "equation",
                                caption: true,
                                id: "f1",
                                aligned: "center",
                                width: "100"
                            },
                            content: [
                                {
                                    type: "figure_equation",
                                    attrs: {equation: "E=mc^2"}
                                },
                                {
                                    type: "figure_caption",
                                    content: [
                                        {
                                            type: "text",
                                            text: "Exponential decline-curve model"
                                        }
                                    ]
                                }
                            ]
                        },
                        {
                            type: "table",
                            attrs: {
                                category: "table",
                                caption: true,
                                id: "t1",
                                width: "100",
                                aligned: "center",
                                layout: "fixed"
                            },
                            content: [
                                {
                                    type: "table_caption",
                                    content: [
                                        {
                                            type: "text",
                                            text: "Mexican oil production"
                                        }
                                    ]
                                },
                                {
                                    type: "table_body",
                                    content: [
                                        {
                                            type: "table_row",
                                            content: [
                                                {
                                                    type: "table_cell",
                                                    content: [
                                                        {
                                                            type: "paragraph",
                                                            content: [
                                                                {
                                                                    type: "text",
                                                                    text: "cell"
                                                                }
                                                            ]
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        },
                        // Caption without a category label: no label, no colon.
                        {
                            type: "table",
                            attrs: {
                                category: "none",
                                caption: true,
                                id: "t2",
                                width: "100",
                                aligned: "center",
                                layout: "fixed"
                            },
                            content: [
                                {
                                    type: "table_caption",
                                    content: [{type: "text", text: "No category"}]
                                },
                                {
                                    type: "table_body",
                                    content: [
                                        {
                                            type: "table_row",
                                            content: [
                                                {
                                                    type: "table_cell",
                                                    content: [
                                                        {
                                                            type: "paragraph",
                                                            content: [
                                                                {
                                                                    type: "text",
                                                                    text: "cell"
                                                                }
                                                            ]
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        },
        settings: {
            papersize: "A4",
            language: "en-US",
            documentstyle: "does-not-exist"
        }
    }) as unknown as ExportDoc

const buildHtml = async (
    options?: ConstructorParameters<typeof PrintExporter>[6]
): Promise<string> => {
    const exporter = new PrintExporter(
        makeDoc(),
        {db: {}},
        {db: {}},
        {},
        new Date(),
        [],
        undefined,
        options
    )
    const build = (
        exporter as unknown as {
            buildPaginatedHtml: () => Promise<{html: string}>
        }
    ).buildPaginatedHtml
    return (await build.call(exporter)).html
}

describe("PrintExporter caption markup and page floats", () => {
    it("puts the figure category label and caption text on the same line", async () => {
        const html = await buildHtml()
        expect(html).toContain(
            "<figcaption><label>Equation 1</label><p>Exponential decline-curve model</p></figcaption>"
        )
    })

    it("places the table category label inside <caption>", async () => {
        const html = await buildHtml()
        expect(html).toContain(
            "<caption><label>Table 1</label><p>Mexican oil production</p></caption>"
        )
    })

    it("emits no label for captions without a category", async () => {
        const html = await buildHtml()
        expect(html).toContain("<caption><p>No category</p></caption>")
    })

    it("injects page float CSS by default", async () => {
        const html = await buildHtml()
        const flat = html.replace(/\n\s*/g, "")
        expect(flat).toMatch(
            /figure\[data-aligned="center"\]\s*{float-reference:\s*page;\s*float:\s*top;\s*}/
        )
        expect(flat).toMatch(
            /table\s*{float-reference:\s*page;\s*float:\s*top;\s*}/
        )
    })

    it("omits page float CSS when disabled", async () => {
        const html = await buildHtml({
            figurePageFloats: false,
            tablePageFloats: false
        })
        expect(html).not.toContain("float-reference")
    })
})
