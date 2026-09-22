import type {BackendConfig} from "pages-to-pdf"

/**
 * Identifiers of the pagination engines available to the exporters. Each
 * name matches the npm package that provides the engine: the default engine
 * is `paged-with-floats`; further engines — such as `vivliostyle-pdf`,
 * which wraps the AGPL licensed `@vivliostyle/print` — ship as adapters
 * inside their own packages and are made available through
 * `registerPrintEngine()`.
 */
export type PrintEngineName = "paged-with-floats" | (string & {})

export interface PaginateConfig {
    /** The complete HTML document to paginate. */
    html: string
    /** Document title, applied to the paginated iframe. */
    title?: string
    /** Called with a message when pagination fails. */
    errorCallback?: (message: string) => void
    /**
     * URL of the pagination engine's script bundle (e.g. the
     * paged-with-floats polyfill) to load inside the print iframe. Engines
     * that load a bundle by URL honor this setting; others ignore it. The
     * hosting application serves the bundle from its static files and pins
     * the URL here.
     */
    polyfillURL?: string
}

/** A paginated document living in a hidden iframe. */
export interface PaginatedWindow {
    /** The iframe window holding the paginated DOM. */
    win: Window
    /** Remove the iframe from the DOM once it is no longer needed. */
    cleanup: () => void
}

/**
 * A pagination engine: renders the paginated output used by the browser
 * print dialog and describes its page structure to the DOM-to-PDF emitter
 * through the `backend` configuration.
 */
export interface PrintEngine {
    /** Identifier used by host applications to select the engine. */
    name: PrintEngineName
    /**
     * Paginate the given HTML in a hidden iframe and hand back the iframe
     * window without opening a print dialog. The caller must invoke
     * `cleanup()` when it is done with the window.
     */
    preparePagination(config: PaginateConfig): Promise<PaginatedWindow>
    /**
     * Paginate the given HTML and open the browser print dialog. Resolves
     * once the document has been handed to the browser.
     */
    print(config: PaginateConfig): Promise<void>
    /** DOM-to-PDF emitter configuration matching this engine's output. */
    backend: BackendConfig
}
