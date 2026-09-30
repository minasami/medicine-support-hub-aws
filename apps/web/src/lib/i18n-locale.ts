export type Language = "en" | "ar";

const STORAGE_KEY = "app-language";

/** Resolve UI language from an explicit store, else device/browser locale (`ar*` → Arabic). */
export function detectDeviceLanguage(
  stored?: string | null,
  navigatorLike?: { language?: string; languages?: readonly string[] } | null,
): Language {
  if (stored === "ar" || stored === "en") return stored;
  const nav =
    navigatorLike ?? (typeof navigator !== "undefined" ? navigator : null);
  const candidates = [
    ...(nav?.languages ? Array.from(nav.languages) : []),
    nav?.language || "",
  ].filter(Boolean);
  for (const tag of candidates) {
    if (/^ar([_-]|$)/i.test(String(tag).trim())) return "ar";
  }
  return "en";
}

export function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* private mode / SSR */
  }
}

export function applyDocumentLocale(language: Language) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
}

export { STORAGE_KEY as APP_LANGUAGE_STORAGE_KEY };
