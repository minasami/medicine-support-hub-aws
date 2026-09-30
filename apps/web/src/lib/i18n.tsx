import React, { createContext, useContext, useState, useEffect } from "react";
import {
  type Language,
  detectDeviceLanguage,
  readStoredLanguage,
  persistLanguage,
  applyDocumentLocale,
} from "./i18n-locale";

export type { Language };
export { detectDeviceLanguage } from "./i18n-locale";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (en: string, ar: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const lang = detectDeviceLanguage(readStoredLanguage());
    applyDocumentLocale(lang);
    return lang;
  });

  useEffect(() => {
    persistLanguage(language);
    applyDocumentLocale(language);
  }, [language]);

  const t = (en: string, ar: string) => {
    return language === "en" ? en : ar;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
