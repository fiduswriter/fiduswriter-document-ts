export const back = (
    notes: string,
    bibliographyHead: string,
    bibliographyItems: string
): string => `
<back>
    ${notes}
    <div type="bibliogr">
        <listBibl>
            <head>${bibliographyHead}</head>
            ${bibliographyItems}
        </listBibl>
    </div>
</back>
`
