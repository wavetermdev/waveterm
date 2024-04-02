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

export { getTermThemes };
