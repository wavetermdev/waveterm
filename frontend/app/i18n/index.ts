import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

// Detect system language and map to supported locale
function detectLanguage(): string {
    const sysLang = navigator.language || "en";
    if (sysLang.startsWith("zh")) {
        return "zh-CN";
    }
    return "en";
}

// Allow override via localStorage
const savedLang = localStorage.getItem("wave:language");
const initialLang = savedLang || detectLanguage();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: initialLang,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

// Save language preference on change
i18n.on("languageChanged", (lng: string) => {
    localStorage.setItem("wave:language", lng);
});

export default i18n;

// Expose a global t function for use in non-React contexts (e.g. event handlers, menus)
declare global {
    interface Window {
        __waveI18n: { t: typeof i18n.t; changeLanguage: typeof i18n.changeLanguage };
    }
}
window.__waveI18n = { t: i18n.t.bind(i18n), changeLanguage: i18n.changeLanguage.bind(i18n) };
