/**
 * Companion recommendations from observed co-prescription — not therapeutic alternatives.
 */

import { normalizeAgentName, pairKey } from "./medicine-combinations";
import { overlayForPairKey } from "./pair-overlay";
import type { RankedPair } from "./pair-ranking";

export type CompanionRec = {
  agentKey: string;
  agentLabel: string;
  pairKey: string;
  count: number;
  share: number;
  blend: number;
  overlay: ReturnType<typeof overlayForPairKey>;
  reason: "observed-together";
};

export function companionsForAgent(
  agentRaw: string,
  ranked: RankedPair[],
  limit = 8,
): CompanionRec[] {
  const self = normalizeAgentName(agentRaw).key;
  if (!self) return [];
  const hits: CompanionRec[] = [];
  for (const p of ranked) {
    const [a, b] = p.key.split("||");
    if (a !== self && b !== self) continue;
    const other = a === self ? b : a;
    const otherLabel = a === self ? p.b : p.a;
    hits.push({
      agentKey: other,
      agentLabel: otherLabel,
      pairKey: pairKey(self, other),
      count: p.count,
      share: p.share,
      blend: p.blend ?? p.count,
      overlay: p.overlay,
      reason: "observed-together",
    });
  }
  return hits.sort((x, y) => y.blend - x.blend || y.count - x.count).slice(0, limit);
}
