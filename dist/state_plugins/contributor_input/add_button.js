import { keyName } from "w3c-keyname";
import { NodeSelection } from "prosemirror-state";
import { nextSelection } from "./helpers.js";
export class AddButton {
    dom;
    getNode;
    getPos;
    view;
    idTypes;
    onAdd;
    button;
    constructor(dom, getNode, getPos, view, options = {}) {
        this.dom = dom;
        this.getNode = getNode;
        this.getPos = getPos;
        this.view = view;
        this.idTypes = options.idTypes || [];
        this.onAdd = options.onAdd || (() => { });
        this.button = null;
    }
    init() {
        const node = this.getNode();
        const nodeTitle = node.attrs.item_title;
        this.dom.insertAdjacentHTML("beforeend", `<button class="fw-button fw-light">${gettext("Add")} ${nodeTitle.toLowerCase()}...</button>`);
        this.button = this.dom.lastElementChild;
        this.button.addEventListener("click", event => this.handleActivation(event));
        this.button.addEventListener("keydown", event => this.handleKeyDown(event));
    }
    handleKeyDown(event) {
        const key = keyName(event);
        switch (key) {
            case "Enter":
            case " ":
                this.handleActivation(event);
                break;
            case "ArrowRight":
            case "ArrowDown":
                if (this.handleArrowDown()) {
                    event.preventDefault();
                }
                break;
            case "ArrowLeft":
                if (this.handleArrowLeft()) {
                    event.preventDefault();
                }
                break;
            case "ArrowUp":
                if (this.handleArrowUp()) {
                    event.preventDefault();
                }
                break;
            default:
                break;
        }
    }
    handleActivation(event) {
        event.preventDefault();
        this.onAdd(this.getNode(), this.view, this.idTypes);
    }
    handleArrowLeft() {
        const node = this.getNode();
        if (node.nodeSize > 2) {
            // At least one contributor
            const startPos = this.getPos() + node.nodeSize - 2;
            this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, startPos)));
            this.view.focus();
            return true;
        }
        else {
            // There is no tag
            return this.handleArrowUp();
        }
    }
    handleArrowUp() {
        // We jump to the section before this one.
        const startPos = this.getPos();
        const newSelection = nextSelection(this.view.state, startPos, -1);
        if (!newSelection) {
            return false;
        }
        this.view.dispatch(this.view.state.tr.setSelection(newSelection));
        this.view.focus();
        return true;
    }
    handleArrowDown() {
        // Move the cursor beyond the contributors part
        const node = this.getNode();
        const pos = this.getPos() + node.nodeSize + 1;
        const newSelection = nextSelection(this.view.state, pos, 1);
        if (!newSelection) {
            return false;
        }
        this.view.dispatch(this.view.state.tr.setSelection(newSelection));
        this.view.focus();
        return true;
    }
    hasFocus() {
        return this.button === window.document.activeElement;
    }
    focus() {
        if (this.button) {
            this.button.focus();
        }
    }
}
//# sourceMappingURL=add_button.js.map