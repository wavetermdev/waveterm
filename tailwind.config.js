/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./frontend/**/*.{js,ts,jsx,tsx,scss,css}", "./.storybook/**/*.{js,ts,jsx,tsx,scss,css}"],
    theme: {
        extend: {
            colors: {
                background: "#000000",
                foreground: "#f7f7f7",
                "muted-foreground": "rgb(195, 200, 194)",
            },
        },
    },
    corePlugins: { preflight: false },
    plugins: [],
};
