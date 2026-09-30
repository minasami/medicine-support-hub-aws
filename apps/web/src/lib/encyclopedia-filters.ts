/**
 * Single source of truth for encyclopedia catalog filters.
 *
 * URL params, UI chips, Appwrite queries, and client post-filters
 * all walk TEXT_FILTERS + FLAG_FILTERS. Add a field once here.
 *
 * Consumer copy-paste patterns live in encyclopedia-filters.examples.ts
 */

export type EncyclopediaFilters = {
  manufacturer: string;
  scientificName: string;
  drugClass: string;
  route: string;
  dosageForm: string;
  category: string;
  verifiedOnly: boolean;
  medCareOnly: boolean;
};

/** @deprecated alias kept for catalog-links re-exports */
export type EncyclopediaFilterParams = EncyclopediaFilters;

export const emptyEncyclopediaFilters: EncyclopediaFilters = {
  manufacturer: "",
  scientificName: "",
  drugClass: "",
  route: "",
  dosageForm: "",
  category: "",
  verifiedOnly: false,
  medCareOnly: false,
};

export const emptyEncyclopediaFilterParams = emptyEncyclopediaFilters;

/** Product fields a text filter may match. */
export type FilterableMedicine = {
  manufacturer?: string | null;
  toll_manufacturer?: string | null;
  scientific_name?: string | null;
  ingredients?: string | null;
  drug_class?: string | null;
  route?: string | null;
  dosage_form?: string | null;
  category?: string | null;
  product_type?: string | null;
  has_verified_dataset?: boolean | null;
  is_medcare_toll?: boolean | null;
};

type TextFilterKey = {
  [K in keyof EncyclopediaFilters]: EncyclopediaFilters[K] extends string ? K : never;
}[keyof EncyclopediaFilters];

type FlagFilterKey = {
  [K in keyof EncyclopediaFilters]: EncyclopediaFilters[K] extends boolean ? K : never;
}[keyof EncyclopediaFilters];

export type TextFilterSpec = {
  key: TextFilterKey;
  urlKey: string;
  urlAliases: string[];
  appwriteAttr: string;
  itemFields: Array<keyof FilterableMedicine>;
  suggestField: keyof FilterableMedicine;
  inputId: string;
  labelEn: string;
  labelAr: string;
  placeholderEn: string;
  placeholderAr: string;
};

export type FlagFilterSpec = {
  key: FlagFilterKey;
  urlAliases: string[];
  urlWrite: { key: string; value: string };
  appwrite?: { attr: string; value: boolean };
  labelEn: string;
  labelAr: string;
};

export const TEXT_FILTERS: readonly TextFilterSpec[] = [
  {
    key: "manufacturer",
    urlKey: "company",
    urlAliases: ["company", "manufacturer"],
    appwriteAttr: "manufacturer",
    itemFields: ["manufacturer", "toll_manufacturer"],
    suggestField: "manufacturer",
    inputId: "enc-company",
    labelEn: "Company",
    labelAr: "الشركة",
    placeholderEn: "EVA, Novartis…",
    placeholderAr: "إيفا، نوفارتس…",
  },
  {
    key: "scientificName",
    urlKey: "inn",
    urlAliases: ["inn", "scientificName", "scientific_name"],
    appwriteAttr: "scientific_name",
    itemFields: ["scientific_name", "ingredients"],
    suggestField: "scientific_name",
    inputId: "enc-inn",
    labelEn: "INN",
    labelAr: "المادة الفعالة",
    placeholderEn: "Paracetamol, Insulin…",
    placeholderAr: "باراسيتامول، إنسولين…",
  },
  {
    key: "drugClass",
    urlKey: "class",
    urlAliases: ["class", "drugClass", "drug_class"],
    appwriteAttr: "drug_class",
    itemFields: ["drug_class"],
    suggestField: "drug_class",
    inputId: "enc-class",
    labelEn: "Drug class",
    labelAr: "الفئة الدوائية",
    placeholderEn: "Antibiotic, NSAID…",
    placeholderAr: "مضاد حيوي…",
  },
  {
    key: "route",
    urlKey: "route",
    urlAliases: ["route"],
    appwriteAttr: "route",
    itemFields: ["route"],
    suggestField: "route",
    inputId: "enc-route",
    labelEn: "Route",
    labelAr: "طريق الإعطاء",
    placeholderEn: "Oral, injection…",
    placeholderAr: "فموي، حقن…",
  },
  {
    key: "dosageForm",
    urlKey: "form",
    urlAliases: ["form", "dosageForm", "dosage_form"],
    appwriteAttr: "dosage_form",
    itemFields: ["dosage_form"],
    suggestField: "dosage_form",
    inputId: "enc-form",
    labelEn: "Dosage form",
    labelAr: "الشكل الصيدلاني",
    placeholderEn: "Tablet, syrup, cream…",
    placeholderAr: "أقراص، شراب، كريم…",
  },
  {
    key: "category",
    urlKey: "category",
    urlAliases: ["category"],
    appwriteAttr: "category",
    itemFields: ["category", "product_type"],
    suggestField: "category",
    inputId: "enc-cat",
    labelEn: "Category",
    labelAr: "التصنيف",
    placeholderEn: "Human, supplement…",
    placeholderAr: "بشري، مكمل…",
  },
];

