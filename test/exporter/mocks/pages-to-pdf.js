// Mock for pages-to-pdf
export const PAGED_WITH_FLOATS_BACKEND = {pageSelector: ".paged_page"}
export const VIVLIOSTYLE_INTERNAL_LINK_PREFIX = /^viv-id-.*:0023/

export async function emitPdfFromWindow(_win, _onProgress, _options) {
    return new Uint8Array()
}