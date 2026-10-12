// Structure-aware random Fidus Writer document generator.
//
// Produces JSON that nodeFromJSON accepts into the real docSchema, covering
// the node types the editor manipulates: title, parts, paragraphs, headings,
// lists, blockquotes, figures, tables, footnotes, equations, citations,
// cross references, plus comment/annotation/anchor and track-change marks.
//
// The generator is deliberately conservative: documents are *valid* per the
// schema. Invalid documents are covered by the importers' fuzzers and by
// mutated step JSON in the collab harness — through its normal API the editor
// must never be able to *reach* an invalid document, which is exactly what
// the harnesses assert.

import {docSchema} from "../../dist/schema/document/index.js"

// Text material that exercises position arithmetic: BMP text, astral-plane
// characters (surrogate pairs), combining marks, ZWJ sequences, RTL runs.
const TEXT_ATOMS = [
    "a",
    "word",
    "Hello",
    " ",
    "é",
    "ü",
    "Ω",
    "ж",
    "中",
    "日",
    "😀",
    "👍",
    "e\u0301", // combining acute accent
    "👩‍🔬", // ZWJ sequence
    "עברית", // RTL
    "—",
    "…"
]

const INLINE_MARKS = ["strong", "em", "underline", "link", "sup", "sub", "code"]
const ANNOTATION_MARKS = ["comment", "annotation_tag", "anchor"]

// Seeded deterministic decisions inside fc .map/.chain combinators, so that a
// shrunk integer seed reproduces the same document.
export function makeRng(seed) {
    let state = seed >>> 0 || 1
    return {
        int(min, max) {
            state = (state * 1664525 + 1013904223) >>> 0
            return min + (state % (max - min + 1))
        },
        bool() {
            return this.int(0, 1) === 1
        },
        pick(items) {
            return items[this.int(0, items.length - 1)]
        }
    }
}

export function randomText(rng) {
    return Array.from({length: rng.int(0, 8)}, () => rng.pick(TEXT_ATOMS)).join(
        ""
    )
}

function markAttrs(markName, rng) {
    switch (markName) {
        case "comment":
            return {id: rng.int(1, 8)}
        case "annotation_tag":
            return {
                type: "fuzz",
                key: "k" + rng.int(0, 4),
                value: "v" + rng.int(0, 4)
            }
        case "anchor":
            return {id: "anchor" + rng.int(0, 4)}
        case "link":
            return {href: "https://example.com/" + rng.int(0, 9)}
        default:
            return {}
    }
}

// Route a candidate mark list through ProseMirror's own exclusion rules
// (same-group marks exclude each other unless excludes: ""; code/link
// exclude themselves), returning a valid ordered JSON mark list.
function resolveMarks(schema, candidates) {
    const set = []
    for (const cand of candidates) {
        const type = schema.marks[cand.type]
        if (!type) {
            continue
        }
        const mark = type.create(cand.attrs || {})
        set.push(mark)
    }
    // addToSet implements exactly the exclusion rules Node.check enforces.
    let reduced = []
    for (const mark of set) {
        reduced = mark.addToSet(reduced)
    }
    return reduced.map(mark => {
        const json = {type: mark.type.name}
        const attrsJson = mark.type.attrs ? mark.toJSON().attrs : undefined
        if (attrsJson) {
            json.attrs = attrsJson
        }
        return json
    })
}

function textRun(rng, opts) {
    const text = randomText(rng)
    if (!text) {
        return null
    }
    const candidates = [...new Set(
        Array.from({length: rng.int(0, 2)}, () => rng.pick(INLINE_MARKS))
    )].map(name => ({type: name, attrs: markAttrs(name, rng)}))
    if (opts.annotations && rng.bool()) {
        const markName = rng.pick(ANNOTATION_MARKS)
        candidates.push({type: markName, attrs: markAttrs(markName, rng)})
    }
    if (opts.track && rng.bool()) {
        const user = rng.int(1, 3)
        const trackName = rng.pick(["insertion", "deletion", "format_change"])
        const trackAttrs = {
            user,
            username: "user" + user,
            date: 1755000000000
        }
        if (trackName === "insertion") {
            trackAttrs.approved = rng.bool()
        } else if (trackName === "format_change") {
            trackAttrs.before = rng.bool() ? ["strong"] : []
            trackAttrs.after = rng.bool() ? ["em"] : []
        }
        candidates.push({type: trackName, attrs: trackAttrs})
    }
    return {type: "text", text, marks: resolveMarks(docSchema, candidates)}
}

