import {XMLBuilder, XMLParser, XMLValidator} from "fast-xml-parser"

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
}

export const isLeaf = (tagName: string | undefined): boolean =>
    ["#text", "__cdata", "#comment"].includes(tagName || "")

type XMLNode = Record<string, unknown>

export class XMLElement {
    node: XMLNode
    parentElement: XMLElement | null

    constructor(node: XMLNode, parentElement: XMLElement | null = null) {
        this.node = node
        this.parentElement = parentElement

        // Recursively wrap child elements if they exist
        const tagName = this.tagName
        if (tagName && this.node[tagName] && !isLeaf(tagName)) {
            this.node[tagName] = (this.node[tagName] as unknown[]).map(
                (child: unknown) => {
                    // Only wrap objects (not text nodes)
                    return typeof child === "object" && child !== null
                        ? new XMLElement(child as XMLNode, this)
                        : child
                }
            )
        }
    }

    get tagName(): string | undefined {
        // Get the tag name dynamically (the first key that isn't ":@")
        return Object.keys(this.node).find(key => key !== ":@")
    }

    get children(): Array<XMLElement | string> {
        // Return child elements if they exist, or an empty array if none
        return (this.node[this.tagName!] as Array<XMLElement | string>) || []
    }

    get attributes(): Record<string, unknown> {
        // Return attributes stored under the ":@" key, or an empty object if not present
        return (this.node[":@"] as Record<string, unknown>) || {}
    }

    set attributes(attrs: Record<string, unknown>) {
        // Update the attributes object
        this.node[":@"] = attrs
    }

    get innerXML(): string {
        // Serialize the children back to XML
        return this.children
            .map(child => {
                if (child instanceof XMLElement) {
                    return child.toString()
                }
                return String(child)
            })
            .join("")
    }

    set innerXML(xmlString: string) {
        ;(this.children as XMLElement[]).forEach(child => {
            child.setParent(null)
        })
        // Clear existing children
        this.node[this.tagName!] = []

        // Parse the new XML string
        const parser = new XMLParser(fastXMLParserOptions)
        const xml = parser.parse(
            `<${this.tagName}>${xmlString}</${this.tagName}>`
        ) as XMLNode[]
        // Append new children
        ;((xml[0][this.tagName!] as unknown[]) || []).forEach(child => {
            this.appendChild(child as XMLNode)
        })
    }

    get textContent(): string {
        const tagName = this.tagName
        if (isLeaf(tagName)) {
            if (tagName === "#text") {
                const value = this.node[tagName]
                return value === undefined || value === null
                    ? ""
                    : String(value)
            }
            return ""
        } else {
            // Serialize the children back to text
            return (this.children as XMLElement[])
                .map(child => child.textContent)
                .join("")
        }
    }

    set textContent(value: string) {
        const tagName = this.tagName
        // For leaf nodes, directly set the text content
        if (tagName === "#text") {
            this.node["#text"] = value
            return
        }

        // For element nodes, clear children and add a text node
        if (this.node[tagName!]) {
            // Clear existing children
            this.node[tagName!] = []

            // Only add text content if it's not empty
            if (value) {
                const textNode: XMLNode = {
                    "#text": value
                }
                ;(this.node[tagName!] as XMLElement[]).push(
                    new XMLElement(textNode, this)
                )
            }
        }
    }

    get firstChild(): XMLElement | string | undefined {
        return this.children[0]
    }

    get lastChild(): XMLElement | string | undefined {
        return this.children[this.children.length - 1]
    }

    get firstElementChild(): XMLElement | undefined {
        return (this.children as XMLElement[]).find(
            child => child instanceof XMLElement && !isLeaf(child.tagName)
        )
    }

    get lastElementChild(): XMLElement | null {
        const elements = (this.children as XMLElement[]).filter(
            child => child instanceof XMLElement && !isLeaf(child.tagName)
        )
        if (elements.length === 0) {
            return null
        }
        return elements[elements.length - 1]
    }

    get nextSibling(): XMLElement | null {
        if (this.parentElement) {
            const siblings = this.parentElement.children as XMLElement[]
            const index = siblings.indexOf(this)
            if (index < siblings.length - 1) {
                return siblings[index + 1]
            }
        }
        return null
    }

    get previousSibling(): XMLElement | null {
        if (this.parentElement) {
            const siblings = this.parentElement.children as XMLElement[]
            const index = siblings.indexOf(this)
            if (index > 0) {
                return siblings[index - 1]
            }
        }
        return null
    }

    setParent(element: XMLElement | null): this {
        this.parentElement = element
        return this
    }

    hasAttribute(name: string): boolean {
        return name in this.attributes
    }

    getAttribute(name: string): unknown {
        return this.attributes[name]
    }

