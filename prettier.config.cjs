/** @type {import("prettier").Config} */
module.exports = {
    plugins: ["prettier-plugin-jsdoc", "prettier-plugin-organize-imports"],
    printWidth: 120,
    trailingComma: "es5",
    useTabs: false,
    jsdocVerticalAlignment: true,
    jsdocSeparateReturnsFromParam: true,
    jsdocSeparateTagGroups: true,
    jsdocPreferCodeFences: true,
};
