/**
 * Snapshot rendering for content that has no representation in the Fidus
 * document model (charts, embedded spreadsheets, SmartArt, OLE objects):
 * render a static SVG from the source data and store it as an image. SVG is
 * a first-class image format throughout the pipeline; exporters that cannot
 * embed SVG (DOCX) already rasterize it to PNG.
 *
 * Everything here is pure string/XML processing so it runs in the browser,
 * Node.js and the desktop app — never on a server.
 */

import {escapeText} from "fwtoolkit"

import {xmlDOM} from "../exporter/tools/xml.js"
import type {XMLElement} from "../exporter/tools/xml.js"

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"'

/** Normalized chart description consumed by the SVG renderer. */
export interface ChartModel {
    type:
        | "bar"
        | "line"
        | "pie"
        | "area"
        | "scatter"
        | "unknown"
    /** Horizontal bars instead of columns (OOXML barDir="bar"). */
    horizontal?: boolean
    stacked?: boolean
    title?: string
    categories: string[]
    series: Array<{
        name: string
        values: Array<number | null>
    }>
}

export interface SvgDimensions {
    width: number
    height: number
}

const DEFAULT_DIMENSIONS: SvgDimensions = {width: 600, height: 400}

function attr(node: unknown, name: string): string {
    if (node && typeof node === "object" && "getAttribute" in node) {
        return String((node as XMLElement).getAttribute(name) || "")
    }
    return ""
}

/** Read an indexed c:pt list (c:strCache/c:numCache) into a dense array. */
function readPointList(
    parent: XMLElement | null | undefined,
    valueTag = "c:v"
): string[] {
    if (!parent) {
        return []
    }
    const points: string[] = []
    parent.queryAll("c:pt").forEach((pt: XMLElement) => {
        const idx = parseInt(attr(pt, "idx")) || 0
        const value = pt.query(valueTag)?.textContent ?? ""
        points[idx] = value
    })
    return points
}

function toNumber(text: string | undefined): number | null {
    if (text === undefined || text === "") {
        return null
    }
    const num = Number.parseFloat(text)
    return Number.isNaN(num) ? null : num
}

const OOXML_CHART_TYPES: Array<{
    tag: string
    type: ChartModel["type"]
    horizontal?: boolean
}> = [
    {tag: "c:barChart", type: "bar"},
    {tag: "c:lineChart", type: "line"},
    {tag: "c:areaChart", type: "area"},
    {tag: "c:pieChart", type: "pie"},
    {tag: "c:doughnutChart", type: "pie"},
    {tag: "c:scatterChart", type: "scatter"}
]

/** Extract a ChartModel from a word/charts/chartN.xml document. */
export function ooxmlChartModel(chartSpace: XMLElement): ChartModel | null {
    const chart = chartSpace.query("c:chart")
    const plotArea = chart?.query("c:plotArea")
    if (!plotArea) {
        return null
    }
    const typeEl = OOXML_CHART_TYPES.map(entry => ({
        entry,
        el: plotArea.query(entry.tag)
    })).find(match => match.el)
    if (!typeEl?.el) {
        return null
    }
    const {entry, el} = typeEl
    const model: ChartModel = {
        type: entry.type,
        horizontal:
            entry.type === "bar" &&
            attr(el.query("c:barDir"), "w:val") === "bar",
        stacked: ["stacked", "percentStacked"].includes(
            attr(el.query("c:grouping"), "w:val")
        ),
        title:
            chart!
                .query("c:title")
                ?.queryAll("a:t")
                .map((t: XMLElement) => t.textContent)
                .join("") || undefined,
        categories: [],
        series: []
    }
    let categories: string[] = []
    el.queryAll("c:ser").forEach((ser: XMLElement, index: number) => {
        const name =
            readPointList(ser.query("c:tx")?.query("c:strCache"))[0] ||
            readPointList(ser.query("c:tx")?.query("c:numCache"))[0] ||
            `Series ${index + 1}`
        const catRef =
            entry.type === "scatter" ? ser.query("c:xVal") : ser.query("c:cat")
        const valRef =
            entry.type === "scatter" ? ser.query("c:yVal") : ser.query("c:val")
        const cats = readPointList(
            catRef?.query("c:strCache") || catRef?.query("c:numCache")
        )
        if (cats.length > categories.length) {
            categories = cats
        }
        const values = readPointList(
            valRef?.query("c:numCache") || valRef?.query("c:strCache")
        ).map(toNumber)
        model.series.push({name, values})
    })
    if (!model.series.length) {
        return null
    }
    model.categories = categories.length
        ? categories
        : model.series[0].values.map((_, i) => String(i + 1))
    return model
}

