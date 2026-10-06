/**
 * Typst validation helpers for the exporter tests.
 *
 * `expectCompilesWithTypst` compiles an exported Typst document with the
 * Typst CLI — the compiler is the format's reference implementation, so a
 * successful compile proves the output is syntactically and semantically
 * valid Typst. The typst binary must be installed (see
 * https://github.com/typst/typst); the test fails with an explanatory
 * message when it is missing.
 */
import {execFileSync} from "node:child_process"
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {homedir, tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {deflateSync} from "node:zlib"

let typstPath: string | false | undefined

/** Resolve the typst binary: PATH first, then common install locations. */
function resolveTypst(): string | false {
    if (typstPath !== undefined) {
        return typstPath
    }
    try {
        execFileSync("typst", ["--version"], {stdio: "pipe"})
        typstPath = "typst"
        return typstPath
    } catch {
        /* not on PATH */
    }
    for (const candidate of [
        join(homedir(), ".local", "bin", "typst"),
        "/usr/local/bin/typst",
        "/opt/typst/typst"
    ]) {
        if (existsSync(candidate)) {
            typstPath = candidate
            return typstPath
        }
    }
    typstPath = false
    return typstPath
}

/** A minimal valid 1x1 PNG used as a placeholder for exported images. */
function onePixelPng(): Buffer {
    const crcTable = Array.from({length: 256}, (_, index) => {
        let crc = index
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
        }
        return crc >>> 0
    })
    const chunk = (type: string, data: Buffer): Buffer => {
        const length = Buffer.alloc(4)
        length.writeUInt32BE(data.length)
        const body = Buffer.concat([Buffer.from(type), data])
        let crc = 0xffffffff
        for (const byte of body) {
            crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
        }
        const crcOut = Buffer.alloc(4)
        crcOut.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
        return Buffer.concat([length, body, crcOut])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(1, 0)
    ihdr.writeUInt32BE(1, 4)
    ihdr[8] = 8
    ihdr[9] = 2
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))),
        chunk("IEND", Buffer.alloc(0))
    ])
}

/**
 * Assert that an exported Typst document compiles. `bibliography` is the
 * BibLaTeX source referenced by `#bibliography("bibliography.bib")`.
 * Placeholder PNGs are created for every `image("images/…")` reference.
 */
export function expectCompilesWithTypst(
    typst: string,
    bibliography?: string
): void {
    const typstBinary = resolveTypst()
    if (typstBinary === false) {
        throw new Error(
            "The typst binary is required for the Typst compile check. " +
                "Install it from https://github.com/typst/typst to run the " +
                "Typst exporter tests."
        )
    }
    const workDir = mkdtempSync(join(tmpdir(), "fidus-typst-export-"))
    try {
        writeFileSync(join(workDir, "document.typ"), typst)
        if (bibliography !== undefined) {
            writeFileSync(join(workDir, "bibliography.bib"), bibliography)
        }
        const png = onePixelPng()
        for (const match of typst.matchAll(/image\("images\/([^"]+)"/g)) {
            const imagePath = join(workDir, "images", match[1])
            mkdirSync(dirname(imagePath), {recursive: true})
            writeFileSync(imagePath, png)
        }
        execFileSync(
            typstBinary,
            ["compile", "document.typ", "output.pdf"],
            {cwd: workDir, stdio: ["pipe", "pipe", "pipe"]}
        )
    } catch (error) {
        const failure = error as {stderr?: Buffer}
        const detail = failure.stderr?.toString().trim()
        throw new Error(
            `Exported Typst fails to compile:\n${detail || "unknown typst failure"}`
        )
    } finally {
        rmSync(workDir, {recursive: true, force: true})
    }
}
