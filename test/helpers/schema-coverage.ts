/**
 * Schema coverage helpers for the exporter/importer tests.
 *
 * The fixture document (test/exporter/fixtures/sample-doc.json) is meant to
 * exercise every node type and every attribute of the document schema so
 * that the export/import filters can be tested against the full range of
 * Fidus Writer content. These helpers diff the fixture against the live
 * schema so a schema extension fails the tests until the fixture and the
 * filters handle it.
 */

/**
 * Walk a Fidus document JSON (including nested footnote contents) and
 * collect the node types, node attributes, mark types and mark attributes
 * it exercises.
 */
export function collectCoverage(docJson) {
    const nodes = new Set()
    const nodeAttrs = new Map()
    const marks = new Set()
    const markAttrs = new Map()

    const addAttr = (map, type, name) => {
        const attrs = map.get(type) || new Set()
        attrs.add(name)
        map.set(type, attrs)
    }

    const walk = value => {
        if (Array.isArray(value)) {
            value.forEach(walk)
            return
        }
        if (!value || typeof value !== "object") {
            return
        }
        if (value.type) {
            nodes.add(value.type)
            Object.keys(value.attrs || {}).forEach(attr =>
                addAttr(nodeAttrs, value.type, attr)
            )
            ;(value.marks || []).forEach(mark => {
                marks.add(mark.type)
                Object.keys(mark.attrs || {}).forEach(attr =>
                    addAttr(markAttrs, mark.type, attr)
                )
            })
        }
        Object.values(value).forEach(walk)
    }
    walk(docJson)
    return {nodes, nodeAttrs, marks, markAttrs}
}

/**
 * Diff a fixture document against the schema. Returns the lists of missing
 * node types, node attributes ("type.attr"), mark types and mark attributes
 * — all expected to be empty for the comprehensive fixture.
 *
 * The doc node itself is exempt: its attributes are document settings that
 * the tests merge in at export time.
 */
export function coverageGaps(docJson, docSchema) {
    const coverage = collectCoverage(docJson)

    const missingNodes = []
    const missingNodeAttrs = []
    Object.entries(docSchema.nodes).forEach(([name, spec]) => {
        if (name === "doc") {
            return
        }
        if (!coverage.nodes.has(name)) {
            missingNodes.push(name)
            return
        }
        Object.keys(spec.attrs || {}).forEach(attr => {
            if (!(coverage.nodeAttrs.get(name) || new Set()).has(attr)) {
                missingNodeAttrs.push(`${name}.${attr}`)
            }
        })
    })

    const missingMarks = []
    const missingMarkAttrs = []
    Object.entries(docSchema.marks).forEach(([name, spec]) => {
        if (!coverage.marks.has(name)) {
            missingMarks.push(name)
            return
        }
        Object.keys(spec.attrs || {}).forEach(attr => {
            if (!(coverage.markAttrs.get(name) || new Set()).has(attr)) {
                missingMarkAttrs.push(`${name}.${attr}`)
            }
        })
    })

    return {missingNodes, missingNodeAttrs, missingMarks, missingMarkAttrs}
}