/** Extract a ChartModel from an ODF chart:chart element. */
export function odfChartModel(chartEl: XMLElement): ChartModel | null {
    const classAttr = attr(chartEl, "chart:class")
    const mappedType: Record<string, ChartModel["type"]> = {
        "chart:bar": "bar",
        "chart:line": "line",
        "chart:area": "area",
        "chart:circle": "pie",
        "chart:ring": "pie",
        "chart:scattered": "scatter"
    }
    const type: ChartModel["type"] = mappedType[classAttr] || "unknown"
    const model: ChartModel = {
        type,
        horizontal: attr(chartEl, "chart:vertical") !== "true",
        stacked: attr(chartEl, "chart:stacked") === "true",
        title:
            chartEl.query("chart:title")?.textContent.trim() || undefined,
        categories: [],
        series: []
    }
    const seriesEls = chartEl.queryAll("chart:series")
    if (seriesEls.length) {
        model.series = seriesEls.map((el, index) => ({
            name: attr(el, "chart:name") || `Series ${index + 1}`,
            values: []
        }))
    }
    // LibreOffice charts cache the data as a table inside the chart part:
    // first column = categories, header row = series names.
    const table = chartEl.query("table:table")
    if (!table) {
        return model.series.length ? model : null
    }
    const rows = table.queryAll("table:table-row")
    const matrix: string[][] = []
    rows.forEach((row: XMLElement) => {
        const repeat = parseInt(attr(row, "table:number-rows-repeated")) || 1
        const cells: string[] = []
        row.queryAll("table:table-cell").forEach((cell: XMLElement) => {
            const cellRepeat =
                parseInt(attr(cell, "table:number-columns-repeated")) || 1
            const value =
                attr(cell, "office:value") || cell.textContent
            for (let i = 0; i < cellRepeat; i++) {
                cells.push(value)
            }
        })
        for (let r = 0; r < Math.min(repeat, 500); r++) {
            matrix.push([...cells])
        }
    })
    if (matrix.length < 2) {
        return null
    }
    if (!seriesEls.length) {
        const header = matrix[0]
        model.series = header.slice(1).map((name, index) => ({
            name: name || `Series ${index + 1}`,
            values: []
        }))
    }
    model.categories = matrix.slice(1).map(row => row[0] || "")
    matrix.slice(1).forEach((row, rowIndex) => {
        row.slice(1).forEach((cell, colIndex) => {
            const series = model.series[colIndex]
            if (!series) {
                return
            }
            series.values[rowIndex] = toNumber(cell)
        })
    })
    if (!model.series.length) {
        return null
    }
    return model
}

/** Simple grid used for table snapshots (embedded spreadsheets, chart fallback). */
export interface TableModel {
    title?: string
    columns: string[]
    rows: string[][]
}

const COLORS = [
    "#4472c4",
    "#ed7d31",
    "#a5a5a5",
    "#ffc000",
    "#5b9bd5",
    "#70ad47",
    "#264478",
    "#9e480e"
]

function svgText(
    x: number,
    y: number,
    text: string,
    options: {anchor?: string; size?: number; weight?: string} = {}
): string {
    const anchor = options.anchor ? ` text-anchor="${options.anchor}"` : ""
    const weight = options.weight ? ` font-weight="${options.weight}"` : ""
    return `<text x="${x}" y="${y}" font-family="sans-serif" font-size="${
        options.size || 12
    }"${anchor}${weight}>${escapeText(text)}</text>`
}

function maxValue(model: ChartModel): number {
    return Math.max(
        1,
        ...model.series.flatMap(series =>
            series.values.map(value => value || 0)
        )
    )
}

function stackedTotals(model: ChartModel): number[] {
    const totals: number[] = []
    model.series.forEach(series => {
        series.values.forEach((value, index) => {
            totals[index] = (totals[index] || 0) + (value || 0)
        })
    })
    return totals
}