    setAttribute(name: string, value: unknown): false | void {
        if (isLeaf(this.tagName)) {
            return false
        }
        this.attributes[name] = value
    }

    cloneNode(deep = false, parentElement: XMLElement | null = null): XMLElement {
        if (isLeaf(this.tagName)) {
            return new XMLElement({...this.node}, parentElement)
        }
        const tagName = this.tagName!
        const clonedNode: XMLNode = {
            ":@": {...((this.node[":@"] as Record<string, unknown>) || {})}
        }
        clonedNode[tagName] = []
        const clone = new XMLElement(clonedNode, parentElement)
        if (deep) {
            clonedNode[tagName] = (this.children as XMLElement[]).map(child =>
                child.cloneNode(deep, clone)
            )
        }
        return clone
    }

    appendChild(newChild: XMLNode | XMLElement): false | void {
        const tagName = this.tagName
        if (isLeaf(tagName)) {
            return false
        }
        if (!this.node[tagName!]) {
            this.node[tagName!] = []
        }
        let newChildElement: XMLElement
        // Wrap newChild in XMLElement if it's not already
        if (newChild instanceof XMLElement) {
            newChild.parentElement?.removeChild(newChild)
            newChildElement = newChild.setParent(this)
        } else {
            newChildElement = new XMLElement(newChild, this)
        }
        // Append newChild to the list of children under the tagName
        ;(this.node[tagName!] as XMLElement[]).push(newChildElement)
    }

    prependChild(newChild: XMLNode | XMLElement): false | void {
        const tagName = this.tagName
        if (isLeaf(tagName)) {
            return false
        }
        if (!this.node[tagName!]) {
            this.node[tagName!] = []
        }
        let newChildElement: XMLElement
        // Wrap newChild in XMLElement if it's not already
        if (newChild instanceof XMLElement) {
            newChild.parentElement?.removeChild(newChild)
            newChildElement = newChild.setParent(this)
        } else {
            newChildElement = new XMLElement(newChild, this)
        }
        // Prepend newChild to the list of children under the tagName
        ;(this.node[tagName!] as XMLElement[]).unshift(newChildElement)
    }

    appendXML(xmlString: string): false | void {
        const tagName = this.tagName
        if (isLeaf(tagName)) {
            return false
        }
        const parser = new XMLParser(fastXMLParserOptions)
        const xml = parser.parse(
            `<${tagName}>${xmlString}</${tagName}>`
        ) as XMLNode[]
        ;((xml[0][tagName!] as unknown[]) || []).forEach(child => {
            this.appendChild(child as XMLNode)
        })
    }

    prependXML(xmlString: string): false | void {
        const tagName = this.tagName
        if (isLeaf(tagName)) {
            return false
        }
        const parser = new XMLParser(fastXMLParserOptions)
        const xml = parser.parse(
            `<${tagName}>${xmlString}</${tagName}>`
        ) as XMLNode[]
        ;((xml[0][tagName!] as unknown[]) || [])
            .slice()
            .reverse()
            .forEach(child => {
                this.prependChild(child as XMLNode)
            })
    }

    insertXMLAt(xmlString: string, index: number): false | void {
        const tagName = this.tagName
        if (isLeaf(tagName)) {
            return false
        }
        const parser = new XMLParser(fastXMLParserOptions)
        const xml = parser.parse(
            `<${tagName}>${xmlString}</${tagName}>`
        ) as XMLNode[]
        ;((xml[0][tagName!] as unknown[]) || []).forEach((child, i) => {
            const newChild = new XMLElement(child as XMLNode, this)
            ;(this.node[tagName!] as XMLElement[]).splice(index + i, 0, newChild)
        })
    }

