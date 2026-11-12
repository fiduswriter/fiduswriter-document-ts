import { mml2omml } from "mathml2omml";
// Not entirely sure if we need this font here. This is included whenever Word
// itself adds a formula, but our omml doesn't refer to the font, so it may be pointless.
const CAMBRIA_MATH_FONT_DECLARATION = `
    <w:font w:name="Cambria Math">
        <w:panose1 w:val="02040503050406030204" />
        <w:charset w:val="00" />
        <w:family w:val="roman" />
        <w:pitch w:val="variable" />
        <w:sig w:usb0="E00002FF" w:usb1="420024FF" w:usb2="00000000" w:usb3="00000000" w:csb0="0000019F" w:csb1="00000000" />
    </w:font>`;
export class DOCXExporterMath {
    xml;
    fontTablesXML;
    addedCambriaMath;
    mathLive;
    constructor(xml) {
        this.xml = xml;
        this.fontTablesXML = false;
        this.addedCambriaMath = false;
        this.mathLive = null;
    }
    init() {
        return this.xml
            .getXml("word/fontTable.xml")
            .then(fontTablesXML => {
            this.fontTablesXML = fontTablesXML;
            return import("mathlive");
        })
            .then(MathLive => {
            this.mathLive = MathLive;
            return MathLive;
        });
    }
    latexToMathML(latex) {
        if (!this.mathLive) {
            throw new Error("MathLive not initialised");
        }
        return this.mathLive.convertLatexToMathMl(latex);
    }
    getOmml(latex) {
        if (!this.fontTablesXML) {
            throw new Error("Font table XML not loaded");
        }
        if (!this.addedCambriaMath) {
            const fontsEl = this.fontTablesXML.query("w:fonts");
            if (!fontsEl) {
                throw new Error("No w:fonts element found in font table");
            }
            fontsEl.appendXML(CAMBRIA_MATH_FONT_DECLARATION);
            this.addedCambriaMath = true;
        }
        const mathmlString = `<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics>${this.latexToMathML(latex)}</semantics></math>`;
        return mml2omml(mathmlString);
    }
}
//# sourceMappingURL=math.js.map