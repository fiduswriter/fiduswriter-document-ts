/**
 * TEI validation helpers for the exporter tests.
 *
 * Every TEI document the exporter produces in tests should pass
 * `expectValidTei`: it asserts the document is well-formed XML (pure
 * JavaScript, always enforced) and that it validates against the official
 * TEI P5 "all plus" RelaxNG schema (vendored as
 * `test/exporter/fixtures/tei_allPlus.rng`, enforced through `xmllint` —
 * install libxml2's xmllint to run these checks).
 */
import {execFileSync} from "node:child_process"
import {existsSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import {DOMParser} from "@xmldom/xmldom"

const dir = dirname(fileURLToPath(import.meta.url))

const SCHEMA_PATH = join(dir, "..", "exporter", "fixtures", "tei_allPlus.rng")

let xmllintAvailable: boolean | undefined

function hasXmllint(): boolean {
    if (xmllintAvailable === undefined) {
        try {
            execFileSync("xmllint", ["--version"], {stdio: "pipe"})
            xmllintAvailable = true
        } catch {
            xmllintAvailable = false
        }
    }
    return xmllintAvailable
}

/**
 * Assert that an exported TEI document is well-formed and (when xmllint is
 * installed) schema-valid. Throws with the validator output on failure.
 */
export function expectValidTei(xml: string): void {
    // Well-formedness — xmldom raises on fatal parse errors.
    try {
        new DOMParser().parseFromString(xml, "text/xml")
    } catch (error) {
        throw new Error(
            `Exported TEI is not well-formed XML: ${(error as Error).message}`
        )
    }

    if (!hasXmllint()) {
        throw new Error(
            "xmllint (libxml2) is required for the TEI schema validity check. " +
                "Install xmllint to run the TEI exporter tests."
        )
    }
    if (!existsSync(SCHEMA_PATH)) {
        throw new Error(`TEI schema fixture not found: ${SCHEMA_PATH}`)
    }
    try {
        execFileSync(
            "xmllint",
            ["--relaxng", SCHEMA_PATH, "--noout", "-"],
            {input: xml, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"]}
        )
    } catch (error) {
        const failure = error as {stderr?: Buffer; status?: number}
        const detail = failure.stderr?.toString().trim()
        throw new Error(
            `Exported TEI fails to validate against the TEI P5 schema ` +
                `(tei_allPlus.rng):\n${detail || "unknown xmllint failure"}`
        )
    }
}