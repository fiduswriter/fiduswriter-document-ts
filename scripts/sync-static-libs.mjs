/**
 * Refreshes the vendored PDF-export assets in static-libs/ from the npm
 * dependencies that ship them:
 *
 *   paged/paged.polyfill.js  ← paged-with-floats/dist/
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

function assertExists(dir) {
    if (!existsSync(dir)) {
        throw new Error(`Missing asset source: ${dir}`)
    }
}

function copyFile(from, to) {
    assertExists(path.dirname(from))
    mkdirSync(path.dirname(to), {recursive: true})
    copyFileSync(from, to)
    console.log(`synced ${to}`)
}

function copyDir(from, to) {
    assertExists(from)
    cpSync(from, to, {recursive: true, force: true})
    console.log(`synced ${to}`)
}

const pagedDist = packageDir("paged-with-floats")
const pagesToPdf = packageDir("pages-to-pdf")

copyFile(
    path.join(pagedDist, "dist", "paged.polyfill.js"),
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