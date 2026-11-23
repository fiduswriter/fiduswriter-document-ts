import {beforeAll, describe, expect, it} from "@jest/globals"
import JSZip from "jszip"

const {DocxConvert} = await import("../../src/importer/docx/convert.js")
const {OdtConvert} = await import("../../src/importer/odt/convert.js")
const {
    chartModelToSvg,
    odfChartModel,
    ooxmlChartModel,
    placeholderSvg,
    svgToBlob,
    tableModelToSvg,
    xlsxFirstSheetTable
} = await import("../../src/importer/chart_svg.js")
const {xmlDOM} = await import("../../src/exporter/tools/xml.js")

const MINIMAL_TEMPLATE = {
    content: {
        type: "doc",
        content: [
            {type: "title", content: [{type: "text", text: "Title"}]},
            {
                type: "richtext_part",
                attrs: {metadata: "abstract", title: "Abstract"}
            },
            {
                type: "contributors_part",
                attrs: {metadata: "authors", title: "Authors"}
            },
            {
                type: "tags_part",
                attrs: {metadata: "keywords", title: "Keywords"}
            },
            {type: "richtext_part", attrs: {title: "Body", id: "body"}}
        ]
    }
}

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
            xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:v="urn:schemas-microsoft-com:vml">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Snapshots</w:t></w:r></w:p>
    <w:p>
      <w:r><w:t>Chart below.</w:t></w:r>
      <w:drawing>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData>
            <c:chart r:id="rIdChart"/>
          </a:graphicData>
        </a:graphic>
      </w:drawing>
    </w:p>
    <w:p>
      <w:drawing>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData>
            <dgm:relIds r:dm="rIdDgm"/>
          </a:graphicData>
        </a:graphic>
      </w:drawing>
    </w:p>
    <w:p>
      <w:pict>
        <v:shape>
          <v:textbox>
            <w:txbxContent>
              <w:p><w:r><w:t>Text box content</w:t></w:r></w:p>
            </w:txbxContent>
          </v:textbox>
        </v:shape>
      </w:pict>
    </w:p>
    <w:p>
      <w:object w:dxaOrig="3000" w:dyaOrig="2000">
        <o:OLEObject Type="Embed" ProgID="Excel.Sheet.12" r:id="rIdOleXlsx"/>
        <w:pict><v:shape/></w:pict>
      </w:object>
    </w:p>
    <w:p>
      <w:object w:dxaOrig="3000" w:dyaOrig="2000">
        <o:OLEObject Type="Embed" ProgID="Word.Document.12" r:id="rIdOleDocx"/>
        <w:pict><v:shape/></w:pict>
      </w:object>
    </w:p>
    <w:altChunk r:id="rIdChunkHtml"/>
    <w:altChunk r:id="rIdChunkDocx"/>
  </w:body>
</w:document>`

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/>
  <Relationship Id="rIdDgm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="diagrams/data1.xml"/>
  <Relationship Id="rIdOleXlsx" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/data.xlsx"/>
  <Relationship Id="rIdOleDocx" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/embedded.docx"/>
  <Relationship Id="rIdChunkHtml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/altChunk" Target="afchunk.html"/>
  <Relationship Id="rIdChunkDocx" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/altChunk" Target="chunk.docx"/>
</Relationships>`

const CHART_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <c:chart>
    <c:title><c:tx><c:rich><a:p><a:r><a:t>Sales</a:t></a:r></a:p></c:rich></c:tx></c:title>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:ser>
          <c:idx val="0"/><c:order val="0"/>
          <c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series 1</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Cat A</c:v></c:pt><c:pt idx="1"><c:v>Cat B</c:v></c:pt><c:pt idx="2"><c:v>Cat C</c:v></c:pt></c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:f>Sheet1!$B$2:$B$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>4.3</c:v></c:pt><c:pt idx="1"><c:v>2.5</c:v></c:pt><c:pt idx="2"><c:v>3.5</c:v></c:pt></c:numCache></c:numRef></c:val>
        </c:ser>
        <c:ser>
          <c:idx val="1"/><c:order val="1"/>
          <c:tx><c:strRef><c:f>Sheet1!$C$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series 2</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Cat A</c:v></c:pt><c:pt idx="1"><c:v>Cat B</c:v></c:pt><c:pt idx="2"><c:v>Cat C</c:v></c:pt></c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:f>Sheet1!$C$2:$C$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>2.4</c:v></c:pt><c:pt idx="1"><c:v>4.4</c:v></c:pt><c:pt idx="2"><c:v>1.8</c:v></c:pt></c:numCache></c:numRef></c:val>
        </c:ser>
        <c:gapWidth val="150"/>
        <c:axId val="111111111"/><c:axId val="222222222"/>
      </c:barChart>
    </c:plotArea>
  </c:chart>
