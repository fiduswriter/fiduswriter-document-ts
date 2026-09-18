import { get } from "fwtoolkit";
import { descendantNodes } from "../tools/doc_content.js";
import { svg2png } from "../tools/svg.js";
function getImageExtension(fileType, blobType) {
    if (fileType) {
        return fileType.includes("/") ? fileType.split("/").pop() || "bin" : fileType;
    }
    return blobType.split("/")[1] || "bin";
}
export class DOCXExporterImages {
    docContent;
    imageDB;
    xml;
    rels;
    images;
    ctXML;
    constructor(docContent, imageDB, xml, rels) {
        this.docContent = docContent;
        this.imageDB = imageDB;
        this.xml = xml;
        this.rels = rels;
        this.images = {};
        this.ctXML = null;
    }
    init() {
        return this.xml.getXml("[Content_Types].xml").then(ctXML => {
            this.ctXML = ctXML;
            return this.exportImages();
        });
    }
    // add an image to the list of files
    addImage(imgFileName, image) {
        const rId = this.rels.addImageRel(imgFileName);
        this.addContentType(imgFileName.split(".").pop() || "");
        this.xml.addExtraFile(`word/media/${imgFileName}`, image);
        return rId;
    }
    // add a global contenttype declaration for an image type (if needed)
    addContentType(fileEnding) {
        if (!this.ctXML) {
            return;
        }
        const types = this.ctXML.query("Types");
        if (!types) {
            return;
        }
        const contentDec = types.query("Default", { Extension: fileEnding });
        if (!contentDec) {
            const string = `<Default ContentType="image/${fileEnding}" Extension="${fileEnding}"/>`;
            types.appendXML(string);
        }
    }
    // Find all images used in file and add these to the export zip.
    // TODO: This will likely fail on image types docx doesn't support such as SVG.
    // Try out and fix.
    exportImages() {
        const usedImgs = [];
        descendantNodes(this.docContent).forEach(node => {
            if (node.type === "image" && node.attrs?.image !== false) {
                const imageId = node.attrs?.image;
                if (imageId !== undefined && !usedImgs.includes(imageId)) {
                    usedImgs.push(imageId);
                }
            }
        });
        return new Promise(resolveExportImages => {
            const p = [];
            usedImgs.forEach(image => {
                const imgDBEntry = this.imageDB.db[String(image)];
                if (!imgDBEntry || !imgDBEntry.image) {
                    return;
                }
                const imageValue = imgDBEntry.image;
                const imagePromise = imageValue instanceof Blob
                    ? Promise.resolve(imageValue)
                    : get(imageValue)
                        .then(response => response.blob());
                const imageFilename = imageValue instanceof Blob
                    ? `image-${String(image)}.${getImageExtension(imgDBEntry.file_type, imageValue.type)}`
                    : imageValue.split("/").pop();
                p.push(imagePromise.then(async (blob) => {
                    if (blob.type === "image/svg+xml") {
                        // DOCX doesn't support SVG. Convert to PNG.
                        const { blob: pngBlob, width, height } = await svg2png(blob);
                        const wImgId = this.addImage(imageFilename.replace(/.svg$/g, ".png"), pngBlob);
                        this.images[String(image)] = {
                            id: wImgId,
                            width,
                            height,
                            title: imgDBEntry.title
                        };
                    }
                    else {
                        const wImgId = this.addImage(imageFilename, blob);
                        this.images[String(image)] = {
                            id: wImgId,
                            width: imgDBEntry.width,
                            height: imgDBEntry.height,
                            title: imgDBEntry.title
                        };
                    }
                }));
            });
            Promise.all(p).then(() => {
                resolveExportImages();
            });
        });
    }
}
//# sourceMappingURL=images.js.map