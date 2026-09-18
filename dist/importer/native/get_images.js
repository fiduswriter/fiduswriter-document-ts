import { get } from "fwtoolkit";
export class GetImages {
    images;
    imageEntries;
    entries;
    counter;
    constructor(images, entries) {
        this.images = images;
        this.imageEntries = Object.values(this.images.db);
        this.entries = entries;
        this.counter = 0;
    }
    async init() {
        if (this.entries.length === 0) {
            return;
        }
        if (this.entries[0].hasOwnProperty("url")) {
            await this.getImageUrlEntry();
        }
        else {
            await this.getImageZipEntry();
        }
    }
    async getImageZipEntry() {
        if (this.counter >= this.imageEntries.length) {
            return;
        }
        const imageEntry = this.imageEntries[this.counter];
        const f = this.entries.find(e => e.filename === imageEntry.image);
        if (!f) {
            console.warn(`Image ${imageEntry.image} not found`, this.imageEntries, this.entries);
            this.counter++;
            await this.getImageZipEntry();
            return;
        }
        this.imageEntries[this.counter]["file"] = new Blob([f.content], {
            type: imageEntry.file_type
        });
        this.counter++;
        await this.getImageZipEntry();
    }
    async getImageUrlEntry() {
        if (this.counter >= this.imageEntries.length) {
            return;
        }
        const imageEntry = this.imageEntries[this.counter];
        const entry = this.entries.find(e => e.filename ===
            `images/${String(imageEntry.image).split("/").pop()}`);
        if (!entry) {
            return;
        }
        const response = await get(entry.url);
        this.imageEntries[this.counter]["file"] = await response.blob();
        this.counter++;
        await this.getImageUrlEntry();
    }
}
//# sourceMappingURL=get_images.js.map