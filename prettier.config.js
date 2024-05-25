/** @type {import("prettier").Config} */
export default {
	plugins: ["prettier-plugin-jsdoc", "prettier-plugin-organize-imports"],
	printWidth: 120,
	tabWidth: 4,
	useTabs: true,
	trailingComma: "es5",
	jsdocVerticalAlignment: true,
	jsdocSeparateReturnsFromParam: true,
	jsdocSeparateTagGroups: true,
	jsdocPreferCodeFences: true,
};
