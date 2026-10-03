import {describe, expect, it} from "@jest/globals"

import {
    DEFAULT_PRINT_ENGINE,
    getPrintEngine,
    registerPrintEngine
} from "../../src/exporter/print/engines/registry.js"
import type {PrintEngine} from "../../src/exporter/print/engines/types.js"

const makeEngine = (name: string): PrintEngine => ({
    name: name as PrintEngine["name"],
    preparePagination: () =>
        Promise.resolve({win: {} as Window, cleanup: () => undefined}),
    print: () => Promise.resolve(),
    backend: {pageSelector: ".test-page", filterEmptyPages: false,
        scaleRunsToMeasuredWidth: false, handleHyphenation: false}
})

describe("Print engine registry", () => {
    it("falls back to the default engine", () => {
        expect(DEFAULT_PRINT_ENGINE).toEqual("paginate-for-print")
        expect(getPrintEngine().name).toEqual("paginate-for-print")
        expect(getPrintEngine("paginate-for-print").name).toEqual(
            "paginate-for-print"
        )
    })

    it("falls back to the default engine when an unknown engine is requested", () => {
        expect(getPrintEngine("does-not-exist").name).toEqual(
            "paginate-for-print"
        )
    })

    it("returns registered engines", () => {
        const engine = makeEngine("test-engine")
        registerPrintEngine(engine)
        expect(getPrintEngine("test-engine")).toBe(engine)
    })
})
