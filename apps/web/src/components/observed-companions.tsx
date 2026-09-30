import { useEffect } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import type { CompanionRec } from "@/lib/pair-recommendations";
import { recordPairEvent } from "@/lib/pair-interactions";
import { useLanguage } from "@/lib/i18n";

export function ObservedCompanions({
  agentLabel,
  items,
}: {
  agentLabel: string;
  items: CompanionRec[];
}) {
  const { t } = useLanguage();

  useEffect(() => {
    for (const c of items) recordPairEvent(c.pairKey, "impression");
  }, [items]);

  if (!items.length) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-1 text-sm font-semibold">
        {t("Often seen with", "غالباً ما يظهر مع")} {agentLabel}
      </h2>
      <p className="mb-2 text-xs text-muted-foreground">
        {t(
          "Observed co-prescription only — not a safety or substitution recommendation.",
          "ملاحظة وصف مشترك فقط — ليست توصية أمان أو بديل.",
        )}
      </p>
      <ul className="space-y-1.5">
        {items.map((c) => (
          <li
            key={c.pairKey}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-sm"
          >
            <Link
              href={`/medicines?q=${encodeURIComponent(c.agentLabel)}`}
              className="font-medium text-emerald-800 hover:underline"
              onClick={() => recordPairEvent(c.pairKey, "click")}
            >
              {c.agentLabel}
            </Link>
            <div className="flex items-center gap-1.5">
              <span className="tabular-nums text-muted-foreground">
                {c.count} · {Math.round(c.share * 100)}%
              </span>
              {c.overlay.oncHigh ? (
                <Badge variant="destructive">{t("ONC high", "تنبيه ONC")}</Badge>
              ) : null}
              {c.overlay.ddinterLevel === "major" ? (
                <Badge variant="destructive">DDInter Major</Badge>
              ) : c.overlay.ddinterLevel === "moderate" ? (
                <Badge variant="secondary">DDInter Moderate</Badge>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
