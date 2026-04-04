import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: "zh-CN", // default language
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;

// Expose a global t function for use in non-React contexts (e.g. event handlers, menus)
declare global {
    interface Window {
        __waveI18n: { t: typeof i18n.t };
    }
}
window.__waveI18n = { t: i18n.t.bind(i18n) };