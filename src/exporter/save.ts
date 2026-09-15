import download from "downloadjs"

/** A file type entry for the File System Access API save picker. */
export interface SaveFileType {
    description: string
    accept: Record<string, string[]>
}

/** Options for {@link saveFile}. */
export interface SaveFileOptions {
    /** Human readable description shown in the save dialog. */
    description?: string
    /** The MIME type of the file (also used for the download fallback). */
    mimeType?: string
    /** File extensions, e.g. `[".fidus"]`. */
    extensions?: string[]
}

interface SaveFilePickerWindow extends Window {
    showSaveFilePicker?: (options: {
        suggestedName?: string
        types?: SaveFileType[]
    }) => Promise<{
        createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>
            close: () => Promise<void>
        }>
    }>
}

/**
 * Save a Blob to disk.
 *
 * In Chromium-based browsers the File System Access API
 * (`showSaveFilePicker`) is preferred, because it passes the media type and
 * file extension to the operating system's save dialog, which lets the OS
 * associate the saved file with the Fidus Writer file type. Everywhere else
 * (Firefox, Safari, Node without a DOM) the classic `downloadjs` fallback is
 * used.
 *
 * Returns `false` when the user aborted the save picker, `true` otherwise.
 */
export async function saveFile(
    blob: Blob,
    filename: string,
    options: SaveFileOptions = {}
): Promise<boolean> {
    const {mimeType, extensions = [], description} = options
    const pickerWindow =
        typeof window === "undefined"
            ? undefined
            : (window as SaveFilePickerWindow)
    if (pickerWindow?.showSaveFilePicker && mimeType && extensions.length) {
        try {
            const handle = await pickerWindow.showSaveFilePicker({
                suggestedName: filename,
                types: [
                    {
                        description: description || filename,
                        accept: {[mimeType]: extensions}
                    }
                ]
            })
            const writable = await handle.createWritable()
            await writable.write(blob)
            await writable.close()
            return true
        } catch (error) {
            if ((error as DOMException)?.name === "AbortError") {
                return false
            }
            // NotAllowedError (no user gesture), SecurityError or a missing
            // implementation: fall back to the classic download.
            console.error(
                "showSaveFilePicker failed, falling back to download:",
                error
            )
        }
    }
    download(blob, filename, mimeType)
    return true
}
