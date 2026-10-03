import { gettext } from "fwtoolkit";
export const createSlug = (str) => {
    if (!str) {
        str = gettext("Untitled");
    }
    str = str.replace(/[^a-zA-Z0-9\s]/g, "");
    str = str.toLowerCase();
    str = str.replace(/\s/g, "-");
    return str;
};
export function getImageExtension(fileType, blobType) {
    if (fileType) {
        return fileType.includes("/")
            ? fileType.split("/").pop() || "bin"
            : fileType;
    }
    return blobType.split("/")[1] || "bin";
}
export function getImageDBEntryFilename(imageEntry, id) {
    const imageValue = imageEntry.image;
    if (imageValue instanceof Blob) {
        const ext = getImageExtension(imageEntry.file_type, imageValue.type);
        return `image-${id}.${ext}`;
    }
    if (imageValue instanceof ArrayBuffer) {
        const ext = getImageExtension(imageEntry.file_type, "");
        return `image-${id}.${ext}`;
    }
    if (typeof imageValue === "string") {
        return imageValue.split("/").pop() || `image-${id}`;
    }
    return `image-${id}`;
}
//# sourceMappingURL=file.js.map