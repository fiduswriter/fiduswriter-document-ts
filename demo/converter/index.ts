import JSZip from "jszip"
import {initSettings} from "fwtoolkit"

// Configure staticUrl so that asset paths like "css/document/document.css" are
// resolved relative to the demo root rather than the converter/ subdirectory.
// apiUrl is set to an identity function and getCsrfToken returns an empty
// string so that the DOCX/ODT exporters can use fwtoolkit's get() to fetch
// template files without a backend.
initSettings({
    staticUrl: (path: string) => `../${path}`,
    apiUrl: (url: string) => url,
    getCsrfToken: () => ""
})

import {createCSL} from "citeproc-plus"

import {JATSExporter} from "../../dist/exporter/jats/index.js"
import {HTMLExporter} from "../../dist/exporter/html/index.js"
import {LatexExporter} from "../../dist/exporter/latex/index.js"
import {PandocExporter} from "../../dist/exporter/pandoc/index.js"
import {EpubExporter} from "../../dist/exporter/epub/index.js"
import {DOCXExporter} from "../../dist/exporter/docx/index.js"
import {ODTExporter} from "../../dist/exporter/odt/index.js"

import apaStyle from "../../test/fixtures/csl/apa.json"
import chicagoStyle from "../../test/fixtures/csl/chicago-author-date.json"
import ieeeStyle from "../../test/fixtures/csl/ieee.json"

import sampleDoc from "../sample-doc.json"

const STYLE_MAP = {
    apa: apaStyle,
    "chicago-author-date": chicagoStyle,
    ieee: ieeeStyle
}

// Default template files are served alongside this page.
const DEFAULT_DOCX_TEMPLATE = "./Classic.docx"
const DEFAULT_ODT_TEMPLATE = "./Free.odt"

const docJsonEl = document.getElementById("doc-json") as HTMLTextAreaElement
const bibJsonEl = document.getElementById("bib-json") as HTMLTextAreaElement
const styleSelect = document.getElementById("style-select") as HTMLSelectElement
const docxTemplateInput = document.getElementById(
    "docx-template"
) as HTMLInputElement
const odtTemplateInput = document.getElementById(
    "odt-template"
) as HTMLInputElement
const logEl = document.getElementById("log")!

const sampleBibDB = {
    db: {
        1: {
            bib_type: "article-journal",
            entry_key: "doe2024",
            fields: {
                title: [{type: "text", text: "An example article"}],
                journaltitle: [
                    {type: "text", text: "Journal of Examples"}
                ],
                author: [
                    {
                        family: [{type: "text", text: "Doe"}],
                        given: [{type: "text", text: "John"}]
                    }
                ],
                date: "2024",
                volume: [{type: "text", text: "7"}],
                issue: [{type: "text", text: "3"}],
                pages: [
                    [
                        [{type: "text", text: "1"}],
                        [{type: "text", text: "10"}]
                    ]
                ]
            }
        }
    }
}

docJsonEl.value = JSON.stringify(sampleDoc, null, 2)
bibJsonEl.value = JSON.stringify(sampleBibDB, null, 2)

// Create one CSL instance up front (styles are pre-loaded objects, so the
// returned promise resolves immediately in a browser context).
const cslPromise = createCSL(STYLE_MAP)

function getExportDoc() {
    const fidusDoc = JSON.parse(docJsonEl.value)
    return {
        id: "demo",
        title: "Demo Document",
        content: fidusDoc,
        settings: Object.assign({}, fidusDoc.attrs || {})
    }
}

function getBibDB() {
    try {
        return JSON.parse(bibJsonEl.value)
    } catch {
        return sampleBibDB
    }
}

/**
 * Return the template URL to pass to an exporter.
 * If the user has selected a file via the given input, an object URL is
 * created for it and a cleanup function is returned so the caller can revoke
 * it once the export finishes.  Otherwise the bundled default URL is used.
 */
