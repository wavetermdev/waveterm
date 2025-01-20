/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./frontend/**/*.{js,ts,jsx,tsx,scss,css}", // adjust this path if your frontend files are elsewhere
    ],
    theme: {
        extend: {},
    },
    corePlugins: { preflight: false },
    plugins: [],
};