    splitAtChildElement(
        childElement: XMLElement,
        appendToCurrentNode = "",
        insertBetweenNodes = "",
        insertAfterSplit = ""
    ): boolean {
        if (!this.children.includes(childElement as unknown as never)) {
            return false
        }

        // Get the index of the child element
        const children = this.children as XMLElement[]
        const splitIndex = children.indexOf(childElement)

        // Store the original content
        const beforeContent = children.slice(0, splitIndex)
        const afterContent = children.slice(splitIndex + 1)

        // Clear current node's content
        this.node[this.tagName!] = []

        // Add back content before split point plus any appendToCurrentNode
        beforeContent.forEach(child => this.appendChild(child))
        if (appendToCurrentNode) {
            this.appendXML(appendToCurrentNode)
        }

        const nextSibling = this.nextSibling

        // Insert between content if provided
        if (insertBetweenNodes) {
            const parentElement = this.parentElement
            if (parentElement) {
                const currentIndex = parentElement.children.indexOf(this)
                parentElement.insertXMLAt(insertBetweenNodes, currentIndex + 1)
            }
        }

        // Create and insert the after content
        if (afterContent.length || insertAfterSplit) {
            const parentElement = this.parentElement
            if (parentElement) {
                const insertIndex = nextSibling
                    ? parentElement.children.indexOf(nextSibling)
                    : parentElement.children.length

                // Parse insertAfterSplit to get the node type and attributes
                if (insertAfterSplit) {
                    const parser = new XMLParser(fastXMLParserOptions)
                    const tempXml = (parser.parse(insertAfterSplit) as XMLNode[])[0]
                    const newTagName = Object.keys(tempXml).find(
                        key => key !== ":@"
                    )!
                    const newAttributes = (tempXml[":@"] as Record<
                        string,
                        unknown
                    >) || {}

                    // Create new element with the parsed tag name and attributes
                    const newElement = new XMLElement(
                        {
                            [newTagName]: [],
                            ":@": newAttributes
                        },
                        parentElement
                    )

                    // Add the content from insertAfterSplit first
                    if (tempXml[newTagName]) {
                        ;(tempXml[newTagName] as unknown[]).forEach(child =>
                            newElement.appendChild(child as XMLNode)
                        )
                    }

                    // Then add the existing after content
                    afterContent.forEach(child => newElement.appendChild(child))

                    ;(parentElement.node[parentElement.tagName!] as XMLElement[]).splice(
                        insertIndex,
                        0,
                        newElement
                    )
                } else {
                    // Fallback to original tag name if no insertAfterSplit provided
                    const tagName = this.tagName!
                    const newElement = new XMLElement(
                        {[tagName]: []},
                        parentElement
                    )
                    afterContent.forEach(child => newElement.appendChild(child))
                    ;(parentElement.node[parentElement.tagName!] as XMLElement[]).splice(
                        insertIndex,
                        0,
                        newElement
                    )
                }
            }
        }

        return true
    }

    removeChild(child: XMLElement): false | void {
        if (isLeaf(this.tagName)) {
            return false
        }
        if (this.node[this.tagName!]) {
            const index = (this.node[this.tagName!] as XMLElement[]).indexOf(child)
            if (index > -1) {
                ;(this.node[this.tagName!] as XMLElement[]).splice(index, 1)
                child.setParent(null)
            }
        }
    }

    insertBefore(newChild: XMLNode | XMLElement, referenceChild: XMLElement): false | void {
        if (isLeaf(this.tagName)) {
            return false
        }
        if (this.node[this.tagName!]) {
            const index = (this.node[this.tagName!] as XMLElement[]).indexOf(
                referenceChild
            )
            if (index > -1) {
                let newChildElement: XMLElement
                // Wrap newChild in XMLElement if it's not already
                if (newChild instanceof XMLElement) {
                    newChild.parentElement?.removeChild(newChild)
                    newChildElement = newChild.setParent(this)
                } else {
                    newChildElement = new XMLElement(newChild, this)
                }
                ;(this.node[this.tagName!] as XMLElement[]).splice(
                    index,
                    0,
                    newChildElement
                )
            } else {
                // If referenceChild is not found, fallback to append
                this.appendChild(newChild)
            }
        }
    }

    query(tagName: string | string[], attributes: Record<string, unknown> = {}): XMLElement | undefined {
        return this.queryAll(tagName, attributes, 1)[0]
    }

    queryAll(
        tagName: string | string[],
        attributes: Record<string, unknown> = {},
        limit: number | false = false
    ): XMLElement[] {
        const result: XMLElement[] = []
        const tags = typeof tagName === "string" ? [tagName] : tagName

        function traverse(dom: XMLElement): boolean {
            const currentTagName = Object.keys(dom.node).find(
                key => key !== ":@"
            )
            if (
                tags.includes(currentTagName || "") &&
                Object.keys(attributes).every(attr => {
                    if (!dom.hasAttribute(attr)) {
                        return false
                    }
                    const attributeValue = attributes[attr]
                    if (attributeValue === null) {
                        return true
                    }

                    if (Array.isArray(attributeValue)) {
                        return (attributeValue as unknown[]).includes(
                            dom.getAttribute(attr)
                        )
                    }

                    return dom.getAttribute(attr) === attributeValue
                })
            ) {
                result.push(dom)
            }
            if (limit && result.length >= limit) {
                return true
            }
            const childTagName = Object.keys(dom.node).find(key => key !== ":@")
            if (
                childTagName &&
                dom.node[childTagName] &&
                !isLeaf(childTagName)
            ) {
                for (const childDOM of dom.node[childTagName] as XMLElement[]) {
                    if (traverse(childDOM)) {
                        return true
                    }
                }
            }
            return false
        }

        traverse(this)
        return result
    }

