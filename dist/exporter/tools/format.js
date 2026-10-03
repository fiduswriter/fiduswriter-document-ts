import prettier from "prettier/standalone";
import * as htmlPlugin from "prettier/plugins/html";
import * as postcssPlugin from "prettier/plugins/postcss";
import * as xmlPluginModule from "@prettier/plugin-xml";
const xmlPlugin = (xmlPluginModule.default ??
    xmlPluginModule);
const baseOptions = {
    tabWidth: 4,
    printWidth: 80
};
export async function formatHtml(html) {
    return prettier.format(html, {
        parser: "html",
        plugins: [htmlPlugin],
        ...baseOptions
    });
}
export async function formatCss(css) {
    return prettier.format(css, {
        parser: "css",
        plugins: [postcssPlugin],
        ...baseOptions
    });
}
export async function formatXml(xml) {
    return prettier.format(xml, {
        parser: "xml",
        plugins: [xmlPlugin],
        xmlWhitespaceSensitivity: "ignore",
        ...baseOptions
    });
}
//# sourceMappingURL=format.js.map