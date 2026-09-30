/**
 * Observe co-prescribed regimens from prescription line items.
 * Aggregates only — never stores patient identifiers in pair rows.
 */

export type CombinationSourceItem = {
  prescriptionId: string;
  drugName: string;
  scientificName?: string | null;
  dose?: string | null;
};

export type NormalizedAgent = {
  key: string;
  label: string;
  raw: string;
};

export type CombinationPair = {
  a: string;
  b: string;
  key: string;
  count: number;
  share: number;
  prescriptions: number;
};

export type CombinationRegimen = {
  prescriptionId: string;
  agents: NormalizedAgent[];
  pairKeys: string[];
};

export type CombinationReport = {
  regimens: number;
  multiDrugRegimens: number;
  uniqueAgents: number;
  pairs: CombinationPair[];
  topAgents: { key: string; label: string; count: number }[];
};

const STOP = new Set([
  "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "amp",
  "syrup", "susp", "mg", "ml", "iu", "mcg", "g", "sr", "xr", "er",
  "film", "coated", "plus",
]);

const ALIAS: Record<string, string> = {
  panadol: "paracetamol",
  acetaminophen: "paracetamol",
  cataflam: "diclofenac",
  voltaren: "diclofenac",
  brufen: "ibuprofen",
  augmention: "amoxicillin-clavulanate",
  augmentin: "amoxicillin-clavulanate",
  amoxil: "amoxicillin",
  flagyl: "metronidazole",
  glucophage: "metformin",
  concor: "bisoprolol",
  norvasc: "amlodipine",
  lipitor: "atorvastatin",
  coveram: "perindopril-amlodipine",
  cozaar: "losartan",
};

export function normalizeAgentName(raw: string): NormalizedAgent {
  const original = (raw || "").trim();
  let s = original
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s
    .split(" ")
    .filter((t) => t && !STOP.has(t) && !/^\d+([.,]\d+)?$/.test(t))
    .join(" ");
  const first = s.split(/[+/]| and /)[0]?.trim() || s;
  const aliased = ALIAS[first] || ALIAS[s] || first || original.toLowerCase();
  const key = aliased.replace(/\s+/g, "-");
  const label = aliased.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { key, label, raw: original };
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

export function uniqueAgents(names: string[]): NormalizedAgent[] {
  const seen = new Set<string>();
  const out: NormalizedAgent[] = [];
  for (const name of names) {
    const n = normalizeAgentName(name);
    if (!n.key || seen.has(n.key)) continue;
    seen.add(n.key);
    out.push(n);
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

export function pairsFromAgents(agents: NormalizedAgent[]): string[] {
  const keys: string[] = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      keys.push(pairKey(agents[i].key, agents[j].key));
    }
  }
  return keys;
}

export function regimensFromItems(items: CombinationSourceItem[]): CombinationRegimen[] {
  const byRx = new Map<string, string[]>();
  for (const row of items) {
    const id = row.prescriptionId || "";
    if (!id) continue;
    const name = (row.scientificName || row.drugName || "").trim();
    if (!name) continue;
    const list = byRx.get(id) || [];
    list.push(name);
    byRx.set(id, list);
  }
  const regimens: CombinationRegimen[] = [];
  for (const [prescriptionId, names] of byRx) {
    const agents = uniqueAgents(names);
    regimens.push({
      prescriptionId,
      agents,
      pairKeys: pairsFromAgents(agents),
    });
  }
  return regimens;
}

export function rankCombinationPairs(items: CombinationSourceItem[], limit = 40): CombinationReport {
  const regimens = regimensFromItems(items);
  const pairCount = new Map<string, { a: string; b: string; count: number }>();
  const agentCount = new Map<string, { label: string; count: number }>();
  let multi = 0;

  for (const r of regimens) {
    if (r.agents.length >= 2) multi += 1;
    for (const ag of r.agents) {
      const prev = agentCount.get(ag.key);
      if (prev) prev.count += 1;
      else agentCount.set(ag.key, { label: ag.label, count: 1 });
    }
    const seen = new Set<string>();
    for (const pk of r.pairKeys) {
      if (seen.has(pk)) continue;
      seen.add(pk);
      const [a, b] = pk.split("||");
      const prev = pairCount.get(pk);
      if (prev) prev.count += 1;
      else pairCount.set(pk, { a, b, count: 1 });
    }
  }

  const denom = Math.max(1, multi);
  const pairs: CombinationPair[] = [...pairCount.values()]
    .map((p) => ({
      a: p.a.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      b: p.b.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      key: pairKey(p.a, p.b),
      count: p.count,
      share: p.count / denom,
      prescriptions: p.count,
    }))
    .sort((x, y) => y.count - x.count || x.key.localeCompare(y.key))
    .slice(0, limit);

  const topAgents = [...agentCount.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    regimens: regimens.length,
    multiDrugRegimens: multi,
    uniqueAgents: agentCount.size,
    pairs,
    topAgents,
  };
}

/** Demo / empty-state seed so the analytics view is usable before live volume. */
export function seedObservationItems(): CombinationSourceItem[] {
  const rows: Array<[string, string[]]> = [
    ["demo-1", ["Concor 5", "Norvasc 5", "Lipitor 20"]],
    ["demo-2", ["Glucophage 1000", "Concor 5"]],
    ["demo-3", ["Augmentin 1g", "Flagyl 500"]],
    ["demo-4", ["Concor 2.5", "Norvasc 10"]],
    ["demo-5", ["Paracetamol 500", "Brufen 400"]],
    ["demo-6", ["Glucophage 500", "Lipitor 10", "Concor 5"]],
    ["demo-7", ["Augmentin", "Paracetamol"]],
    ["demo-8", ["Amlodipine", "Bisoprolol"]],
    ["demo-9", ["Metformin", "Atorvastatin"]],
    ["demo-10", ["Amoxicillin clavulanate", "Metronidazole"]],
  ];
  const items: CombinationSourceItem[] = [];
  for (const [id, names] of rows) {
    for (const n of names) items.push({ prescriptionId: id, drugName: n });
  }
  return items;
}
