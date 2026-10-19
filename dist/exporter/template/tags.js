export function extractTemplateTags(docContent) {
    const tags = [];
    for (const node of docContent.content) {
        switch (node.type) {
            case "title":
                tags.push({
                    title: "title",
                    type: "inline",
                    partType: "title",
                    id: "title",
                    partTitle: "Title"
                });
                break;
            case "heading_part":
                tags.push({
                    title: String(node.attrs?.id || "heading"),
                    type: "inline",
                    partType: "heading_part",
                    id: String(node.attrs?.id || "heading"),
                    partTitle: String(node.attrs?.title || node.attrs?.id || "Heading")
                });
                break;
            case "richtext_part":
            case "table_part":
                tags.push({
                    title: `@${node.attrs?.id || "part"}`,
                    type: "block",
                    partType: node.type,
                    id: String(node.attrs?.id || "part"),
                    partTitle: String(node.attrs?.title || node.attrs?.id || "Part")
                });
                break;
            case "contributors_part":
                tags.push({
                    title: String(node.attrs?.id || "contributors"),
                    type: "inline",
                    partType: "contributors_part",
                    id: String(node.attrs?.id || "contributors"),
                    partTitle: String(node.attrs?.title ||
                        node.attrs?.item_title ||
                        "Contributors")
                });
                break;
            case "tags_part":
                tags.push({
                    title: String(node.attrs?.id || "tags"),
                    type: "inline",
                    partType: "tags_part",
                    id: String(node.attrs?.id || "tags"),
                    partTitle: String(node.attrs?.title || node.attrs?.item_title || "Tags")
                });
                break;
        }
    }
    tags.push({
        title: "@bibliography",
        type: "block",
        partType: "bibliography",
        id: "bibliography",
        partTitle: "Bibliography"
    });
    tags.push({
        title: "@copyright",
        type: "block",
        partType: "copyright",
        id: "copyright",
        partTitle: "Copyright"
    });
    tags.push({
        title: "@licenses",
        type: "block",
        partType: "licenses",
        id: "licenses",
        partTitle: "Licenses"
    });
    return tags;
}
//# sourceMappingURL=tags.js.map