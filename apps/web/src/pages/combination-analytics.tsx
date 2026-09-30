import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import { databases } from "@/lib/appwrite";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { seedObservationItems, type CombinationSourceItem } from "@/lib/medicine-combinations";
import { rankObservedPairs, sortRanked, type PairSortMode } from "@/lib/pair-ranking";
import { companionsForAgent } from "@/lib/pair-recommendations";
import { hydrateInterestFromAppwrite, interestFor, recordPairEvent } from "@/lib/pair-interactions";
import { ObservedCompanions } from "@/components/observed-companions";
import { DB } from "@/components/rx/rx-types";
import { Link } from "wouter";

type Source = "live" | "seed" | "empty";

async function loadLiveItems(): Promise<CombinationSourceItem[]> {
  const list = await databases.listDocuments(DB, "prescription_items", [
    Query.limit(200),
    Query.orderDesc("$createdAt"),
  ]);
  return (list.documents || []).map((d) => {
    const row = d as Record<string, unknown>;
    return {
      prescriptionId: String(row.prescription_id || row.$id || ""),
      drugName: String(row.drug_name || ""),
      scientificName: (row.scientific_name as string) || null,
      dose: (row.suggested_dose as string) || null,
    };
  });
}

export default function CombinationAnalyticsPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<CombinationSourceItem[]>([]);
  const [source, setSource] = useState<Source>("empty");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<PairSortMode>("frequency");
  const [focus, setFocus] = useState("");
  const [interestEpoch, setInterestEpoch] = useState(0);

  const load = async (preferLive: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await hydrateInterestFromAppwrite();
      setInterestEpoch((n) => n + 1);
      if (preferLive) {
        const live = await loadLiveItems();
        if (live.length) {
          setItems(live);
          setSource("live");
          return;
        }
      }
      setItems(seedObservationItems());
      setSource("seed");
    } catch (e) {
      setItems(seedObservationItems());
      setSource("seed");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(true);
  }, []);

  const report = useMemo(() => rankObservedPairs(items, 30), [items, interestEpoch]);
  const rows = useMemo(() => sortRanked(report.ranked, sortMode), [report.ranked, sortMode]);
  const companions = useMemo(
    () => (focus ? companionsForAgent(focus, report.ranked, 8) : []),
    [focus, report.ranked],
  );

  return (
    <div className="container mx-auto max-w-5xl px-3 py-6 pb-24">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {t("Co-prescribed regimens", "الأنظمة المشتركة")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t(
              "Observed pairs from multi-item prescriptions. Counts are aggregated — no patient identifiers. Interest is views/clicks, not clinical rank.",
              "أزواج ملاحظة من الروشتات متعددة الأصناف. الأعداد مجمّعة — بلا معرفات مرضى. الاهتمام عروض/نقرات وليس ترتيبًا سريريًا.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={source === "live" ? "default" : "secondary"}>
            {source === "live" ? t("Live items", "بيانات حية") : t("Seed preview", "معاينة تجريبية")}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => void load(true)} disabled={loading}>
            {t("Refresh", "تحديث")}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mb-3 text-xs text-amber-800">
          {t("Live collection unavailable — showing seed pairs.", "المجموعة الحية غير متاحة — عرض أزواج تجريبية.")} {error}
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          [t("Regimens", "الروشتات"), report.regimens],
          [t("Multi-drug", "متعددة"), report.multiDrugRegimens],
          [t("Unique agents", "مواد فريدة"), report.uniqueAgents],
          [t("Ranked pairs", "أزواج مرتبة"), report.ranked.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border bg-card p-3">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant={sortMode === "frequency" ? "default" : "outline"} onClick={() => setSortMode("frequency")}>
          {t("Rank by frequency", "ترتيب حسب التكرار")}
        </Button>
        <Button size="sm" variant={sortMode === "interest" ? "default" : "outline"} onClick={() => setSortMode("interest")}>
          {t("Interest", "الاهتمام")}
        </Button>
        <Button size="sm" variant={sortMode === "alerts-first" ? "default" : "outline"} onClick={() => setSortMode("alerts-first")}>
          {t("Alerts first", "التنبيهات أولًا")}
        </Button>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold">{t("Most common pairs", "الأزواج الأكثر شيوعًا")}</h2>
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-emerald-800 text-white">
              <tr>
                <th className="p-2 text-left">#</th>
                <th className="p-2 text-left">{t("Pair", "الزوج")}</th>
                <th className="p-2 text-right">{t("Regimens", "روشتات")}</th>
                <th className="p-2 text-right">{t("Share", "النسبة")}</th>
                <th className="p-2 text-right">{t("Interest", "اهتمام")}</th>
                <th className="p-2 text-left">{t("Overlay", "طبقة")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const i = interestFor(p.key);
                return (
                <tr key={p.key} className="border-t">
                  <td className="p-2 tabular-nums text-muted-foreground">{p.rank}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="font-medium text-emerald-800 hover:underline"
                      onClick={() => {
                        recordPairEvent(p.key, "click");
                        setFocus(p.a);
                      }}
                    >
                      {p.a}
                    </button>
                    <span className="mx-1.5 text-muted-foreground">+</span>
                    <button
                      type="button"
                      className="font-medium text-emerald-800 hover:underline"
                      onClick={() => {
                        recordPairEvent(p.key, "click");
                        setFocus(p.b);
                      }}
                    >
                      {p.b}
                    </button>
                  </td>
                  <td className="p-2 text-right tabular-nums">{p.count}</td>
                  <td className="p-2 text-right tabular-nums">{Math.round(p.share * 100)}%</td>
                  <td className="p-2 text-right tabular-nums text-muted-foreground">
                    {i.clicks}·{i.openBoth}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {p.overlay.oncHigh ? <Badge variant="destructive">{t("ONC high", "تنبيه ONC")}</Badge> : null}
                      {p.overlay.ddinterLevel ? (
                        <Badge variant={p.overlay.ddinterLevel === "major" ? "destructive" : "secondary"}>
                          DDInter {p.overlay.ddinterLevel}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ); })}
              {!rows.length ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted-foreground">
                    {t("No multi-drug regimens yet.", "لا توجد روشتات متعددة بعد.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("Interest column = clicks · session co-views. Not used unless you pick Interest sort.", "عمود الاهتمام = نقرات · مشاهدة جلسة. لا يغيّر الترتيب إلا عند اختيار Interest.")}
        </p>
      </section>

      {focus ? <ObservedCompanions agentLabel={focus} items={companions} /> : null}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">{t("Agents appearing most often", "المواد الأكثر ظهورًا")}</h2>
        <div className="flex flex-wrap gap-1.5">
          {report.topAgents.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setFocus(a.label)}
              className="rounded-full border bg-card px-3 py-1 text-xs hover:border-emerald-500/40"
            >
              {a.label}
              <span className="ms-1.5 tabular-nums text-muted-foreground">{a.count}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          <Link href="/medicines" className="text-emerald-800 hover:underline">
            {t("Back to encyclopedia", "العودة للموسوعة")}
          </Link>
        </p>
      </section>
    </div>
  );
}
