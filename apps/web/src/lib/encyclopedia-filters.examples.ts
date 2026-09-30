/**
 * Consumer examples for encyclopedia-filters.ts
 *
 * Import from "@/lib/encyclopedia-filters" (or "@/lib/catalog-links"
 * for the re-exported URL helpers). Specs in TEXT_FILTERS / FLAG_FILTERS
 * are the single source of truth — do not hard-code URL keys in callers.
 */

import {
  TEXT_FILTERS,
  FLAG_FILTERS,
  emptyEncyclopediaFilters,
  normalizeEncyclopediaFilters,
  filtersEqual,
  countActiveFilters,
  hasActiveFilters,
  applyClientFilters,
  medicineMatchesFilters,
  readEncyclopediaFiltersFromLocation,
  encyclopediaFilteredUrl,
  syncEncyclopediaFilterUrl,
  catalogSliceFromFilters,
  type EncyclopediaFilters,
  type FilterableMedicine,
} from "./encyclopedia-filters";

export function exampleProductChipLinks(product: {
  scientific_name?: string | null;
  manufacturer?: string | null;
  drug_class?: string | null;
  dosage_form?: string | null;
  route?: string | null;
}) {
  const byInn = encyclopediaFilteredUrl({
    scientificName: String(product.scientific_name || ""),
  });
  const byCompany = encyclopediaFilteredUrl({
    manufacturer: String(product.manufacturer || ""),
  });
  const byClass = encyclopediaFilteredUrl({
    drugClass: String(product.drug_class || ""),
  });
  const combined = encyclopediaFilteredUrl(
    {
      manufacturer: String(product.manufacturer || ""),
      dosageForm: String(product.dosage_form || ""),
    },
    "panadol",
  );
  return { byInn, byCompany, byClass, combined };
}

export function exampleReadFiltersOnMount(): EncyclopediaFilters {
  if (typeof window === "undefined") return emptyEncyclopediaFilters;
  return readEncyclopediaFiltersFromLocation(window.location);
}

export function exampleSyncUrl(query: string, filters: EncyclopediaFilters) {
  syncEncyclopediaFilterUrl(query, filters);
}

export async function exampleLoadPage(
  fetchMedicinesPage: (opts: Record<string, unknown>) => Promise<unknown>,
  query: string,
  filters: EncyclopediaFilters,
) {
  return fetchMedicinesPage({
    query,
    limit: 40,
    offset: 0,
    ...catalogSliceFromFilters(filters),
  });
}

export function exampleStaticFallback<T extends FilterableMedicine>(
  allRows: T[],
  filters: Partial<EncyclopediaFilters>,
): T[] {
  return applyClientFilters(allRows, filters);
}

export function exampleSingleRowGuard(row: FilterableMedicine, filters: EncyclopediaFilters) {
  return medicineMatchesFilters(row, filters);
}

export function exampleFilterBarProps(
  filters: EncyclopediaFilters,
  setFilters: (next: EncyclopediaFilters) => void,
) {
  return {
    filters,
    onChange: (partial: Partial<EncyclopediaFilters>) => {
      const next = normalizeEncyclopediaFilters({ ...filters, ...partial });
      if (filtersEqual(filters, next)) return;
      setFilters(next);
    },
    activeCount: countActiveFilters(filters),
    canClear: hasActiveFilters(filters),
    onClear: () => setFilters(emptyEncyclopediaFilters),
  };
}

export function exampleChipLabels(lang: "en" | "ar") {
  return TEXT_FILTERS.map((spec) => ({
    key: spec.key,
    urlKey: spec.urlKey,
    inputId: spec.inputId,
    label: lang === "ar" ? spec.labelAr : spec.labelEn,
    placeholder: lang === "ar" ? spec.placeholderAr : spec.placeholderEn,
  }));
}

export function exampleFlagLabels(lang: "en" | "ar") {
  return FLAG_FILTERS.map((spec) => ({
    key: spec.key,
    label: lang === "ar" ? spec.labelAr : spec.labelEn,
    write: spec.urlWrite,
  }));
}

export function exampleAppwriteContainsQueries(
  Query: { contains: (attr: string, value: string) => unknown; equal: (attr: string, value: boolean) => unknown },
  filters: EncyclopediaFilters,
): unknown[] {
  const queries: unknown[] = [];
  for (const spec of TEXT_FILTERS) {
    const value = filters[spec.key].trim();
    if (value) queries.push(Query.contains(spec.appwriteAttr, value));
  }
  for (const spec of FLAG_FILTERS) {
    if (filters[spec.key] && spec.appwrite) {
      queries.push(Query.equal(spec.appwrite.attr, spec.appwrite.value));
    }
  }
  return queries;
}

export const EXAMPLE_URLS = {
  company: "/medicines?company=EVA",
  inn: "/medicines?inn=Paracetamol",
  form: "/medicines?form=tablet",
  stacked: "/medicines?q=cataflam&company=Novartis&class=NSAID&form=tablet",
  verifiedMedCare: "/medicines?verifiedOnly=true&medCare=1",
} as const;
