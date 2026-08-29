#!/usr/bin/env node
// Bundle each demo entry point into .pages-build/ so the pages can be served
// without relying on a CDN or an import map.
import {build} from "esbuild"
import {readdirSync, statSync} from "node:fs"
import {join, resolve} from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const DEMO_DIR = join(ROOT, "demo")
const BUILD_DIR = process.env.PAGES_BUILD_DIR || join(ROOT, ".pages-build")

const entries = readdirSync(DEMO_DIR)
    .filter(name => {
        const dir = join(DEMO_DIR, name)
        return (
            statSync(dir).isDirectory() &&
            statSync(join(dir, "index.ts")).isFile()
        )
    })
    .map(name => ({
        in: join(DEMO_DIR, name, "index.ts"),
        out: `${name}/index`
    }))

if (entries.length === 0) {
    console.log("No demo entry points found.")
    process.exit(0)
}

console.log("Bundling demos:", entries.map(e => e.out).join(", "))

await build({
    entryPoints: entries,
    bundle: true,
    format: "esm",
    splitting: true,
    outdir: BUILD_DIR,
    sourcemap: false,
    minify: true,
    target: ["es2020"],
    loader: {
        ".png": "file",
        ".svg": "file",
        ".woff2": "file",
        // citeproc-plus ships compressed locale data as .gz assets that are
        // imported from its dist JS. Copy them as files so the browser demo
        // can load them at runtime.
        ".gz": "file",
        ".csljson": "json"
    },
    define: {
        "process.env.NODE_ENV": '"production"'
    },
    // Mark Node.js built-ins as external so esbuild does not try to bundle
    // them for the browser.  citeproc-plus guards its Node.js paths with a
    // `process.versions?.node` check and they are never reached at runtime in
    // the browser, so leaving these as unresolved dynamic imports is safe.
    external: [
        "fs",
        "fs/promises",
        "path",
        "url",
        "module",
        "node:fs",
        "node:fs/promises",
        "node:path",
        "node:url",
        "node:module"
    ]
})

console.log("Demo bundles written to", BUILD_DIR)
