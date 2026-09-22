import { pagedWithFloatsEngine } from "paged-with-floats";
export const DEFAULT_PRINT_ENGINE = "paged-with-floats";
const engines = new Map([
    [pagedWithFloatsEngine.name, pagedWithFloatsEngine]
]);
/**
 * Make an additional pagination engine available to the exporters. Engine
 * adapters ship inside their own packages — both `paged-with-floats`
 * (bundled by default) and `vivliostyle-pdf` export a `PrintEngine`-
 * compatible object. Host applications that bundle additional engines must
 * import them from their packages and register them here at startup, which
 * also keeps engines that are not in use — including the AGPL licensed
 * vivliostyle engine — out of the bundle.
 */
export function registerPrintEngine(engine) {
    engines.set(engine.name, engine);
}
/**
 * Look up a pagination engine by name. Falls back to the default
 * (paged-with-floats) when the name is unknown, so that a missing optional
 * engine degrades gracefully.
 */
export function getPrintEngine(name) {
    if (name && engines.has(name)) {
        return engines.get(name);
    }
    if (name && name !== DEFAULT_PRINT_ENGINE) {
        console.warn(`Print engine "${name}" is not available. Falling back to "${DEFAULT_PRINT_ENGINE}".`);
    }
    return engines.get(DEFAULT_PRINT_ENGINE);
}
//# sourceMappingURL=registry.js.map