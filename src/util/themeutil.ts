function loadTheme(theme: string) {
    const linkTag: any = document.getElementById("theme-stylesheet");
    if (theme === "dark") {
        linkTag.href = "public/themes/default.css";
    } else {
        linkTag.href = `public/themes/${theme}.css`;
    }
}

export { loadTheme };
