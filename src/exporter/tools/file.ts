import {gettext} from "fwtoolkit"
import type {ImageDBEntry} from "../../types.js"

export const createSlug = (str: string): string => {
    if (!str) {
        str = gettext("Untitled")
    }
    str = str.replace(/[^a-zA-Z0-9\s]/g, "")
    str = str.toLowerCase()
    str = str.replace(/\s/g, "-")
    return str
}

export function getImageExtension(
    fileType: string | undefined,
    blobType: string
): string {
    if (fileType) {
        return fileType.includes("/")
            ? fileType.split("/").pop() || "bin"
            : fileType
    }
    return blobType.split("/")[1] || "bin"
}

/** Whether an image DB value is a data URL (the desktop/static hosts store
 * images that way so the editor can display them without a backend). A plain
 * boolean (not a type guard): callers have usually narrowed the value to
 * string already, where a `value is string` guard would narrow the negative
 * branch to never. */
export function isDataUrlValue(value: unknown): boolean {
    return typeof value === "string" && /^data:/i.test(value)
}

/** The MIME type declared by a data URL, or null when the value is not one. */
export function getDataUrlMime(value: string): string | null {
    const match = /^data:([^;,]+)?[;,]/i.exec(value)
    return match ? match[1] || "text/plain" : null
}

export function getImageDBEntryFilename(
    imageEntry: Pick<ImageDBEntry, "image" | "file_type">,
    id: string | number
): string {
    const imageValue = imageEntry.image
    if (imageValue instanceof Blob) {
        const ext = getImageExtension(imageEntry.file_type, imageValue.type)
        return `image-${id}.${ext}`
    }
    if (imageValue instanceof ArrayBuffer) {
        const ext = getImageExtension(imageEntry.file_type, "")
        return `image-${id}.${ext}`
    }
    if (typeof imageValue === "string") {
        if (isDataUrlValue(imageValue)) {
            // No meaningful last path segment on a data URL: the base64
            // payload can contain "/" and ends up as the file name (e.g.
            // "vJ1MfMy7AAAAABJRU5ErkJggg=="). Derive a stable one instead.
            const ext = getImageExtension(
                imageEntry.file_type,
                getDataUrlMime(imageValue) || ""
            )
            return `image-${id}.${ext}`
        }
        return imageValue.split("/").pop() || `image-${id}`
    }
    return `image-${id}`
}
