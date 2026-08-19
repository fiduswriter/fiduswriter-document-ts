import {
    createHash
} from "node:crypto"
import {
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync
} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"
import JSZip from "jszip"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = join(__dirname, "..")

const MATHLIVE_ROOT = join(repoRoot, "node_modules", "mathlive")
const CSS_SRC = join(MATHLIVE_ROOT, "mathlive-static.css")
const FONTS_SRC_DIR = join(MATHLIVE_ROOT, "fonts")

const OUTPUT_DIR = join(repoRoot, "static-libs")
const CSS_OUT_DIR = join(OUTPUT_DIR, "css", "libs", "mathlive")
const CSS_OUT_FILE = join(CSS_OUT_DIR, "mathlive.css")
const FONTS_OUT_DIR = join(CSS_OUT_DIR, "media")
const ZIP_OUT_FILE = join(OUTPUT_DIR, "zip", "mathlive_style.zip")
const OPF_OUT_FILE = join(repoRoot, "src", "mathlive", "opf_includes.ts")
const CACHE_FILE = join(repoRoot, ".mathlive_bundle_cache.json")

interface FilePathEntry {
    path: string
    mimetype: string
}

function getMimeType(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase()
    if (ext === "css") {
        return "text/css"
    }
    if (ext === "woff") {
        return "font/woff"
    }
    if (ext === "woff2") {
        return "font/woff2"
    }
    return "application/octet-stream"
}

function calculateSourceHash(): string {
    const hasher = createHash("md5")
    hasher.update(readFileSync(CSS_SRC))
    for (const filename of readdirSync(FONTS_SRC_DIR)) {
        if (filename.startsWith(".")) {
            continue
        }
        hasher.update(readFileSync(join(FONTS_SRC_DIR, filename)))
    }
    return hasher.digest("hex")
}

function hasContentChanged(currentHash: string): boolean {
    try {
        const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"))
        if (cache.hash !== currentHash) {
            return true
        }
    } catch {
        return true
    }
    const requiredOutputs = [CSS_OUT_FILE, ZIP_OUT_FILE, OPF_OUT_FILE]
    for (const path of requiredOutputs) {
        try {
            statSync(path)
        } catch {
            return true
        }
    }
    return false
}

function saveHash(currentHash: string): void {
    writeFileSync(CACHE_FILE, JSON.stringify({hash: currentHash}, null, 2))
}

function cleanDirectory(dir: string): void {
    try {
        for (const entry of readdirSync(dir)) {
            const fullPath = join(dir, entry)
            rmSync(fullPath, {recursive: true})
        }
    } catch {
        // Directory may not exist yet
    }
    mkdirSync(dir, {recursive: true})
}

function copyFileWithTimestamp(src: string, dest: string): void {
    writeFileSync(dest, readFileSync(src))
    const stats = statSync(src)
    utimesSync(dest, stats.atime, stats.mtime)
}

function generateOpfEntries(filePaths: FilePathEntry[]): string {
    let opfText =
        "// This file is auto-generated. CHANGES WILL BE OVERWRITTEN! " +
        "Re-generate by running npm run bundle-mathlive.\n"
    opfText += "export const mathliveOpfIncludes = `\n"
    for (const [index, filePath] of filePaths.entries()) {
        opfText += `<item id="mathlive-${index}" href="css/${filePath.path}" media-type="${filePath.mimetype}" />\n`
    }
    opfText += "`"
    return opfText
}

async function createBundle(): Promise<void> {
    // Prepare output directories
    cleanDirectory(CSS_OUT_DIR)
    cleanDirectory(FONTS_OUT_DIR)
    mkdirSync(dirname(ZIP_OUT_FILE), {recursive: true})
    mkdirSync(dirname(OPF_OUT_FILE), {recursive: true})

    // Copy and rewrite CSS font paths
    const css = readFileSync(CSS_SRC, "utf-8")
    writeFileSync(CSS_OUT_FILE, css.replace(/url\(fonts\//g, "url(media/"))
    const cssStats = statSync(CSS_SRC)
    utimesSync(CSS_OUT_FILE, cssStats.atime, cssStats.mtime)

    // Copy font files
    for (const filename of readdirSync(FONTS_SRC_DIR).sort()) {
        if (filename.startsWith(".")) {
            continue
        }
        const src = join(FONTS_SRC_DIR, filename)
        copyFileWithTimestamp(src, join(FONTS_OUT_DIR, filename))
    }

    // Create zip
    const zip = new JSZip()
    const filePaths: FilePathEntry[] = []
    const cssMtime = cssStats.mtime
    // Explicitly create the media directory with a stable timestamp so JSZip
    // does not fall back to the current time for the implicit folder entry.
    zip.file("media/", null, {dir: true, date: cssMtime})
    const addToZip = (fullPath: string, zipPath: string) => {
        const stats = statSync(fullPath)
        zip.file(zipPath, readFileSync(fullPath), {date: stats.mtime})
        filePaths.push({path: zipPath, mimetype: getMimeType(zipPath)})
    }
    addToZip(CSS_OUT_FILE, "mathlive.css")
    for (const filename of readdirSync(FONTS_OUT_DIR).sort()) {
        if (filename.startsWith(".")) {
            continue
        }
        addToZip(join(FONTS_OUT_DIR, filename), `media/${filename}`)
    }
    const zipBuffer = await zip.generateAsync({type: "nodebuffer"})
    writeFileSync(ZIP_OUT_FILE, zipBuffer)

    // Generate OPF includes
    writeFileSync(OPF_OUT_FILE, generateOpfEntries(filePaths))
}

function main(force = false): void {
    console.log("Bundling MathLive")
    let currentHash: string
    try {
        currentHash = calculateSourceHash()
    } catch (_error) {
        console.warn(
            "MathLive source files not found. Skipping bundle creation. Run npm install first."
        )
        process.exit(1)
    }

    if (force || hasContentChanged(currentHash)) {
        createBundle()
            .then(() => {
                saveHash(currentHash)
                console.log("MathLive bundle updated.")
            })
            .catch(error => {
                console.error("Failed to create MathLive bundle:", error)
                process.exit(1)
            })
    } else {
        console.log("MathLive bundle is up to date. Skipping.")
    }
}

const forceFlag = process.argv.includes("--force")
main(forceFlag)
