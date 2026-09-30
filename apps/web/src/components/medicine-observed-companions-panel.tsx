import { useEffect, useMemo, useState } from "react";
import { Query } from "appwrite";
import { databases } from "@/lib/appwrite";
import { DB } from "@/components/rx/rx-types";
import { ObservedCompanions } from "@/components/observed-companions";
import {
  seedObservationItems,
  type CombinationSourceItem,
} from "@/lib/medicine-combinations";
import { rankObservedPairs } from "@/lib/pair-ranking";
import { companionsForAgent } from "@/lib/pair-recommendations";
import { hydrateInterestFromAppwrite } from "@/lib/pair-interactions";
import { noteSessionAgentView } from "@/lib/session-coview";
import {
  fetchMedicineByCanonicalId,
  fetchMedicineByName,
} from "@/lib/medicines-appwrite-page";
import {
  isNameKeyedCatalogId,
  parseNameKeyedCatalogId,
} from "@/lib/catalog-links";

async function loadLiveItems(): Promise<CombinationSourceItem[]> {
  try {
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
      };
    });
  } catch {
    return [];
  }
}

export function MedicineObservedCompanionsPanel({
  catalogId,
}: {
  catalogId?: string;
}) {
  const [agent, setAgent] = useState("");
  const [items, setItems] = useState<CombinationSourceItem[]>([]);
  const [interestEpoch, setInterestEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await hydrateInterestFromAppwrite();
      if (!cancelled) setInterestEpoch((n) => n + 1);
      const live = await loadLiveItems();
      if (!cancelled) setItems(live.length ? live : seedObservationItems());
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!catalogId) return;
    let cancelled = false;
    const run = async () => {
      const nameKey = isNameKeyedCatalogId(catalogId)
        ? parseNameKeyedCatalogId(catalogId)
        : null;
      const byName = await fetchMedicineByName(nameKey || catalogId).catch(() => null);
      const numericId = Number(catalogId);
      const byCanonical =
        !byName &&
        Number.isFinite(numericId) &&
        String(numericId) === String(catalogId).trim()
          ? await fetchMedicineByCanonicalId(numericId).catch(() => null)
          : null;
      const byId = byName || byCanonical;
      const label =
        byId?.scientific_name ||
        byId?.name_en ||
        byId?.name_ar ||
        nameKey ||
        catalogId;
      if (!cancelled) setAgent(String(label || ""));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [catalogId]);

  useEffect(() => {
    if (agent) noteSessionAgentView(agent);
  }, [agent]);

  const companions = useMemo(() => {
    if (!agent) return [];
    const report = rankObservedPairs(items, 40);
    return companionsForAgent(agent, report.ranked, 8);
  }, [agent, items, interestEpoch]);

  if (!agent || !companions.length) return null;
  return (
    <div className="container mx-auto max-w-5xl px-3 pb-16">
      <ObservedCompanions agentLabel={agent} items={companions} />
      <p className="mt-2 text-xs text-muted-foreground">
        <a href="/combinations" className="text-emerald-800 hover:underline">
          All observed pairs
        </a>
      </p>
    </div>
  );
}
