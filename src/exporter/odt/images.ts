import {get} from "fwtoolkit"

import type {FidusNode, ImageDB} from "../../types.js"
import {descendantNodes} from "../tools/doc_content.js"
import {getImageDBEntryFilename} from "../tools/file.js"
import {svg2png} from "../tools/svg.js"
import type {XMLElement} from "../tools/xml.js"
import type {XmlZip} from "../tools/xml_zip.js"

interface ImageInfo {
    id: string
    width: number
    height: number
    title?: string
    type: string
    svg: string | null
}

function getImageExtension(fileType: string | undefined, blobType: string): string {
    if (fileType) {
        return fileType.includes("/") ? fileType.split("/").pop() || "bin" : fileType
    }
    return blobType.split("/")[1] || "bin"
}

export class ODTExporterImages {
    docContent: FidusNode
    xml: XmlZip
    imageDB: ImageDB
    images: Record<string, ImageInfo>
    manifestXml: XMLElement | null

    constructor(docContent: FidusNode, xml: XmlZip, imageDB: ImageDB) {
        this.docContent = docContent
        this.xml = xml
        this.imageDB = imageDB
        this.images = {}
        this.manifestXml = null
    }

    init(): Promise<void> {
        return this.xml.getXml("META-INF/manifest.xml").then(manifestXml => {
            this.manifestXml = manifestXml
            return this.exportImages()
        })
    }

    // add an image to the list of files
    addImage(imgFileName: string, image: Blob): string {
        imgFileName = this.addFileToManifest(imgFileName)
        this.xml.addExtraFile(`Pictures/${imgFileName}`, image)
        return imgFileName
    }

    // add a an image file to the manifest
    addFileToManifest(imgFileName: string): string {
        const fileNameParts = imgFileName.split(".")
        const fileNameEnding = fileNameParts.pop() || ""
        const fileNameStart = fileNameParts.join(".")
        const manifestEl = this.manifestXml!.query("manifest:manifest")
        let imgManifest = manifestEl?.query("manifest:file-entry", {
            "manifest:full-path": `Pictures/${imgFileName}`
        })
        let counter = 0
        while (imgManifest) {
            // Name exists already, we change the name until we get a file name not yet included in manifest.
            imgFileName = `${fileNameStart}_${counter++}.${fileNameEnding}`
            imgManifest = manifestEl?.query("manifest:file-entry", {
                "manifest:full-path": `Pictures/${imgFileName}`
            })
        }
        const string = `  <manifest:file-entry manifest:full-path="Pictures/${imgFileName}" manifest:media-type="image/${fileNameEnding}"/>`
        manifestEl?.appendXML(string)
        return imgFileName
    }

    // Find all images used in file and add these to the export zip.
    // TODO: This will likely fail on image types odt doesn't support such as
    // SVG. Try out and fix.
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
                        const wImgId = this.addImage(imageFilename, blob)
                        if (blob.type === "image/svg+xml") {
                            // Add PNG version in addition to SVG
                            const {blob: pngBlob, width, height} = await svg2png(blob)
                            const pngWImgId = this.addImage(
                                imageFilename.replace(/.svg$/g, ".png"),
                                pngBlob
                            )
                            this.images[String(image)] = {
                                id: pngWImgId,
                                width,
                                height,
                                title: imgDBEntry.title as string | undefined,
                                type: blob.type,
                                svg: wImgId
                            }
                        } else {
                            this.images[String(image)] = {
                                id: wImgId,
                                width: imgDBEntry.width as number,
                                height: imgDBEntry.height as number,
                                title: imgDBEntry.title as string | undefined,
                                type: blob.type,
                                svg: null
                            }
                        }
                    })
                )
            })

            Promise.all(p).then(() => resolveExportImages())
        })
    }
}
