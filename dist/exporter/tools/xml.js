import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
const fastXMLParserOptions = {
    attributeNamePrefix: "",
    ignoreAttributes: false,
    allowBooleanAttributes: true,
    preserveOrder: true,
    cdataPropName: "__cdata",
    commentPropName: "#comment",
    processEntities: true,
    suppressUnpairedNode: false,
    suppressEmptyNode: true,
    trimValues: false
};
export const isLeaf = (tagName) => ["#text", "__cdata", "#comment"].includes(tagName || "");
export class XMLElement {
    node;
    parentElement;
    constructor(node, parentElement = null) {
        this.node = node;
        this.parentElement = parentElement;
        // Recursively wrap child elements if they exist
        const tagName = this.tagName;
        if (tagName && this.node[tagName] && !isLeaf(tagName)) {
            this.node[tagName] = this.node[tagName].map((child) => {
                // Only wrap objects (not text nodes)
                return typeof child === "object" && child !== null
                    ? new XMLElement(child, this)
                    : child;
            });
        }
    }
    get tagName() {
        // Get the tag name dynamically (the first key that isn't ":@")
        return Object.keys(this.node).find(key => key !== ":@");
    }
    get children() {
        // Return child elements if they exist, or an empty array if none
        return this.node[this.tagName] || [];
    }
    get attributes() {
        // Return attributes stored under the ":@" key, or an empty object if not present
        return this.node[":@"] || {};
    }
    set attributes(attrs) {
        // Update the attributes object
        this.node[":@"] = attrs;
    }
    get innerXML() {
        // Serialize the children back to XML
        return this.children
            .map(child => {
            if (child instanceof XMLElement) {
                return child.toString();
            }
            return String(child);
        })
            .join("");
    }
    set innerXML(xmlString) {
        ;
        this.children.forEach(child => {
            child.setParent(null);
        });
        // Clear existing children
        this.node[this.tagName] = [];
        // Parse the new XML string
        const parser = new XMLParser(fastXMLParserOptions);
        const xml = parser.parse(`<${this.tagName}>${xmlString}</${this.tagName}>`);
        (xml[0][this.tagName] || []).forEach(child => {
            this.appendChild(child);
        });
    }
    get textContent() {
        const tagName = this.tagName;
        if (isLeaf(tagName)) {
            if (tagName === "#text") {
                return String(this.node[tagName] || "");
            }
            return "";
        }
        else {
            // Serialize the children back to text
            return this.children
                .map(child => child.textContent)
                .join("");
        }
    }
    set textContent(value) {
        const tagName = this.tagName;
        // For leaf nodes, directly set the text content
        if (tagName === "#text") {
            this.node["#text"] = value;
            return;
        }
        // For element nodes, clear children and add a text node
        if (this.node[tagName]) {
            // Clear existing children
            this.node[tagName] = [];
            // Only add text content if it's not empty
            if (value) {
                const textNode = {
                    "#text": value
                };
                this.node[tagName].push(new XMLElement(textNode, this));
            }
        }
    }
    get firstChild() {
        return this.children[0];
    }
    get lastChild() {
        return this.children[this.children.length - 1];
    }
    get firstElementChild() {
        return this.children.find(child => child instanceof XMLElement && !isLeaf(child.tagName));
    }
    get lastElementChild() {
        const elements = this.children.filter(child => child instanceof XMLElement && !isLeaf(child.tagName));
        if (elements.length === 0) {
            return null;
        }
        return elements[elements.length - 1];
    }
    get nextSibling() {
        if (this.parentElement) {
            const siblings = this.parentElement.children;
            const index = siblings.indexOf(this);
            if (index < siblings.length - 1) {
                return siblings[index + 1];
            }
        }
        return null;
    }
    get previousSibling() {
        if (this.parentElement) {
            const siblings = this.parentElement.children;
            const index = siblings.indexOf(this);
            if (index > 0) {
                return siblings[index - 1];
            }
        }
        return null;
    }
    setParent(element) {
        this.parentElement = element;
        return this;
    }
    hasAttribute(name) {
        return name in this.attributes;
    }
    getAttribute(name) {
        return this.attributes[name];
    }
    setAttribute(name, value) {
        if (isLeaf(this.tagName)) {
            return false;
        }
        this.attributes[name] = value;
    }
    cloneNode(deep = false, parentElement = null) {
        if (isLeaf(this.tagName)) {
            return new XMLElement({ ...this.node }, parentElement);
        }
        const tagName = this.tagName;
        const clonedNode = {
            ":@": { ...(this.node[":@"] || {}) }
        };
        clonedNode[tagName] = [];
        const clone = new XMLElement(clonedNode, parentElement);
        if (deep) {
            clonedNode[tagName] = this.children.map(child => child.cloneNode(deep, clone));
        }
        return clone;
    }
    appendChild(newChild) {
        const tagName = this.tagName;
        if (isLeaf(tagName)) {
            return false;
        }
        if (!this.node[tagName]) {
            this.node[tagName] = [];
        }
        let newChildElement;
        // Wrap newChild in XMLElement if it's not already
        if (newChild instanceof XMLElement) {
            newChild.parentElement?.removeChild(newChild);
            newChildElement = newChild.setParent(this);
        }
        else {
            newChildElement = new XMLElement(newChild, this);
        }
        // Append newChild to the list of children under the tagName
        ;
        this.node[tagName].push(newChildElement);
    }
    prependChild(newChild) {
        const tagName = this.tagName;
        if (isLeaf(tagName)) {
            return false;
        }
        if (!this.node[tagName]) {
            this.node[tagName] = [];
        }
        let newChildElement;
        // Wrap newChild in XMLElement if it's not already
        if (newChild instanceof XMLElement) {
            newChild.parentElement?.removeChild(newChild);
            newChildElement = newChild.setParent(this);
        }
        else {
            newChildElement = new XMLElement(newChild, this);
        }
        // Prepend newChild to the list of children under the tagName
        ;
        this.node[tagName].unshift(newChildElement);
    }
    appendXML(xmlString) {
        const tagName = this.tagName;
        if (isLeaf(tagName)) {
            return false;
        }
        const parser = new XMLParser(fastXMLParserOptions);
        const xml = parser.parse(`<${tagName}>${xmlString}</${tagName}>`);
        (xml[0][tagName] || []).forEach(child => {
            this.appendChild(child);
        });
    }
    prependXML(xmlString) {
        const tagName = this.tagName;
        if (isLeaf(tagName)) {
            return false;
        }
        const parser = new XMLParser(fastXMLParserOptions);
        const xml = parser.parse(`<${tagName}>${xmlString}</${tagName}>`);
        (xml[0][tagName] || [])
            .slice()
            .reverse()
            .forEach(child => {
            this.prependChild(child);
        });
    }
    insertXMLAt(xmlString, index) {
        const tagName = this.tagName;
        if (isLeaf(tagName)) {
            return false;
        }
        const parser = new XMLParser(fastXMLParserOptions);
        const xml = parser.parse(`<${tagName}>${xmlString}</${tagName}>`);
        (xml[0][tagName] || []).forEach((child, i) => {
            const newChild = new XMLElement(child, this);
            this.node[tagName].splice(index + i, 0, newChild);
        });
    }
    splitAtChildElement(childElement, appendToCurrentNode = "", insertBetweenNodes = "", insertAfterSplit = "") {
        if (!this.children.includes(childElement)) {
            return false;
        }
        // Get the index of the child element
        const children = this.children;
        const splitIndex = children.indexOf(childElement);
        // Store the original content
        const beforeContent = children.slice(0, splitIndex);
        const afterContent = children.slice(splitIndex + 1);
        // Clear current node's content
        this.node[this.tagName] = [];
        // Add back content before split point plus any appendToCurrentNode
        beforeContent.forEach(child => this.appendChild(child));
        if (appendToCurrentNode) {
            this.appendXML(appendToCurrentNode);
        }
        const nextSibling = this.nextSibling;
        // Insert between content if provided
        if (insertBetweenNodes) {
            const parentElement = this.parentElement;
            if (parentElement) {
                const currentIndex = parentElement.children.indexOf(this);
                parentElement.insertXMLAt(insertBetweenNodes, currentIndex + 1);
            }
        }
        // Create and insert the after content
        if (afterContent.length || insertAfterSplit) {
            const parentElement = this.parentElement;
            if (parentElement) {
                const insertIndex = nextSibling
                    ? parentElement.children.indexOf(nextSibling)
                    : parentElement.children.length;
                // Parse insertAfterSplit to get the node type and attributes
                if (insertAfterSplit) {
                    const parser = new XMLParser(fastXMLParserOptions);
                    const tempXml = parser.parse(insertAfterSplit)[0];
                    const newTagName = Object.keys(tempXml).find(key => key !== ":@");
                    const newAttributes = tempXml[":@"] || {};
                    // Create new element with the parsed tag name and attributes
                    const newElement = new XMLElement({
                        [newTagName]: [],
                        ":@": newAttributes
                    }, parentElement);
                    // Add the content from insertAfterSplit first
                    if (tempXml[newTagName]) {
                        ;
                        tempXml[newTagName].forEach(child => newElement.appendChild(child));
                    }
                    // Then add the existing after content
                    afterContent.forEach(child => newElement.appendChild(child));
                    parentElement.node[parentElement.tagName].splice(insertIndex, 0, newElement);
                }
                else {
                    // Fallback to original tag name if no insertAfterSplit provided
                    const tagName = this.tagName;
                    const newElement = new XMLElement({ [tagName]: [] }, parentElement);
                    afterContent.forEach(child => newElement.appendChild(child));
                    parentElement.node[parentElement.tagName].splice(insertIndex, 0, newElement);
                }
            }
        }
        return true;
    }
    removeChild(child) {
        if (isLeaf(this.tagName)) {
            return false;
        }
        if (this.node[this.tagName]) {
            const index = this.node[this.tagName].indexOf(child);
            if (index > -1) {
                ;
                this.node[this.tagName].splice(index, 1);
                child.setParent(null);
            }
        }
    }
    insertBefore(newChild, referenceChild) {
        if (isLeaf(this.tagName)) {
            return false;
        }
        if (this.node[this.tagName]) {
            const index = this.node[this.tagName].indexOf(referenceChild);
            if (index > -1) {
                let newChildElement;
                // Wrap newChild in XMLElement if it's not already
                if (newChild instanceof XMLElement) {
                    newChild.parentElement?.removeChild(newChild);
                    newChildElement = newChild.setParent(this);
                }
                else {
                    newChildElement = new XMLElement(newChild, this);
                }
                ;
                this.node[this.tagName].splice(index, 0, newChildElement);
            }
            else {
                // If referenceChild is not found, fallback to append
                this.appendChild(newChild);
            }
        }
    }
    query(tagName, attributes = {}) {
        return this.queryAll(tagName, attributes, 1)[0];
    }
    queryAll(tagName, attributes = {}, limit = false) {
        const result = [];
        const tags = typeof tagName === "string" ? [tagName] : tagName;
        function traverse(dom) {
            const currentTagName = Object.keys(dom.node).find(key => key !== ":@");
            if (tags.includes(currentTagName || "") &&
                Object.keys(attributes).every(attr => {
                    if (!dom.hasAttribute(attr)) {
                        return false;
                    }
                    const attributeValue = attributes[attr];
                    if (attributeValue === null) {
                        return true;
                    }
                    if (Array.isArray(attributeValue)) {
                        return attributeValue.includes(dom.getAttribute(attr));
                    }
                    return dom.getAttribute(attr) === attributeValue;
                })) {
                result.push(dom);
            }
            if (limit && result.length >= limit) {
                return true;
            }
            const childTagName = Object.keys(dom.node).find(key => key !== ":@");
            if (childTagName &&
                dom.node[childTagName] &&
                !isLeaf(childTagName)) {
                for (const childDOM of dom.node[childTagName]) {
                    if (traverse(childDOM)) {
                        return true;
                    }
                }
            }
            return false;
        }
        traverse(this);
        return result;
    }
    closest(tagName) {
        let currentNode = this;
        while (currentNode) {
            if (currentNode.tagName === tagName) {
                return currentNode;
            }
            currentNode = currentNode.parentElement;
        }
        return null;
    }
    // Serialize back to original structure in a non-destructive way
    toObject() {
        const tagName = this.tagName;
        const node = { ...this.node };
        if (this.node[":@"]) {
            node[":@"] = { ...this.node[":@"] };
        }
        if (tagName && this.node[tagName]) {
            if (Array.isArray(this.node[tagName])) {
                node[tagName] = this.node[tagName].map(child => {
                    return child instanceof XMLElement
                        ? child.toObject()
                        : child;
                });
            }
            else {
                node[tagName] =
                    this.node[tagName] instanceof XMLElement
                        ? this.node[tagName].toObject()
                        : this.node[tagName];
            }
        }
        if (tagName === "#document") {
            return node["#document"];
        }
        return node;
    }
    toString() {
        const tagName = this.tagName;
        if (isLeaf(tagName)) {
            if (tagName === "#text") {
                return String(this.node[tagName] || "");
            }
            else if (tagName === "__cdata") {
                return `<![CDATA[${this.node[tagName]}]]>`;
            }
            else if (tagName === "#comment") {
                return `<!--${this.node[tagName]}-->`;
            }
        }
        const builder = new XMLBuilder(fastXMLParserOptions);
        const object = this.toObject();
        return builder.build(Array.isArray(object) ? object : [object]);
    }
    get outerXML() {
        return this.toString();
    }
}
// Helper function to wrap the entire XML structure recursively
export const xmlDOM = (xmlString) => {
    const parser = new XMLParser(fastXMLParserOptions);
    // Parse the XML string into an object
    const xmlStructure = parser.parse(xmlString);
    const node = xmlStructure.length === 1
        ? xmlStructure[0]
        : { "#document": xmlStructure };
    // Recursively wrap each node in XMLElement
    return new XMLElement(node);
};
function validateXmlNamespaces(nodes, parentNamespaceMap) {
    for (const node of nodes) {
        if (typeof node !== "object" || node === null) {
            continue;
        }
        const nodeRecord = node;
        const tagNames = Object.keys(nodeRecord).filter(key => key !== ":@");
        const attributes = nodeRecord[":@"] || {};
        const namespaceMap = new Map(parentNamespaceMap);
        for (const attrName of Object.keys(attributes)) {
            if (attrName.startsWith("xmlns:")) {
                namespaceMap.set(attrName.slice(6), String(attributes[attrName]));
            }
            else if (attrName === "xmlns") {
                namespaceMap.set("", String(attributes[attrName]));
            }
        }
        for (const tagName of tagNames) {
            if (["#text", "__cdata", "#comment"].includes(tagName)) {
                continue;
            }
            checkXmlNamespacePrefix(tagName, namespaceMap);
        }
        for (const attrName of Object.keys(attributes)) {
            if (!attrName.startsWith("xmlns") && attrName !== "xmlns") {
                checkXmlNamespacePrefix(attrName, namespaceMap);
            }
        }
        for (const tagName of tagNames) {
            if (["#text", "__cdata", "#comment"].includes(tagName)) {
                continue;
            }
            const children = nodeRecord[tagName];
            if (Array.isArray(children)) {
                validateXmlNamespaces(children, namespaceMap);
            }
        }
    }
}
function checkXmlNamespacePrefix(name, namespaceMap) {
    const colonIndex = name.indexOf(":");
    if (colonIndex === -1) {
        return;
    }
    const prefix = name.slice(0, colonIndex);
    if (prefix === "xml" || prefix === "xmlns") {
        return;
    }
    if (!namespaceMap.has(prefix)) {
        throw new Error(`Namespace prefix "${prefix}" is not declared (${name})`);
    }
}
export function validateXml(xmlString) {
    const wellFormed = XMLValidator.validate(xmlString);
    if (wellFormed !== true) {
        const err = wellFormed;
        throw new Error(`Invalid XML: ${err.err.msg || err.err.code}`);
    }
    const parser = new XMLParser(fastXMLParserOptions);
    const xmlStructure = parser.parse(xmlString);
    validateXmlNamespaces(xmlStructure, new Map());
}
//# sourceMappingURL=xml.js.map