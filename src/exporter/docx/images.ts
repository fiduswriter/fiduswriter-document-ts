import {get} from "fwtoolkit"

import type {FidusNode, ImageDB} from "../../types.js"
import {descendantNodes} from "../tools/doc_content.js"
import {getImageDBEntryFilename} from "../tools/file.js"
import {svg2png} from "../tools/svg.js"
import type {XMLElement} from "../tools/xml.js"
import type {XmlZip} from "../tools/xml_zip.js"
import type {DOCXExporterRels} from "./rels.js"

interface ImageInfo {
    id: number
    width: number
    height: number
    title?: string
}

function getImageExtension(fileType: string | undefined, blobType: string): string {
    if (fileType) {
        return fileType.includes("/") ? fileType.split("/").pop() || "bin" : fileType
    }
    return blobType.split("/")[1] || "bin"
}

export class DOCXExporterImages {
    docContent: FidusNode
    imageDB: ImageDB
    xml: XmlZip
    rels: DOCXExporterRels

    images: Record<string, ImageInfo>
    ctXML: XMLElement | null

    constructor(docContent: FidusNode, imageDB: ImageDB, xml: XmlZip, rels: DOCXExporterRels) {
        this.docContent = docContent
        this.imageDB = imageDB
        this.xml = xml
        this.rels = rels

        this.images = {}
        this.ctXML = null
    }

    init(): Promise<void> {
        return this.xml.getXml("[Content_Types].xml").then(ctXML => {
            this.ctXML = ctXML
            return this.exportImages()
        })
    }

    // add an image to the list of files
    addImage(imgFileName: string, image: Blob): number {
        const rId = this.rels.addImageRel(imgFileName)
        this.addContentType(imgFileName.split(".").pop() || "")
        this.xml.addExtraFile(`word/media/${imgFileName}`, image)
        return rId
    }

    // add a global contenttype declaration for an image type (if needed)
    addContentType(fileEnding: string): void {
        if (!this.ctXML) {
            return
        }
        const types = this.ctXML.query("Types")
        if (!types) {
            return
        }
        const contentDec = types.query("Default", {Extension: fileEnding})
        if (!contentDec) {
            const string = `<Default ContentType="image/${fileEnding}" Extension="${fileEnding}"/>`
            types.appendXML(string)
        }
    }

    // Find all images used in file and add these to the export zip.
    // TODO: This will likely fail on image types docx doesn't support such as SVG.
    // Try out and fix.
    exportImages(): Promise<void> {
        const usedImgs: (string | number)[] = []
        descendantNodes(this.docContent).forEach(node => {
            if (node.type === "image" && node.attrs?.image !== false) {
                const imageId = node.attrs?.image as string | number | undefined
                if (imageId !== undefined && !usedImgs.includes(imageId)) {
                    usedImgs.push(imageId)
                }
            }
        })
        return new Promise(resolveExportImages => {
            const p: Array<Promise<void>> = []
            usedImgs.forEach(image => {
                const imgDBEntry = this.imageDB.db[String(image)]
                if (!imgDBEntry || !imgDBEntry.image) {
                    return
                }
                const imageValue = imgDBEntry.image
                const imagePromise: Promise<Blob> =
                    imageValue instanceof Blob
                        ? Promise.resolve(imageValue)
                        : get(imageValue as string)
                              .then(response => response.blob())
                const imageFilename =
                    imageValue instanceof Blob
                        ? `image-${String(image)}.${getImageExtension(imgDBEntry.file_type as string | undefined, imageValue.type)}`
                        : // Data URLs have no usable last path segment (the
                          // base64 payload may contain "/"); the helper
                          // derives a stable name.
                          getImageDBEntryFilename(
                              imgDBEntry,
                              String(image)
                          )
                p.push(
                    imagePromise.then(async blob => {
                        if (blob.type === "image/svg+xml") {
                            // DOCX doesn't support SVG. Convert to PNG.
                            const {blob: pngBlob, width, height} = await svg2png(blob)
                            const wImgId = this.addImage(
                                imageFilename.replace(/.svg$/g, ".png"),
                                pngBlob
                            )
                            this.images[String(image)] = {
                                id: wImgId,
                                width,
                                height,
                                title: imgDBEntry.title as string | undefined
                            }
                        } else {
                            const wImgId = this.addImage(imageFilename, blob)
                            this.images[String(image)] = {
                                id: wImgId,
                                width: imgDBEntry.width as number,
                                height: imgDBEntry.height as number,
                                title: imgDBEntry.title as string | undefined
                            }
                        }
                    })
                )
            })

            Promise.all(p).then(() => {
                resolveExportImages()
            })
        })
    }
}
