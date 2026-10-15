// jszip 3.10.2 verifies each entry's inflated length against the size
// declared in the (attacker-controlled) zip header inside a detached
// stream worker (`getContentWorker`'s "end" handler in
// jszip/lib/compressedObject.js). When a malformed zip makes that check
// fire after the consuming promise chain has already settled, the throw
// escapes as an unhandled rejection and kills the Node.js process even
// though the import itself resolved or rejected normally. See
// test/fuzz/regressions/jszip-orphan-size-mismatch.js.
//
// `ensureZipSizeGuard` installs a single process-level listener that
// swallows that exact jszip-internal assertion and re-raises every
// other rejection on the next tick so strict "unhandled rejection
// crashes the process" semantics are preserved for all other code.
// When the host application has registered its own unhandledRejection
// listeners we leave the decision to it and do not re-raise.

const jszipOrphanThrowMessages = new Set([
    "Bug : uncompressed data size mismatch",
    "Bug : compressed data size mismatch"
])

let installed = false

export function ensureZipSizeGuard(): void {
    if (
        installed ||
        typeof process === "undefined" ||
        typeof process.on !== "function" ||
        typeof process.listenerCount !== "function"
    ) {
        // Browser environments (where an unhandled rejection cannot kill
        // the process) and hosts without a process object are unaffected.
        return
    }
    installed = true
    process.on("unhandledRejection", (reason: unknown) => {
        if (reason instanceof Error && jszipOrphanThrowMessages.has(reason.message)) {
            return
        }
        if (process.listenerCount("unhandledRejection") > 1) {
            // The host application has its own policy for unhandled
            // rejections; do not second-guess it.
            return
        }
        // Restore Node's default fatal behavior for everything else.
        process.nextTick(() => {
            throw reason
        })
    })
}
