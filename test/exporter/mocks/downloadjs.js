// Mock of the downloadjs library. Records each call so tests can assert
// whether a download was triggered (see the ExportFidusFile download option).
export const downloadCalls = []

export default function download(data, filename, mimeType) {
    downloadCalls.push({data, filename, mimeType})
    // Mock: just return the data for inspection
    return Promise.resolve({data, filename, mimeType})
}
