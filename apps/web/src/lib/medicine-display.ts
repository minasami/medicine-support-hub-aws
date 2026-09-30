export type MedicineDisplaySource = "provided" | "inferred" | "planned";

export type MedicineDisplayField = {
  value: string;
  source: MedicineDisplaySource;
};

const STRENGTH_PATTERN = /(?:^|\s)(\d+(?:[.,]\d+)?\s?(?:mg|mcg|g|gm|gram|grams|ml|iu|unit|units|%|mg\/ml|mcg\/ml|mg\/g|mg\/5ml|mg\/dose|iu\/ml))(?:\s|$)/i;

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

export function inferStrengthFromName(...names: Array<string | null | undefined>): string | null {
  for (const name of names) {
    const text = clean(name);
    if (!text) continue;
    const match = text.match(STRENGTH_PATTERN);
    if (match?.[1]) return match[1].replace(/\s+/g, " ").trim();
  }
  return null;
}

export function displayStrength(strength: string | null | undefined, ...names: Array<string | null | undefined>): MedicineDisplayField {
  const provided = clean(strength);
  if (provided) return { value: provided, source: "provided" };
  const inferred = inferStrengthFromName(...names);
  if (inferred) return { value: inferred, source: "inferred" };
  return { value: "Pending enrichment", source: "planned" };
}

export function displayKnownOrPlanned(value: string | null | undefined): MedicineDisplayField {
  const provided = clean(value);
  if (provided) return { value: provided, source: "provided" };
  return { value: "Pending enrichment", source: "planned" };
}

export function sourceLabel(source: MedicineDisplaySource, language: "en" | "ar") {
  if (source === "provided") return "";
  if (source === "inferred") return language === "ar" ? "مستنتج من الاسم" : "inferred from name";
  return language === "ar" ? "مخطط لإثرائه" : "planned enrichment";
}

/** Re-export catalog title helpers used by encyclopedia cards. */
export {
  formatCatalogTitle,
  scrubCatalogNameRaw,
  formatCatalogPriceRange,
} from "./encyclopedia-catalog";

/**
 * Prefer locale-primary trade name; expose the other language as secondary when both exist.
 */
export function localeMedicineNames(
  language: "en" | "ar",
  nameEn?: string | null,
  nameAr?: string | null,
  fallback?: string | null,
): { primary: string; secondary: string | null } {
  const en = String(nameEn ?? "").trim();
  const ar = String(nameAr ?? "").trim();
  const fb = String(fallback ?? "").trim();
  if (language === "ar") {
    const primary = ar || en || fb;
    const secondary = ar && en && ar !== en ? en : null;
    return { primary, secondary };
  }
  const primary = en || ar || fb;
  const secondary = en && ar && ar !== en ? ar : null;
  return { primary, secondary };
}
