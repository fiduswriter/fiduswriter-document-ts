/**
 * Shared citation utilities for DOCX and ODT importers.
 */
function mergeBibEntries(entries, bibliography, bibDB) {
    const keyMap = {};
    for (const entry of Object.values(entries)) {
        if (!entry || !entry.entry_key) {
            continue;
        }
        const entryKey = entry.entry_key;
        // Check whether this entry_key is already in the bibliography.
        const existing = Object.entries(bibliography).find(([, bibEntry]) => {
            if (!bibEntry ||
                typeof bibEntry !== "object" ||
                Array.isArray(bibEntry)) {
                return false;
            }
            return bibEntry.entry_key === entryKey;
        });
        if (existing) {
            keyMap[entryKey] = existing[0];
        }
        else {
            if (bibDB && Object.keys(entry.fields).length === 0) {
                // Jabref citations don't contain any fields. Look up values in bibDB instead
                const bibEntry = Object.values(bibDB.db).find(bibEntry => bibEntry && bibEntry.entry_key === entryKey);
                if (bibEntry) {
                    entry.fields = JSON.parse(JSON.stringify(bibEntry.fields));
                    if (bibEntry.bib_type) {
                        entry.bib_type = bibEntry.bib_type;
                    }
                }
            }
            // TODO: add for jabref citations - according to entry_key import from user
            // library if useExternalDB is true
            const bibKey = String(Object.keys(bibliography).length + 1);
            bibliography[bibKey] = entry;
            keyMap[entryKey] = bibKey;
        }
    }
    return keyMap;
}
export function citationResultToNode(result, bibliography, bibDB = false) {
    if (!result || !result.isCitation || !result.entries) {
        return null;
    }
    const entries = result.entries;
    const metadata = result.metadata || [];
    if (Object.keys(entries).length === 0) {
        return null;
    }
    const keyMap = mergeBibEntries(entries, bibliography, bibDB);
    const references = Object.values(entries).map(entry => {
        const entryKey = entry.entry_key;
        const entryMetadata = metadata.find(meta => meta.entry_key === entryKey);
        return {
            id: keyMap[entryKey],
            prefix: entryMetadata?.prefix || "",
            locator: entryMetadata?.locator || entryMetadata?.suffix || ""
        };
    });
    if (references.length === 0) {
        return null;
    }
    const format = metadata.length === 1 &&
        (metadata[0].authorOnly || metadata[0].authorYear)
        ? "textcite"
        : "autocite";
    return {
        type: "citation",
        attrs: {
            format,
            references
        }
    };
}
//# sourceMappingURL=citations.js.map