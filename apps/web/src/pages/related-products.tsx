import { collectPages, comparePrices } from "@/lib/collection-results";
import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductActionCard } from "@/components/product-action-card";
import { EncyclopediaFilterBar } from "@/components/encyclopedia-filter-bar";
import { useLanguage } from "@/lib/i18n";
import {
  fetchMedicinesPage,
  type MedicineListItem,
} from "@/lib/medicines-appwrite-page";
import {
  applyClientFilters,
  emptyEncyclopediaFilters,
  readEncyclopediaFiltersFromLocation,
  TEXT_FILTERS,
  type EncyclopediaFilters,
} from "@/lib/encyclopedia-filters";

type Mode = "similars" | "alternatives" | "company";
type SortKey =
  | "relevance"
  | "name"
  | "price-asc"
  | "price-desc"
  | "form"
  | "company"
  | "strength";

const SORT_KEYS: SortKey[] = [
  "relevance",
  "name",
  "price-asc",
  "price-desc",
  "form",
  "company",
  "strength",
];

function decodeParam(value: string | undefined) {
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function uniqueValues(items: MedicineListItem[], field: keyof MedicineListItem): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const raw = String(item[field] || "").trim();
    if (raw) set.add(raw);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function priceOf(item: MedicineListItem): number {
  const n = Number(item.current_price_egp);
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

function readCollectionQuery(): { q: string; sort: SortKey; pricedOnly: boolean } {
  if (typeof window === "undefined") {
    return { q: "", sort: "relevance", pricedOnly: false };
  }
  const params = new URLSearchParams(window.location.search);
  const sort = (params.get("sort") || "relevance") as SortKey;
  return {
    q: (params.get("q") || "").trim(),
    sort: SORT_KEYS.includes(sort) ? sort : "relevance",
    pricedOnly: params.get("priced") === "1",
  };
}

function writeCollectionQuery(next: {
  q: string;
  sort: SortKey;
  pricedOnly: boolean;
  filters: EncyclopediaFilters;
}) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.sort && next.sort !== "relevance") params.set("sort", next.sort);
  if (next.pricedOnly) params.set("priced", "1");
  for (const spec of TEXT_FILTERS) {
    const value = String(next.filters[spec.key] || "").trim();
    if (value) params.set(spec.urlKey, value);
  }
  if (next.filters.verifiedOnly) params.set("verifiedOnly", "true");
  if (next.filters.medCareOnly) params.set("medCare", "1");
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (url !== current) window.history.replaceState(null, "", url);
}

