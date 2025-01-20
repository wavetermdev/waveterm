/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./frontend/**/*.{js,ts,jsx,tsx,scss,css}", "./.storybook/**/*.{js,ts,jsx,tsx,scss,css}"],
    theme: {
        extend: {},
    },
    corePlugins: { preflight: false },
    plugins: [],
};
