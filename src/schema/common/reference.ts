import type {MarkSpec, NodeSpec} from "prosemirror-model"
import {isSafeLinkHref} from "fwtoolkit"

export const cross_reference = {
    inline: true,
    group: "inline",
    attrs: {
        id: {
            default: false
        },
        title: {
            default: null // title === null means that the target is gone
        }
    },
    parseDOM: [
        {
            tag: "span.cross-reference[data-id][data-title]",
            getAttrs(dom: HTMLElement) {
                return {
                    id: dom.dataset.id || false,
                    title: dom.dataset.title ?? null
                }
            }
        }
    ],
    toDOM(node) {
        return [
            "span",
            {
                class: `cross-reference${node.attrs.title ? "" : " missing-target"}`,
                "data-id": node.attrs.id,
                "data-title": node.attrs.title
            },
            node.attrs.title ? node.attrs.title : gettext("Missing Target")
        ]
    }
} satisfies NodeSpec

export const link = {
    attrs: {
        href: {},
        title: {
            default: ""
        }
    },
    inclusive: false,
    parseDOM: [
        {
            tag: "a[href]",
            getAttrs(dom: HTMLElement) {
                const href = dom.getAttribute("href")
                // Drop anchors with a disallowed scheme
                // (e.g. javascript:) when parsing pasted HTML.
                if (!isSafeLinkHref(href)) {
                    return null
                }
                return {
                    href: href || "",
                    title: dom.getAttribute("title") || ""
                }
            }
        }
    ],
    toDOM(node) {
        const {href, title} = node.attrs
        const attrs =
            title || href.charAt(0) !== "#"
                ? {href, title}
                : {
                      href,
                      title: gettext("Missing target"),
                      class: "missing-target"
                  }
        return ["a", attrs, 0]
    }
} satisfies MarkSpec

export const randomAnchorId = (): string => {
    return `A${Math.round(Math.random() * 10000000) + 1}`
}

export const anchor = {
    attrs: {
        id: {
            default: false
        }
    },
    inclusive: false,
    group: "annotation",
    parseDOM: [
        {
            tag: "span.anchor[data-id]",
            getAttrs(dom: HTMLElement) {
                return {
                    id: dom.dataset.id || false
                }
            }
        }
    ],
    toDOM(node) {
        return [
            "span",
            {
                class: "anchor",
                "data-id": node.attrs.id
            }
        ]
    }
} satisfies MarkSpec