export const FLAG_FILTERS: readonly FlagFilterSpec[] = [
  {
    key: "verifiedOnly",
    urlAliases: ["verifiedOnly", "verified"],
    urlWrite: { key: "verifiedOnly", value: "true" },
    appwrite: { attr: "has_verified_dataset", value: true },
    labelEn: "Verified",
    labelAr: "موثّق",
  },
  {
    key: "medCareOnly",
    urlAliases: ["medCare", "medCareOnly"],
    urlWrite: { key: "medCare", value: "1" },
    appwrite: { attr: "is_medcare_toll", value: true },
    labelEn: "Med-Care",
    labelAr: "Med-Care",
  },
];

function firstParam(params: URLSearchParams, keys: string[]): string {
  for (const key of keys) {
    const value = (params.get(key) || "").trim();
    if (value) return value;
  }
  return "";
}

function flagFromParams(params: URLSearchParams, spec: FlagFilterSpec): boolean {
  for (const key of spec.urlAliases) {
    const raw = (params.get(key) || "").trim().toLowerCase();
    if (raw === "true" || raw === "1" || raw === spec.urlWrite.value.toLowerCase()) return true;
  }
  return false;
}

export function normalizeEncyclopediaFilters(
  partial: Partial<EncyclopediaFilters> | null | undefined,
): EncyclopediaFilters {
  return { ...emptyEncyclopediaFilters, ...partial };
}

export function filtersEqual(a: EncyclopediaFilters, b: EncyclopediaFilters): boolean {
  return (
    FLAG_FILTERS.every((spec) => a[spec.key] === b[spec.key]) &&
    TEXT_FILTERS.every((spec) => a[spec.key] === b[spec.key])
  );
}

export function countActiveFilters(filters: Partial<EncyclopediaFilters>): number {
  let n = 0;
  for (const spec of TEXT_FILTERS) {
    if (String(filters[spec.key] || "").trim()) n++;
  }
  for (const spec of FLAG_FILTERS) {
    if (filters[spec.key]) n++;
  }
  return n;
}

export function hasActiveFilters(filters: Partial<EncyclopediaFilters>): boolean {
  return countActiveFilters(filters) > 0;
}

export function fieldContains(hay: unknown, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  return String(hay || "").toLowerCase().includes(n);
}

function matchesMedCareFlag(item: FilterableMedicine): boolean {
  if (item.is_medcare_toll) return true;
  return Boolean(item.manufacturer && /med[-\s]?care/i.test(item.manufacturer));
}

export function medicineMatchesFilters(
  item: FilterableMedicine,
  filters: Partial<EncyclopediaFilters>,
): boolean {
  for (const spec of TEXT_FILTERS) {
    const needle = String(filters[spec.key] || "").trim();
    if (!needle) continue;
    const hit = spec.itemFields.some((field) => fieldContains(item[field], needle));
    if (!hit) return false;
  }
  if (filters.verifiedOnly && item.has_verified_dataset === false) return false;
  if (filters.medCareOnly && !matchesMedCareFlag(item)) return false;
  return true;
}

export function applyClientFilters<T extends FilterableMedicine>(
  items: T[],
  filters: Partial<EncyclopediaFilters>,
): T[] {
  if (!hasActiveFilters(filters)) return items;
  return items.filter((item) => medicineMatchesFilters(item, filters));
}

export function readEncyclopediaFiltersFromLocation(
  loc: { search?: string; hash?: string } = typeof window !== "undefined"
    ? window.location
    : {},
): EncyclopediaFilters {
  const search = String(loc.search || "");
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const next: EncyclopediaFilters = { ...emptyEncyclopediaFilters };
  for (const spec of TEXT_FILTERS) {
    next[spec.key] = firstParam(params, spec.urlAliases);
  }
  for (const spec of FLAG_FILTERS) {
    next[spec.key] = flagFromParams(params, spec);
  }
  return next;
}

export function encyclopediaFilteredUrl(
  filters: Partial<EncyclopediaFilters> = {},
  query = "",
): string {
  const params = new URLSearchParams();
  const q = String(query || "").trim();
  if (q) params.set("q", q);
  const merged = normalizeEncyclopediaFilters(filters);
  for (const spec of TEXT_FILTERS) {
    const value = merged[spec.key].trim();
    if (value) params.set(spec.urlKey, value);
  }
  for (const spec of FLAG_FILTERS) {
    if (merged[spec.key]) params.set(spec.urlWrite.key, spec.urlWrite.value);
  }
  const qs = params.toString();
  return qs ? `/medicines?${qs}` : "/medicines";
}

export function syncEncyclopediaFilterUrl(
  query: string,
  filters: Partial<EncyclopediaFilters> = {},
) {
  if (typeof window === "undefined") return;
  try {
    const next = encyclopediaFilteredUrl(filters, query);
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === next || current === `${next}/`) return;
    window.history.replaceState(null, "", next);
  } catch {
    /* ignore */
  }
}

/** Catalog slice passed into fetchMedicinesPage (excludes page-only opts). */
export function catalogSliceFromFilters(
  filters: Partial<EncyclopediaFilters>,
): Pick<
  EncyclopediaFilters,
  | "manufacturer"
  | "scientificName"
  | "drugClass"
  | "route"
  | "dosageForm"
  | "category"
  | "verifiedOnly"
  | "medCareOnly"
> {
  const merged = normalizeEncyclopediaFilters(filters);
  return {
    manufacturer: merged.manufacturer,
    scientificName: merged.scientificName,
    drugClass: merged.drugClass,
    route: merged.route,
    dosageForm: merged.dosageForm,
    category: merged.category,
    verifiedOnly: merged.verifiedOnly,
    medCareOnly: merged.medCareOnly,
  };
}
