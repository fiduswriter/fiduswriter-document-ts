/**
 * Refreshes the vendored PDF-export assets in static-libs/ from the npm
 * dependencies that ship them:
 *
 *   paged/paged.polyfill.js  ← paginate-for-print/dist/paginate.polyfill.js
 *   icc/*                    ← pages-to-pdf/public/icc/
 *   woff2/woff2.wasm         ← pages-to-pdf/public/woff2/
 *   fonts/*                  ← pages-to-pdf/public/fonts/
 *
 * static-libs/ is generated, not committed to git: it is recreated by this
 * script as part of `prepare`/`prepublishOnly` from the versions of the
 * pagination packages installed at build time, and ships in the published
 * npm package (see the `files` field).
 */
import {copyFileSync, existsSync, mkdirSync, readdirSync, cpSync} from "node:fs"
import path from "node:path"
import {createRequire} from "node:module"

const require = createRequire(import.meta.url)

function packageDir(dep) {
    // The packages' exports maps do not expose ./package.json, so resolve
    // the main entry and walk up two levels (…/<pkg>/<main>).
    const entry = require.resolve(dep)
    return path.dirname(path.dirname(entry))
}

function assertExists(target) {
    if (!existsSync(target)) {
        throw new Error(`Missing asset source: ${target}`)
    }
}

// The polyfill was renamed from `paged.polyfill.js` to
// `paginate.polyfill.js` in paginate-for-print 1.1.1; accept both names.
const POLYFILL_NAMES = ["paginate.polyfill.js", "paged.polyfill.js"]

function resolvePolyfill(distDir) {
    for (const name of POLYFILL_NAMES) {
        const candidate = path.join(distDir, name)
        if (existsSync(candidate)) {
            return candidate
        }
    }
    throw new Error(
        `Missing asset source: none of ${POLYFILL_NAMES.join(", ")} in ${distDir}`
    )
}

function copyFile(from, to) {
    assertExists(from)
    mkdirSync(path.dirname(to), {recursive: true})
    copyFileSync(from, to)
    console.log(`synced ${to}`)
}

function copyDir(from, to) {
    assertExists(from)
    cpSync(from, to, {recursive: true, force: true})
    console.log(`synced ${to}`)
}

const pagedDist = packageDir("paginate-for-print")
const pagesToPdf = packageDir("pages-to-pdf")

// Vendored under its historic name: staticUrl("paged/paged.polyfill.js") is
// part of this package's contract with the apps serving static-libs/.
copyFile(
    resolvePolyfill(path.join(pagedDist, "dist")),
    path.join("static-libs", "paged", "paged.polyfill.js")
)
copyDir(path.join(pagesToPdf, "public", "icc"), path.join("static-libs", "icc"))
copyDir(path.join(pagesToPdf, "public", "woff2"), path.join("static-libs", "woff2"))

const fontsSource = path.join(pagesToPdf, "public", "fonts")
assertExists(fontsSource)
mkdirSync(path.join("static-libs", "fonts"), {recursive: true})
for (const name of readdirSync(fontsSource)) {
    copyFileSync(
        path.join(fontsSource, name),
        path.join("static-libs", "fonts", name)
    )
}
console.log(`synced ${path.join("static-libs", "fonts")} (${readdirSync(fontsSource).length} files)`)