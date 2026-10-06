import JSZip from "jszip";
import { validateXml } from "../tools/xml.js";
import { extractTemplateTags } from "./tags.js";
const ODT_MIMETYPE = "application/vnd.oasis.opendocument.text";
const ODT_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${ODT_MIMETYPE}"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
const ODT_META = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    office:version="1.2">
  <office:meta>
    <meta:generator>fiduswriter-template-generator</meta:generator>
  </office:meta>
</office:document-meta>`;
const ODT_NAMESPACES = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
    xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
    xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
    xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"`;
function odtStyleXml(name, family, parent, pPr, tPr) {
    const displayAttr = name.includes("_20_")
        ? ` style:display-name="${name.replace(/_20_/g, " ")}"`
        : "";
    const parentAttr = parent ? ` style:parent-style-name="${parent}"` : "";
    const classAttr = family === "paragraph" ? ` style:class="text"` : "";
    const pPrXml = pPr ? `<style:paragraph-properties ${pPr}/>` : "";
    const tPrXml = tPr ? `<style:text-properties ${tPr}/>` : "";
    return `<style:style style:name="${name}" style:family="${family}"${displayAttr}${parentAttr}${classAttr}>${pPrXml}${tPrXml}</style:style>`;
}
function odtStylesXml(papersize) {
    const pageW = papersize === "US Letter" ? "8.5in" : "8.2681in";
    const pageH = papersize === "US Letter" ? "11in" : "11.6929in";
    const styles = [
        odtStyleXml("Standard", "paragraph"),
        odtStyleXml("Text_20_body", "paragraph", "Standard", 'fo:margin-top="0in" fo:margin-bottom="0.0972in" fo:line-height="120%"', ""),
        odtStyleXml("Heading", "paragraph", "Standard", 'fo:margin-top="0.1665in" fo:margin-bottom="0.0835in"', 'style:font-name="Liberation Sans" fo:font-size="14pt"'),
        odtStyleXml("Title", "paragraph", "Heading", 'fo:text-align="center" fo:margin-top="0.1665in" fo:margin-bottom="0.0835in"', 'fo:font-size="28pt" fo:font-weight="bold" style:font-name="Liberation Sans"'),
        odtStyleXml("Subtitle", "paragraph", "Heading", 'fo:text-align="center" fo:margin-top="0.0417in" fo:margin-bottom="0.0835in"', 'fo:font-size="18pt" style:font-name="Liberation Sans"'),
        odtStyleXml("Authors", "paragraph", "Text_20_body", 'fo:text-align="center"', 'fo:font-size="10.5pt" fo:font-style="italic"'),
        odtStyleXml("Abstract", "paragraph", "Text_20_body", 'fo:margin-left="0.5in" fo:margin-right="0in" fo:text-indent="0in"', 'fo:font-size="10pt"'),
        odtStyleXml("Heading_20_1", "paragraph", "Heading", 'fo:margin-top="0.1665in" fo:margin-bottom="0.0835in"', 'fo:font-size="24pt" fo:font-weight="bold" style:font-name="Liberation Sans"'),
        odtStyleXml("Heading_20_2", "paragraph", "Heading", 'fo:margin-top="0.1665in" fo:margin-bottom="0.0835in"', 'fo:font-size="18pt" fo:font-weight="bold" style:font-name="Liberation Sans"'),
        odtStyleXml("Heading_20_3", "paragraph", "Heading", 'fo:margin-top="0.1665in" fo:margin-bottom="0.0835in"', 'fo:font-size="14pt" fo:font-weight="bold" style:font-name="Liberation Sans"')
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${ODT_NAMESPACES} office:version="1.2">
  <office:font-face-decls>
    <style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'" style:font-family-generic="roman" style:font-pitch="variable"/>
    <style:font-face style:name="Liberation Sans" svg:font-family="'Liberation Sans'" style:font-family-generic="swiss" style:font-pitch="variable"/>
  </office:font-face-decls>
  <office:styles>
    ${styles.join("\n    ")}
  </office:styles>
  <office:automatic-styles>
    <style:page-layout style:name="Mpm1">
      <style:page-layout-properties fo:page-width="${pageW}" fo:page-height="${pageH}"
          fo:margin-top="0.7874in" fo:margin-bottom="0.7874in"
          fo:margin-left="0.7874in" fo:margin-right="0.7874in"/>
    </style:page-layout>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="Mpm1"/>
  </office:master-styles>
</office:document-styles>`;
}
function tagToOdtStyle(tag) {
    if (tag.partType === "title") {
        return "Title";
    }
    if (tag.partType === "heading_part") {
        return "Heading_20_2";
    }
    if (tag.partType === "contributors_part") {
        return "Authors";
    }
    if (tag.partType === "tags_part") {
        return "Abstract";
    }
    return "Text_20_body";
}
function odtContentXml(tags) {
    const paragraphs = tags.map(tag => {
        const style = tagToOdtStyle(tag);
        return `<text:p text:style-name="${style}">{${tag.title}}</text:p>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${ODT_NAMESPACES} office:version="1.2">
  <office:scripts/>
  <office:font-face-decls>
    <style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'" style:font-family-generic="roman" style:font-pitch="variable"/>
    <style:font-face style:name="Liberation Sans" svg:font-family="'Liberation Sans'" style:font-family-generic="swiss" style:font-pitch="variable"/>
  </office:font-face-decls>
  <office:automatic-styles/>
  <office:body>
    <office:text>
      <text:sequence-decls>
        <text:sequence-decl text:display-outline-level="0" text:name="Illustration"/>
        <text:sequence-decl text:display-outline-level="0" text:name="Table"/>
        <text:sequence-decl text:display-outline-level="0" text:name="Text"/>
        <text:sequence-decl text:display-outline-level="0" text:name="Drawing"/>
      </text:sequence-decls>
      ${paragraphs.join("\n      ")}
    </office:text>
  </office:body>
</office:document-content>`;
}
export async function generateOdtTemplate(docContent) {
    const tags = extractTemplateTags(docContent);
    const papersize = docContent.attrs?.papersize;
    const zip = new JSZip();
    zip.file("mimetype", ODT_MIMETYPE, { compression: "STORE" });
    const manifestXml = ODT_MANIFEST;
    const contentXml = odtContentXml(tags);
    const stylesXml = odtStylesXml(String(papersize));
    const metaXml = ODT_META;
    [manifestXml, contentXml, stylesXml, metaXml].forEach(validateXml);
    zip.file("META-INF/manifest.xml", manifestXml);
    zip.file("content.xml", contentXml);
    zip.file("styles.xml", stylesXml);
    zip.file("meta.xml", metaXml);
    return zip.generateAsync({
        type: "blob",
        mimeType: ODT_MIMETYPE
    });
}
//# sourceMappingURL=odt.js.map