</c:chartSpace>`

const DIAGRAM_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <dgm:ptLst>
    <dgm:pt modelId="1"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>First step</a:t></a:r></a:p></dgm:t></dgm:pt>
    <dgm:pt modelId="2"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Second step</a:t></a:r></a:p></dgm:t></dgm:pt>
  </dgm:ptLst>
</dgm:dataModel>`

const CHUNK_HTML = `<html><body><p>Alt chunk one</p><div>Alt chunk two</div></body></html>`

const CHUNK_DOCX_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Chunk docx paragraph</w:t></w:r></w:p>
  </w:body>
</w:document>`

const XLSX_WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const XLSX_SHEET = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>42</v></c></row>
    <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>7</v></c></row>
  </sheetData>
</worksheet>`

const XLSX_SHARED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>Name</t></si>
  <si><t>Value</t></si>
  <si><t>Alpha</t></si>
  <si><t>Beta</t></si>
</sst>`

const flatten = (node, result = []) => {
    result.push(node)
    if (node.content) {
        node.content.forEach(child => flatten(child, result))
    }
    return result
}

async function buildSnapshotZip() {
    const zip = new JSZip()
    zip.file("word/document.xml", DOCUMENT_XML)
    zip.file("word/styles.xml", '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')
    zip.file("word/_rels/document.xml.rels", RELS_XML)
    zip.file("word/charts/chart1.xml", CHART_XML)
    zip.file("word/diagrams/data1.xml", DIAGRAM_XML)
    zip.file("word/afchunk.html", CHUNK_HTML)

    const chunkZip = new JSZip()
    chunkZip.file("word/document.xml", CHUNK_DOCX_DOCUMENT_XML)
    zip.file("word/chunk.docx", await chunkZip.generateAsync({type: "arraybuffer"}))

    const xlsxZip = new JSZip()
    xlsxZip.file("xl/workbook.xml", XLSX_WORKBOOK)
    xlsxZip.file("xl/worksheets/sheet1.xml", XLSX_SHEET)
    xlsxZip.file("xl/sharedStrings.xml", XLSX_SHARED)
    zip.file("word/embeddings/data.xlsx", await xlsxZip.generateAsync({type: "arraybuffer"}))

    const oleZip = new JSZip()
    oleZip.file("word/document.xml", CHUNK_DOCX_DOCUMENT_XML)
    zip.file("word/embeddings/embedded.docx", await oleZip.generateAsync({type: "arraybuffer"}))

    return zip
}

describe("DOCX snapshot imports", () => {
    let imported
    let converter

    beforeAll(async () => {
        const zip = await buildSnapshotZip()
        converter = new DocxConvert(zip, "snapshot-test", MINIMAL_TEMPLATE, {})
        imported = await converter.init()
    })

    it("imports a chart as an SVG snapshot figure", async () => {
        const nodes = flatten(imported.content)
        const figure = nodes.find(node => node.type === "figure")
        expect(figure).toBeDefined()
        const image = figure.content.find(node => node.type === "image")
        const entry = converter.images[image.attrs.image]
        expect(entry.title).toBe("Sales")
        const svg = await entry.file.text()
        expect(svg).toContain("<svg")
        expect(svg).toContain("Series 1")
        expect(svg).toContain("Cat A")
    })

    it("imports SmartArt as a placeholder snapshot with its text", async () => {
        const nodes = flatten(imported.content)
        const figures = nodes.filter(node => node.type === "figure")
        expect(figures.length).toBeGreaterThanOrEqual(3)
        const svgs = await Promise.all(
            figures.map(async figure => {
                const image = figure.content.find(node => node.type === "image")
                return converter.images[image.attrs.image].file.text()
            })
        )
        const smartArt = svgs.find(svg => svg.includes("SmartArt"))
        expect(smartArt).toBeDefined()
        expect(smartArt).toContain("First step")
    })

    it("flattens text box content into the body", () => {
        const nodes = flatten(imported.content)
        const texts = nodes
            .filter(node => node.type === "text")
            .map(node => node.text)
        expect(texts).toContain("Text box content")
    })

    it("snapshots an embedded xlsx as a table image", async () => {
        const nodes = flatten(imported.content)
        const figures = nodes.filter(node => node.type === "figure")
        const svgs = await Promise.all(
            figures.map(async figure => {
                const image = figure.content.find(node => node.type === "image")
                return converter.images[image.attrs.image].file.text()
            })
        )
        const table = svgs.find(svg => svg.includes("Alpha"))
        expect(table).toBeDefined()
        expect(table).toContain("42")
    })

    it("imports embedded docx OLE as a placeholder figure", async () => {
        const nodes = flatten(imported.content)
        const figures = nodes.filter(node => node.type === "figure")
        const svgs = await Promise.all(
            figures.map(async figure => {
                const image = figure.content.find(node => node.type === "image")
                return converter.images[image.attrs.image].file.text()
            })
        )
        const placeholder = svgs.find(svg => svg.includes("Embedded object"))
        expect(placeholder).toBeDefined()
        expect(placeholder).toContain("embedded.docx")
    })

    it("imports altChunk content", () => {
        const nodes = flatten(imported.content)
        const texts = nodes
            .filter(node => node.type === "text")
            .map(node => node.text)
        expect(texts).toContain("Alt chunk one")
        expect(texts).toContain("Alt chunk two")
        expect(texts).toContain("Chunk docx paragraph")
    })
})

describe("chart model and SVG rendering", () => {
    it("extracts an OOXML chart model", () => {
        const model = ooxmlChartModel(xmlDOM(CHART_XML))
        expect(model).not.toBeNull()
        expect(model.type).toBe("bar")
        expect(model.title).toBe("Sales")
        expect(model.categories).toEqual(["Cat A", "Cat B", "Cat C"])
        expect(model.series.length).toBe(2)
        expect(model.series[0].values).toEqual([4.3, 2.5, 3.5])
    })

    it("renders bar, pie and line charts as SVG", () => {
        const model = ooxmlChartModel(xmlDOM(CHART_XML))
        const barSvg = chartModelToSvg(model)
        expect(barSvg).toContain("<svg")
        expect(barSvg).toContain("<rect")

        const pieSvg = chartModelToSvg({
            type: "pie",
            title: "Share",
            categories: ["A", "B"],
            series: [{name: "S", values: [60, 40]}]
        })
        expect(pieSvg).toContain("<path")

        const lineSvg = chartModelToSvg({
            type: "line",
            categories: ["A", "B"],
            series: [{name: "S", values: [1, 2]}]
        })
        expect(lineSvg).toContain("<polyline")
    })

    it("falls back to a table SVG for unknown chart types", () => {
        const svg = chartModelToSvg({
            type: "unknown",
            categories: ["A"],
            series: [{name: "S", values: [1]}]
        })
        expect(svg).toContain("<rect")
    })

    it("extracts an ODF chart model from a LibreOffice chart part", () => {
        const odfChart = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
                 xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0"
                 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
  <office:body>
    <office:chart>
      <chart:chart chart:class="chart:bar">
        <chart:title>Revenue</chart:title>
        <chart:plot-area>
          <chart:series chart:name="Q1"/>
          <chart:series chart:name="Q2"/>
          <table:table>
            <table:table-row>
              <table:table-cell/><table:table-cell office:value-type="string"><text:p xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">Q1</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">Q2</text:p></table:table-cell>
            </table:table-row>
            <table:table-row>
              <table:table-cell office:value-type="string"><text:p xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">2023</text:p></table:table-cell><table:table-cell office:value="10" office:value-type="float"><text:p>10</text:p></table:table-cell><table:table-cell office:value="12" office:value-type="float"><text:p>12</text:p></table:table-cell>
            </table:table-row>
            <table:table-row>
              <table:table-cell office:value-type="string"><text:p xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">2024</text:p></table:table-cell><table:table-cell office:value="20" office:value-type="float"><text:p>20</text:p></table:table-cell><table:table-cell office:value="22" office:value-type="float"><text:p>22</text:p></table:table-cell>
            </table:table-row>
          </table:table>
        </chart:plot-area>
      </chart:chart>
    </office:chart>
  </office:body>
</office:document>`
        const model = odfChartModel(xmlDOM(odfChart).query("chart:chart"))
        expect(model).not.toBeNull()
        expect(model.type).toBe("bar")
        expect(model.title).toBe("Revenue")
        expect(model.categories).toEqual(["2023", "2024"])
        expect(model.series.map(s => s.name)).toEqual(["Q1", "Q2"])
        expect(model.series[0].values).toEqual([10, 20])
        expect(chartModelToSvg(model)).toContain("<svg")
    })

    it("reads the first sheet of an xlsx into a table model", async () => {
        const xlsxZip = new JSZip()
        xlsxZip.file("xl/workbook.xml", XLSX_WORKBOOK)
        xlsxZip.file("xl/worksheets/sheet1.xml", XLSX_SHEET)
        xlsxZip.file("xl/sharedStrings.xml", XLSX_SHARED)
        const data = await xlsxZip.generateAsync({type: "arraybuffer"})
        const table = await xlsxFirstSheetTable(data)
        expect(table).not.toBeNull()
        expect(table.title).toBe("Data")
        expect(table.rows[0]).toEqual(["Name", "Value"])
        expect(table.rows[1]).toEqual(["Alpha", "42"])
        const svg = tableModelToSvg(table)
        expect(svg).toContain("Alpha")
    })

    it("renders a placeholder SVG", () => {
        const svg = placeholderSvg("Embedded object", ["file.bin"])
        expect(svg).toContain("Embedded object")
        expect(svg).toContain("file.bin")
        expect(svgToBlob(svg).type).toBe("image/svg+xml")
    })
})

