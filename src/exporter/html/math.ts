/**
 * Lazy MathJax TeX→SVG conversion for HTML/print/PDF math output.
 *
 * MathJax is only loaded (via dynamic import, so bundlers code-split it) when
 * the exporter is configured with `mathOutput: "svg"`. It runs in the browser
 * (browserAdaptor) and in Node (liteAdaptor, used by the CLI), so the same
 * code path serves both environments.
 *
 * The SVG output is post-processed for embedding as an `<img>` data URI:
 *
 * - MathJax measures the formula in `ex` units and paints it in viewBox units
 *   where 1000 units equal one `em` of the surrounding text. For an `<img>`
 *   those units would be meaningless (an `<img>`'s content cannot inherit the
 *   surrounding font size), so we strip the `ex`-based attributes and compute
 *   explicit `em` dimensions from the viewBox instead.
 * - The formula's baseline sits at viewBox y=0, so the amount the formula hangs
 *   below the text baseline is `max(0, y + height) / 1000` em. An `<img>` with
 *   the default `vertical-align: baseline` rests its bottom edge on the text
 *   baseline, so the math baseline must be pulled back down by that offset.
 * - `fontCache: "none"` keeps every glyph as an inline `<path>` (no `<use>`
 *   references), so the SVG is fully self-contained and survives both the
 *   browser and the vivliostyle-pdf SVG path (svg4pdf-lib) without external
 *   font or `<defs>/<use>` resolution.
 */

interface SvgMathResult {
    /** data: URI ready for use as an `<img src>` */
    src: string
    /** rendered width in em of the surrounding text */
    widthEm: number
    /** rendered height in em of the surrounding text */
    heightEm: number
    /** CSS `vertical-align` value in em (negative) aligning the math baseline */
    verticalAlignEm: number
}

type MathConvert = (latex: string, display: boolean) => string

type MathJaxAdaptor = import("mathjax-full/js/core/DOMAdaptor.js").DOMAdaptor<
    unknown,
    unknown,
    unknown
>

let mathReady: Promise<void> | null = null
let mathConvert: MathConvert | null = null

/** Load and initialise MathJax once; resolves when TeX→SVG conversion is ready. */
export function ensureMathJax(): Promise<void> {
    if (!mathReady) {
        mathReady = (async () => {
            const [{mathjax}, {TeX}, {SVG}, {AllPackages}] = await Promise.all([
                import("mathjax-full/js/mathjax.js"),
                import("mathjax-full/js/input/tex.js"),
                import("mathjax-full/js/output/svg.js"),
                import("mathjax-full/js/input/tex/AllPackages.js")
            ])
            const {RegisterHTMLHandler} = await import(
                "mathjax-full/js/handlers/html.js"
            )
            let adaptor: MathJaxAdaptor
            if (typeof document === "undefined") {
                const {liteAdaptor} = await import(
                    "mathjax-full/js/adaptors/liteAdaptor.js"
                )
                adaptor = liteAdaptor()
            } else {
                const {browserAdaptor} = await import(
                    "mathjax-full/js/adaptors/browserAdaptor.js"
                )
                adaptor = browserAdaptor()
            }
            RegisterHTMLHandler(adaptor)
            const tex = new TeX({packages: AllPackages})
            const svg = new SVG({fontCache: "none"})
            const html = mathjax.document("", {InputJax: tex, OutputJax: svg})
            mathConvert = (latex, display) => {
                const node = html.convert(latex, {display})
                return adaptor.innerHTML(node)
            }
        })().catch(error => {
            mathReady = null
            throw error
        })
    }
    return mathReady
}

/**
 * Convert a LaTeX formula to an SVG `<img>` data URI sized in `em`.
 *
 * Must only be called after `ensureMathJax()` has resolved. Returns `null`
 * when MathJax is not initialised yet or the LaTeX could not be converted
 * (MathJax marks parse errors with `data-mml-node="merror"`); callers then
 * fall back to MathML output.
 */
export function latexToSvg(
    latex: string,
    display: boolean
): SvgMathResult | null {
    if (!mathConvert) {
        return null
    }
    const svg = mathConvert(latex, display)
    // MathJax renders unparseable LaTeX as an error element rather than
    // throwing (throwOnError is not configurable in this version), so detect
    // that and let the caller fall back to MathML.
    if (svg.includes('data-mml-node="merror"')) {
        return null
    }
    const viewBoxMatch = svg.match(/viewBox="([0-9.]+(?:[,\s][-0-9.]+){3})"/)
    if (!viewBoxMatch) {
        return null
    }
    const [_vx, vy, vw, vh] = viewBoxMatch[1].split(/[,\s]+/).map(Number)
    if (!vw || !vh) {
        return null
    }
    // Round to milliem so the generated CSS has no float noise.
    const round = (value: number): number => Math.round(value * 1000) / 1000
    const widthEm = round(vw / 1000)
    const heightEm = round(vh / 1000)
    // Baseline is at viewBox y=0; content below it is y∈(0, vy+vh].
    const depthEm = round(Math.max(0, vy + vh) / 1000)
    // The `ex`-based width/height and vertical-align the MathJax root carries
    // are meaningless inside an `<img>` (the surrounding text font size cannot
    // reach into it), so strip them. The caller applies the returned em sizing
    // to the `<img>` and the baseline offset to its wrapper element.
    const cleanSvg = svg
        .replace(/ style="[^"]*"/, "")
        .replace(/ width="[^"]*"/, "")
        .replace(/ height="[^"]*"/, "")
    return {
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanSvg)}`,
        widthEm,
        heightEm,
        verticalAlignEm: -depthEm
    }
}
