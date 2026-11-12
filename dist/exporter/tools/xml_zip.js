import { get } from "fwtoolkit";
import { validateXml, xmlDOM } from "./xml.js";
export class XmlZip {
    url;
    mimeType;
    docs;
    extraFiles;
    rawFile;
    zip;
    loadedBlob;
    constructor(url, mimeType, loadedBlob) {
        this.url = url;
        this.mimeType = mimeType;
        this.docs = {};
        this.extraFiles = {};
        this.rawFile = false;
        this.loadedBlob = loadedBlob;
    }
    init() {
        return import("jszip")
            .then(({ default: JSZip }) => {
            this.zip = new JSZip();
            if (this.loadedBlob) {
                return this.blobToArrayBuffer(this.loadedBlob).then(ab => {
                    this.rawFile = new Blob([ab]);
                    return this.loadZip(ab);
                });
            }
            return this.downloadZip().then(() => this.loadZip());
        });
    }
    blobToArrayBuffer(blob) {
        if (blob instanceof Blob && typeof blob.arrayBuffer === "function") {
            return blob.arrayBuffer();
        }
        if (blob instanceof ArrayBuffer) {
            return Promise.resolve(blob);
        }
        return Promise.reject(new Error("Cannot convert to ArrayBuffer"));
    }
    downloadZip() {
        return get(this.url)
            .then(response => response.blob())
            .then(blob => (this.rawFile = blob));
    }
    loadZip(data) {
        const input = data || this.rawFile;
        if (!input) {
            return Promise.reject(new Error("No zip data to load"));
        }
        return this.zip.loadAsync(input);
    }
    // Open file at filePath from zip file and parse it as XML.
    getXml(filePath, defaultContents) {
        if (this.docs[filePath]) {
            // file has been loaded already.
            return Promise.resolve(this.docs[filePath]);
        }
        else if (this.zip.files[filePath]) {
            const file = this.zip.file(filePath);
            if (!file) {
                return Promise.reject(new Error("File not found"));
            }
            return file.async("string").then((string) => {
                this.docs[filePath] = xmlDOM(string);
                return Promise.resolve(this.docs[filePath]);
            });
        }
        else if (defaultContents) {
            return Promise.resolve(defaultContents).then(string => {
                this.docs[filePath] = xmlDOM(string);
                return Promise.resolve(this.docs[filePath]);
            });
        }
        else {
            // File couldn't be found and there was no default value.
            return Promise.reject(new Error("File not found"));
        }
    }
    // Add an xml file at filepath without checking for previous version
    addXmlFile(filePath, xmlContents) {
        this.docs[filePath] = xmlContents;
    }
    // Add extra file to be saved in zip later.
    addExtraFile(filePath, fileContents) {
        this.extraFiles[filePath] = fileContents;
    }
    // Put all currently open XML files into zip.
    allXMLToZip() {
        for (const fileName in this.docs) {
            this.xmlToZip(fileName);
        }
    }
    // Put all extra files into zip.
    async allExtraToZip() {
        for (const fileName in this.extraFiles) {
            let contents = this.extraFiles[fileName];
            // JSZip 3.x cannot consume a Node.js Blob, so convert Blobs to
            // ArrayBuffers before adding them. Browser Blobs work with
            // ArrayBuffer as well, so this is safe everywhere.
            if (contents instanceof Blob) {
                contents = await contents.arrayBuffer();
            }
            this.zip.file(fileName, contents);
        }
    }
    // Put the xml identified by filePath into zip.
    xmlToZip(filePath) {
        const string = this.docs[filePath].toString();
        validateXml(string);
        this.zip.file(filePath, string);
    }
    async prepareBlob() {
        this.allXMLToZip();
        await this.allExtraToZip();
        return this.zip.generateAsync({ type: "blob", mimeType: this.mimeType });
    }
}
//# sourceMappingURL=xml_zip.js.map