function getTemplateUrl(
    input: HTMLInputElement,
    defaultUrl: string
): {url: string; revoke: (() => void) | null} {
    const file = input.files?.[0]
    if (file) {
        const url = URL.createObjectURL(file)
        return {url, revoke: () => URL.revokeObjectURL(url)}
    }
    return {url: defaultUrl, revoke: null}
}

function log(msg: string) {
    logEl.textContent = msg
}

const emptyImageDB = {db: {}}

document.getElementById("export-jats")!.addEventListener("click", async () => {
    const doc = getExportDoc()
    doc.settings.citationstyle = styleSelect.value
    const exporter = new JATSExporter(
        doc,
        getBibDB(),
        emptyImageDB,
        await cslPromise,
        new Date(),
        "article"
    )
    exporter.init().then(() => log("JATS export downloaded."))
})

document.getElementById("export-html")!.addEventListener("click", async () => {
    const doc = getExportDoc()
    doc.settings.citationstyle = styleSelect.value
    const exporter = new HTMLExporter(
        doc,
        getBibDB(),
        emptyImageDB,
        await cslPromise,
        new Date(),
        []
    )
    exporter.init().then(() => log("HTML export downloaded."))
})

document.getElementById("export-latex")!.addEventListener("click", async () => {
    const doc = getExportDoc()
    const exporter = new LatexExporter(
        doc,
        getBibDB(),
        emptyImageDB,
        new Date()
    )
    exporter.init().then(() => log("LaTeX export downloaded."))
})

document
    .getElementById("export-pandoc")!
    .addEventListener("click", async () => {
        const doc = getExportDoc()
        doc.settings.citationstyle = styleSelect.value
        const exporter = new PandocExporter(
            doc,
            getBibDB(),
            emptyImageDB,
            await cslPromise,
            new Date()
        )
        exporter.init().then(() => log("Pandoc JSON export downloaded."))
    })

document.getElementById("export-epub")!.addEventListener("click", async () => {
    const doc = getExportDoc()
    doc.settings.citationstyle = styleSelect.value
    const exporter = new EpubExporter(
        doc,
        getBibDB(),
        emptyImageDB,
        await cslPromise,
        new Date(),
        []
    )
    exporter.init().then(() => log("EPUB export downloaded."))
})

document.getElementById("export-docx")!.addEventListener("click", async () => {
    const doc = getExportDoc()
    doc.settings.citationstyle = styleSelect.value
    const {url, revoke} = getTemplateUrl(docxTemplateInput, DEFAULT_DOCX_TEMPLATE)
    const exporter = new DOCXExporter(
        doc,
        url,
        getBibDB(),
        emptyImageDB,
        await cslPromise
    )
    exporter
        .init()
        .then(() => {
            revoke?.()
            log("DOCX export downloaded.")
        })
        .catch((err: unknown) => {
            revoke?.()
            log(`DOCX export failed: ${err}`)
        })
})

document.getElementById("export-odt")!.addEventListener("click", async () => {
    const doc = getExportDoc()
    doc.settings.citationstyle = styleSelect.value
    const {url, revoke} = getTemplateUrl(odtTemplateInput, DEFAULT_ODT_TEMPLATE)
    const exporter = new ODTExporter(
        doc,
        url,
        getBibDB(),
        emptyImageDB,
        await cslPromise
    )
    exporter
        .init()
        .then(() => {
            revoke?.()
            log("ODT export downloaded.")
        })
        .catch((err: unknown) => {
            revoke?.()
            log(`ODT export failed: ${err}`)
        })
})

document
    .getElementById("export-native")!
    .addEventListener("click", () => {
        const doc = getExportDoc()
        const bibDB = getBibDB()
        const zip = new JSZip()
        zip.file("document.json", JSON.stringify(doc.content))
        zip.file("bibliography.json", JSON.stringify(bibDB.db))
        zip.file("images.json", "{}")
        zip.generateAsync({type: "blob"}).then(blob => {
            const a = document.createElement("a")
            a.href = URL.createObjectURL(blob)
            a.download = "document.fidus"
            a.click()
            log("Native Fidus export downloaded.")
        })
    })
