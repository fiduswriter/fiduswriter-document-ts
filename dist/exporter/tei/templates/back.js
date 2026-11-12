export const back = (notes, bibliographyHead, bibliographyItems) => {
    // An empty <listBibl> is invalid TEI; only emit the bibliography div
    // when at least one entry was rendered.
    const bibliography = bibliographyItems.trim()
        ? `
    <div type="bibliogr">
        <listBibl>
            <head>${bibliographyHead}</head>
            ${bibliographyItems}
        </listBibl>
    </div>`
        : "";
    return `
<back>
    ${notes}${bibliography}
</back>
`;
};
//# sourceMappingURL=back.js.map