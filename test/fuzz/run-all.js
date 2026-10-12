// Runs every harness in this directory in its own child process.
//
// Process isolation matters: each fake editor cycle retains ~0.5 MB through
// happy-dom, so long campaigns would otherwise exhaust the heap. A fresh
// process per harness (and per campaign batch, via fuzz-campaign.sh) keeps
// memory bounded and gives one summary line per harness.
//
// Usage: node test/fuzz/run-all.js [harness.js ...]
//   FC_RUNS      iterations per property (default 200)
//   FC_SEED      seed (default: time-based, printed on failure)

import {spawnSync} from "node:child_process"
import {readdirSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const requested = process.argv.slice(2)
const harnesses = requested.length
    ? requested
    : readdirSync(here)
          .filter(
              name =>
                  name.endsWith(".js") &&
                  !["config.js", "setup.js", "rng.js", "doc-generator.js", "run-all.js"].includes(name)
          )
          .sort()

let failed = 0
for (const harness of harnesses) {
    const result = spawnSync("node", [join(here, harness)], {
        stdio: "inherit",
        env: process.env
    })
    if (result.status !== 0) {
        failed++
        console.log(`\n^^^ ${harness} failed (exit ${result.status})\n`)
    }
}

console.log(
    `\nrun-all: ${harnesses.length - failed}/${harnesses.length} harnesses passed (FC_RUNS=${process.env.FC_RUNS || "200"}, FC_SEED=${process.env.FC_SEED || "time-based"})`
)
if (failed) {
    process.exit(1)
}
