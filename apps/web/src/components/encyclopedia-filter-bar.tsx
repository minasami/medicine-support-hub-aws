import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/lib/i18n";
import type { MedicineListItem } from "@/lib/medicines-appwrite-page";
import {
  countActiveFilters,
  emptyEncyclopediaFilters,
  FLAG_FILTERS,
  TEXT_FILTERS,
  type EncyclopediaFilters,
  type FilterableMedicine,
} from "@/lib/encyclopedia-filters";

export {
  countActiveFilters,
  emptyEncyclopediaFilters,
  type EncyclopediaFilters,
} from "@/lib/encyclopedia-filters";

function uniqueField(
  items: MedicineListItem[],
  key: keyof FilterableMedicine,
  limit = 40,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of items) {
    const raw = String((row as FilterableMedicine)[key] || "").trim();
    if (!raw) continue;
    const k = raw.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(raw);
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function EncyclopediaFilterBar({
  filters,
  onChange,
  items,
  open,
  onToggle,
}: {
  filters: EncyclopediaFilters;
  onChange: (next: EncyclopediaFilters) => void;
  items: MedicineListItem[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  const active = countActiveFilters(filters);
  const set = (patch: Partial<EncyclopediaFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
            open || active
              ? "border-teal-500/40 bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200"
              : "border-border bg-background text-muted-foreground"
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          {t("Filters", "تصفية")}
          {active ? <span className="rounded-full bg-teal-700 px-1.5 text-[10px] text-white">{active}</span> : null}
        </button>
        {TEXT_FILTERS.map((spec) => {
          const value = filters[spec.key];
          if (!value) return null;
          return (
            <Chip
              key={spec.key}
              label={`${t(spec.labelEn, spec.labelAr)}: ${value}`}
              onClear={() => set({ [spec.key]: "" })}
            />
          );
        })}
        {FLAG_FILTERS.map((spec) =>
          filters[spec.key] ? (
            <Chip
              key={spec.key}
              label={t(spec.labelEn, spec.labelAr)}
              onClear={() => set({ [spec.key]: false })}
            />
          ) : null,
        )}
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2 text-[11px]"
            onClick={() => onChange(emptyEncyclopediaFilters)}
          >
            {t("Clear filters", "مسح التصفية")}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="grid gap-2.5 rounded-2xl border bg-card/70 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEXT_FILTERS.map((spec) => (
            <FilterField
              key={spec.key}
              id={spec.inputId}
              label={t(spec.labelEn, spec.labelAr)}
              value={filters[spec.key]}
              onChange={(v) => set({ [spec.key]: v })}
              options={uniqueField(items, spec.suggestField)}
              placeholder={t(spec.placeholderEn, spec.placeholderAr)}
            />
          ))}
          <div className="flex flex-wrap items-end gap-2">
            {FLAG_FILTERS.map((spec) => (
              <label key={spec.key} className="inline-flex min-h-9 items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={filters[spec.key]}
                  onChange={(e) => set({ [spec.key]: e.target.checked })}
                />
                {t(spec.labelEn, spec.labelAr)}
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex max-w-[min(14rem,calc(100vw-4rem))] min-h-8 items-center gap-1 rounded-full border border-teal-500/30 bg-teal-50/80 px-2.5 py-1 text-[11px] text-teal-900 dark:bg-teal-950/50 dark:text-teal-100"
    >
      <span className="truncate">{label}</span>
      <X className="h-3 w-3 shrink-0" />
    </button>
  );
}

function FilterField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
      {label}
      <Input
        list={`${id}-list`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 rounded-xl text-start text-sm font-normal text-foreground"
      />
      <datalist id={`${id}-list`}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
    </label>
  );
}
