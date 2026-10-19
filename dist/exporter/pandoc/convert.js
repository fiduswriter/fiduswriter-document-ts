import { getImageDBEntryFilename } from "../tools/file.js";
import { convertContributor, convertText } from "./tools.js";
export class PandocExporterConvert {
    exporter;
    settings;
    imageDB;
    bibDB;
    imageIds;
    usedBibDB;
    internalLinks;
    categoryCounter;
    metaData;
    constructor(exporter, imageDB, bibDB, settings) {
        this.exporter = exporter;
        this.settings = settings;
        this.imageDB = imageDB;
        this.bibDB = bibDB;
        this.imageIds = [];
        this.usedBibDB = {};
        this.internalLinks = [];
        this.categoryCounter = {}; // counters for each type of figure (figure/table/photo)
        this.metaData = {
            toc: []
        };
    }
    init(doc) {
        this.preWalkJson(doc);
        const meta = {
            lang: {
                t: "MetaInlines",
                c: [{ t: "Str", c: (this.settings.language || "en").split("-")[0] }]
            }
        };
        const json = {
            "pandoc-api-version": [1, 23, 1],
            meta,
            blocks: this.convertContent(doc.content, meta)
        };
        const returnObject = {
            json,
            imageIds: this.imageIds,
            usedBibDB: this.usedBibDB
        };
        return returnObject;
    }
    // Find information for meta tags in header
    preWalkJson(node) {
        const fn = node;
        switch (fn.type) {
            case "heading1":
            case "heading2":
            case "heading3":
            case "heading4":
            case "heading5":
            case "heading6": {
                const level = Number.parseInt(fn.type.slice(-1));
                this.metaData.toc.push({
                    t: "Header",
                    c: [
                        level,
                        [fn.attrs.id || "", [], []],
                        this.convertContent(fn.content || [], {})
                    ]
                });
                break;
            }
            default:
                break;
        }
        if (fn.content) {
            fn.content.forEach(child => this.preWalkJson(child));
        }
    }
    // Function to convert Fidus Writer content to Pandoc format
    convertContent(docContent, meta, options = { inFootnote: false, inCode: false }) {
        const pandocContent = [];
        for (const node of docContent) {
            const fn = node;
            switch (fn.type) {
                case "doc":
                    // We only handle doc children
                    break;
                case "blockquote": {
                    pandocContent.push({
                        t: "BlockQuote",
                        c: this.convertContent(fn.content, meta, options)
                    });
                    break;
                }
                case "bullet_list": {
                    const c = [];
                    pandocContent.push({
                        t: "BulletList",
                        c
                    });
                    if (fn.content) {
                        fn.content.forEach(listItem => c.push(this.convertContent(listItem.content || [], meta, options)));
                    }
                    break;
                }
                case "citation": {
                    if (options.inFootnote) {
                        // TODO: handle citations in footnotes
                        break;
                    }
                    const cit = this.exporter.citations.pmCits.shift();
                    if (!cit) {
                        break;
                    }
                    const references = (fn.attrs?.references || []);
                    const pandocReferences = references
                        .map((reference) => {
                        const bibDBEntry = this.bibDB.db[String(reference.id)];
                        if (!bibDBEntry) {
                            // Not present in bibliography database, skip it.
                            return false;
                        }
                        if (!this.usedBibDB[String(reference.id)]) {
                            const citationKey = this.createUniqueCitationKey(bibDBEntry.entry_key);
                            this.usedBibDB[String(reference.id)] = Object.assign({}, bibDBEntry);
                            this.usedBibDB[String(reference.id)].entry_key =
                                citationKey;
                        }
                        return {
                            citationId: this.usedBibDB[String(reference.id)].entry_key,
                            citationPrefix: convertText(reference.prefix || ""),
                            citationSuffix: convertText(reference.locator || ""),
                            citationMode: {
                                t: fn.attrs.format === "textcite"
                                    ? "AuthorInText"
                                    : "NormalCitation"
                            },
                            citationNoteNum: 1,
                            citationHash: 0
                        };
                    })
                        .filter((reference) => Boolean(reference));
                    if (!pandocReferences.length) {
                        break;
                    }
                    const pandocRendering = this.convertContent(cit.content || [], meta, options);
                    const pandocElement = {
                        t: "Cite",
                        c: [pandocReferences, pandocRendering]
                    };
                    if (fn.content) {
                        this.convertContent(fn.content, meta, options).forEach(el => pandocElement.c[1].push(el));
                    }
                    pandocContent.push(pandocElement);
                    break;
                }
                case "code_block": {
                    options = Object.assign({}, options);
                    options.inCode = true;
                    const classes = fn.attrs.language
                        ? [fn.attrs.language]
                        : [];
                    const keyValuePairs = [];
                    // Add caption if title is present
                    if (fn.attrs.title) {
                        keyValuePairs.push([
                            "caption",
                            String(fn.attrs.title)
                        ]);
                    }
                    // Add category as custom attribute for round-trip fidelity
                    if (fn.attrs.category) {
                        keyValuePairs.push([
                            "category",
                            String(fn.attrs.category)
                        ]);
                    }
                    // Use id if present, otherwise empty string
                    const id = fn.attrs.id || "";
                    const attrs = [id, classes, keyValuePairs];
                    pandocContent.push({
                        t: "CodeBlock",
                        c: [
                            attrs,
                            this.convertContent(fn.content, meta, options)
                                .map(item => {
                                if (item.t === "Str") {
                                    return item.c;
                                }
                                else if (item.t === "Space") {
                                    return " ";
                                }
                                else if (item.t === "SoftBreak" ||
                                    item.t === "LineBreak") {
                                    return "\n";
                                }
                                return "";
                            })
                                .join("")
                        ]
                    });
                    break;
                }
                case "contributor":
                    // dealt with in contributors_part
                    break;
                case "contributors_part": {
                    if (!fn.content || !fn.content.length) {
                        break;
                    }
                    if (fn.attrs?.metadata === "authors") {
                        if (!meta.author) {
                            meta.author = { t: "MetaList", c: [] };
                        }
                        const convertedContributors = fn.content
                            .map(contributor => convertContributor(contributor.attrs))
                            .filter(Boolean);
                        convertedContributors.forEach(contributor => meta.author.c.push(contributor));
                    }
                    else {
                        pandocContent.push({
                            t: "Div",
                            c: [
                                [
                                    fn.attrs?.id || "",
                                    [
                                        "doc-part",
                                        "doc-contributors",
                                        fn.attrs?.id
                                            ? `doc-${fn.attrs.id}`
                                            : "doc-div",
                                        `doc-${fn.attrs?.metadata || "other"}`
                                    ],
                                    []
                                ],
                                [
                                    {
                                        t: "Para",
                                        c: convertText(fn.content
                                            .map(contributor => `${contributor.attrs?.firstname || ""} ${contributor.attrs?.lastname || ""}, ${contributor.attrs?.institution || ""}, ${contributor.attrs?.email || ""}`)
                                            .join("; "))
                                    }
                                ]
                            ]
                        });
                    }
                    break;
                }
                case "cross_reference": {
                    // TODO: use real cross reference instead of link.
                    pandocContent.push({
                        t: "Link",
                        c: [
                            ["", ["reference"], []],
                            convertText(String(fn.attrs?.title || "MISSING TARGET")),
                            [`#${fn.attrs?.id || ""}`, ""]
                        ]
                    });
                    break;
                }
                case "heading_part": {
                    if (!fn.content || !fn.content.length) {
                        break;
                    }
                    if (fn.attrs?.metadata === "subtitle" && !meta.subtitle) {
                        if (fn.content?.length && fn.content[0].content) {
                            meta.subtitle = {
                                t: "MetaInlines",
                                c: this.convertContent(fn.content[0].content, meta, options)
                            };
                        }
                    }
                    else {
                        const pandocElement = {
                            t: "Header",
                            c: [2, [String(fn.attrs?.metadata || ""), [], []], []]
                        };
                        if (fn.content) {
                            this.convertContent(fn.content, meta, options).forEach(el => pandocElement.c[2].push(el));
                        }
                        pandocContent.push({
                            t: "Div",
                            c: [
                                [
                                    fn.attrs?.id || "",
                                    [
                                        "doc-part",
                                        "doc-heading",
                                        fn.attrs?.id
                                            ? `doc-${fn.attrs.id}`
                                            : "doc-div",
                                        `doc-${fn.attrs?.metadata || "other"}`
                                    ],
                                    []
                                ],
                                [pandocElement]
                            ]
                        });
                    }
                    break;
                }
                case "equation": {
                    pandocContent.push({
                        t: "Span",
                        c: [
                            ["", ["equation"], []],
                            [
                                {
                                    t: "Math",
                                    c: [{ t: "InlineMath" }, fn.attrs.equation]
                                }
                            ]
                        ]
                    });
                    break;
                }
                case "figure": {
                    const image = fn.content.find(child => child.type === "image")
                        ?.attrs?.image || false;
                    const caption = fn.attrs?.caption
                        ? (fn.content.find(child => child.type === "figure_caption")?.content || [])
                        : [];
                    const equation = fn.content.find(child => child.type === "figure_equation")?.attrs?.equation;
                    if (image !== false) {
                        this.imageIds.push(image);
                        const imageDBEntry = this.imageDB.db[image];
                        const copyright = imageDBEntry?.copyright;
                        const imageFilename = getImageDBEntryFilename(imageDBEntry, image);
                        if (fn.attrs?.category === "none" &&
                            imageFilename &&
                            !caption.length &&
                            (!copyright || !copyright.holder)) {
                            pandocContent.push({
                                t: "Plain",
                                c: [
                                    {
                                        t: "Image",
                                        c: [
                                            [
                                                fn.attrs?.id || "",
                                                [],
                                                [
                                                    [
                                                        "data-width",
                                                        String(fn.attrs?.width)
                                                    ],
                                                    [
                                                        "width",
                                                        `${String(fn.attrs?.width)}%`
                                                    ]
                                                ]
                                            ],
                                            [],
                                            [imageFilename, ""]
                                        ]
                                    }
                                ]
                            });
                        }
                        else {
                            pandocContent.push({
                                t: "Figure",
                                c: [
                                    [
                                        fn.attrs?.id || "",
                                        [
                                            `aligned-${String(fn.attrs?.aligned)}`,
                                            `image-width-${String(fn.attrs?.width)}`
                                        ],
                                        [
                                            ["aligned", String(fn.attrs?.aligned)],
                                            [
                                                "data-width",
                                                String(fn.attrs?.width)
                                            ],
                                            ["width", `${String(fn.attrs?.width)}%`],
                                            ["category", String(fn.attrs?.category)]
                                        ]
                                    ],
                                    [
                                        null,
                                        caption.length
                                            ? [
                                                {
                                                    t: "Para",
                                                    c: this.convertContent(caption, meta, options)
                                                }
                                            ]
                                            : []
                                    ],
                                    [
                                        {
                                            t: "Plain",
                                            c: [
                                                {
                                                    t: "Image",
                                                    c: [
                                                        [
                                                            "",
                                                            [],
                                                            [
                                                                [
                                                                    "width",
                                                                    `${String(fn.attrs?.width)}%`
                                                                ]
                                                            ]
                                                        ],
                                                        [],
                                                        [imageFilename, ""]
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                ]
                            });
                        }
                    }
                    else if (equation) {
                        pandocContent.push({
                            t: "Figure",
                            c: [
                                [
                                    fn.attrs?.id || "",
                                    [
                                        `aligned-${String(fn.attrs?.aligned)}`,
                                        `image-width-${String(fn.attrs?.width)}`
                                    ],
                                    [
                                        ["aligned", String(fn.attrs?.aligned)],
                                        [
                                            "data-width",
                                            String(fn.attrs?.width)
                                        ],
                                        ["width", `${String(fn.attrs?.width)}%`],
                                        ["category", String(fn.attrs?.category)]
                                    ]
                                ],
                                [
                                    null,
                                    caption.length
                                        ? [
                                            {
                                                t: "Para",
                                                c: this.convertContent(caption, meta, options)
                                            }
                                        ]
                                        : []
                                ],
                                [
                                    {
                                        t: "Math",
                                        c: [
                                            { t: "DisplayMath" },
                                            equation
                                        ]
                                    }
                                ]
                            ]
                        });
                    }
                    // TODO: figure attributes like copyright info etc.
                    break;
                }
                case "figure_caption":
                case "figure_equation":
                    // Dealt with in figure
                    break;
                case "footnote": {
                    options = Object.assign({}, options);
                    options.inFootnote = true;
                    pandocContent.push({
                        t: "Note",
                        c: this.convertContent(fn.attrs.footnote, meta, options)
                    });
                    break;
                }
                case "footnotecontainer":
                    // Dealt with in footnote
                    break;
                case "hard_break":
                    pandocContent.push({ t: "LineBreak" });
                    break;
                case "heading1":
                case "heading2":
                case "heading3":
                case "heading4":
                case "heading5":
                case "heading6": {
                    const level = Number.parseInt(fn.type.slice(-1));
                    pandocContent.push({
                        t: "Header",
                        c: [
                            level,
                            [fn.attrs.id || "", [], []],
                            this.convertContent(fn.content || [], meta, options)
                        ]
                    });
                    break;
                }
                case "image":
                    // Handled by figure
                    break;
                case "list_item":
                    // handled by ordered_list and bullet_list
                    break;
                case "ordered_list": {
                    const c = [];
                    pandocContent.push({
                        t: "OrderedList",
                        c: [
                            [
                                Number(fn.attrs?.order) || 1,
                                { t: "DefaultStyle" },
                                { t: "DefaultDelim" }
                            ], // list attributes
                            c
                        ]
                    });
                    if (fn.content) {
                        fn.content.forEach(listItem => c.push(this.convertContent(listItem.content || [], meta, options)));
                    }
                    break;
                }
                case "paragraph": {
                    pandocContent.push({
                        t: "Para",
                        c: fn.content
                            ? this.convertContent(fn.content, meta, options)
                            : []
                    });
                    break;
                }
                case "richtext_part": {
                    if (!fn.content || !fn.content.length) {
                        break;
                    }
                    if (fn.attrs?.metadata === "abstract" && !meta.abstract) {
                        meta.abstract = {
                            t: "MetaBlocks",
                            c: this.convertContent(fn.content, meta, options)
                        };
                    }
                    else {
                        pandocContent.push({
                            t: "Div",
                            c: [
                                [
                                    fn.attrs.id || "",
                                    [
                                        "doc-part",
                                        "doc-richtext",
                                        fn.attrs.id
                                            ? `doc-${fn.attrs.id}`
                                            : "doc-div",
                                        `doc-${fn.attrs.metadata || "other"}`
                                    ],
                                    []
                                ],
                                this.convertContent(fn.content, meta, options)
                            ]
                        });
                    }
                    break;
                }
                case "separator_part":
                    pandocContent.push({
                        t: "HorizontalRule",
                        c: [
                            [
                                fn.attrs.id || "",
                                [
                                    "doc-part",
                                    "doc-separator",
                                    fn.attrs.id
                                        ? `doc-${fn.attrs.id}`
                                        : "doc-hr",
                                    `doc-${fn.attrs.metadata || "other"}`
                                ],
                                []
                            ],
                            []
                        ]
                    });
                    break;
                case "tag":
                    // Handled by tags_part
                    break;
                case "tags_part": {
                    if (!fn.content || !fn.content.length) {
                        break;
                    }
                    pandocContent.push({
                        t: "Div",
                        c: [
                            [
                                fn.attrs?.id || "",
                                [
                                    "doc-part",
                                    "doc-tags",
                                    fn.attrs?.id
                                        ? `doc-${fn.attrs.id}`
                                        : "doc-div",
                                    `doc-${fn.attrs?.metadata || "other"}`
                                ],
                                []
                            ],
                            [
                                {
                                    t: "Para",
                                    c: convertText(fn.content
                                        .map(tag => String(tag.attrs?.tag))
                                        .join("; "))
                                }
                            ]
                        ]
                    });
                    break;
                }
                case "table": {
                    // Tables seem to have this structure in pandoc json:
                    // If table has no rows with content, skip.
                    const tableBodyNode = fn.content.find(childNode => childNode.type === "table_body" &&
                        childNode.content &&
                        childNode.content.length);
                    const tableFirstRow = tableBodyNode
                        ? tableBodyNode.content.find(childNode => childNode.type === "table_row" &&
                            childNode.content &&
                            childNode.content.length)
                        : undefined;
                    if (!tableFirstRow) {
                        break;
                    }
                    const c = [];
                    pandocContent.push({
                        t: "Table",
                        c
                    });
                    // child 0: attributes of the table.
                    c.push([
                        fn.attrs?.id || "",
                        [
                            `table-${String(fn.attrs?.width)}`,
                            `table-${String(fn.attrs?.aligned)}`,
                            `table-${String(fn.attrs?.layout)}`
                        ],
                        [
                            ["data-width", String(fn.attrs?.width)],
                            ["width", `${String(fn.attrs?.width)}%`],
                            ["aligned", String(fn.attrs?.aligned)],
                            ["layout", String(fn.attrs?.layout)],
                            ["category", String(fn.attrs?.category)]
                        ]
                    ]);
                    // child 1: table caption
                    const tableCaptionNode = fn.content.find(childNode => childNode.type === "table_caption" &&
                        childNode.content &&
                        childNode.content.length);
                    if (tableCaptionNode) {
                        c.push([
                            null,
                            [
                                {
                                    t: "Plain",
                                    c: this.convertContent(tableCaptionNode.content || [], meta, options)
                                }
                            ]
                        ]);
                    }
                    else {
                        c.push([null, []]);
                    }
                    // child 2: settings for each column
                    c.push(tableFirstRow.content.map(_column => [
                        { t: "AlignDefault" },
                        { t: "ColWidthDefault" }
                    ]));
                    // child 3: ?
                    c.push([["", [], []], []]);
                    // child 4: Each child represents one table row
                    const tableHead = [];
                    const tableBody = [];
                    c.push([["", [], []], 0, tableHead, tableBody]);
                    let currentTablePart = tableHead;
                    this.convertContent(tableBodyNode.content, meta, options).forEach((row, index) => {
                        if (currentTablePart === tableHead &&
                            tableBodyNode.content[index].content?.find(cell => cell.type === "table_cell")) {
                            // If at least one regular table cell is found in the row, we assume the table header hs finished.
                            currentTablePart = tableBody;
                        }
                        currentTablePart.push(row);
                    });
                    // last child: Unclear meaning
                    c.push([["", [], []], []]);
                    // Don't process content as we do that by calling convertContent above already.
                    //processContent = false
                    break;
                }
                case "table_body":
                case "table_caption":
                    // Handled directly through table tag.
                    break;
                case "table_cell":
                case "table_header": {
                    if (fn.content) {
                        pandocContent.push([
                            ["", [], []],
                            { t: "AlignDefault" },
                            fn.attrs?.rowspan || 1,
                            fn.attrs?.colspan || 1,
                            this.convertContent(fn.content, meta, options)
                        ]);
                    }
                    break;
                }
                case "table_part":
                    pandocContent.push({
                        t: "Div",
                        c: [
                            [
                                fn.attrs.id || "",
                                [
                                    "doc-part",
                                    "doc-table",
                                    fn.attrs.id
                                        ? `doc-${fn.attrs.id}`
                                        : "doc-div",
                                    `doc-${fn.attrs.metadata || "other"}`
                                ],
                                []
                            ],
                            this.convertContent(fn.content, meta, options)
                        ]
                    });
                    break;
                case "table_of_contents": {
                    pandocContent.push({
                        t: "Div",
                        c: [
                            [
                                fn.attrs.id || "",
                                [
                                    "doc-part",
                                    "doc-table-of-contents",
                                    fn.attrs.id
                                        ? `doc-${fn.attrs.id}`
                                        : "doc-div",
                                    `doc-${fn.attrs.metadata || "other"}`
                                ],
                                []
                            ],
                            [
                                {
                                    t: "Header",
                                    c: [
                                        1,
                                        ["", ["toc"], []],
                                        convertText(fn.attrs.title)
                                    ]
                                }
                            ].concat(this.metaData.toc)
                        ]
                    });
                    break;
                }
                case "table_row": {
                    pandocContent.push({
                        t: "TableRow",
                        c: [
                            ["", [], []],
                            this.convertContent(fn.content, meta, options)
                        ]
                    });
                    break;
                }
                case "text": {
                    if (fn.text) {
                        let containerContent = pandocContent;
                        let strong, em, underline, hyperlink, anchor, sup, sub, code;
                        if (fn.marks) {
                            strong = fn.marks.find(mark => mark.type === "strong");
                            em = fn.marks.find(mark => mark.type === "em");
                            underline = fn.marks.find(mark => mark.type === "underline");
                            hyperlink = fn.marks.find(mark => mark.type === "link");
                            anchor = fn.marks.find(mark => mark.type === "anchor");
                            sup = fn.marks.find(mark => mark.type === "sup");
                            sub = fn.marks.find(mark => mark.type === "sub");
                            code = fn.marks.find(mark => mark.type === "code");
                        }
                        if (em) {
                            const c = [];
                            containerContent.push({
                                t: "Emph",
                                c
                            });
                            containerContent = c;
                        }
                        if (strong) {
                            const c = [];
                            containerContent.push({
                                t: "Strong",
                                c
                            });
                            containerContent = c;
                        }
                        if (underline) {
                            const c = [];
                            containerContent.push({
                                t: "Underline",
                                c
                            });
                            containerContent = c;
                        }
                        if (sup) {
                            const c = [];
                            containerContent.push({
                                t: "Superscript",
                                c
                            });
                            containerContent = c;
                        }
                        if (sub) {
                            const c = [];
                            containerContent.push({
                                t: "Subscript",
                                c
                            });
                            containerContent = c;
                        }
                        if (code && !options.inCode) {
                            containerContent.push({
                                t: "Code",
                                c: [["", [], []], fn.text]
                            });
                            break;
                        }
                        if (hyperlink) {
                            const c = [];
                            containerContent.push({
                                t: "Link",
                                c: [["", [], []], c, [hyperlink.attrs.href, ""]]
                            });
                            containerContent = c;
                        }
                        if (anchor) {
                            const c = [];
                            containerContent.push({
                                t: "Span",
                                c: [[anchor.attrs.id, [], []], c]
                            });
                            containerContent = c;
                        }
                        if (options.inCode) {
                            containerContent.push({
                                t: "Code",
                                c: [["", [], []], fn.text]
                            });
                        }
                        else {
                            containerContent.push(...convertText(fn.text || ""));
                        }
                    }
                    break;
                }
                case "title": {
                    if (!fn.content || !fn.content.length) {
                        break;
                    }
                    if (!meta.title) {
                        meta.title = {
                            t: "MetaInlines",
                            c: this.convertContent(fn.content, meta, options)
                        };
                    }
                    else {
                        const pandocElement = {
                            t: "Header",
                            c: [1, ["title", [], []], []]
                        };
                        if (fn.content) {
                            this.convertContent(fn.content, meta, options).forEach(el => pandocElement.c[2].push(el));
                        }
                        pandocContent.push(pandocElement);
                    }
                    break;
                }
                default: {
                    console.warn(`Not handled: ${fn.type}`, { node });
                    break;
                }
            }
        }
        return pandocContent;
    }
    createUniqueCitationKey(suggestedKey) {
        suggestedKey = suggestedKey || "key";
        const usedKeys = Object.keys(this.usedBibDB).map(key => this.usedBibDB[key].entry_key);
        if (usedKeys.includes(suggestedKey)) {
            suggestedKey += "X";
            return this.createUniqueCitationKey(suggestedKey);
        }
        else {
            return suggestedKey;
        }
    }
}
//# sourceMappingURL=convert.js.map