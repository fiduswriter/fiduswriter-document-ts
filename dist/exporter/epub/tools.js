export function getTimestamp(date) {
    let second = date.getUTCSeconds();
    let minute = date.getUTCMinutes();
    let hour = date.getUTCHours();
    let day = date.getUTCDate();
    let month = date.getUTCMonth() + 1; // January is 0!
    const year = date.getUTCFullYear();
    if (second < 10) {
        second = Number("0" + second);
    }
    if (minute < 10) {
        minute = Number("0" + minute);
    }
    if (hour < 10) {
        hour = Number("0" + hour);
    }
    if (day < 10) {
        day = Number("0" + day);
    }
    if (month < 10) {
        month = Number("0" + month);
    }
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}
export function getFontMimeType(filename) {
    // Define a mapping of font file extensions to MIME types
    const fontMimeTypes = {
        ttf: "font/ttf",
        otf: "font/otf",
        woff: "font/woff",
        woff2: "font/woff2",
        eot: "application/vnd.ms-fontobject"
    };
    // Extract the file extension from the filename
    const extension = filename.split(".").pop()?.toLowerCase();
    // Check if the extension matches a known font type and return the MIME type
    return extension ? fontMimeTypes[extension] || null : null;
}
export function getImageMimeType(filename) {
    // Define a mapping of image file extensions to MIME types
    const imageMimeTypes = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        bmp: "image/bmp",
        tiff: "image/tiff",
        webp: "image/webp",
        svg: "image/svg+xml",
        ico: "image/vnd.microsoft.icon",
        avif: "image/avif"
    };
    // Extract the file extension from the filename
    const extension = filename.split(".").pop()?.toLowerCase();
    // Check if the extension matches a known image type and return the MIME type
    return extension ? imageMimeTypes[extension] || null : null;
}
export function buildHierarchy(flatList) {
    const hierarchy = [];
    const levelMap = {};
    flatList.forEach(item => {
        // Ensure there's an array for the current level in the map
        levelMap[item.level] = levelMap[item.level] || [];
        // Add the current item to its level in the map
        const itemWithChildren = { ...item, children: [] };
        levelMap[item.level].push(itemWithChildren);
        if (item.level === 0) {
            // Top-level items are added directly to the hierarchy
            hierarchy.push(itemWithChildren);
        }
        else {
            // Non-top-level items are added as children of the last item at the previous level
            const parentLevel = levelMap[item.level - 1];
            if (parentLevel) {
                const parent = parentLevel[parentLevel.length - 1];
                parent.children.push(itemWithChildren);
            }
        }
    });
    return hierarchy;
}
//# sourceMappingURL=tools.js.map