export default function RelatedProductsPage() {
  const [, similars] = useRoute("/similars/:value");
  const [, alternatives] = useRoute("/alternatives/:value");
  const [, company] = useRoute("/company-products/:value");
  const mode: Mode = similars ? "similars" : alternatives ? "alternatives" : "company";
  const value = decodeParam(similars?.value || alternatives?.value || company?.value);
  const { t } = useLanguage();
  const [items, setItems] = useState<MedicineListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const initial = readCollectionQuery();
  const [q, setQ] = useState(initial.q);
  const [sort, setSort] = useState<SortKey>(initial.sort);
  const [pricedOnly, setPricedOnly] = useState(initial.pricedOnly);
  const [filters, setFilters] = useState<EncyclopediaFilters>(() =>
    readEncyclopediaFiltersFromLocation(),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);

  const title = useMemo(() => {
    if (mode === "similars") return t(`Similars · ${value}`, `مثائل · ${value}`);
    if (mode === "alternatives") return t(`Alternatives · ${value}`, `بدائل · ${value}`);
    return t(`Company · ${value}`, `الشركة · ${value}`);
  }, [mode, t, value]);

  useEffect(() => {
    writeCollectionQuery({ q, sort, pricedOnly, filters });
  }, [q, sort, pricedOnly, filters]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!value) {
        setLoading(false);
        setError("Missing filter");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const baseFilters =
          mode === "similars"
            ? { scientificName: value }
            : mode === "alternatives"
              ? { drugClass: value }
              : { manufacturer: value };
        const keyOf = (row: MedicineListItem) => `${row.canonical_id}-${row.name_en || ""}`;
        let rows = await collectPages(
          (cursor) => fetchMedicinesPage({ limit: 100, cursorAfter: cursor, filters: baseFilters }),
          keyOf, () => cancelled,
        );
        if (cancelled) return;
        if (!rows.length) {
          const fallback = await collectPages(
            (cursor) => fetchMedicinesPage({ limit: 100, cursorAfter: cursor, filters: { query: value } }),
            keyOf, () => cancelled,
          );
          rows = fallback.filter((row) => {
            const needle = value.toLowerCase();
            if (mode === "similars") {
              return String(row.scientific_name || "").toLowerCase().includes(needle);
            }
            if (mode === "alternatives") {
              return String(row.drug_class || "").toLowerCase().includes(needle);
            }
            return String(row.manufacturer || "").toLowerCase().includes(needle);
          });
        }
        if (!cancelled) setItems(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load products");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, value]);

  const manufacturers = useMemo(() => uniqueValues(items, "manufacturer"), [items]);
  const forms = useMemo(() => uniqueValues(items, "dosage_form"), [items]);
  const routes = useMemo(() => uniqueValues(items, "route"), [items]);
  const classes = useMemo(() => uniqueValues(items, "drug_class"), [items]);
  const inns = useMemo(() => uniqueValues(items, "scientific_name"), [items]);

  const visible = useMemo(() => {
    let rows = applyClientFilters(items, filters);
    const needle = q.trim().toLowerCase();
    if (needle) {
      rows = rows.filter((row) =>
        [
          row.name_en,
          row.name_ar,
          row.scientific_name,
          row.manufacturer,
          row.dosage_form,
          row.strength,
          row.route,
          row.drug_class,
        ]
          .map((v) => String(v || "").toLowerCase())
          .some((v) => v.includes(needle)),
      );
    }
    if (pricedOnly) {
      rows = rows.filter((row) => Number.isFinite(priceOf(row)) && priceOf(row) < Infinity);
    }
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === "name") {
        return String(a.name_en || a.name_ar || "").localeCompare(
          String(b.name_en || b.name_ar || ""),
        );
      }
      if (sort === "price-asc" || sort === "price-desc") {
        return comparePrices(priceOf(a), priceOf(b), sort === "price-desc");
      }
      if (sort === "form") {
        return String(a.dosage_form || "").localeCompare(String(b.dosage_form || ""));
      }
      if (sort === "company") {
        return String(a.manufacturer || "").localeCompare(String(b.manufacturer || ""));
      }
      if (sort === "strength") {
        return String(a.strength || "").localeCompare(String(b.strength || ""));
      }
      return 0;
    });
    return copy;
  }, [items, filters, q, sort, pricedOnly]);

  const setFilter = (key: keyof EncyclopediaFilters, next: string) => {
    setFilters((prev) => ({ ...prev, [key]: next }));
  };

  return (
    <main className="page-shell container mx-auto max-w-6xl min-w-0 space-y-4 px-3 py-6 sm:px-4 sm:py-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="sm" asChild className="shrink-0">
          <Link href="/medicines">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold sm:text-xl break-words">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "similars"
              ? t(
                  "Products that share the same active ingredient (INN). Not a substitution instruction.",
                  "منتجات تشارك نفس المادة الفعالة. ليست تعليمة إحلال.",
                )
              : mode === "alternatives"
                ? t(
                    "Products in the same medication class. Confirm indication and dose with a licensed pharmacist.",
                    "منتجات في نفس التصنيف الدوائي. راجع الدواعي والجرعة مع صيدلي مرخص.",
                  )
                : t(
                    "Products listed under this company name in the encyclopedia.",
                    "منتجات مسجلة باسم هذه الشركة في الموسوعة.",
                  )}
          </p>
        </div>
      </div>

      <section className="sticky top-14 z-20 -mx-3 space-y-2 border-b bg-background/95 px-3 py-3 backdrop-blur sm:top-[4.25rem] sm:mx-0 sm:rounded-2xl sm:border sm:px-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t(
              "Filter by name, strength, company…",
              "صفِّ بالاسم أو التركيز أو الشركة…",
            )}
            className="min-h-11 min-w-0 flex-1"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-11 min-w-0 rounded-md border bg-background px-3 text-sm sm:w-52"
            aria-label={t("Sort", "ترتيب")}
          >
            <option value="relevance">{t("Sort: default", "الترتيب: الافتراضي")}</option>
            <option value="name">{t("Name A–Z", "الاسم")}</option>
            <option value="price-asc">{t("Price: low to high", "السعر: الأقل")}</option>
            <option value="price-desc">{t("Price: high to low", "السعر: الأعلى")}</option>
            <option value="form">{t("Dosage form", "الشكل الصيدلاني")}</option>
            <option value="strength">{t("Strength", "التركيز")}</option>
            <option value="company">{t("Company", "الشركة")}</option>
          </select>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {mode !== "company" ? (
            <select
              value={filters.manufacturer}
              onChange={(e) => setFilter("manufacturer", e.target.value)}
              className="h-11 min-w-0 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">{t("All companies", "كل الشركات")}</option>
              {manufacturers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          {mode !== "similars" ? (
            <select
              value={filters.scientificName}
              onChange={(e) => setFilter("scientificName", e.target.value)}
              className="h-11 min-w-0 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">{t("All INNs", "كل المواد الفعالة")}</option>
              {inns.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          {mode !== "alternatives" ? (
            <select
              value={filters.drugClass}
              onChange={(e) => setFilter("drugClass", e.target.value)}
              className="h-11 min-w-0 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">{t("All classes", "كل الفئات")}</option>
              {classes.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          <select
            value={filters.dosageForm}
            onChange={(e) => setFilter("dosageForm", e.target.value)}
            className="h-11 min-w-0 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{t("All forms", "كل الأشكال")}</option>
            {forms.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={filters.route}
            onChange={(e) => setFilter("route", e.target.value)}
            className="h-11 min-w-0 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{t("All routes", "كل طرق الإعطاء")}</option>
            {routes.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pricedOnly}
              onChange={(e) => setPricedOnly(e.target.checked)}
            />
            {t("Has listed price", "له سعر مسجل")}
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setQ("");
              setSort("relevance");
              setPricedOnly(false);
              setFilters(emptyEncyclopediaFilters);
            }}
          >
            {t("Reset", "إعادة")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {visible.length}/{items.length} {t("products", "منتج")}
          </span>
        </div>
        <EncyclopediaFilterBar
          filters={filters}
          onChange={setFilters}
          items={items}
          open={filtersOpen}
          onToggle={() => setFiltersOpen((open) => !open)}
        />
      </section>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("Loading…", "جاري التحميل…")}</p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((item) => (
          <ProductActionCard
            key={`${item.canonical_id}-${item.name_en}`}
            product={{
              name_en: item.name_en,
              name_ar: item.name_ar,
              scientific_name: item.scientific_name,
              manufacturer: item.manufacturer,
              drug_class: item.drug_class,
              current_price_egp: item.current_price_egp,
              canonical_id: item.canonical_id,
              id_source: item.id_source,
              barcode: item.barcode,
              product_type: item.product_type,
            }}
          />
        ))}
      </div>
      {!loading && !error && !visible.length ? (
        <p className="text-sm text-muted-foreground">
          {t("No products match these filters.", "لا توجد منتجات تطابق هذه الفلاتر.")}
        </p>
      ) : null}
    </main>
  );
}
