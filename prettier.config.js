/** @type {import("prettier").Config} */
export default {
    plugins: ["prettier-plugin-jsdoc", "prettier-plugin-organize-imports"],
    printWidth: 120,
    trailingComma: "es5",
    jsdocVerticalAlignment: true,
    jsdocSeparateReturnsFromParam: true,
    jsdocSeparateTagGroups: true,
    jsdocPreferCodeFences: true,
};