    closest(tagName: string): XMLElement | null {
        let currentNode: XMLElement | null = this
        while (currentNode) {
            if (currentNode.tagName === tagName) {
                return currentNode
            }
            currentNode = currentNode.parentElement
        }
        return null
    }

    // Serialize back to original structure in a non-destructive way
    toObject(): unknown {
        const tagName = this.tagName
        const node = {...this.node}
        if (this.node[":@"]) {
            node[":@"] = {...(this.node[":@"] as Record<string, unknown>)}
        }
        if (tagName && this.node[tagName]) {
            if (Array.isArray(this.node[tagName])) {
                node[tagName] = (this.node[tagName] as XMLElement[]).map(child => {
                    return child instanceof XMLElement
                        ? child.toObject()
                        : child
                })
            } else {
                node[tagName] =
                    (this.node[tagName] as unknown) instanceof XMLElement
                        ? (this.node[tagName] as XMLElement).toObject()
                        : this.node[tagName]
            }
        }

        if (tagName === "#document") {
            return node["#document"]
        }

        return node
    }

    toString(): string {
        const tagName = this.tagName
        if (isLeaf(tagName)) {
            if (tagName === "#text") {
                return String(this.node[tagName] || "")
            } else if (tagName === "__cdata") {
                return `<![CDATA[${this.node[tagName]}]]>`
            } else if (tagName === "#comment") {
                return `<!--${this.node[tagName]}-->`
            }
        }
        const builder = new XMLBuilder(fastXMLParserOptions)
        const object = this.toObject()
        return builder.build(Array.isArray(object) ? object : [object])
    }

    get outerXML(): string {
        return this.toString()
    }
}

// Helper function to wrap the entire XML structure recursively
export const xmlDOM = (xmlString: string): XMLElement => {
    const parser = new XMLParser(fastXMLParserOptions)
    // Parse the XML string into an object
    const xmlStructure = parser.parse(xmlString) as XMLNode[]

    const node =
        xmlStructure.length === 1
            ? xmlStructure[0]
            : ({"#document": xmlStructure} as XMLNode)
    // Recursively wrap each node in XMLElement
    return new XMLElement(node)
}

function validateXmlNamespaces(
    nodes: unknown[],
    parentNamespaceMap: Map<string, string>
): void {
    for (const node of nodes) {
        if (typeof node !== "object" || node === null) {
            continue
        }
        const nodeRecord = node as Record<string, unknown>
        const tagNames = Object.keys(nodeRecord).filter(key => key !== ":@")
        const attributes = (nodeRecord[":@"] as Record<string, unknown>) || {}
        const namespaceMap = new Map(parentNamespaceMap)
        for (const attrName of Object.keys(attributes)) {
            if (attrName.startsWith("xmlns:")) {
                namespaceMap.set(attrName.slice(6), String(attributes[attrName]))
            } else if (attrName === "xmlns") {
                namespaceMap.set("", String(attributes[attrName]))
            }
        }
        for (const tagName of tagNames) {
            if (["#text", "__cdata", "#comment"].includes(tagName)) {
                continue
            }
            checkXmlNamespacePrefix(tagName, namespaceMap)
        }
        for (const attrName of Object.keys(attributes)) {
            if (!attrName.startsWith("xmlns") && attrName !== "xmlns") {
                checkXmlNamespacePrefix(attrName, namespaceMap)
            }
        }
        for (const tagName of tagNames) {
            if (["#text", "__cdata", "#comment"].includes(tagName)) {
                continue
            }
            const children = nodeRecord[tagName]
            if (Array.isArray(children)) {
                validateXmlNamespaces(children, namespaceMap)
            }
        }
    }
}

function checkXmlNamespacePrefix(
    name: string,
    namespaceMap: Map<string, string>
): void {
    const colonIndex = name.indexOf(":")
    if (colonIndex === -1) {
        return
    }
    const prefix = name.slice(0, colonIndex)
    if (prefix === "xml" || prefix === "xmlns") {
        return
    }
    if (!namespaceMap.has(prefix)) {
        throw new Error(`Namespace prefix "${prefix}" is not declared (${name})`)
    }
}

export function validateXml(xmlString: string): void {
    const wellFormed = XMLValidator.validate(xmlString)
    if (wellFormed !== true) {
        const err = wellFormed as {err: {msg?: string; code?: string}}
        throw new Error(`Invalid XML: ${err.err.msg || err.err.code}`)
    }
    const parser = new XMLParser(fastXMLParserOptions)
    const xmlStructure = parser.parse(xmlString) as unknown[]
    validateXmlNamespaces(xmlStructure, new Map())
}
