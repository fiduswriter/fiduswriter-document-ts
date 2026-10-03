import JSZip from "jszip";
import { validateXml } from "../tools/xml.js";
import { extractTemplateTags } from "./tags.js";
const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>
</Relationships>`;
const DOCX_DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`;
const DOCX_SETTINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="720"/>
  <w:compat>
    <w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>
  </w:compat>
</w:settings>`;
const DOCX_FONT_TABLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="Calibri">
    <w:panose1 w:val="020F0502020204030204"/>
    <w:charset w:val="00"/>
    <w:family w:val="swiss"/>
    <w:pitch w:val="variable"/>
  </w:font>
  <w:font w:name="Calibri Light">
    <w:panose1 w:val="020F0302020204030204"/>
    <w:charset w:val="00"/>
    <w:family w:val="swiss"/>
    <w:pitch w:val="variable"/>
  </w:font>
  <w:font w:name="Times New Roman">
    <w:panose1 w:val="02020603050405020304"/>
    <w:charset w:val="00"/>
    <w:family w:val="roman"/>
    <w:pitch w:val="variable"/>
  </w:font>
</w:fonts>`;
const DOCX_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:dcterms="http://purl.org/dc/terms/"
    xmlns:dcmitype="http://purl.org/dc/dcmitype/"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title></dc:title>
  <dc:creator></dc:creator>
  <dc:lastModifiedBy></dc:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;
const DOCX_APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
    xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Fidus Writer</Application>
  <AppVersion>0.1</AppVersion>
</Properties>`;
const DOCX_CUSTOM = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
    xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
</Properties>`;
function docxStyleXml(styleId, name, basedOn, pPr, rPr) {
    const basedOnXml = basedOn ? `<w:basedOn w:val="${basedOn}"/>` : "";
    const pPrXml = pPr ? `<w:pPr>${pPr}</w:pPr>` : "";
    const rPrXml = rPr ? `<w:rPr>${rPr}</w:rPr>` : "";
    return `<w:style w:type="paragraph" w:styleId="${styleId}"><w:name w:val="${name}"/>${basedOnXml}${pPrXml}${rPrXml}</w:style>`;
}
function docxStylesXml() {
    const styles = [
        docxStyleXml("Normal", "Normal", undefined, '<w:spacing w:after="160" w:line="259" w:lineRule="auto"/>', '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>'),
        docxStyleXml("Title", "Title", "Normal", '<w:jc w:val="center"/>', '<w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:bCs/><w:color w:val="262626"/><w:sz w:val="96"/>'),
        docxStyleXml("Subtitle", "Subtitle", "Normal", '<w:jc w:val="center"/>', '<w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="404040"/><w:sz w:val="28"/>'),
        docxStyleXml("Authors", "Authors", "Normal", '<w:jc w:val="center"/>', '<w:i/><w:color w:val="404040"/><w:sz w:val="22"/>'),
        docxStyleXml("Abstract", "Abstract", "Normal", "", '<w:i/><w:sz w:val="20"/>'),
        docxStyleXml("Keywords", "Keywords", "Normal", "", '<w:b/><w:i/><w:sz w:val="22"/>'),
        docxStyleXml("References", "References", "Normal", '<w:spacing w:before="0" w:after="160"/>', '<w:sz w:val="22"/>'),
        docxStyleXml("Heading1", "heading 1", "Normal", '<w:spacing w:before="360" w:after="80"/>', '<w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:bCs/><w:color w:val="2E74B5"/><w:sz w:val="48"/>'),
        docxStyleXml("Heading2", "heading 2", "Normal", '<w:spacing w:before="240" w:after="40"/>', '<w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:bCs/><w:color w:val="2E74B5"/><w:sz w:val="36"/>'),
        docxStyleXml("Heading3", "heading 3", "Normal", '<w:spacing w:before="200" w:after="40"/>', '<w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:bCs/><w:color w:val="2E74B5"/><w:sz w:val="28"/>'),
        docxStyleXml("ListParagraph", "List Paragraph", "Normal", '<w:ind w:left="720"/><w:contextualSpacing/>', "")
    ];
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
${styles.join("\n")}
</w:styles>`;
}
function docxParagraphXml(styleId, text) {
    return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}
function tagToDocxStyle(tag) {
    if (tag.partType === "title") {
        return "Title";
    }
    if (tag.partType === "heading_part") {
        return "Heading2";
    }
    if (tag.partType === "contributors_part") {
        return "Authors";
    }
    if (tag.partType === "tags_part") {
        return "Keywords";
    }
    if (tag.partType === "bibliography") {
        return "References";
    }
    if (tag.type === "block") {
        return "Normal";
    }
    return "Normal";
}
function docxPageSz(papersize) {
    if (papersize === "US Letter") {
        return '<w:pgSz w:w="12240" w:h="15840"/>';
    }
    return '<w:pgSz w:w="11906" w:h="16838"/>';
}
function docxDocumentXml(tags, papersize) {
    const paragraphs = tags.map(tag => docxParagraphXml(tagToDocxStyle(tag), `{${tag.title}}`));
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            mc:Ignorable="">
  <w:body>
    ${paragraphs.join("\n    ")}
    <w:sectPr>
      <w:type w:val="nextPage"/>
      ${docxPageSz(papersize)}
      <w:pgMar w:left="1440" w:right="1440" w:header="0" w:top="1440" w:footer="0" w:bottom="1440" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}
export async function generateDocxTemplate(docContent) {
    const tags = extractTemplateTags(docContent);
    const papersize = docContent.attrs?.papersize;
    const zip = new JSZip();
    const contentTypesXml = DOCX_CONTENT_TYPES;
    const relsXml = DOCX_RELS;
    const documentXml = docxDocumentXml(tags, String(papersize));
    const stylesXml = docxStylesXml();
    const settingsXml = DOCX_SETTINGS;
    const fontTableXml = DOCX_FONT_TABLE;
    const documentRelsXml = DOCX_DOCUMENT_RELS;
    const coreXml = DOCX_CORE;
    const appXml = DOCX_APP;
    const customXml = DOCX_CUSTOM;
    [
        contentTypesXml,
        relsXml,
        documentXml,
        stylesXml,
        settingsXml,
        fontTableXml,
        documentRelsXml,
        coreXml,
        appXml,
        customXml
    ].forEach(validateXml);
    zip.file("[Content_Types].xml", contentTypesXml);
    zip.file("_rels/.rels", relsXml);
    zip.file("word/document.xml", documentXml);
    zip.file("word/styles.xml", stylesXml);
    zip.file("word/settings.xml", settingsXml);
    zip.file("word/fontTable.xml", fontTableXml);
    zip.file("word/_rels/document.xml.rels", documentRelsXml);
    zip.file("docProps/core.xml", coreXml);
    zip.file("docProps/app.xml", appXml);
    zip.file("docProps/custom.xml", customXml);
    return zip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
}
//# sourceMappingURL=docx.js.map