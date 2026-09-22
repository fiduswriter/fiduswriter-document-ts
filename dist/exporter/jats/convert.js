import { convertLatexToMathMl } from "mathlive";
import { escapeText } from "fwtoolkit";
import { getCat } from "../../schema/i18n.js";
import { removeHidden } from "../tools/doc_content.js";
import { getImageDBEntryFilename } from "../tools/file.js";
import { JATSExporterCitations } from "./citations.js";
import { convertText } from "./text.js";
function getStringAttr(attrs, key) {
    const value = attrs?.[key];
    return typeof value === "string" ? value : undefined;
}
function getNumberAttr(attrs, key) {
    const value = attrs?.[key];
    return typeof value === "number" ? value : undefined;
}
function getBooleanAttr(attrs, key) {
    return !!attrs?.[key];
}
function getNodeArrayAttr(attrs, key) {
    const value = attrs?.[key];
    return Array.isArray(value) ? value : undefined;
}
export class JATSExporterConverter {
    type;
    doc;
    csl;
    imageDB;
    bibDB;
    imageIds;
    categoryCounter;
    affiliations;
    affCounter;
    parCounter;
    headingCounter;
    currentSectionLevel;
    listCounter;
    orderedListLengths;
    footnotes;
    fnCounter;
    frontMatter;
    citInfos;
    citationCount;
    citations;
    constructor(type, doc, csl, imageDB, bibDB) {
        this.type = type;
        this.doc = doc;
        this.csl = csl;
        this.imageDB = imageDB;
        this.bibDB = bibDB;
        this.imageIds = [];
        this.categoryCounter = {}; // counters for each type of figure (figure/table/photo)
        this.affiliations = {}; // affiliations of authors and editors
        this.affCounter = 0;
        this.parCounter = 0;
        this.headingCounter = 0;
        this.currentSectionLevel = 0;
        this.listCounter = 0;
        this.orderedListLengths = [];
        this.footnotes = [];
        this.fnCounter = 0;
        this.frontMatter = {
            title: {},
            subtitle: {},
            contributors: [],
            abstract: {},
            keywords: [],
            tags: [],
            copyright: {
                licenses: []
            }
        };
        this.citInfos = [];
        this.citationCount = 0;
        this.citations = new JATSExporterCitations(this.doc, this.bibDB, this.csl);
    }
    init() {
        const docContent = removeHidden(this.doc.content);
        this.preWalkJson(docContent);
        this.findAllCitations(docContent);
        return this.citations.init(this.citInfos).then(() => {
            const front = this.type === "article"
                ? this.assembleArticleFront()
                : this.assembleBookPartFront();
            const body = this.assembleBody(docContent);
            const back = this.assembleBack();
            return {
                front,
                body,
                back,
                imageIds: this.imageIds
            };
        });
    }
    // Remove items from the body that should be in the front.
    preWalkJson(node, parentNode = false) {
        switch (node.type) {
            case "doc": {
                const copyright = node.attrs?.copyright;
                if (copyright) {
                    this.frontMatter.copyright = copyright;
                }
                break;
            }
            case "title":
                this.frontMatter.title["default"] = node;
                if (parentNode && parentNode.content) {
                    parentNode.content = parentNode.content.filter((child) => child !== node);
                }
                break;
            case "heading_part": {
                const metadata = getStringAttr(node.attrs, "metadata");
                const language = getStringAttr(node.attrs, "language") || "default";
                if (metadata &&
                    (metadata === "title" || metadata === "subtitle") &&
                    !this.frontMatter[metadata][language] &&
                    node.content &&
                    node.content.length) {
                    const firstChild = node.content[0];
                    const firstChildId = getStringAttr(firstChild.attrs, "id");
                    // We only take the first instance of title/subtitle per language
                    this.frontMatter[metadata][language] = {
                        type: getStringAttr(node.attrs, "language")
                            ? `trans_${metadata}`
                            : metadata,
                        attrs: {
                            id: firstChildId,
                            language: getStringAttr(node.attrs, "language")
                        },
                        content: firstChild.content
                    };
                    if (parentNode && parentNode.content) {
                        parentNode.content = parentNode.content.filter((child) => child !== node);
                    }
                }
                break;
            }
            case "richtext_part": {
                const metadata = getStringAttr(node.attrs, "metadata");
                const language = getStringAttr(node.attrs, "language") || "default";
                if (metadata === "abstract" &&
                    !this.frontMatter.abstract[language]) {
                    // We only take the first instance of abstract per language
                    this.frontMatter.abstract[language] = {
                        type: getStringAttr(node.attrs, "language")
                            ? "trans_abstract"
                            : "abstract",
                        attrs: {
                            id: getStringAttr(node.attrs, "id"),
                            language: getStringAttr(node.attrs, "language")
                        },
                        content: node.content
                    };
                    if (parentNode && parentNode.content) {
                        parentNode.content = parentNode.content.filter((child) => child !== node);
                    }
                }
                break;
            }
            case "tags_part": {
                const metadata = getStringAttr(node.attrs, "metadata");
                if (metadata === "keywords" && node.content) {
                    this.frontMatter.keywords.push({
                        type: "keywords",
                        attrs: {
                            language: getStringAttr(node.attrs, "language")
                        },
                        content: node.content
                    });
                }
                else {
                    this.frontMatter.tags.push(node);
                }
                if (parentNode && parentNode.content) {
                    parentNode.content = parentNode.content.filter((child) => child !== node);
                }
                break;
            }
            case "contributors_part":
                this.frontMatter.contributors.push(node);
                if (parentNode && parentNode.content) {
                    parentNode.content = parentNode.content.filter((child) => child !== node);
                }
                break;
            default:
                break;
        }
        if (node.content) {
            node.content.forEach((child) => this.preWalkJson(child, node));
        }
    }
    findAllCitations(docContent) {
        // We need to look for citations in the same order they will be found in front + body
        // to get the formatting right.
        if (this.frontMatter.subtitle.default) {
            this.findCitations(this.frontMatter.subtitle.default);
        }
        Object.keys(this.frontMatter.title)
            .filter(language => language !== "default")
            .forEach(language => {
            this.findCitations(this.frontMatter.title[language]);
            if (this.frontMatter.subtitle[language]) {
                this.findCitations(this.frontMatter.subtitle[language]);
            }
        });
        if (this.frontMatter.abstract.default) {
            this.findCitations(this.frontMatter.abstract.default);
        }
        Object.keys(this.frontMatter.abstract)
            .filter(language => language !== "default")
            .forEach(language => {
            this.findCitations(this.frontMatter.abstract[language]);
        });
        this.findCitations(docContent);
    }
    findCitations(node) {
        switch (node.type) {
            case "citation":
                this.citInfos.push(JSON.parse(JSON.stringify(node.attrs)));
                break;
            case "footnote": {
                const footnote = getNodeArrayAttr(node.attrs, "footnote");
                footnote?.forEach((child) => this.findCitations(child));
                break;
            }
            default:
                break;
        }
        if (node.content) {
            node.content.forEach((child) => this.findCitations(child));
        }
    }
    assembleArticleFront() {
        let front = "<front>";
        front +=
            "<journal-meta><journal-id></journal-id><issn></issn></journal-meta>"; // Required by DTD
        front += "<article-meta>";
        if (this.frontMatter.tags.length) {
            front += `<article-categories>${this.frontMatter.tags.map((node) => this.walkJson(node)).join("")}</article-categories>`;
        }
        Object.keys(this.frontMatter.subtitle)
            .filter(language => language !== "default")
            .forEach(language => {
            // Making sure there is a title for each subtitle
            if (!this.frontMatter.title[language]) {
                this.frontMatter.title[language] = {
                    type: "trans_title",
                    attrs: { language }
                };
            }
        });
        front += "<title-group>";
        front += this.walkJson(this.frontMatter.title.default);
        if (this.frontMatter.subtitle.default) {
            front += this.walkJson(this.frontMatter.subtitle.default);
        }
        Object.keys(this.frontMatter.title)
            .filter(language => language !== "default")
            .forEach(language => {
            front += `<trans-title-group @xml:lang="${language}">`;
            front += this.walkJson(this.frontMatter.title[language]);
            if (this.frontMatter.subtitle[language]) {
                front += this.walkJson(this.frontMatter.subtitle[language]);
            }
            front += "</trans-title-group>";
        });
        front += "</title-group>";
        this.frontMatter.contributors.forEach((contributors) => {
            front += this.walkJson(contributors);
        });
        Object.entries(this.affiliations).forEach(([institution, index]) => (front += `<aff id="aff${index}"><institution>${escapeText(institution)}</institution></aff>`));
        // https://validator.jats4r.org/ requires a <permissions> element here, but is OK with it being empty.
        if (this.frontMatter.copyright.holder) {
            front += "<permissions>";
            const year = this.frontMatter.copyright.year
                ? this.frontMatter.copyright.year
                : new Date().getFullYear();
            front += `<copyright-year>${year}</copyright-year>`;
            front += `<copyright-holder>${escapeText(this.frontMatter.copyright.holder)}</copyright-holder>`;
            if (this.frontMatter.copyright.freeToRead) {
                front += "<ali:free_to_read/>";
            }
            front += this.frontMatter.copyright.licenses
                .map((license) => `<license><ali:license_ref${license.start ? ` start_date="${license.start}"` : ""}>${escapeText(license.url)}</ali:license_ref></license>`)
                .join("");
            front += "</permissions>";
        }
        else {
            front += "<permissions/>";
        }
        if (this.frontMatter.abstract.default) {
            front += this.walkJson(this.frontMatter.abstract.default);
            front += this.closeSections(0);
        }
        Object.keys(this.frontMatter.abstract)
            .filter(language => language !== "default")
            .forEach(language => {
            front += this.walkJson(this.frontMatter.abstract[language]);
            front += this.closeSections(0);
        });
        this.frontMatter.keywords.forEach((keywords) => {
            front += this.walkJson(keywords);
        });
        front += "</article-meta></front>";
        return front;
    }
    assembleBookPartFront() {
        let front = "<front-matter><book-part-meta>";
        if (this.frontMatter.tags.length) {
            front += `<subj-group>${this.frontMatter.tags.map((node) => this.walkJson(node)).join("")}</subj-group>`;
        }
        Object.keys(this.frontMatter.subtitle)
            .filter(language => language !== "default")
            .forEach(language => {
            // Making sure there is a title for each subtitle
            if (!this.frontMatter.title[language]) {
                this.frontMatter.title[language] = {
                    type: "trans_title",
                    attrs: { language }
                };
            }
        });
        front += "<title-group>";
        front += this.walkJson(this.frontMatter.title.default);
        if (this.frontMatter.subtitle.default) {
            front += this.walkJson(this.frontMatter.subtitle.default);
        }
        Object.keys(this.frontMatter.title)
            .filter(language => language !== "default")
            .forEach(language => {
            front += `<trans-title-group @xml:lang="${language}">`;
            front += this.walkJson(this.frontMatter.title[language]);
            if (this.frontMatter.subtitle[language]) {
                front += this.walkJson(this.frontMatter.subtitle[language]);
            }
            front += "</trans-title-group>";
        });
        front += "</title-group>";
        this.frontMatter.contributors.forEach((contributors) => {
            front += this.walkJson(contributors);
        });
        Object.entries(this.affiliations).forEach(([institution, index]) => (front += `<aff id="aff${index}"><institution>${escapeText(institution)}</institution></aff>`));
        // https://validator.jats4r.org/ requires a <permissions> element here, but is OK with it being empty.
        if (this.frontMatter.copyright.holder) {
            front += "<permissions>";
            const year = this.frontMatter.copyright.year
                ? this.frontMatter.copyright.year
                : new Date().getFullYear();
            front += `<copyright-year>${year}</copyright-year>`;
            front += `<copyright-holder>${escapeText(this.frontMatter.copyright.holder)}</copyright-holder>`;
            if (this.frontMatter.copyright.freeToRead) {
                front += "<ali:free_to_read/>";
            }
            front += this.frontMatter.copyright.licenses
                .map((license) => `<license><ali:license_ref${license.start ? ` start_date="${license.start}"` : ""}>${escapeText(license.url)}</ali:license_ref></license>`)
                .join("");
            front += "</permissions>";
        }
        else {
            front += "<permissions/>";
        }
        if (this.frontMatter.abstract.default) {
            front += this.walkJson(this.frontMatter.abstract.default);
            front += this.closeSections(0);
        }
        Object.keys(this.frontMatter.abstract)
            .filter(language => language !== "default")
            .forEach(language => {
            front += this.walkJson(this.frontMatter.abstract[language]);
            front += this.closeSections(0);
        });
        this.frontMatter.keywords.forEach((keywords) => {
            front += this.walkJson(keywords);
        });
        front += "</book-part-meta></front-matter>";
        return front;
    }
    walkJson(node, options = {}) {
        let start = "", content = "", end = "";
        switch (node.type) {
            case "doc":
                break;
            case "title":
                if (this.type === "article") {
                    start += "<article-title>";
                    end = "</article-title>" + end;
                }
                else {
                    start += "<title>";
                    end = "</title>" + end;
                }
                options = Object.assign({}, options);
                options.breakAllowed = true;
                break;
            case "trans_title":
                start += "<trans-title>";
                end = "</trans-title>" + end;
                options = Object.assign({}, options);
                options.breakAllowed = true;
                break;
            case "subtitle":
                if (node.content) {
                    start += "<subtitle>";
                    end = "</subtitle>" + end;
                    options = Object.assign({}, options);
                    options.breakAllowed = true;
                }
                break;
            case "trans_subtitle":
                if (node.content) {
                    start += "<trans-subtitle>";
                    end = "</trans-subtitle>" + end;
                    options = Object.assign({}, options);
                    options.breakAllowed = true;
                }
                break;
            case "heading_part":
                // Ignore - we deal with the heading inside
                break;
            case "contributor":
                // Ignore - we deal with contributors_part instead.
                break;
            case "contributors_part":
                if (node.content) {
                    const contributorTypes = {
                        authors: "author",
                        editors: "editor",
                        translators: "translator",
                        reviewers: "reviewer",
                        contributors: "contributor"
                    };
                    const metadata = getStringAttr(node.attrs, "metadata");
                    const contributorType = (metadata && contributorTypes[metadata]) || "other";
                    start += `<contrib-group content-type="${contributorType}">`;
                    end = "</contrib-group>" + end;
                    const contributorTypeId = getStringAttr(node.attrs, "id");
                    let counter = 1;
                    node.content.forEach((childNode) => {
                        const contributor = childNode.attrs;
                        if (contributor?.firstname || contributor?.lastname) {
                            content += `<contrib id="${contributorTypeId}-${counter++}" contrib-type="person">`;
                            content += "<name>";
                            if (contributor.lastname) {
                                content += `<surname>${escapeText(contributor.lastname)}</surname>`;
                            }
                            if (contributor.firstname) {
                                content += `<given-names>${escapeText(contributor.firstname)}</given-names>`;
                            }
                            content += "</name>";
                            if (contributor.institution) {
                                let affNumber;
                                if (this.affiliations[contributor.institution]) {
                                    affNumber =
                                        this.affiliations[contributor.institution];
                                }
                                else {
                                    affNumber = ++this.affCounter;
                                    this.affiliations[contributor.institution] =
                                        affNumber;
                                }
                                content += `<xref ref-type="aff" rid="aff${affNumber}" />`;
                            }
                            if (contributor.id_type && contributor.id_value) {
                                const idType = escapeText(contributor.id_type.toLowerCase());
                                content += `<contrib-id contrib-id-type="${idType}">${escapeText(contributor.id_value)}</contrib-id>`;
                            }
                            content += "</contrib>";
                        }
                        else if (contributor?.institution) {
                            // There is an affiliation but no first/last name. We take this
                            // as a group collaboration.
                            content += `<contrib id="${contributorTypeId}-${counter++}" contrib-type="group">`;
                            content += `<collab><named-content content-type="name">${escapeText(contributor.institution)}</named-content></collab>`;
                            if (contributor.id_type && contributor.id_value) {
                                const idType = escapeText(contributor.id_type.toLowerCase());
                                content += `<contrib-id contrib-id-type="${idType}">${escapeText(contributor.id_value)}</contrib-id>`;
                            }
                            content += "</contrib>";
                        }
                    });
                }
                break;
            case "tags_part":
                if (node.content) {
                    const attrsId = getStringAttr(node.attrs, "id");
                    const language = getStringAttr(node.attrs, "language");
                    start += `<subj-group subj-group-type="${attrsId}"${language ? ` xml:lang="${language}"` : ""}>`;
                    end = "</subj-group>" + end;
                }
                break;
            case "keywords":
                if (node.content) {
                    const language = getStringAttr(node.attrs, "language");
                    start += `<kwd-group${language ? ` xml:lang="${language}"` : ""}>`;
                    end = "</kwd-group>" + end;
                    options = Object.assign({}, options);
                    options.inKeywords = true;
                }
                break;
            case "tag": {
                const tag = getStringAttr(node.attrs, "tag");
                if (options.inKeywords) {
                    content += `<kwd>${tag}</kwd>`;
                }
                else {
                    content += `<subject>${tag}</subject>`;
                }
                break;
            }
            case "abstract":
                if (node.content) {
                    start += "<abstract>";
                    end = "</abstract>" + end;
                }
                break;
            case "trans_abstract":
                if (node.content) {
                    const language = getStringAttr(node.attrs, "language");
                    start += `<trans-abstract xml:lang="${language}">`;
                    end = "</trans-abstract>" + end;
                }
                break;
            case "richtext_part": {
                const metadata = getStringAttr(node.attrs, "metadata");
                if (metadata) {
                    options = Object.assign({}, options);
                    options.partMetadata = metadata;
                }
                break;
            }
            case "table_of_contents":
                // TODO: Not sure what to use here.
                break;
            case "separator_part":
            case "table_part":
                // part separators as in page breaks should usually already be handled
                // by JATS renderer and table parts will simply show the table inside of them.
                break;
            case "paragraph":
                start += `<p id="p-${++this.parCounter}">`;
                end = "</p>" + end;
                break;
            case "heading1":
            case "heading2":
            case "heading3":
            case "heading4":
            case "heading5":
            case "heading6": {
                if (options.ignoreHeading) {
                    break;
                }
                else if (options.inFootnote) {
                    // only allows <p> block level elements https://jats.nlm.nih.gov/archiving/tag-library/1.2/element/fn.html
                    start += `<p id="p-${++this.parCounter}">`;
                    end = "</p>" + end;
                    break;
                }
                const metadata = options.partMetadata;
                if (metadata) {
                    // the metadata should only be applied once within a part.
                    delete options.partMetadata;
                }
                const level = Number.parseInt(node.type.slice(-1));
                if (this.currentSectionLevel > level - 1) {
                    start += this.closeSections(level - 1);
                }
                while (this.currentSectionLevel < level) {
                    this.currentSectionLevel++;
                    if (this.currentSectionLevel === level) {
                        const nodeId = getStringAttr(node.attrs, "id");
                        start += `<sec id="${nodeId}"${metadata ? ` sec-type="${metadata}"` : ""}>`;
                    }
                    else {
                        start += `<sec id="h-${++this.headingCounter}">`;
                    }
                }
                start += "<title>";
                end = "</title>" + end;
                options = Object.assign({}, options);
                options.breakAllowed = true;
                break;
            }
            case "code_block":
                if (options.inFootnote) {
                    // only allows <p> block level elements https://jats.nlm.nih.gov/archiving/tag-library/1.2/element/fn.html
                    start += `<p id="p-${++this.parCounter}">`;
                    end = "</p>" + end;
                    break;
                }
                start += "<code>";
                end = "</code>" + end;
                break;
            case "blockquote":
                start += "<disp-quote>";
                end = "</disp-quote>" + end;
                break;
            case "ordered_list": {
                if (options.inFootnote) {
                    // only allows <p> block level elements https://jats.nlm.nih.gov/archiving/tag-library/1.2/element/fn.html
                    break;
                }
                const order = getNumberAttr(node.attrs, "order");
                const continuedListEndNumber = order !== undefined ? order - 1 : 0;
                let lastListIndex;
                // TODO: deal with lists that have an order number other than 1 that do not continue previous lists. Currently not possible in JATS
                if (continuedListEndNumber) {
                    lastListIndex = this.orderedListLengths.lastIndexOf(continuedListEndNumber);
                }
                if (lastListIndex !== undefined && lastListIndex > -1) {
                    start += `<list list-type="order" id="list-${++this.listCounter}" continued-from="list-${lastListIndex}">`;
                }
                else {
                    start += `<list list-type="order" id="list-${++this.listCounter}">`;
                }
                options = Object.assign({}, options);
                options.inOrderedList = this.listCounter;
                this.orderedListLengths[options.inOrderedList] =
                    continuedListEndNumber;
                end = "</list>" + end;
                break;
            }
            case "bullet_list":
                if (options.inFootnote) {
                    // only allows <p> block level elements https://jats.nlm.nih.gov/archiving/tag-library/1.2/element/fn.html
                    break;
                }
                start += `<list list-type="bullet" id="list-${++this.listCounter}">`;
                end = "</list>" + end;
                options = Object.assign({}, options);
                delete options.inOrderedList;
                break;
            case "list_item":
                if (options.inFootnote) {
                    // only allows <p> block level elements https://jats.nlm.nih.gov/archiving/tag-library/1.2/element/fn.html
                    break;
                }
                if (options.inOrderedList !== undefined) {
                    this.orderedListLengths[options.inOrderedList] += 1;
                }
                start += "<list-item>";
                end = "</list-item>" + end;
                break;
            case "footnote":
                content += `<xref ref-type="fn" rid="fn-${++this.fnCounter}">${this.fnCounter}</xref>`;
                options = Object.assign({}, options);
                options.inFootnote = true;
                this.footnotes.push(this.walkJson({
                    type: "footnotecontainer",
                    attrs: {
                        id: `fn-${this.fnCounter}`,
                        label: this.fnCounter // Note: it's unclear whether the footnote number is required as a label
                    },
                    content: getNodeArrayAttr(node.attrs, "footnote") || []
                }, options));
                break;
            case "footnotecontainer": {
                const nodeId = getStringAttr(node.attrs, "id");
                const label = getStringAttr(node.attrs, "label");
                start += `<fn id="${nodeId}"><label>${label}</label>`;
                end = "</fn>" + end;
                break;
            }
            case "text": {
                content += convertText(node);
                break;
            }
            case "cross_reference": {
                const nodeId = getStringAttr(node.attrs, "id");
                const title = getStringAttr(node.attrs, "title") || "MISSING TARGET";
                start += `<xref rid="${nodeId}">`;
                content += escapeText(title);
                end = "</xref>" + end;
                break;
            }
            case "citation": {
                const citationText = this.citations.citationTexts[this.citationCount++];
                if (options.inFootnote ||
                    this.citations.citFm.citationType !==
                        "note") {
                    content += citationText;
                }
                else {
                    content += `<xref ref-type="fn" rid="fn-${++this.fnCounter}">${this.fnCounter}</xref>`;
                    this.footnotes.push(`<fn id="fn-${this.fnCounter}"><label>${this.fnCounter}</label><p id="p-${++this.parCounter}">${citationText}</p></fn>`);
                }
                break;
            }
            case "figure": {
                // Note: width and alignment are not stored due to lack of corresponding attributes in JATS.
                if (options.inFootnote) {
                    // only allows <p> block level elements https://jats.nlm.nih.gov/archiving/tag-library/1.2/element/fn.html
                    break;
                }
                let imageFilename, copyright;
                const image = node.content?.find((node) => node.type === "image")?.attrs?.image || false;
                if (image !== false) {
                    const imageId = String(image);
                    this.imageIds.push(imageId);
                    const imageDBEntry = this.imageDB.db[imageId];
                    copyright = imageDBEntry.copyright;
                    imageFilename = getImageDBEntryFilename(imageDBEntry, imageId);
                }
                const caption = getBooleanAttr(node.attrs, "caption")
                    ? node.content?.find((node) => node.type === "figure_caption")?.content || []
                    : [];
                const category = getStringAttr(node.attrs, "category");
                const nodeId = getStringAttr(node.attrs, "id");
                if (category === "none" &&
                    imageFilename &&
                    !caption.length &&
                    (!copyright || !copyright.holder)) {
                    content += `<graphic id="${nodeId}" position="anchor" xlink:href="${imageFilename}">`;
                    content += `<alt-text>${escapeText(caption.map((node) => node.text || "").join("") || imageFilename)}</alt-text>`;
                    content += "</graphic>";
                }
                else {
                    start += `<fig id="${nodeId}">`;
                    end = "</fig>" + end;
                    if (category !== "none" && category) {
                        if (!this.categoryCounter[category]) {
                            this.categoryCounter[category] = 0;
                        }
                        const catCount = ++this.categoryCounter[category];
                        const catLabel = `${getCat(category, this.doc.settings.language || "en-US")} ${catCount}`;
                        start += `<label>${escapeText(catLabel)}</label>`;
                    }
                    if (caption.length) {
                        start += `<caption><p>${caption.map((node) => this.walkJson(node)).join("")}</p></caption>`;
                    }
                    const equation = node.content?.find((node) => node.type === "figure_equation")?.attrs?.equation;
                    if (typeof equation === "string") {
                        start += "<disp-formula>";
                        end = "</disp-formula>" + end;
                        const equationML = convertLatexToMathMl(equation);
                        content = `
                            <alternatives>
                                <tex-math><![CDATA[${equation}]]></tex-math>
                                <mml:math>${equationML}</mml:math>
                            </alternatives>
                        `;
                    }
                    else {
                        if (copyright?.holder) {
                            start += "<permissions>";
                            const year = copyright.year
                                ? copyright.year
                                : new Date().getFullYear();
                            start += `<copyright-year>${year}</copyright-year>`;
                            start += `<copyright-holder>${escapeText(copyright.holder)}</copyright-holder>`;
                            if (copyright.freeToRead) {
                                start += "<ali:free_to_read/>";
                            }
                            start += copyright.licenses
                                .map((license) => `<license><ali:license_ref${license.start ? ` start_date="${license.start}"` : ""}>${escapeText(license.url)}</ali:license_ref></license>`)
                                .join("");
                            start += "</permissions>";
                        }
                        if (imageFilename) {
                            content += `<graphic position="anchor" xlink:href="${imageFilename}">`;
                            content += `<alt-text>${escapeText(caption.map((node) => node.text || "").join("") || imageFilename)}</alt-text>`;
                            content += "</graphic>";
                        }
                    }
                }
                break;
            }
            case "figure_caption":
                // We are already dealing with this in the figure. Prevent content from being added a second time.
                return "";
            case "figure_equation":
                // We are already dealing with this in the figure.
                break;
            case "image":
                // We are already dealing with this in the figure.
                break;
            case "table": {
                // Note: We ignore right/left/center aligned and table layout
                if (options.inFootnote) {
                    // only allows <p> block level elements https://jats.nlm.nih.gov/archiving/tag-library/1.2/element/fn.html
                    break;
                }
                const nodeId = getStringAttr(node.attrs, "id");
                start += `<table-wrap id="${nodeId}">`;
                end = "</table-wrap>" + end;
                const category = getStringAttr(node.attrs, "category");
                if (category && category !== "none") {
                    if (!this.categoryCounter[category]) {
                        this.categoryCounter[category] = 0;
                    }
                    const catCount = ++this.categoryCounter[category];
                    const catLabel = `${getCat(category, this.doc.settings.language || "en-US")} ${catCount}`;
                    start += `<label>${escapeText(catLabel)}</label>`;
                }
                const caption = getBooleanAttr(node.attrs, "caption")
                    ? node.content?.[0].content || []
                    : [];
                if (caption.length) {
                    start += `<caption><p>${caption.map((node) => this.walkJson(node)).join("")}</p></caption>`;
                }
                const width = getNumberAttr(node.attrs, "width");
                start += `<table width="${width}%"><tbody>`;
                end = "</tbody></table>" + end;
                break;
            }
            case "table_body":
                // Pass through to table.
                break;
            case "table_caption":
                // We already deal with this in 'table'.
                return "";
            case "table_row":
                start += "<tr>";
                end = "</tr>" + end;
                break;
            case "table_cell": {
                const colspan = getNumberAttr(node.attrs, "colspan");
                const rowspan = getNumberAttr(node.attrs, "rowspan");
                start += `<td${colspan === 1 ? "" : ` colspan="${colspan}"`}${rowspan === 1 ? "" : ` rowspan="${rowspan}"`}>`;
                end = "</td>" + end;
                break;
            }
            case "table_header": {
                const colspan = getNumberAttr(node.attrs, "colspan");
                const rowspan = getNumberAttr(node.attrs, "rowspan");
                start += `<th${colspan === 1 ? "" : ` colspan="${colspan}"`}${rowspan === 1 ? "" : ` rowspan="${rowspan}"`}>`;
                end = "</th>" + end;
                break;
            }
            case "equation": {
                const equation = getStringAttr(node.attrs, "equation");
                if (!equation) {
                    break;
                }
                start += "<inline-formula>";
                end = "</inline-formula>" + end;
                const equationML = convertLatexToMathMl(equation);
                content = `
                    <alternatives>
                        <tex-math><![CDATA[${equation}]]></tex-math>
                        <mml:math>${equationML}</mml:math>
                    </alternatives>
                `;
                break;
            }
            case "hard_break":
                // Forbidden inside of most elements. We only render it if explicitly allowed.
                // https://jats.nlm.nih.gov/publishing/tag-library/1.3/element/break.html
                if (options.breakAllowed) {
                    content += "<break />";
                }
                else {
                    content += " ";
                }
                break;
            default:
                break;
        }
        if (!content.length && node.content) {
            node.content.forEach((child) => {
                content += this.walkJson(child, options);
            });
        }
        return start + content + end;
    }
    closeSections(targetLevel) {
        let returnValue = "";
        while (this.currentSectionLevel > targetLevel) {
            returnValue += "</sec>";
            this.currentSectionLevel--;
        }
        return returnValue;
    }
    assembleBody(docContent) {
        return `<body id="body">${this.walkJson(docContent) + this.closeSections(0)}</body>`;
    }
    assembleBack() {
        let back = "<back>";
        if (this.footnotes.length) {
            back += `<fn-group>${this.footnotes.join("")}</fn-group>`;
        }
        if (this.citations.jatsBib.length) {
            back += `<ref-list>${this.citations.jatsBib}</ref-list>`;
        }
        back += "</back>";
        return back;
    }
}
//# sourceMappingURL=convert.js.map