import { docSchema } from "./document/index.js";
export class SchemaExport {
    schema;
    constructor() {
        this.schema = docSchema;
    }
    init() {
        const spec = {
            nodes: {},
            marks: {}
        };
        this.schema.spec.nodes.forEach((key, value) => (spec.nodes[key] = value));
        this.schema.spec.marks.forEach((key, value) => (spec.marks[key] = value));
        return JSON.stringify(spec);
    }
}
//# sourceMappingURL=export.js.map