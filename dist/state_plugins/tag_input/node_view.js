import { createTagEditor } from "./tag_editor.js";
export class TagsPartView {
    node;
    view;
    getPos;
    options;
    dom;
    contentDOM;
    tagInputView;
    constructor(node, view, getPos, options = {}) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.options = options;
        this.dom = document.createElement("div");
        this.dom.classList.add("doc-part");
        this.dom.classList.add(`doc-${this.node.type.name}`);
        this.dom.classList.add(`doc-${this.node.attrs.id}`);
        if (this.node.attrs.hidden) {
            this.dom.dataset.hidden = "true";
        }
        this.contentDOM = document.createElement("span");
        this.contentDOM.classList.add("tags-inner");
        this.contentDOM.contentEditable =
            this.node.attrs.locking !== "fixed" ? "true" : "false";
        this.dom.appendChild(this.contentDOM);
        if (this.node.attrs.locking !== "fixed") {
            const createTagEditorFn = options.createTagEditor || createTagEditor;
            const [tagInputDOM, tagInputView] = createTagEditorFn(view, getPos, () => this.getNode());
            this.tagInputView = tagInputView;
            this.dom.appendChild(tagInputDOM);
        }
        if (this.node.attrs.deleted &&
            options.addDeletedPartWidget) {
            options.addDeletedPartWidget(this.dom, view, getPos);
        }
    }
    stopEvent(event) {
        // Trap events for tagInputView
        if (["click", "mousedown"].includes(event.type)) {
            return false;
        }
        else if (!this.tagInputView || this.node.attrs.locking === "fixed") {
            return false;
        }
        else if (event.type === "keydown" && this.tagInputView.hasFocus()) {
            return true;
        }
        else {
            return false;
        }
    }
    update(node, _decorations, _innerDecorations) {
        this.node = node;
        if (this.node.attrs.hidden) {
            this.dom.dataset.hidden = "true";
        }
        else {
            delete this.dom.dataset.hidden;
        }
        return true;
    }
    getNode() {
        return this.node;
    }
    setSelection(anchor, head, _root) {
        if (anchor === head && this.view.hasFocus()) {
            // Check if we should prevent refocusing (e.g., user just clicked on a tag)
            const shouldPreventTagInputFocus = this.options.shouldPreventTagInputFocus || (() => false);
            if (shouldPreventTagInputFocus()) {
                return;
            }
            // We must be in last position.
            // Activate the tag input tag editor.
            this.tagInputView?.focus();
        }
    }
    ignoreMutation(_record) {
        if (this.tagInputView?.hasFocus()) {
            return true;
        }
        return false;
    }
}
//# sourceMappingURL=node_view.js.map