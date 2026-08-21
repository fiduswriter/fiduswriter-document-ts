import {ensureMathJax, latexToSvg} from "../../src/exporter/html/math.js"

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
})
