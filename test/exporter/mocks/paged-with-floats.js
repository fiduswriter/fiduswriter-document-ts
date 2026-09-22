// Mock for paged-with-floats
export const pagedWithFloatsEngine = {
    name: "paged-with-floats",
    preparePagination: () => Promise.resolve({win: {}, cleanup: () => {}}),
    print: () => Promise.resolve(),
    backend: {pageSelector: ".paged_page"}
}

export function printHTML(_html, _options) {
    return Promise.resolve({})
}

export default {printHTML, pagedWithFloatsEngine}
