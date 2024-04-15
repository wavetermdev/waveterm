function getTermThemes(termThemeOptions: string[], noneLabel = "Inherit"): DropdownItem[] {
    if (!termThemeOptions) {
        return [];
    }
    const tt: DropdownItem[] = [];
    tt.push({
        label: noneLabel,
        value: null,
    });
    for (const themeName of Object.keys(termThemeOptions)) {
        tt.push({
            label: themeName,
            value: themeName,
        });
    }
    return tt;
}

export { getTermThemes };
