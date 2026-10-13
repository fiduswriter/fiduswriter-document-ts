import { paginateForPrintEngine } from "paginate-for-print";
export const DEFAULT_PRINT_ENGINE = "paginate-for-print";
const engines = new Map([
    [paginateForPrintEngine.name, paginateForPrintEngine]
]);
/**
 * Make an additional pagination engine available to the exporters. Engine
 * adapters ship inside their own packages — both `paginate-for-print`
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
 * (paginate-for-print) when the name is unknown, so that a missing optional
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