/**
 * Ambient type declarations for dependencies that do not ship their own types.
 */

declare module "downloadjs" {
    /**
     * Trigger a browser download of the given data.
     * @param data - File content (Blob or string).
     * @param filename - Suggested filename for the download.
     * @param mimeType - MIME type of the data.
     */
    function download(
        data: Blob | string,
        filename?: string,
        mimeType?: string
    ): void
    export default download
}
