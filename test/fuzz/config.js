// Shared fast-check configuration for the fuzz harnesses in this directory.
//
//   FC_SEED=123456 FC_RUNS=2000 node test/fuzz/native-fidus.js
//
// On failure fast-check prints the seed and shrunk counterexample — replay
// with the same FC_SEED to reproduce, then pin the input as a regression in
// test/fuzz/regressions/.
import fc from "fast-check"

const RUNS = Number.parseInt(process.env.FC_RUNS || "500", 10)
const SEED = Number.parseInt(process.env.FC_SEED || String(Date.now()), 10)

const config = {
    seed: SEED,
    numRuns: RUNS,
    endOnFailure: true
}
if (process.env.FC_TIME_LIMIT) {
    config.interruptAfterTimeLimit =
        Number.parseInt(process.env.FC_TIME_LIMIT, 10) * 1000
}
fc.configureGlobal(config)

export {fc, RUNS, SEED}

export async function runHarness(name, properties) {
    let failed = 0
    for (const {label, prop} of properties) {
        try {
            await fc.assert(prop, {seed: SEED, numRuns: RUNS})
            console.log(`ok ${label}`)
        } catch (error) {
            failed++
            console.log(`FAILED ${label}`)
            console.log(error.message)
            if (error.cause !== undefined) {
                console.log(
                    `underlying error: ${error.cause.message || error.cause}`
                )
                if (error.cause.stack && process.env.FC_STACK) {
                    console.log(error.cause.stack)
                }
            }
        }
    }
    console.log(
        `\n${name}: ${properties.length - failed} passed, ${failed} failed (seed=${SEED}, runs=${RUNS})`
    )
    if (failed) {
        process.exit(1)
    }
}
