function parseReferences(str) {
    if (!str) {
        return [];
    }
    let references;
    try {
        references = JSON.parse(str);
    }
    catch (_error) {
        return [];
    }
    if (!Array.isArray(references)) {
        return [];
    }
    return references
        .filter((ref) => typeof ref === "object" && ref !== null && Object.prototype.hasOwnProperty.call(ref, "id"))
        .map(ref => {
        const mRef = { id: Number(ref.id) };
        if (ref.locator) {
            mRef.locator = String(ref.locator);
        }
        if (ref.prefix) {
            mRef.prefix = String(ref.prefix);
        }
        return mRef;
    });
}
export const citation = {
    inline: true,
    group: "inline",
    attrs: {
        format: {
            default: "autocite" // "autocite" or "textcite"
        },
        references: {
            default: [] // array of {id[, locator][, prefix]}
        }
    },
    parseDOM: [
        {
            tag: "span.citation",
            getAttrs(dom) {
                return {
                    format: dom.dataset.format || "",
                    references: parseReferences(dom.dataset.references)
                };
            }
        }
    ],
    toDOM(node) {
        return [
            "span",
            {
                class: "citation",
                "data-format": node.attrs.format,
                "data-references": JSON.stringify(node.attrs.references)
            }
        ];
    }
};
//# sourceMappingURL=citation.js.map