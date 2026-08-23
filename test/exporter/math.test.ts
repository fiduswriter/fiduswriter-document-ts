import {ensureMathJax, latexToSvg} from "../../src/exporter/html/math.js"
import {HTMLExporterConvert} from "../../src/exporter/html/convert.js"
import {htmlExportTemplate} from "../../src/exporter/html/templates.js"

describe("latexToSvg (MathJax TeX→SVG)", () => {
    it("returns null before MathJax is initialised", () => {
        expect(latexToSvg("x", false)).toBeNull()
    })

    it("converts a fraction to a sized SVG data URI", async () => {
        await ensureMathJax()
        const result = latexToSvg("\\frac{1}{2}", false)
        expect(result).not.toBeNull()
        expect(result!.src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(
            true
        )
        // viewBox units are milli-em: height 1209.9 → 1.21em
        expect(result!.heightEm).toBeCloseTo(1.21, 2)
        expect(result!.widthEm).toBeGreaterThan(0)
        // baseline sits at viewBox y=0; a fraction hangs 345 units below it
        expect(result!.verticalAlignEm).toBeCloseTo(-0.345, 2)
        // the data URI decodes back to a self-contained SVG with a fraction
        // bar (rect) and glyphs (path), and no external <use> references
        const svg = decodeURIComponent(
            result!.src.slice("data:image/svg+xml;charset=utf-8,".length)
        )
        expect(svg).toContain("<svg")
        expect(svg).toContain("<rect") // fraction bar
        expect(svg).toContain("<path") // glyphs
        expect(svg).not.toContain("<use") // fontCache:none keeps it self-contained
    })

    it("display mode produces a taller formula", async () => {
        await ensureMathJax()
        const inline = latexToSvg("\\frac{1}{2}", false)!
        const display = latexToSvg("\\frac{1}{2}", true)!
        expect(display.heightEm).toBeGreaterThan(inline.heightEm)
    })

    it("returns null for unparseable LaTeX so callers fall back to MathML", async () => {
        await ensureMathJax()
        expect(latexToSvg("\\frac{", false)).toBeNull()
    })

    it("produces a single-root SVG for formulas with breakable operators", async () => {
        // MathJax 4's default inline line-breaking splits operator-containing
        // formulas into multiple <svg> chunks joined by <mjx-break> elements.
        // That output cannot be embedded in a single <img> data URI (it used
        // to make PDF exports render only the first chunk, e.g. just "R").
        await ensureMathJax()
        const result = latexToSvg("R = P \\times Q - C", false)
        expect(result).not.toBeNull()
        const svg = decodeURIComponent(
            result!.src.slice("data:image/svg+xml;charset=utf-8,".length)
        )
        expect(svg.match(/<svg/g)?.length).toBe(1)
        expect(svg).not.toContain("<mjx-break")
        // The metrics must come from the full formula, not the first chunk.
        expect(result!.widthEm).toBeGreaterThan(4)
        // The glyphs of the whole formula are present: R, =, ×, Q, −, C.
        expect(svg.match(/<path/g)?.length).toBeGreaterThanOrEqual(6)
    })
})

const makeConverter = (mathOutput: "mathml" | "svg"): HTMLExporterConvert => {
    const doc = {
        type: "doc",
        attrs: {language: "en"},
        content: [
            {
                type: "paragraph",
                content: [{type: "equation", attrs: {equation: "x^2"}}]
            }
        ]
    }
    return new HTMLExporterConvert(
        "test",
        {language: "en"} as never,
        doc as never,
        htmlExportTemplate,
        {db: {}} as never,
        {db: {}} as never,
        {} as never,
        [],
        {mathOutput}
    )
}

describe("MathLive stylesheet gating", () => {
    it("includes mathlive.css for MathML output", async () => {
        const converter = makeConverter("mathml")
        const {extraStyleSheets} = await converter.init()
        expect(
            extraStyleSheets.some(sheet =>
                String(sheet.filename).includes("mathlive")
            )
        ).toBe(true)
        // MathML output still uses MathLive to convert LaTeX to MathML.
        expect(await converter.assembleBody()).toContain("<math>")
    })

    it("omits mathlive.css for SVG output (equations are self-contained images)", async () => {
        const converter = makeConverter("svg")
        const {extraStyleSheets} = await converter.init()
        expect(
            extraStyleSheets.some(sheet =>
                String(sheet.filename).includes("mathlive")
            )
        ).toBe(false)
    })
})
