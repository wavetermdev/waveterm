function loadTheme(theme) {
    const linkTag: any = document.getElementById("theme-stylesheet");
    if (theme === "dark") {
        linkTag.href = "public/themes/default.css";
    } else {
        linkTag.href = `public/themes/${theme}.css`;
    }
}

function getTermThemes(termThemes: string[], noneLabel = "Inherit"): DropdownItem[] {
    const tt: DropdownItem[] = [];
    tt.push({
        label: noneLabel,
        value: null,
    });
    for (const themeName of termThemes) {
        tt.push({
            label: themeName,
            value: themeName,
        });
    }
    return tt;
}

export { loadTheme, getTermThemes };