describe("ODT chart snapshot (parity)", () => {
    it("imports a chart object as an SVG snapshot figure", () => {
        const odfChart = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
                 xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0"
                 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
                 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body>
    <office:chart>
      <chart:chart chart:class="chart:line">
        <chart:plot-area>
          <chart:series chart:name="Trend"/>
          <table:table>
            <table:table-row>
              <table:table-cell/><table:table-cell office:value-type="string"><text:p>Trend</text:p></table:table-cell>
            </table:table-row>
            <table:table-row>
              <table:table-cell office:value-type="string"><text:p>x</text:p></table:table-cell><table:table-cell office:value="1" office:value-type="float"><text:p>1</text:p></table:table-cell>
            </table:table-row>
          </table:table>
        </chart:plot-area>
      </chart:chart>
    </office:chart>
  </office:body>
</office:document>`
        const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
    office:version="1.2">
  <office:body>
    <office:text>
      <text:p text:style-name="Title">Doc</text:p>
      <text:p>
        <draw:frame svg:width="10cm" svg:height="8cm">
          <draw:object xlink:href="./Object 1" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>
        </draw:frame>
      </text:p>
    </office:text>
  </office:body>
</office:document-content>`
        const importer = new OdtConvert(
            contentXml,
            "",
            "",
            "",
            "odt-chart-test",
            MINIMAL_TEMPLATE,
            {},
            {},
            {"Object 1": odfChart}
        )
        const imported = importer.init()
        const nodes = flatten(imported.content)
        const figure = nodes.find(node => node.type === "figure")
        expect(figure).toBeDefined()
        const image = figure.content.find(node => node.type === "image")
        const entry = importer.images[image.attrs.image]
        expect(entry.file_type).toBe("image/svg+xml")
    })

    it("flattens draw:text-box content into the body", () => {
        const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
    xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
    xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
    office:version="1.2">
  <office:body>
    <office:text>
      <text:p text:style-name="Title">Doc</text:p>
      <text:p>
        <draw:frame svg:width="6cm" svg:height="3cm">
          <draw:text-box>
            <text:p>Boxed text here</text:p>
          </draw:text-box>
        </draw:frame>
      </text:p>
    </office:text>
  </office:body>
</office:document-content>`
        const importer = new OdtConvert(
            contentXml,
            "",
            "",
            "",
            "odt-textbox-test",
            MINIMAL_TEMPLATE,
            {},
            {}
        )
        const imported = importer.init()
        const nodes = flatten(imported.content)
        const texts = nodes
            .filter(node => node.type === "text")
            .map(node => node.text)
        expect(texts).toContain("Boxed text here")
    })
})
