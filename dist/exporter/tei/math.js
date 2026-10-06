/**
 * LaTeX to MathML conversion for TEI `<formula>` elements.
 *
 * Ported from the DHd-Verband TEI exporter. MathLive is imported statically
 * (as in the JATS exporter); named entities that plain XML cannot parse
 * without a DTD are replaced by numeric character references.
 * @module
 */
import { convertLatexToMathMl } from "mathlive";
/**
 * MathLive emits a few XML entities/numeric character references for invisible
 * operators. Plain XML documents (without a DTD) only predeclare `&amp;`
 * `&lt;` `&gt;` `&apos;` `&quot;`, so everything else is replaced by the
 * literal Unicode characters — the files are UTF-8 anyway.
 */
const ENTITY_REPLACEMENTS = [
    // INVISIBLE TIMES
    [/&InvisibleTimes;/g, "\u2062"],
    [/&#8290;/g, "\u2062"],
    [/&#x2062;/gi, "\u2062"],
    // FUNCTION APPLICATION
    [/&ApplyFunction;/g, "\u2061"],
    [/&#x2061;/gi, "\u2061"],
    // PLUS-MINUS SIGN
    [/&PlusMinus;/g, "\u00b1"],
    [/&#177;/g, "\u00b1"],
    [/&#xb1;/gi, "\u00b1"],
    // MULTIPLICATION SIGN
    [/&times;/g, "\u00d7"],
    [/&#215;/g, "\u00d7"],
    [/&#xd7;/gi, "\u00d7"]
];
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
export class TeiExporterMath {
    latexToMathML(latex) {
        let mathml = convertLatexToMathMl(latex);
        ENTITY_REPLACEMENTS.forEach(([pattern, replacement]) => {
            mathml = mathml.replace(pattern, replacement);
        });
        // Some mathlive versions return a full <math> element rather than an
        // inner fragment. Wrapping that in another <math> would nest the
        // content in the TEI namespace, so declare the MathML namespace on the
        // returned element instead.
        if (/^<math[\s>]/.test(mathml)) {
            if (mathml.slice(0, 250).includes("xmlns=")) {
                return mathml;
            }
            return mathml.replace(/^<math/, `<math xmlns="${MATHML_NS}"`);
        }
        return `<math xmlns="${MATHML_NS}">${mathml}</math>`;
    }
}
//# sourceMappingURL=math.js.map