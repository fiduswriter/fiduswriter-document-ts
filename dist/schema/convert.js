/* To convert to and from how the document is stored in the database to how ProseMirror expects it.
 We use the DOM import for ProseMirror as the JSON we store in the database is really jsonized HTML.
*/
import deepEqual from "fast-deep-equal";
import { randomFigureId, randomHeadingId, randomListId, randomTableId } from "./common/index.js";
export const getSettings = (pmDoc) => {
    const settings = JSON.parse(JSON.stringify(pmDoc.attrs));
    return settings;
};
export const updateDoc = (doc, docVersion, bibliography = false) => {
    /* This is to clean documents taking all the accepted formatting from older
       versions and outputting the current version of the doc format.
       Notice that the docVersion isn't the same as the version of the FW export
       file in Fidus Writer < 3.2 (docVersion/FW file versions versions -1.X).
       While the FW file version also says something about what files could be
       available inside the FW zip, the doc_version refers to how the data is
       stored in those files.
       In general, an update to the doc_version will likely also trigger an
       update to the version of the FW export file, the reverse is not always
       true.
    */
    let returnDoc = JSON.parse(JSON.stringify(doc));
    switch (docVersion) {
        // Import from versions up to 3.0 no longer supported starting with Fidus Writer 3.5
        case 1: // Fidus Writer 3.1 prerelease
            returnDoc = convertDocV1(returnDoc);
            returnDoc = convertDocV11(returnDoc);
            returnDoc = convertDocV12(returnDoc);
            returnDoc = convertDocV13(returnDoc, bibliography);
            returnDoc = convertDocV20(returnDoc);
            returnDoc = convertDocV21(returnDoc);
            returnDoc = convertDocV22(returnDoc);
            returnDoc = convertDocV23(returnDoc);
            returnDoc = convertDocV30(returnDoc);
            returnDoc = convertDocV31(returnDoc);
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 1.1: // Fidus Writer 3.1
            returnDoc = convertDocV11(returnDoc);
            returnDoc = convertDocV12(returnDoc);
            returnDoc = convertDocV13(returnDoc, bibliography);
            returnDoc = convertDocV20(returnDoc);
            returnDoc = convertDocV21(returnDoc);
            returnDoc = convertDocV22(returnDoc);
            returnDoc = convertDocV23(returnDoc);
            returnDoc = convertDocV30(returnDoc);
            returnDoc = convertDocV31(returnDoc);
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 1.2: // Fidus Writer 3.2
            returnDoc = convertDocV12(returnDoc);
            returnDoc = convertDocV13(returnDoc, bibliography);
            returnDoc = convertDocV20(returnDoc);
            returnDoc = convertDocV21(returnDoc);
            returnDoc = convertDocV22(returnDoc);
            returnDoc = convertDocV23(returnDoc);
            returnDoc = convertDocV30(returnDoc);
            returnDoc = convertDocV31(returnDoc);
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 1.3: // Fidus Writer 3.3 prerelease
            returnDoc = convertDocV13(returnDoc, bibliography);
            returnDoc = convertDocV20(returnDoc);
            returnDoc = convertDocV21(returnDoc);
            returnDoc = convertDocV22(returnDoc);
            returnDoc = convertDocV23(returnDoc);
            returnDoc = convertDocV30(returnDoc);
            returnDoc = convertDocV31(returnDoc);
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 2.0: // Fidus Writer 3.3
            returnDoc = convertDocV20(returnDoc);
            returnDoc = convertDocV21(returnDoc);
            returnDoc = convertDocV22(returnDoc);
            returnDoc = convertDocV23(returnDoc);
            returnDoc = convertDocV30(returnDoc);
            returnDoc = convertDocV31(returnDoc);
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 2.1: // Fidus Writer 3.4
            returnDoc = convertDocV21(returnDoc);
            returnDoc = convertDocV22(returnDoc);
            returnDoc = convertDocV23(returnDoc);
            returnDoc = convertDocV30(returnDoc);
            returnDoc = convertDocV31(returnDoc);
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 2.2: // Fidus Writer 3.5.7
            returnDoc = convertDocV22(returnDoc);
            returnDoc = convertDocV23(returnDoc);
            returnDoc = convertDocV30(returnDoc);
            returnDoc = convertDocV31(returnDoc);
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 2.3: // Fidus Writer 3.5.10
            returnDoc = convertDocV23(returnDoc);
            returnDoc = convertDocV30(returnDoc);
            returnDoc = convertDocV31(returnDoc);
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 3.0: // Fidus Writer 3.6
            returnDoc = convertDocV30(returnDoc);
            returnDoc = convertDocV31(returnDoc);
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 3.1: // Fidus Writer 3.7
            returnDoc = convertDocV31(returnDoc);
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 3.2: // Fidus Writer 3.8
            returnDoc = convertDocV32(returnDoc);
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 3.3: // Fidus Writer 3.9
            returnDoc = convertDocV33(returnDoc);
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 3.4: // Fidus Writer 3.10
            returnDoc = convertDocV34(returnDoc);
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 3.5: // Fidus Writer 4.0
            returnDoc = convertDocV35(returnDoc);
            returnDoc = convertDocV36(returnDoc);
            break;
        case 3.6: // Fidus Writer 4.1
            returnDoc = convertDocV36(returnDoc);
            break;
        case 3.7: // Fidus Writer 5.0
            break;
    }
    return returnDoc;
};
const convertDocV1 = (doc) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    if (returnDoc.content) {
        convertNodeV1(returnDoc.content);
    }
    return returnDoc;
};
const convertNodeV1 = (node) => {
    let prefixes, locators, ids, references;
    const nodeAttrs = node.attrs ?? {};
    switch (node.type) {
        case "citation": {
            prefixes = nodeAttrs.bibBefore
                ? String(nodeAttrs.bibBefore).split(",,,")
                : [];
            locators = nodeAttrs.bibPage
                ? String(nodeAttrs.bibPage).split(",,,")
                : [];
            ids = nodeAttrs.bibEntry
                ? String(nodeAttrs.bibEntry).split(",")
                : [];
            references = ids.map((id, index) => {
                const returnObj = { id: Number.parseInt(id) };
                if (prefixes[index] !== "") {
                    returnObj.prefix = prefixes[index];
                }
                if (locators[index] !== "") {
                    returnObj.locator = locators[index];
                }
                return returnObj;
            });
            node.attrs = {
                format: nodeAttrs.bibFormat,
                references
            };
            break;
        }
        case "footnote":
            if (nodeAttrs.footnote) {
                ;
                nodeAttrs.footnote.forEach(childNode => {
                    convertNodeV1(childNode);
                });
            }
            break;
    }
    if (node.content) {
        node.content.forEach(childNode => {
            convertNodeV1(childNode);
        });
    }
};
const convertDocV11 = (doc) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    if (returnDoc.content) {
        convertNodeV11(returnDoc.content);
    }
    return returnDoc;
};
const convertNodeV11 = (node, ids = []) => {
    let blockId;
    switch (node.type) {
        case "heading":
            blockId = node.attrs?.id;
            while (!blockId || ids.includes(blockId)) {
                blockId = randomHeadingId();
            }
            if (!node.attrs) {
                node.attrs = {};
            }
            node.attrs.id = blockId;
            ids.push(blockId);
            break;
    }
    if (node.content) {
        node.content.forEach(childNode => {
            convertNodeV11(childNode, ids);
        });
    }
};
const convertDocV12 = (doc) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    if (returnDoc.content) {
        convertNodeV12(returnDoc.content);
    }
    return returnDoc;
};
const convertNodeV12 = (node, ids = []) => {
    let blockId;
    switch (node.type) {
        case "figure":
            blockId = node.attrs?.id;
            while (!blockId || ids.includes(blockId)) {
                blockId = randomFigureId();
            }
            if (!node.attrs) {
                node.attrs = {};
            }
            node.attrs.id = blockId;
            ids.push(blockId);
            break;
    }
    if (node.content) {
        node.content.forEach(childNode => {
            convertNodeV12(childNode, ids);
        });
    }
};
const convertDocV13 = (doc, bibliography) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    delete returnDoc.settings;
    delete returnDoc.metadata;
    returnDoc.bibliography = {};
    returnDoc.imageIds = [];
    const fullBib = bibliography || {};
    if (returnDoc.content) {
        convertNodeV13(returnDoc.content, returnDoc.bibliography, fullBib, returnDoc.imageIds);
    }
    return returnDoc;
};
const convertNodeV13 = (node, shrunkBib, fullBib, imageIds) => {
    let authorsText, keywordsText;
    const nodeAttrs = node.attrs ?? {};
    switch (node.type) {
        case "article":
            if (!node.attrs) {
                node.attrs = {};
            }
            node.attrs.language = "en-US";
            break;
        case "authors": {
            authorsText = node.content
                ? node.content.reduce((text, item) => item.type === "text" ? text + (item.text ?? "") : text, "")
                : "";
            const authorNodes = authorsText
                .split(/[,;]/g)
                .map(authorString => {
                const author = authorString.trim();
                if (!author.length) {
                    return false;
                }
                const authorParts = author.split(" ");
                return {
                    type: "author",
                    attrs: {
                        firstname: authorParts.length > 1
                            ? authorParts.shift()
                            : false,
                        lastname: authorParts.join(" "),
                        institution: false,
                        email: false
                    }
                };
            })
                .filter(authorObj => authorObj);
            node.content = authorNodes;
            if (!node.content.length) {
                delete node.content;
            }
            break;
        }
        case "citation":
            if (nodeAttrs.references) {
                ;
                nodeAttrs.references.forEach(ref => {
                    let item = fullBib[ref.id];
                    if (!item) {
                        item = {
                            fields: { title: [{ type: "text", text: "Deleted" }] },
                            bib_type: "misc",
                            entry_key: "FidusWriter"
                        };
                    }
                    item = Object.assign({}, item);
                    delete item.cats;
                    shrunkBib[ref.id] = item;
                });
            }
            break;
        case "keywords": {
            keywordsText = node.content
                ? node.content.reduce((text, item) => item.type === "text" ? text + (item.text ?? "") : text, "")
                : "";
            const keywordNodes = keywordsText
                .split(/[,;]/g)
                .map(keywordString => {
                const keyword = keywordString.trim();
                if (!keyword.length) {
                    return false;
                }
                return {
                    type: "keyword",
                    attrs: {
                        keyword
                    }
                };
            })
                .filter(keywordObj => keywordObj);
            node.content = keywordNodes;
            if (!node.content.length) {
                delete node.content;
            }
            break;
        }
        case "figure":
            if (isNaN(Number.parseInt(nodeAttrs.image))) {
                nodeAttrs.image = false;
            }
            else {
                imageIds.push(Number.parseInt(nodeAttrs.image));
            }
            node.attrs = nodeAttrs;
            break;
    }
    if (node.content) {
        node.content.forEach(childNode => {
            convertNodeV13(childNode, shrunkBib, fullBib, imageIds);
        });
    }
};
const convertDocV20 = (doc) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    delete returnDoc.added;
    delete returnDoc.is_owner;
    delete returnDoc.revisions;
    delete returnDoc.rights;
    delete returnDoc.updated;
    const content = returnDoc.content;
    if (content?.attrs) {
        content.attrs.tracked = false;
    }
    if (returnDoc.comments) {
        Object.values(returnDoc.comments).forEach(comment => {
            comment.username = comment.userName;
            comment.isMajor = comment["review:isMajor"];
            delete comment.userAvatar;
            delete comment.userName;
            delete comment["review:isMajor"];
            if (comment.answers) {
                comment.answers.forEach(answer => {
                    answer.username = answer.userName;
                    delete answer.userAvatar;
                    delete answer.userName;
                });
            }
        });
    }
    return returnDoc;
};
const convertNodeV21 = (node) => {
    let commentMark;
    if (node.marks &&
        (commentMark = node.marks.find(mark => mark.type === "comment"))) {
        const attrs = commentMark.attrs ?? {};
        attrs.id = String(attrs.id);
        commentMark.attrs = attrs;
    }
    if (node.content) {
        node.content.forEach(childNode => convertNodeV21(childNode));
    }
};
const convertDocV21 = (doc) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    if (returnDoc.content) {
        convertNodeV21(returnDoc.content);
    }
    if (returnDoc.comment) {
        Object.entries(returnDoc.comment).forEach(([commentId, comment]) => {
            delete comment.id;
            comment.assignedUser = false;
            comment.assignedUsername = false;
            comment.resolved = false;
            comment.comment = comment.comment
                .split("\n")
                .map(text => ({
                type: "paragraph",
                content: [{ type: "text", text }]
            }));
            if (comment.answers) {
                comment.answers.forEach(answer => {
                    answer.id = answer.answerId
                        ? String(answer.answerId)
                        : answer.id && String(answer.id) !== String(commentId)
                            ? String(answer.id)
                            : String(Math.floor(Math.random() * 0xffffffff));
                    delete answer.answerId;
                    answer.answer = answer.answer
                        .split("\n")
                        .map(text => ({
                        type: "paragraph",
                        content: [{ type: "text", text }]
                    }));
                });
            }
        });
    }
    return returnDoc;
};
const convertNodeV22 = (node, imageIds) => {
    switch (node.type) {
        case "figure": {
            const nodeAttrs = node.attrs ?? {};
            if (!isNaN(Number.parseInt(nodeAttrs.image))) {
                imageIds.push(Number.parseInt(nodeAttrs.image));
            }
            break;
        }
        default:
            break;
    }
    if (node.content) {
        const deleteChildren = [];
        node.content.forEach(childNode => {
            if (childNode.type === "text" && !childNode.text?.length) {
                deleteChildren.push(childNode);
            }
            else {
                convertNodeV22(childNode, imageIds);
            }
        });
        node.content = node.content.filter(childNode => !deleteChildren.includes(childNode));
    }
};
const convertDocV22 = (doc) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    returnDoc.imageIds = [];
    if (returnDoc.content) {
        convertNodeV22(returnDoc.content, returnDoc.imageIds);
    }
    if (returnDoc.comment) {
        Object.entries(returnDoc.comment).forEach(([_commentId, comment]) => {
            ;
            comment.comment.forEach(commentNode => convertNodeV22(commentNode, returnDoc.imageIds));
            if (comment.answers) {
                comment.answers.forEach(answer => {
                    ;
                    answer.answer.forEach(answerNode => convertNodeV22(answerNode, returnDoc.imageIds));
                });
            }
        });
    }
    return returnDoc;
};
const v23ExtraAttrs = {
    languages: [
        "af-ZA",
        "sq-AL",
        "ar",
        "ast",
        "be",
        "br",
        "bg",
        "ca",
        "ca-ES-Valencia",
        "zh-CN",
        "da",
        "nl",
        "en-AU",
        "en-CA",
        "en-NZ",
        "en-ZA",
        "en-GB",
        "en-US",
        "eo",
        "fr",
        "gl",
        "de-DE",
        "de-AU",
        "de-CH",
        "el",
        "he",
        "is",
        "it",
        "ja",
        "km",
        "lt",
        "ml",
        "nb-NO",
        "nn-NO",
        "fa",
        "pl",
        "pt-BR",
        "pt-PT",
        "ro",
        "ru",
        "tr",
        "sr-SP-Cy",
        "sr-SP-Lt",
        "sk",
        "sl",
        "es",
        "sv",
        "ta",
        "tl",
        "uk"
    ],
    papersizes: ["A4", "US Letter"],
    footnote_marks: ["strong", "em", "link", "anchor"],
    footnote_elements: [
        "paragraph",
        "heading1",
        "heading2",
        "heading3",
        "heading4",
        "heading5",
        "heading6",
        "figure",
        "ordered_list",
        "bullet_list",
        "horizontal_rule",
        "equation",
        "citation",
        "blockquote",
        "table"
    ],
    template: "Standard Article"
};
const convertNodeV23 = (node) => {
    const nodeAttrs = node.attrs ?? {};
    switch (node.type) {
        case "article":
            node.attrs = Object.assign({}, nodeAttrs, v23ExtraAttrs);
            break;
        case "title":
            node.attrs = {
                title: "Title",
                id: "title"
            };
            break;
        case "subtitle":
            node.type = "heading_part";
            node.attrs = {
                title: "Subtitle",
                id: "subtitle",
                locking: false,
                language: false,
                optional: "hidden",
                hidden: nodeAttrs.hidden,
                help: false,
                deleted: false,
                elements: ["heading1"],
                marks: ["strong", "em", "link", "anchor"]
            };
            node.content = [
                {
                    type: "heading1",
                    attrs: {
                        id: "H5302207",
                        track: []
                    },
                    content: node.content
                }
            ];
            break;
        case "authors":
            node.type = "contributors_part";
            node.attrs = {
                title: "Authors",
                id: "authors",
                locking: false,
                language: false,
                optional: "hidden",
                hidden: nodeAttrs.hidden,
                help: false,
                deleted: false,
                item_title: "Author"
            };
            break;
        case "author":
            node.type = "contributor";
            break;
        case "abstract":
            node.type = "richtext_part";
            node.attrs = {
                title: "Abstract",
                id: "abstract",
                locking: false,
                language: false,
                optional: "hidden",
                hidden: nodeAttrs.hidden,
                help: false,
                deleted: false,
                elements: [
                    "paragraph",
                    "heading1",
                    "heading2",
                    "heading3",
                    "heading4",
                    "heading5",
                    "heading6",
                    "figure",
                    "ordered_list",
                    "bullet_list",
                    "horizontal_rule",
                    "equation",
                    "citation",
                    "blockquote",
                    "footnote",
                    "table"
                ],
                marks: ["strong", "em", "link", "anchor"]
            };
            break;
        case "keywords":
            node.type = "tags_part";
            node.attrs = {
                title: "Keywords",
                id: "keywords",
                locking: false,
                language: false,
                optional: "hidden",
                hidden: nodeAttrs.hidden,
                help: false,
                deleted: false,
                item_title: "Keyword"
            };
            break;
        case "keyword":
            node.type = "tag";
            node.attrs = {
                tag: nodeAttrs.keyword
            };
            break;
        case "body":
            node.attrs = {
                title: "Body",
                id: "body",
                locking: false,
                language: false,
                optional: false,
                hidden: false,
                help: false,
                deleted: false,
                elements: [
                    "paragraph",
                    "heading1",
                    "heading2",
                    "heading3",
                    "heading4",
                    "heading5",
                    "heading6",
                    "figure",
                    "ordered_list",
                    "bullet_list",
                    "horizontal_rule",
                    "equation",
                    "citation",
                    "blockquote",
                    "footnote",
                    "table"
                ],
                marks: ["strong", "em", "link", "anchor"]
            };
            break;
        case "heading":
            node.type = `heading${nodeAttrs.level}`;
            delete node.attrs?.level;
            break;
        default:
            break;
    }
    if (node.content) {
        node.content.forEach(childNode => {
            convertNodeV23(childNode);
        });
    }
};
const convertDocV23 = (doc) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    if (returnDoc.content) {
        convertNodeV23(returnDoc.content);
    }
    returnDoc.settings = Object.assign({}, returnDoc.settings, v23ExtraAttrs);
    return returnDoc;
};
const convertNodeV30 = (node) => {
    const nodeAttrs = node.attrs ?? {};
    if (nodeAttrs.marks && nodeAttrs.marks.filter) {
        nodeAttrs.marks = nodeAttrs.marks.filter(mark => mark !== "anchor");
    }
    if (nodeAttrs.footnote_marks) {
        nodeAttrs.footnote_marks = nodeAttrs.footnote_marks.filter(mark => mark !== "anchor");
    }
    let attrs;
    switch (node.type) {
        case "article":
            attrs = {
                documentstyle: "",
                tracked: false,
                citationstyle: "apa",
                language: "en-US",
                languages: [
                    "af-ZA",
                    "sq-AL",
                    "ar",
                    "ast",
                    "be",
                    "br",
                    "bg",
                    "ca",
                    "ca-ES-Valencia",
                    "zh-CN",
                    "da",
                    "nl",
                    "en-AU",
                    "en-CA",
                    "en-NZ",
                    "en-ZA",
                    "en-GB",
                    "en-US",
                    "eo",
                    "fr",
                    "gl",
                    "de-DE",
                    "de-AU",
                    "de-CH",
                    "el",
                    "he",
                    "is",
                    "it",
                    "ja",
                    "km",
                    "lt",
                    "ml",
                    "nb-NO",
                    "nn-NO",
                    "fa",
                    "pl",
                    "pt-BR",
                    "pt-PT",
                    "ro",
                    "ru",
                    "tr",
                    "sr-SP-Cy",
                    "sr-SP-Lt",
                    "sk",
                    "sl",
                    "es",
                    "sv",
                    "ta",
                    "tl",
                    "uk"
                ],
                papersize: "A4",
                papersizes: ["A4", "US Letter"],
                footnote_marks: ["strong", "em", "link"],
                footnote_elements: [
                    "paragraph",
                    "heading1",
                    "heading2",
                    "heading3",
                    "heading4",
                    "heading5",
                    "heading6",
                    "figure",
                    "ordered_list",
                    "bullet_list",
                    "horizontal_rule",
                    "equation",
                    "citation",
                    "blockquote",
                    "table"
                ]
            };
            break;
        case "richtext_part":
            attrs = {
                title: "",
                id: "",
                locking: false,
                language: false,
                optional: false,
                hidden: false,
                help: false,
                initial: false,
                deleted: false,
                elements: [
                    "paragraph",
                    "heading1",
                    "heading2",
                    "heading3",
                    "heading4",
                    "heading5",
                    "heading6",
                    "figure",
                    "ordered_list",
                    "bullet_list",
                    "horizontal_rule",
                    "equation",
                    "citation",
                    "blockquote",
                    "footnote",
                    "table"
                ],
                marks: ["strong", "em", "link"],
                metadata: false
            };
            break;
        case "heading_part":
            attrs = {
                title: "",
                id: "",
                locking: false,
                language: false,
                optional: false,
                hidden: false,
                help: false,
                initial: false,
                deleted: false,
                elements: ["heading1"],
                marks: ["strong", "em", "link"],
                metadata: false
            };
            break;
        case "contributors_part":
            attrs = {
                title: "",
                id: "",
                locking: false,
                language: false,
                optional: false,
                hidden: false,
                help: false,
                initial: false,
                deleted: false,
                item_title: "Contributor",
                metadata: false
            };
            break;
        case "tags_part":
            attrs = {
                title: "",
                id: "",
                locking: false,
                language: false,
                optional: false,
                hidden: false,
                help: false,
                initial: false,
                deleted: false,
                item_title: "Tag",
                metadata: false
            };
            break;
        case "table_part":
            attrs = {
                title: "",
                id: "",
                locking: false,
                language: false,
                optional: false,
                hidden: false,
                help: false,
                initial: false,
                deleted: false,
                elements: [
                    "paragraph",
                    "heading1",
                    "heading2",
                    "heading3",
                    "heading4",
                    "heading5",
                    "heading6",
                    "figure",
                    "ordered_list",
                    "bullet_list",
                    "horizontal_rule",
                    "equation",
                    "citation",
                    "blockquote",
                    "footnote"
                ],
                marks: ["strong", "em", "link"],
                metadata: false
            };
            break;
        case "table_of_contents":
            attrs = {
                title: "Table of Contents",
                id: "toc",
                optional: false,
                hidden: false
            };
            break;
        case "separator_part":
            attrs = {
                id: "separator"
            };
            break;
        case "title":
            attrs = {
                id: "title"
            };
            break;
        case "contributor":
            attrs = {
                firstname: false,
                lastname: false,
                email: false,
                institution: false
            };
            break;
        case "tag":
            attrs = {
                tag: ""
            };
            break;
        case "footnote":
            attrs = {
                footnote: [
                    {
                        type: "paragraph"
                    }
                ]
            };
            break;
        case "code_block":
        case "paragraph":
        case "blockquote":
        case "horizontal_rule":
        case "bullet_list":
        case "list_item":
            attrs = {
                track: []
            };
            break;
        case "ordered_list":
            attrs = {
                order: 1,
                track: []
            };
            break;
        case "citation":
            attrs = {
                format: "autocite",
                references: []
            };
            break;
        case "equation":
            attrs = {
                equation: ""
            };
            break;
        case "figure":
            attrs = {
                equation: "",
                image: false,
                figureCategory: "",
                caption: "",
                id: false,
                track: [],
                aligned: "center",
                width: "100"
            };
            break;
        case "heading1":
        case "heading2":
        case "heading3":
        case "heading4":
        case "heading5":
        case "heading6":
            attrs = {
                id: false,
                track: []
            };
            break;
        default:
            break;
    }
    if (attrs && node.attrs) {
        for (const attr in attrs) {
            if (attr in node.attrs &&
                deepEqual(node.attrs[attr], attrs[attr])) {
                delete node.attrs[attr];
            }
        }
        switch (node.type) {
            case "article": {
                if (node.attrs.language === "") {
                    delete node.attrs.language;
                }
                const template = node.attrs.template || "default";
                node.attrs.import_id = template
                    .normalize("NFKC")
                    .replace(/[^\w\s-]/g, "")
                    .toLowerCase()
                    .trim()
                    .replace(/[-\s]+/g, "-");
                switch (node.attrs.citationstyle) {
                    case "harvard1":
                        node.attrs.citationstyle = "harvard-cite-them-right";
                        break;
                    case "mla":
                        node.attrs.citationstyle = "modern-language-association";
                        break;
                    case "american-anthropological-association":
                    case "chicago-author-date":
                    case "chicago-note-bibliography":
                    case "oxford-university-press-humsoc":
                    case "nature":
                        break;
                    default:
                        delete node.attrs.citationstyle;
                }
                break;
            }
            case "title":
                delete node.attrs.title;
                break;
            default:
                break;
        }
    }
    if (node.marks) {
        // The original code used `for...in` over the marks array, iterating
        // indices rather than mark objects. The loop body therefore never
        // matched a case and was effectively a no-op. The cast below preserves
        // that exact runtime behavior while satisfying the type checker.
        for (const mark in node.marks) {
            const markRecord = mark;
            let markAttrs;
            switch (markRecord.type) {
                case "comment":
                    markAttrs = {
                        id: false
                    };
                    break;
                case "annotation_tag":
                    markAttrs = {
                        type: "",
                        key: "",
                        value: ""
                    };
                    break;
                case "anchor":
                    markAttrs = {
                        id: false
                    };
                    break;
                case "deletion":
                    markAttrs = {
                        user: 0,
                        username: "",
                        date: 0
                    };
                    break;
                case "insertion":
                    markAttrs = {
                        user: 0,
                        username: "",
                        date: 0,
                        approved: true
                    };
                    break;
                case "format_change":
                    markAttrs = {
                        user: 0,
                        username: "",
                        date: 0,
                        before: [],
                        after: []
                    };
                    break;
            }
            if (markAttrs && markRecord.attrs) {
                for (const attr in markAttrs) {
                    if (attr in markRecord.attrs &&
                        deepEqual(markRecord.attrs[attr], markAttrs[attr])) {
                        delete markRecord.attrs[attr];
                    }
                }
            }
        }
    }
    if (node.content) {
        node.content.forEach(childNode => {
            convertNodeV30(childNode);
        });
    }
};
const convertDocV30 = (doc) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    if (returnDoc.content) {
        convertNodeV30(returnDoc.content);
    }
    return returnDoc;
};
const convertDocV31 = (doc) => {
    // Conversion adds no new requirements. Version update is required so that
    // users don't try to open file in a previous FW file. That won't work as
    // additional syntax has been added (copyright + cross references).
    const returnDoc = JSON.parse(JSON.stringify(doc));
    return returnDoc;
};
const convertNodeV32 = (node, ids = []) => {
    let blockId, attrs;
    switch (node.type) {
        case "table":
            attrs = node.attrs || {};
            blockId = attrs.id;
            while (!blockId || ids.includes(blockId)) {
                blockId = randomTableId();
            }
            attrs.id = blockId;
            attrs.caption = false;
            node.attrs = attrs;
            ids.push(blockId);
            node.content = [
                { type: "table_caption" },
                {
                    type: "table_body",
                    content: node.content
                }
            ];
            break;
        case "table_cell":
            if (!node.content || !node.content.length) {
                node.content = [{ type: "paragraph" }];
            }
            break;
        case "table_header":
            if (!node.content || !node.content.length) {
                node.content = [{ type: "paragraph" }];
            }
            break;
        case "bullet_list":
        case "ordered_list":
            attrs = node.attrs || {};
            blockId = attrs.id;
            while (!blockId || ids.includes(blockId)) {
                blockId = randomListId();
            }
            attrs.id = blockId;
            node.attrs = attrs;
            ids.push(blockId);
            break;
        case "figure": {
            attrs = node.attrs || {};
            if (attrs.figureCategory) {
                attrs.category = attrs.figureCategory;
                delete attrs.figureCategory;
            }
            node.content = [];
            if (attrs.image) {
                node.content.push({ type: "image", attrs: { image: attrs.image } });
            }
            else {
                node.content.push({
                    type: "figure_equation",
                    attrs: { equation: attrs.equation || "" }
                });
            }
            delete attrs.image;
            delete attrs.equation;
            const caption = { type: "figure_caption" };
            if (attrs.caption) {
                if (attrs.caption.length) {
                    caption.content = [
                        { type: "text", text: attrs.caption }
                    ];
                    attrs.caption = true;
                }
                else {
                    attrs.caption = false;
                }
            }
            else {
                attrs.caption = false;
            }
            if (attrs.category === "table") {
                node.content.unshift(caption);
            }
            else {
                node.content.push(caption);
            }
            node.attrs = attrs;
            break;
        }
        case "footnote":
            if (node.attrs?.footnote) {
                ;
                node.attrs.footnote.forEach(childNode => {
                    convertNodeV32(childNode, ids);
                });
            }
            break;
    }
    if (node.content) {
        node.content.forEach(childNode => {
            convertNodeV32(childNode, ids);
        });
    }
    if (node.attrs?.initial) {
        ;
        node.attrs.initial.forEach(childNode => {
            convertNodeV32(childNode, ids);
        });
    }
};
const convertDocV32 = (doc) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    convertNodeV32(returnDoc);
    return returnDoc;
};
const convertDocV33 = (doc) => {
    // We just need to increase the version number so that documents cannot
    // be moved from a 3.10 to an 3.9 system, but 3.3 files should be readable
    // as 3.4 files.
    return JSON.parse(JSON.stringify(doc));
};
const convertDocV34 = (doc) => {
    // The top node needs to be changed from "article" to "doc".
    const returnDoc = JSON.parse(JSON.stringify(doc));
    returnDoc.type = "doc";
    return returnDoc;
};
const convertDocV35 = (doc) => {
    // We just need to increase the version number so that documents cannot
    // be moved from a 4.1 to an 4.0 system, but 3.5 files should be readable
    // as 3.6 files.
    return JSON.parse(JSON.stringify(doc));
};
const STYLE_MAP_V36 = {
    "chicago-note-bibliography": "chicago-notes-bibliography",
    "oxford-university-press-humsoc": "oxford-guide-to-style-notes"
};
const convertNodeV36 = (node) => {
    if (node.attrs) {
        if (node.type === "doc" &&
            node.attrs.citationstyle &&
            typeof node.attrs.citationstyle === "string" &&
            STYLE_MAP_V36[node.attrs.citationstyle]) {
            node.attrs.citationstyle =
                STYLE_MAP_V36[node.attrs.citationstyle];
        }
        if (node.type === "doc" &&
            Array.isArray(node.attrs.citationstyles)) {
            node.attrs.citationstyles = node.attrs.citationstyles.map(s => STYLE_MAP_V36[s] || s);
        }
    }
    if (node.content) {
        node.content.forEach(childNode => {
            convertNodeV36(childNode);
        });
    }
};
const convertDocV36 = (doc) => {
    const returnDoc = JSON.parse(JSON.stringify(doc));
    if (returnDoc.content) {
        convertNodeV36(returnDoc.content);
    }
    return returnDoc;
};
//# sourceMappingURL=convert.js.map