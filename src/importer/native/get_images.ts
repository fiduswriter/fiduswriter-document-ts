import {get} from "fwtoolkit"

import type {ImageDB, ImageDBEntry} from "../../types.js"

interface ZipEntry {
    filename: string
    content: Blob | ArrayBuffer | string
}

interface UrlEntry {
    filename: string
    url: string
}

export class GetImages {
    images: ImageDB
    imageEntries: ImageDBEntry[]
    entries: Array<ZipEntry | UrlEntry>
    counter: number

    constructor(images: ImageDB, entries: Array<ZipEntry | UrlEntry>) {
        this.images = images
        this.imageEntries = Object.values(this.images.db)
        this.entries = entries
        this.counter = 0
    }

    async init(): Promise<void> {
        if (this.entries.length === 0) {
            return
        }
        if (this.entries[0].hasOwnProperty("url")) {
            await this.getImageUrlEntry()
        } else {
            await this.getImageZipEntry()
        }
    }

    async getImageZipEntry(): Promise<void> {
        if (this.counter >= this.imageEntries.length) {
            return
        }
        const imageEntry = this.imageEntries[this.counter]
        const f = (this.entries as ZipEntry[]).find(
            e => e.filename === imageEntry.image
        )
        if (!f) {
            console.warn(
                `Image ${imageEntry.image} not found`,
                this.imageEntries,
                this.entries
            )
            this.counter++
            await this.getImageZipEntry()
            return
        }
        this.imageEntries[this.counter]["file"] = new Blob([f.content], {
            type: imageEntry.file_type
        })
        this.counter++
        await this.getImageZipEntry()
    }

    async getImageUrlEntry(): Promise<void> {
        if (this.counter >= this.imageEntries.length) {
            return
        }
        const imageEntry = this.imageEntries[this.counter]
        const entry = (this.entries as UrlEntry[]).find(
            e =>
                e.filename ===
                `images/${String(imageEntry.image).split("/").pop()}`
        )
        if (entry) {
            try {
                const response = await get(entry.url)
                this.imageEntries[this.counter]["file"] = await response.blob()
            } catch (error) {
                // A missing or unreachable image must not cancel the whole
                // import; the image will simply be missing.
                console.warn(
                    `Could not load image ${entry.url}:`,
                    error instanceof Error ? error.message : error
                )
            }
        } else {
            console.warn(`No source found for image ${imageEntry.image}`)
        }
        this.counter++
        await this.getImageUrlEntry()
    }
}
