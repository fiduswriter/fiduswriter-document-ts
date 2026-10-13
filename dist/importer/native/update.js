import { updateDoc } from "../../schema/convert.js";
export function updateFile(doc, filetypeVersion, bibliography, images) {
    // update bibliography -- currently not needed
    // bibliography = updateBib(bibliography)
    if (filetypeVersion < 3.2) {
        Object.values(images).forEach(image => (image.copyright = {
            holder: false,
            year: false,
            freeToRead: true,
            licenses: []
        }));
    }
    const docRecord = doc;
    if (filetypeVersion < 3.3) {
        docRecord.content = docRecord.contents;
        delete docRecord.contents;
    }
    if (filetypeVersion < 2.0) {
        // Before 2.0, version numbers of the doc and of the file differed.
        doc = updateDoc(doc, docRecord.settings["doc_version"], bibliography);
    }
    else {
        doc = updateDoc(doc, filetypeVersion, bibliography);
    }
    return { doc, bibliography, images };
}
//# sourceMappingURL=update.js.map