function barChartSvg(
    model: ChartModel,
    dims: SvgDimensions,
    plot: {left: number; top: number; width: number; height: number}
): string {
    const horizontal = model.horizontal
    const stacked = model.stacked
    const totals = stacked ? stackedTotals(model) : []
    const axisMax = stacked ? Math.max(1, ...totals) : maxValue(model)
    const categories = model.categories
    const seriesCount = model.series.length
    const slotCount = horizontal ? plot.height : plot.width
    const slot = slotCount / Math.max(1, categories.length)
    const barThickness = (slot * 0.7) / (stacked ? 1 : seriesCount)
    const scale = (horizontal ? plot.width : plot.height) / axisMax
    let body = ""
    categories.forEach((category, catIndex) => {
        const base = horizontal
            ? plot.top + catIndex * slot + slot * 0.15
            : plot.left + catIndex * slot + slot * 0.15
        let stackPos = 0
        model.series.forEach((series, serIndex) => {
            const value = series.values[catIndex] || 0
            const length = value * scale
            if (horizontal) {
                const y = stacked
                    ? plot.top + catIndex * slot + slot * 0.15
                    : base + serIndex * barThickness
                const x = plot.left + stackPos * scale
                const height = stacked ? slot * 0.7 : barThickness
                body += `<rect x="${x}" y="${y}" width="${length}" height="${height}" fill="${COLORS[serIndex % COLORS.length]}"/>`
                if (!stacked) {
                    body += svgText(
                        x + length + 4,
                        y + height / 2 + 4,
                        String(value)
                    )
                }
            } else {
                const x = stacked
                    ? plot.left + catIndex * slot + slot * 0.15
                    : base + serIndex * barThickness
                const y =
                    plot.top + plot.height - stackPos * scale - length
                const width = stacked ? slot * 0.7 : barThickness
                body += `<rect x="${x}" y="${y}" width="${width}" height="${length}" fill="${COLORS[serIndex % COLORS.length]}"/>`
                if (!stacked) {
                    body += svgText(
                        x + width / 2,
                        y - 3,
                        String(value),
                        {anchor: "middle", size: 10}
                    )
                }
            }
            stackPos += value
        })
    })
    return body
}

function lineChartSvg(
    model: ChartModel,
    plot: {left: number; top: number; width: number; height: number},
    area: boolean
): string {
    const axisMax = maxValue(model)
    const x = (index: number) =>
        plot.left +
        (plot.width * (index + 0.5)) / Math.max(1, model.categories.length)
    const y = (value: number) =>
        plot.top + plot.height - (value / axisMax) * plot.height
    let body = ""
    model.series.forEach((series, serIndex) => {
        const color = COLORS[serIndex % COLORS.length]
        const points = series.values
            .map((value, index) =>
                value === null ? null : `${x(index)},${y(value)}`
            )
            .filter((point): point is string => point !== null)
        if (area && points.length > 1) {
            const baseline = `${x(0)},${plot.top + plot.height} ${points.join(" ")} ${x(series.values.length - 1)},${plot.top + plot.height}`
            body += `<polygon points="${baseline}" fill="${color}" fill-opacity="0.3"/>`
        }
        if (points.length > 1) {
            body += `<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="2"/>`
        }
        points.forEach(point => {
            const [px, py] = point.split(",")
            body += `<circle cx="${px}" cy="${py}" r="3" fill="${color}"/>`
        })
    })
    return body
}

function scatterChartSvg(
    model: ChartModel,
    plot: {left: number; top: number; width: number; height: number}
): string {
    const axisMax = maxValue(model)
    const x = (index: number) =>
        plot.left +
        (plot.width * (index + 0.5)) / Math.max(1, model.categories.length)
    const y = (value: number) =>
        plot.top + plot.height - (value / axisMax) * plot.height
    let body = ""
    model.series.forEach((series, serIndex) => {
        const color = COLORS[serIndex % COLORS.length]
        series.values.forEach((value, index) => {
            if (value !== null) {
                body += `<circle cx="${x(index)}" cy="${y(value)}" r="4" fill="${color}"/>`
            }
        })
    })
    return body
}

function pieChartSvg(
    model: ChartModel,
    dims: SvgDimensions,
    plot: {left: number; top: number; width: number; height: number}
): string {
    const series = model.series[0]
    if (!series) {
        return ""
    }
    const cx = plot.left + plot.width / 2
    const cy = plot.top + plot.height / 2
    const radius = Math.min(plot.width, plot.height) / 2 - 10
    const total = series.values.reduce<number>(
        (sum, value) => sum + Math.max(0, value || 0),
        0
    )
    if (total <= 0) {
        return ""
    }
    let angle = -Math.PI / 2
    let body = ""
    series.values.forEach((value, index) => {
        const slice = (Math.max(0, value || 0) / total) * Math.PI * 2
        if (slice <= 0) {
            return
        }
        const x1 = cx + radius * Math.cos(angle)
        const y1 = cy + radius * Math.sin(angle)
        const mid = angle + slice / 2
        const x2 = cx + radius * Math.cos(angle + slice)
        const y2 = cy + radius * Math.sin(angle + slice)
        const large = slice > Math.PI ? 1 : 0
        body += `<path d="M${cx},${cy} L${x1},${y1} A${radius},${radius} 0 ${large} 1 ${x2},${y2} Z" fill="${COLORS[index % COLORS.length]}"/>`
        body += svgText(
            cx + (radius + 14) * Math.cos(mid),
            cy + (radius + 14) * Math.sin(mid),
            `${model.categories[index] || index + 1} (${value})`,
            {anchor: mid > Math.PI / 2 || mid < -Math.PI / 2 ? "end" : "start", size: 10}
        )
        angle += slice
    })
    void dims
    return body
}

