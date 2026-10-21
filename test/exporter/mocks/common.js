import JSZip from "jszip"

// Mock for `../../common` and similar paths
export const escapeText = str => {
    if (typeof str !== "string") {
        return String(str)
    }
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

export const shortFileTitle = (title, path) => {
    return title || path || "untitled"
}

export const addAlert = (type, message) => {
    if (typeof console !== "undefined") {
        console.log(`[${type}] ${message}`)
    }
}

export const get = _url => {
    return Promise.resolve({
        blob: () => Promise.resolve(new Blob()),
        json: () => Promise.resolve({}),
        text: () => Promise.resolve("")
    })
}

export const post = (_url, _params) => {
    return Promise.resolve({ok: true})
}

export const postJson = (_url, _data) => {
    return Promise.resolve({json: {}})
}

export const getJson = _url => {
    return Promise.resolve({})
}

export const convertDataURIToBlob = _dataURI => {
    return new Blob()
}

export const gettext = str => str

export const interpolate = (str, args) => {
    return str.replace(/%s/g, () => args.shift())
}

export const staticUrl = path => path

export const noSpaceTmp = (strings, ...values) => {
    const tmpStrings = Array.from(strings)
    let combined = ""
    while (tmpStrings.length > 0 || values.length > 0) {
        if (tmpStrings.length > 0) {
            combined += tmpStrings.shift()
        }
        if (values.length > 0) {
            const value = values.shift()
            combined += value !== undefined && value !== null ? String(value) : ""
        }
    }
    return combined.split("\n").map(line => line.replace(/^\s*/g, "")).join("")
}

export const longFilePath = (path, filename) => `${path}${filename}`

export const isSafeLinkHref = href => {
    if (typeof href !== "string") {
        return false
    }
    const trimmed = href.trim()
    if (!trimmed) {
        return false
    }
    if (trimmed.startsWith("#")) {
        return true
    }
    try {
        const url = new URL(trimmed, "http://localhost")
        return ["http:", "https:"].includes(url.protocol)
    } catch {
        return false
    }
}

export class ZipFileCreator {
    constructor(
        textFiles = [],
        binaryFiles = [],
        zipFiles = [],
        mimeType = "application/zip",
        date = new Date()
    ) {
        this.textFiles = textFiles
        this.binaryFiles = binaryFiles
        this.zipFiles = zipFiles
        this.mimeType = mimeType
        this.date = date
    }

    init() {
        const zipFs = new JSZip()
        if (this.mimeType !== "application/zip") {
            zipFs.file("mimetype", this.mimeType, {compression: "STORE"})
        }
        this.textFiles.forEach(textFile => {
            zipFs.file(textFile.filename, textFile.contents, {
                compression: "DEFLATE"
            })
        })
        this.binaryFiles.forEach(binaryFile => {
            zipFs.file(binaryFile.filename, binaryFile.blob || new Blob(), {
                binary: true,
                compression: "DEFLATE"
            })
        })
        return zipFs.generateAsync({type: "blob", mimeType: this.mimeType})
    }

    convertDataURIToBlob(_dataURI) {
        return new Blob()
    }
}

export default {
    escapeText,
    shortFileTitle,
    addAlert,
    get,
    post,
    postJson,
    getJson,
    convertDataURIToBlob,
    gettext,
    interpolate,
    staticUrl,
    noSpaceTmp,
    longFilePath,
    isSafeLinkHref
}
