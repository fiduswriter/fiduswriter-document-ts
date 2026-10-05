export {header} from "./header.js"
export {body} from "./body.js"
export {back} from "./back.js"

export const TEITemplate = (
    slug: string,
    teiHeader: string,
    text: string,
    backMatter: string
): string => `<?xml version="1.0" encoding="UTF-8"?>
<TEI xml:id="${slug}" xmlns="http://www.tei-c.org/ns/1.0">
${teiHeader}
<text>
    ${text}
    ${backMatter}
</text>
</TEI>
`
