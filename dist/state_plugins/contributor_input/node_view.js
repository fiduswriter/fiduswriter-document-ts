import { AddButton } from "./add_button.js";
export class ContributorsPartView {
    node;
    view;
    getPos;
    options;
    idTypes;
    dom;
    contentDOM;
    addButton;
    constructor(node, view, getPos, options = {}) {
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.options = options;
        this.idTypes =
            view.state?.doc?.attrs?.id_types || [];
        this.dom = document.createElement("div");
        this.dom.classList.add("doc-part");
        this.dom.classList.add(`doc-${this.node.type.name}`);
        this.dom.classList.add(`doc-${this.node.attrs.id}`);
        if (this.node.attrs.hidden) {
            this.dom.dataset.hidden = "true";
        }
        this.contentDOM = document.createElement("span");
        this.contentDOM.classList.add("contributors-inner");
        this.contentDOM.contentEditable =
            this.node.attrs.locking !== "fixed" ? "true" : "false";
        this.dom.appendChild(this.contentDOM);
        if (this.node.attrs.locking !== "fixed") {
            const AddButtonClass = options.AddButton || AddButton;
            this.addButton = new AddButtonClass(this.dom, () => this.getNode(), this.getPos, this.view, {
                idTypes: this.idTypes,
                onAdd: options.onAddContributor
            });
            this.addButton.init();
        }
        if (this.node.attrs.deleted &&
            options.addDeletedPartWidget) {
            options.addDeletedPartWidget(this.dom, view, getPos);
        }
    }
    stopEvent(event) {
        // Trap events for addButton
        if (["click", "mousedown"].includes(event.type)) {
            return false;
        }
        else if (!this.addButton || this.node.attrs.locking === "fixed") {
            return false;
        }
        else if (this.addButton.hasFocus() && event.type === "keydown") {
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
            // We must be in last position.
            // Activate the tag input tag editor.
            this.addButton?.focus();
        }
    }
    ignoreMutation(_record) {
        if (this.addButton?.hasFocus()) {
            return true;
        }
        return false;
    }
}
//# sourceMappingURL=node_view.js.map