// Mock for paginate-for-print
export const paginateForPrintEngine = {
    name: "paginate-for-print",
    preparePagination: () => Promise.resolve({win: {}, cleanup: () => {}}),
    print: () => Promise.resolve(),
    backend: {pageSelector: ".paged_page"}
}

export function printHTML(_html, _options) {
    return Promise.resolve({})
}

export default {printHTML, paginateForPrintEngine}
