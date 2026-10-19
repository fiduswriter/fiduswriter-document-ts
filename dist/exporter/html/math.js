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
 * - Inline line-breaking is disabled (`linebreaks: {inline: false}`). With
 *   MathJax 4's default, formulas containing operators are emitted as several
 *   `<svg>` chunks separated by `<mjx-break>` elements — that markup cannot be
 *   embedded in a single `<img>` data URI. As a safety net, `latexToSvg`
 *   extracts exactly one root `<svg>` and falls back to MathML if MathJax
 *   still produced a multi-part formula.
 */
let mathReady = null;
let mathConvert = null;
/**
 * `@mathjax/src` ships both ESM and CJS builds. Native ESM (Node) and the Jest
 * ESM loader expose the named exports directly, but bundlers that code-split
 * dynamic imports (esbuild with `splitting: true`, rspack) may emit a module
 * whose only export is under `default`. Reading through `.default` first works
 * in every case.
 */
function cjsExport(mod) {
    return mod.default ?? mod;
}
/** Load and initialise MathJax once; resolves when TeX→SVG conversion is ready. */
export function ensureMathJax() {
    if (!mathReady) {
        mathReady = (async () => {
            const [mathjaxMod, texMod, svgMod] = await Promise.all([
                import("@mathjax/src/js/mathjax.js"),
                import("@mathjax/src/js/input/tex.js"),
                import("@mathjax/src/js/output/svg.js")
            ]);
            const { mathjax } = cjsExport(mathjaxMod);
            const { TeX } = cjsExport(texMod);
            const { SVG } = cjsExport(svgMod);
            const { RegisterHTMLHandler } = cjsExport(await import("@mathjax/src/js/handlers/html.js"));
            let adaptor;
            // Use the browser DOM adaptor only when we actually run in a real
            // browser. Node and Node-like environments (the CLI sets up a
            // happy-dom `window`/`document`, which is not a full browser DOM)
            // must use the lightweight adaptor, otherwise MathJax's handler
            // registration fails and every formula falls back to MathML.
            const isBrowserDocument = typeof document !== "undefined" &&
                typeof globalThis.Document !== "undefined" &&
                document instanceof globalThis.Document;
            if (isBrowserDocument) {
                const { browserAdaptor } = cjsExport(await import("@mathjax/src/js/adaptors/browserAdaptor.js"));
                adaptor = browserAdaptor();
            }
            else {
                const { liteAdaptor } = cjsExport(await import("@mathjax/src/js/adaptors/liteAdaptor.js"));
                adaptor = liteAdaptor();
            }
            RegisterHTMLHandler(adaptor);
            // MathJax 4 loads TeX extension packages on demand via its built-in
            // autoload support; no AllPackages list needs to be passed.
            const tex = new TeX();
            // Inline line-breaking must be disabled: with MathJax 4's default
            // (linebreaks.inline: true), formulas containing operators are
            // split into MULTIPLE <svg> chunks joined by <mjx-break> elements.
            // That output cannot be embedded in a single <img> data URI
            // (multi-root SVG is invalid as an image), so we need MathJax to
            // emit exactly one self-contained <svg> per formula.
            const svg = new SVG({ fontCache: "none", linebreaks: { inline: false } });
            const html = mathjax.document("", { InputJax: tex, OutputJax: svg });
            mathConvert = (latex, display) => {
                const node = html.convert(latex, { display });
                return adaptor.innerHTML(node);
            };
        })().catch(error => {
            // Do not fail the whole print/PDF export when MathJax cannot be
            // loaded or initialised: leave `mathConvert` null so `latexToSvg`
            // returns null and callers fall back to MathML. Reset `mathReady`
            // so a later call can retry.
            mathReady = null;
            console.warn("MathJax SVG math initialisation failed; falling back to MathML.", error);
        });
    }
    return mathReady;
}
/**
 * Convert a LaTeX formula to an SVG `<img>` data URI sized in `em`.
 *
 * Must only be called after `ensureMathJax()` has resolved. Returns `null`
 * when MathJax is not initialised yet, the LaTeX could not be converted
 * (MathJax marks parse errors with `data-mml-node="merror"`), or MathJax
 * unexpectedly produced a multi-part formula; callers then fall back to
 * MathML output.
 */
export function latexToSvg(latex, display) {
    if (!mathConvert) {
        return null;
    }
    const svgMarkup = mathConvert(latex, display);
    // MathJax renders unparseable LaTeX as an error element rather than
    // throwing (throwOnError is not configurable in this version), so detect
    // that and let the caller fall back to MathML.
    if (svgMarkup.includes('data-mml-node="merror"')) {
        return null;
    }
    // Extract exactly one root <svg> element. MathJax never nests <svg>
    // elements (glyphs are inline <path> data), so the first "<svg …>…</svg>"
    // span is the whole formula. Anything beyond it (e.g. the multi-<svg>
    // chunks joined by <mjx-break> markers that MathJax 4 emits when inline
    // line-breaking is enabled) cannot be embedded in a single <img> data
    // URI, so fall back to MathML instead of producing a broken image.
    const svgMatch = svgMarkup.match(/<svg[\s\S]*?<\/svg>/);
    if (!svgMatch) {
        return null;
    }
    const svg = svgMatch[0];
    const remainder = svgMarkup.slice(svgMatch.index + svg.length);
    if (svgMarkup.includes("<mjx-break") || remainder.includes("<svg")) {
        console.warn("latexToSvg: MathJax produced a multi-part formula; falling back to MathML.");
        return null;
    }
    const viewBoxMatch = svg.match(/viewBox="([0-9.]+(?:[,\s][-0-9.]+){3})"/);
    if (!viewBoxMatch) {
        return null;
    }
    const [_vx, vy, vw, vh] = viewBoxMatch[1].split(/[,\s]+/).map(Number);
    if (!vw || !vh) {
        return null;
    }
    // Round to milliem so the generated CSS has no float noise.
    const round = (value) => Math.round(value * 1000) / 1000;
    const widthEm = round(vw / 1000);
    const heightEm = round(vh / 1000);
    // Baseline is at viewBox y=0; content below it is y∈(0, vy+vh].
    const depthEm = round(Math.max(0, vy + vh) / 1000);
    // The `ex`-based width/height and vertical-align the MathJax root carries
    // are meaningless inside an `<img>` (the surrounding text font size cannot
    // reach into it), so strip them. The caller applies the returned em sizing
    // to the `<img>` and the baseline offset to its wrapper element.
    const cleanSvg = svg
        .replace(/ style="[^"]*"/, "")
        .replace(/ width="[^"]*"/, "")
        .replace(/ height="[^"]*"/, "");
    return {
        src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanSvg)}`,
        widthEm,
        heightEm,
        verticalAlignEm: -depthEm
    };
}
//# sourceMappingURL=math.js.map