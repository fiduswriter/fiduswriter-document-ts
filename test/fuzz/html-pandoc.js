// Fuzz harness for the HTML and Pandoc-JSON importers.
//
// HTML: pasted/served content of arbitrary origin; Pandoc JSON: the AST
// produced by external pandoc versions. Both are untrusted structured
// input parsed into the document model.
//
// Invariants: imports resolve with a structured result or reject with a
// catchable Error, never hang, and a successful parse produces a document
// object.

import "../setup.js"

import {readFileSync} from "node:fs"
import {join, dirname} from "node:path"
import {fileURLToPath} from "node:url"

import {fc, runHarness} from "./config.js"
import {makeRng} from "./rng.js"

const here = dirname(fileURLToPath(import.meta.url))

const {HtmlImporter} = await import("../../dist/importer/html/index.js")
const {PandocImporter} = await import("../../dist/importer/pandoc/index.js")

const backend = {
    createDoc: async () => ({id: 1, path: ""}),
    saveImages: async () => ({}),
    saveDocument: async () => ({})
}
const user = {id: 1, username: "fuzzer", is_authenticated: true}
const template = {
    content: {
        type: "doc",
        content: [
            {type: "title", content: [{type: "text", text: "Title"}]},
            {
                type: "richtext_part",
                attrs: {id: "body", title: "Body"},
                content: [{type: "paragraph"}]
            }
        ]
    },
    document_styles: [],
    export_templates: []
}
const getTemplate = async () => template

const HTML_SEED = readFileSync(
    join(here, "..", "importer", "fixtures", "comprehensive-test.html"),
    "utf8"
)

const HTML_ATTACKS = [
    "<div>",
    "</div>",
    "<p",
    "<table><tr><td>",
    "<math>",
    "<img src=x>",
    "<script>",
    "<style>",
    "<!--",
    "-->",
    "&#x110000;",
    "\x00",
    "class=\"c",
    "<span dir=rtl>",
    "href=\"#",
    "<h0>",
    "<li value=999999999999>"
]

const PANDOC_ATTACKS = [
    {t: "bogus_block"},
    {t: "Para", c: null},
    {t: "Para"},
    {t: "Para", c: []},
    {t: "Str", c: 42},
    {t: "Table", c: []},
    {t: "Math", c: ["", null]},
    {t: "Image", c: [["", [], []], [], ["", ""]]},
    null,
    "string-instead-of-object",
    42,
    [],
    {t: "Div", c: [["x", ["cls"], []], [{t: "Div", c: [["y", [], []], [{t: "Div"}]]}]]}
]

function mutatedHtml(rng) {
    if (rng.bool()) {
        return HTML_SEED
    }
    let html = HTML_SEED
    const count = rng.int(1, 5)
    for (let i = 0; i < count; i++) {
        const pos = rng.int(0, html.length)
        const fragment = HTML_ATTACKS[rng.int(0, HTML_ATTACKS.length - 1)]
        html = html.slice(0, pos) + fragment + html.slice(pos)
    }
    return html
}

async function importWithTimeout(importer) {
    const timeout = new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("import timed out")), 20000)
    )
    try {
        await Promise.race([importer.init(), timeout])
    } catch (error) {
        if (error.message === "import timed out") {
            throw error
        }
        if (!(error instanceof Error)) {
            throw new Error(`import rejected with a non-Error: ${String(error)}`)
        }
        return false // catchable rejection: acceptable
    }
    if (!importer.output.ok) {
        return false
    }
    if (typeof importer.output.doc !== "object" || !importer.output.doc) {
        throw new Error(
            `importer reported ok without a document (statusText: ${importer.output.statusText})`
        )
    }
    return true
}

const htmlProp = fc.asyncProperty(
    fc.integer({min: 1, max: 2 ** 31 - 1}),
    async seed => {
        const rng = makeRng(seed)
        const html = mutatedHtml(rng)
        const importer = new HtmlImporter(new Blob([html]), user, "", null, {
            getTemplate,
            nativeBackend: backend
        })
        await importWithTimeout(importer)
    }
)

function mutatePandocAst(ast, rng, depth = 0) {
    if (depth > 3 || typeof ast !== "object" || ast === null) {
        return rng.pick(PANDOC_ATTACKS)
    }
    if (Array.isArray(ast)) {
        if (!ast.length || rng.bool()) {
            return ast
        }
        const index = rng.int(0, ast.length - 1)
        const copy = [...ast]
        copy[index] = mutatePandocAst(copy[index], rng, depth + 1)
        return copy
    }
    const copy = {...ast}
    if (copy.blocks && rng.bool()) {
        const index = rng.int(0, copy.blocks.length - 1)
        copy.blocks[index] = rng.pick(PANDOC_ATTACKS)
    } else if (copy.c && rng.bool()) {
        if (Array.isArray(copy.c) && copy.c.length) {
            const index = rng.int(0, copy.c.length - 1)
            copy.c[index] = mutatePandocAst(copy.c[index], rng, depth + 1)
        } else {
            copy.c = rng.pick(PANDOC_ATTACKS)
        }
    } else {
        copy.t = rng.pick(["Para", "Str", "Bogus", null])
    }
    return copy
}

const PANDOC_SEED = {
    "pandoc-api-version": [1, 23, 1],
    meta: {title: {t: "MetaInlines", c: [{t: "Str", c: "Fuzzed"}]}},
    blocks: [
        {t: "Header", c: [1, ["sec", [], []], [{t: "Str", c: "Section"}]]},
        {
            t: "Para",
            c: [
                {t: "Strong", c: [{t: "Str", c: "bold"}]},
                {t: "Space"},
                {t: "Str", c: "text"},
                {t: "Math", c: [{t: "DisplayMath"}, "x^2"]},
                {
                    t: "Image",
                    c: [["fig", [], []], [], ["img.png", "caption"]]
                }
            ]
        },
        {
            t: "OrderedList",
            c: [[1, {t: "Decimal"}, {t: "Period"}], [[{t: "Plain", c: [{t: "Str", c: "one"}]}]]]
        },
        {
            t: "Div",
            c: [["d", ["cls"], []], [{t: "Para", c: [{t: "Emph", c: [{t: "Str", c: "inner"}]}]}]]
        }
    ]
}

const pandocProp = fc.asyncProperty(
    fc.integer({min: 1, max: 2 ** 31 - 1}),
    async seed => {
        const rng = makeRng(seed)
        const ast = mutatePandocAst(PANDOC_SEED, rng)
        const importer = new PandocImporter(
            new Blob([JSON.stringify(ast)]),
            user,
            "",
            null,
            {
                getTemplate,
                nativeBackend: backend,
                importBibliography: async () => ({})
            }
        )
        await importWithTimeout(importer)
    }
)

runHarness("html-pandoc", [
    {label: "mutated HTML imports safely", prop: htmlProp},
    {label: "mutated Pandoc AST imports safely", prop: pandocProp}
])
