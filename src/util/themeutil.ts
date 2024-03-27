import React, { useEffect, useState } from "react";

export const useTheme = () => {
    const initialTheme = darkTheme;
    const [theme, setTheme] = useState(initialTheme);
    useEffect(() => {
        window
            .matchMedia("(prefers-color-scheme: dark)")
            .addEventListener("change", (e) => e.matches && setTheme(darkTheme));
        window
            .matchMedia("(prefers-color-scheme: light)")
            .addEventListener("change", (e) => e.matches && setTheme(lightTheme));
    }, []);
    return theme;
};