function axesAndLabels(
    model: ChartModel,
    plot: {left: number; top: number; width: number; height: number}
): string {
    let body = `<line x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${
        plot.top + plot.height
    }" stroke="#000"/><line x1="${plot.left}" y1="${
        plot.top + plot.height
    }" x2="${plot.left + plot.width}" y2="${plot.top + plot.height}" stroke="#000"/>`
    if (model.type === "pie") {
        return body
    }
    model.categories.forEach((category, index) => {
        if (model.horizontal) {
            body += svgText(
                plot.left - 6,
                plot.top +
                    (plot.height * (index + 0.5)) /
                        Math.max(1, model.categories.length) +
                    4,
                category,
                {anchor: "end"}
            )
        } else {
            body += svgText(
                plot.left +
                    (plot.width * (index + 0.5)) /
                        Math.max(1, model.categories.length),
                plot.top + plot.height + 16,
                category,
                {anchor: "middle"}
            )
        }
    })
    return body
}

function legendSvg(
    model: ChartModel,
    dims: SvgDimensions
): string {
    let body = ""
    model.series.forEach((series, index) => {
        const y = dims.height - 18 * (model.series.length - index)
        body += `<rect x="10" y="${y - 9}" width="10" height="10" fill="${COLORS[index % COLORS.length]}"/>`
        body += svgText(26, y, series.name)
    })
    return body
}

