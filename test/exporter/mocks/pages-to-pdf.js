// Mock for pages-to-pdf
export const PAGINATE_FOR_PRINT_BACKEND = {pageSelector: ".paged_page"}
/** Deprecated alias kept to mirror pages-to-pdf 0.4.x. */
export const PAGED_WITH_FLOATS_BACKEND = PAGINATE_FOR_PRINT_BACKEND
export const VIVLIOSTYLE_INTERNAL_LINK_PREFIX = /^viv-id-.*:0023/

export async function emitPdfFromWindow(_win, _onProgress, _options) {
    return new Uint8Array()
}