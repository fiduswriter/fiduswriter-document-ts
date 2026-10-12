// Deterministic seeded RNG for decisions inside fuzz properties. A shrunk
// integer seed reproduces the same mutation sequence.
export function makeRng(seed) {
    let state = seed >>> 0 || 1
    return {
        int(min, max) {
            state = (state * 1664525 + 1013904223) >>> 0
            return min + (state % (max - min + 1))
        },
        bool() {
            return this.int(0, 1) === 1
        },
        pick(items) {
            return items[this.int(0, items.length - 1)]
        }
    }
}