function inlineContent(rng, opts) {
    const runs = []
    const count = rng.int(0, 5)
    for (let i = 0; i < count; i++) {
        switch (rng.int(0, 5)) {
            case 0:
            case 1: {
                const run = textRun(rng, opts)
                if (run) {
                    runs.push(run)
                }
                break
            }
            case 2: {
                // footnote with nested block content
                const blocks = []
                for (let j = 0, len = rng.int(1, 3); j < len; j++) {
                    const fnText = randomText(rng)
                    blocks.push({
                        type: "paragraph",
                        content: fnText ? [{type: "text", text: fnText}] : []
                    })
                }
                runs.push({type: "footnote", attrs: {footnote: blocks}})
                break
            }
            case 3: {
                const references = []
                for (let j = 0, len = rng.int(1, 3); j < len; j++) {
                    references.push({id: j + 1})
                }
                runs.push({
                    type: "citation",
                    attrs: {
                        format: rng.pick(["autocite", "textcite"]),
                        references
                    }
                })
                break
            }
            case 4:
                runs.push({
                    type: "equation",
                    attrs: {equation: rng.pick(["x^2", "\\frac{1}{2}", "E=mc^2"])}
                })
                break
            case 5:
                runs.push({type: "hard_break"})
                break
        }
    }
    return runs
}

function blockJson(rng, opts) {
    switch (rng.int(0, 8)) {
        case 0:
            return {type: "paragraph", content: inlineContent(rng, opts)}
        case 1: {
            const level = rng.int(1, 6)
            const text = randomText(rng)
            return {
                type: "heading" + level,
                content: text ? [{type: "text", text}] : []
            }
        }
        case 2:
            return {
                type: rng.pick(["bullet_list", "ordered_list"]),
                content: Array.from({length: rng.int(1, 3)}, () => ({
                    type: "list_item",
                    content: [{type: "paragraph", content: inlineContent(rng, opts)}]
                }))
            }
        case 3:
            return {
                type: "table",
                content: [
                    {
                        type: "table_caption",
                        content: []
                    },
                    {
                        type: "table_body",
                        content: Array.from({length: rng.int(1, 3)}, () => ({
                            type: "table_row",
                            content: Array.from({length: rng.int(1, 3)}, () => ({
                                type: "table_cell",
                                content: [{type: "paragraph", content: inlineContent(rng, opts)}]
                            }))
                        }))
                    }
                ]
            }
        case 4:
            return {
                type: "figure",
                attrs: {category: "figure", caption: true},
                content: [
                    {type: "image", attrs: {image: rng.int(1, 3)}},
                    {
                        type: "figure_caption",
                        content: inlineContent(rng, opts)
                    }
                ]
            }
        case 5:
            return {
                type: "code_block",
                attrs: {language: "python", category: "listing"},
                content: [{type: "text", text: "def x():\n    pass"}]
            }
        case 6:
            return {
                type: "blockquote",
                content: [{type: "paragraph", content: inlineContent(rng, opts)}]
            }
        case 7:
            return {type: "horizontal_rule"}
        case 8:
            // figure_equation has no group, so it can only appear inside a
            // figure — emit a figure wrapping it instead.
            return {
                type: "figure",
                attrs: {category: "equation", caption: true},
                content: [
                    {type: "figure_equation", attrs: {equation: "x + y"}},
                    {type: "figure_caption", content: inlineContent(rng, opts)}
                ]
            }
    }
}

// The main entry: an fc Arbitrary producing {json, doc, seed}. `doc` is a
// checked docSchema Node. The integer seed drives all structural decisions
// (so shrinking small seeds produces small documents); the fc string drives
// the title text.
export function docArb(fc, options = {}) {
    const opts = {
        annotations: true,
        track: true,
        minParts: 1,
        maxParts: 2,
        ...options
    }
    return fc
        .tuple(fc.integer({min: 1, max: 2 ** 31 - 1}), fc.string({maxSize: 12}))
        .map(([seed, title]) => {
            const rng = makeRng(seed)
            const parts = []
            for (let i = 0, len = rng.int(opts.minParts, opts.maxParts); i < len; i++) {
                const blocks = []
                for (let j = 0, blockCount = rng.int(1, 4); j < blockCount; j++) {
                    blocks.push(blockJson(rng, opts))
                }
                parts.push({
                    type: "richtext_part",
                    attrs: {id: "part" + i, title: "Part " + i},
                    content: blocks
                })
            }
            const json = {
                type: "doc",
                attrs: {template: "Fuzz"},
                content: [
                    {
                        type: "title",
                        content: title ? [{type: "text", text: title}] : []
                    },
                    ...parts
                ]
            }
            const doc = docSchema.nodeFromJSON(json)
            doc.check()
            return {json, doc, seed}
        })
}

// Paragraph JSON mixing comment/annotation marks and track marks — the seed
// corpus for the comments and track harnesses.
export function paragraphWithMarksArb(fc) {
    return fc.integer({min: 1, max: 2 ** 31 - 1}).map(seed => {
        const rng = makeRng(seed)
        const runs = []
        for (let i = 0, len = rng.int(1, 5); i < len; i++) {
            const run = textRun(rng, {annotations: true, track: true})
            if (run) {
                runs.push(run)
            }
        }
        return {
            seed,
            json: {type: "paragraph", content: runs}
        }
    })
}