/** Render a chart model as a self-contained SVG string. */
export function chartModelToSvg(
    model: ChartModel,
    dims: SvgDimensions = DEFAULT_DIMENSIONS
): string {
    if (model.type === "unknown" || !model.series.length) {
        return tableModelToSvg(
            {
                title: model.title,
                columns: ["Category", ...model.series.map(s => s.name)],
                rows: model.categories.map((category, index) => [
                    category,
                    ...model.series.map(
                        series => String(series.values[index] ?? "")
                    )
                ])
            },
            dims
        )
    }
    const plot = {
        left: model.horizontal ? 120 : 60,
        top: model.title ? 40 : 20,
        width: dims.width - (model.horizontal ? 150 : 90),
        height:
            dims.height -
            (model.horizontal ? 50 : 90) -
            (model.title ? 20 : 0)
    }
    let body = ""
    if (model.title) {
        body += svgText(dims.width / 2, 24, model.title, {
            anchor: "middle",
            size: 16,
            weight: "bold"
        })
    }
    switch (model.type) {
        case "bar":
            body += barChartSvg(model, dims, plot)
            body += axesAndLabels(model, plot)
            break
        case "line":
        case "area":
            body += lineChartSvg(model, plot, model.type === "area")
            body += axesAndLabels(model, plot)
            break
        case "scatter":
            body += scatterChartSvg(model, plot)
            body += axesAndLabels(model, plot)
            break
        case "pie":
            body += pieChartSvg(model, dims, plot)
            break
        default:
            break
    }
    if (model.type !== "pie") {
        body += legendSvg(model, dims)
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg ${SVG_NS} width="${dims.width}" height="${dims.height}" viewBox="0 0 ${dims.width} ${dims.height}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`
}

/** Render a simple table (embedded spreadsheet snapshot, chart fallback). */
export function tableModelToSvg(
    table: TableModel,
    dims: SvgDimensions = {width: 600, height: 400}
): string {
    const columns = table.columns.length
        ? table.columns
        : table.rows[0]?.map((_, i) => `Column ${i + 1}`) || []
    const rows = table.rows
    const colWidth = Math.min(
        180,
        Math.max(60, (dims.width - 20) / Math.max(1, columns.length))
    )
    const rowHeight = 22
    let height = 20 + (table.title ? 24 : 0) + rowHeight * (rows.length + 1) + 10
    height = Math.min(Math.max(height, 60), Math.max(dims.height, 800))
    let body = ""
    if (table.title) {
        body += svgText(10, 20, table.title, {size: 15, weight: "bold"})
    }
    const top = table.title ? 34 : 12
    columns.forEach((column, index) => {
        const x = 10 + index * colWidth
        body += `<rect x="${x}" y="${top}" width="${colWidth}" height="${rowHeight}" fill="#dde5f0" stroke="#999"/>`
        body += svgText(x + 4, top + 15, column, {size: 11, weight: "bold"})
    })
    rows.forEach((row, rowIndex) => {
        const y = top + rowHeight * (rowIndex + 1)
        row.forEach((cell, colIndex) => {
            const x = 10 + colIndex * colWidth
            body += `<rect x="${x}" y="${y}" width="${colWidth}" height="${rowHeight}" fill="#fff" stroke="#bbb"/>`
            body += svgText(x + 4, y + 15, cell, {size: 11})
        })
    })
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg ${SVG_NS} width="${dims.width}" height="${height}" viewBox="0 0 ${dims.width} ${height}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`
}

/** A labelled placeholder box for content we can only preserve visually. */
export function placeholderSvg(
    title: string,
    lines: string[] = [],
    dims: SvgDimensions = {width: 480, height: 120}
): string {
    let body = `<rect x="1" y="1" width="${dims.width - 2}" height="${
        dims.height - 2
    }" fill="#f5f5f5" stroke="#888" stroke-dasharray="6 4" rx="6"/>`
    body += `<text x="${dims.width / 2}" y="30" font-family="sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#555">${escapeText(title)}</text>`
    lines.slice(0, 4).forEach((line, index) => {
        body += `<text x="${dims.width / 2}" y="${56 + index * 18}" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#777">${escapeText(line)}</text>`
    })
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg ${SVG_NS} width="${dims.width}" height="${dims.height}" viewBox="0 0 ${dims.width} ${dims.height}">${body}</svg>`
}

/**
 * Read the first worksheet of an xlsx file into a TableModel. Shared
 * strings and inline strings are supported — enough for snapshots of
 * embedded workbooks.
 */
export async function xlsxFirstSheetTable(
    data: ArrayBuffer
): Promise<TableModel | null> {
    const {default: JSZip} = await import("jszip")
    const zip = await JSZip.loadAsync(data)
    const sharedStrings: string[] = []
    const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string")
    if (sharedXml) {
        const sharedDoc = xmlDOM(sharedXml)
        sharedDoc
            .query("sst")!
            .queryAll("si")
            .forEach((si: XMLElement) => {
                sharedStrings.push(si.textContent)
            })
    }
    const workbookXml = await zip.file("xl/workbook.xml")?.async("string")
    let sheetName = "Sheet1"
    if (workbookXml) {
        const sheetEl = xmlDOM(workbookXml).query("sheet")
        sheetName = attr(sheetEl, "name") || sheetName
    }
    const sheetFiles = Object.keys(zip.files).filter(path =>
        /^xl\/worksheets\/sheet\d+\.xml$/.test(path)
    )
    sheetFiles.sort()
    const sheetXml = sheetFiles.length
        ? await zip.file(sheetFiles[0])!.async("string")
        : null
    if (!sheetXml) {
        return null
    }
    const sheet = xmlDOM(sheetXml)
    const rows: string[][] = []
    sheet.queryAll("row").forEach((row: XMLElement, rowIndex: number) => {
        if (rowIndex >= 50) {
            return
        }
        const cells: string[] = []
        row.queryAll("c").forEach((cell: XMLElement) => {
            const ref = attr(cell, "r")
            const colIndex = ref
                ? ref.charCodeAt(0) - 65
                : cells.length
            const type = attr(cell, "t")
            const value = cell.query("v")?.textContent ?? ""
            let text = value
            if (type === "s") {
                text = sharedStrings[parseInt(value)] ?? value
            } else if (type === "inlineStr") {
                text = cell.query("is")?.textContent ?? ""
            }
            cells[colIndex < 0 ? cells.length : colIndex] = text
        })
        rows.push(cells.map(cell => cell ?? ""))
    })
    if (!rows.length) {
        return null
    }
    return {title: sheetName, columns: [], rows}
}

/** Wrap an SVG string in a Blob with the SVG image mime type. */
export function svgToBlob(svg: string): Blob {
    return new Blob([svg], {type: "image/svg+xml"})
}
