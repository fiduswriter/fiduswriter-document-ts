import { gettext, longFilePath } from "fwtoolkit";
import { ShrinkFidus } from "./shrink.js";
export class SaveCopy {
    doc;
    bibDB;
    imageDB;
    newUser;
    importId;
    e2eeOptions;
    e2ee;
    importDocument;
    progressCallback;
    constructor(doc, bibDB, imageDB, newUser, options) {
        this.doc = doc;
        this.bibDB = bibDB;
        this.imageDB = imageDB;
        this.newUser = newUser;
        this.importId = options.importId ?? null;
        this.e2eeOptions = options.e2eeOptions ?? null;
        this.e2ee = options.e2ee;
        this.importDocument = options.importDocument;
        this.progressCallback = options.progressCallback;
    }
    _requestedPath() {
        return longFilePath(this.doc.title || "copy", this.doc.path || "", `${gettext("Copy of")} `);
    }
    init() {
        this.progressCallback?.(gettext("Creating copy..."), 0);
        let shrinkerPromise;
        if (this.doc.e2ee) {
            shrinkerPromise = this._decryptDocument().then(decryptedDoc => {
                const shrinker = new ShrinkFidus(decryptedDoc, this.imageDB, this.bibDB, this.progressCallback);
                return shrinker.init();
            });
        }
        else {
            const shrinker = new ShrinkFidus(this.doc, this.imageDB, this.bibDB, this.progressCallback);
            shrinkerPromise = shrinker.init();
        }
        return shrinkerPromise
            .then(({ doc, shrunkImageDB, shrunkBibDB, httpIncludes }) => {
            this.progressCallback?.(gettext("Importing copy..."), 80);
            let targetE2EEPromise;
            if (this.e2eeOptions?.targetE2EE) {
                targetE2EEPromise = this._setupTargetE2EE(doc, shrunkImageDB);
            }
            else {
                targetE2EEPromise = Promise.resolve({
                    doc,
                    e2eeOptions: null
                });
            }
            return targetE2EEPromise.then(({ doc: encryptedDoc, e2eeOptions }) => {
                const importerE2EEOptions = e2eeOptions || {};
                if (this.e2eeOptions?.sourceKey) {
                    ;
                    importerE2EEOptions.sourceKey =
                        this.e2eeOptions.sourceKey;
                }
                return this.importDocument(encryptedDoc, {
                    db: shrunkBibDB
                }, {
                    db: shrunkImageDB
                }, httpIncludes, {
                    user: this.newUser,
                    importId: this.importId,
                    requestedPath: this._requestedPath(),
                    e2eeOptions: importerE2EEOptions
                }).then(result => {
                    this.progressCallback?.(gettext("Copy created."), 100);
                    return result;
                });
            });
        });
    }
    async _decryptDocument() {
        const key = this.e2eeOptions?.sourceKey;
        if (!key) {
            throw new Error("Missing source E2EE key for decryption");
        }
        if (!this.e2ee) {
            throw new Error("Missing E2EE helper");
        }
        const decryptedDoc = Object.assign({}, this.doc);
        if (typeof decryptedDoc.content === "string") {
            decryptedDoc.content = (await this.e2ee.decryptObject(decryptedDoc.content, key));
        }
        if (typeof decryptedDoc.comments === "string") {
            decryptedDoc.comments = await this.e2ee.decryptObject(decryptedDoc.comments, key);
        }
        if (typeof decryptedDoc.bibliography === "string") {
            decryptedDoc.bibliography = await this.e2ee.decryptObject(decryptedDoc.bibliography, key);
        }
        if (this.bibDB && typeof this.bibDB.db === "string") {
            this.bibDB.db = decryptedDoc.bibliography;
        }
        if (this.imageDB && this.imageDB.db) {
            await Promise.all(Object.values(this.imageDB.db).map(async (imageEntry) => {
                const copyright = imageEntry.copyright;
                if (typeof copyright === "string" &&
                    copyright.length > 0) {
                    try {
                        imageEntry.copyright =
                            (await this.e2ee.decryptObject(copyright, key));
                    }
                    catch (_e) {
                        // If decryption fails, leave as-is
                    }
                }
            }));
        }
        return decryptedDoc;
    }
    async _setupTargetE2EE(doc, shrunkImageDB) {
        const password = this.e2eeOptions
            .targetPassword;
        if (!password) {
            throw new Error("Missing target E2EE password");
        }
        if (!this.e2ee) {
            throw new Error("Missing E2EE helper");
        }
        const salt = this.e2ee.generateSalt();
        const saltBase64 = btoa(String.fromCharCode(...salt));
        const iterations = 600000;
        const key = await this.e2ee.deriveKey(password, salt, iterations);
        const plainDoc = Object.assign({}, doc);
        if (shrunkImageDB) {
            await Promise.all(Object.values(shrunkImageDB).map(async (imageEntry) => {
                if (imageEntry.file) {
                    try {
                        const encryptedFile = await this.e2ee.encryptImage(imageEntry.file, key);
                        imageEntry.file = encryptedFile;
                        imageEntry.original_file_type = imageEntry.file_type;
                        imageEntry.file_type = "application/octet-stream";
                    }
                    catch (_e) {
                        // If encryption fails, keep original file
                    }
                }
                if (imageEntry.copyright) {
                    try {
                        imageEntry.copyright = await this.e2ee.encryptObject(imageEntry.copyright, key);
                    }
                    catch (_e) {
                        // If encryption fails, keep original
                    }
                }
            }));
        }
        return {
            doc: plainDoc,
            e2eeOptions: {
                enabled: true,
                key,
                salt: saltBase64,
                iterations
            }
        };
    }
}
//# sourceMappingURL=copy.js.map