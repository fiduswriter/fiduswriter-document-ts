import { DocxCitationsParser } from "bibliojson";
import { citationResultToNode } from "../citations.js";
/**
 * Check whether a field instruction string belongs to a citation.
 * Uses DocxCitationsParser.fieldCitation() with retrieve=false so no BibDB
 * is allocated for the check.
 */
export function isDocxCitationField(instrText) {
    if (!instrText) {
        return false;
    }
    return DocxCitationsParser.fieldCitation(instrText, false).isCitation;
}
/**
 * Check whether a field instruction string belongs to a bibliography region
 * (Zotero ZOTERO_BIBL, Word native BIBLIOGRAPHY, EN.REFLIST, etc.).
 * Uses DocxCitationsParser.fieldBibliography() with the accumulated
 * instruction text between begin and separate markers.
 */
export function isDocxBibliographyField(instrText) {
    if (!instrText) {
        return false;
    }
    return DocxCitationsParser.fieldBibliography(instrText).isBibliography;
}
/**
 * Check whether a w:sdt node contains a citation (Mendeley v3, Citavi).
 * Uses DocxCitationsParser.sdtCitation() with retrieve=false.
 */
export function isDocxSdtCitation(sdtNode) {
    if (!sdtNode) {
        return false;
    }
    return DocxCitationsParser.sdtCitation(sdtNode.outerXML, false).isCitation;
}
/**
 * Check whether a w:sdt node is a bibliography rendering region
 * (Mendeley v3 bibliography, Citavi bibliography).
 * Uses DocxCitationsParser.sdtBibliography().
 */
export function isDocxSdtBibliography(sdtNode) {
    if (!sdtNode) {
        return false;
    }
    return DocxCitationsParser.sdtBibliography(sdtNode.outerXML).isBibliography;
}
/**
 * Parse a citation from a DOCX field instruction and add any new bibliography
 * entries into `bibliography`.
 *
 * Handles all field-based citation managers: Zotero, Mendeley Desktop
 * (legacy), EndNote (both inline and fldData forms), Citavi (older ADDIN
 * form), and Word native (requires sourcesXml).
 */
export function parseDocxFieldCitation(instrText, fldData, sourcesXml, bibliography) {
    if (!instrText) {
        return null;
    }
    const options = sourcesXml ? { sourcesXml } : {};
    const result = DocxCitationsParser.fieldCitation(instrText, true, // retrieve
    true, // retrieveMetadata
    true, // extractWordNative
    fldData || undefined, options);
    return citationResultToNode(result, bibliography);
}
/**
 * Parse a citation from a DOCX structured document tag (w:sdt) and add any
 * new bibliography entries into `bibliography`.
 *
 * Handles Mendeley Cite v3 and Citavi (modern SDT form).
 */
export function parseDocxSdtCitation(sdtNode, bibliography) {
    if (!sdtNode) {
        return null;
    }
    const result = DocxCitationsParser.sdtCitation(sdtNode.outerXML, true, // retrieve
    true // retrieveMetadata
    );
    return citationResultToNode(result, bibliography);
}
//# sourceMappingURL=citations.js.map