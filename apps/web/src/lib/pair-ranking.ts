/**
 * Rank observed co-prescription pairs.
 * Frequency is the default sort. Overlays and interest are optional modes.
 */

import {
  rankCombinationPairs,
  type CombinationPair,
  type CombinationReport,
  type CombinationSourceItem,
} from "./medicine-combinations";
import { overlayForPairKey, type PairOverlay } from "./pair-overlay";
import { blendScore, interestScore, loadInterest } from "./pair-interactions";

export type RankedPair = CombinationPair & {
  overlay: PairOverlay;
  rank: number;
  interest: number;
  blend: number;
};

export type RankedCombinationReport = CombinationReport & {
  ranked: RankedPair[];
};

export type PairSortMode = "frequency" | "alerts-first" | "interest";

export function rankObservedPairs(
  items: CombinationSourceItem[],
  limit = 40,
): RankedCombinationReport {
  const base = rankCombinationPairs(items, limit);
  const interest = typeof window === "undefined" ? {} : loadInterest();
  const ranked: RankedPair[] = base.pairs.map((p, i) => {
    const iScore = interestScore(interest[p.key] || { impressions: 0, clicks: 0, openBoth: 0 });
    return {
      ...p,
      rank: i + 1,
      overlay: overlayForPairKey(p.key),
      interest: iScore,
      blend: blendScore(p.count, iScore),
    };
  });
  return { ...base, ranked };
}

export function sortRanked(
  pairs: RankedPair[],
  mode: PairSortMode = "frequency",
): RankedPair[] {
  if (mode === "frequency") return [...pairs].sort((a, b) => a.rank - b.rank);
  if (mode === "interest") {
    return [...pairs].sort((a, b) => {
      if (b.blend !== a.blend) return b.blend - a.blend;
      return b.count - a.count;
    });
  }
  return [...pairs].sort((a, b) => {
    const ah = Number(a.overlay.oncHigh || a.overlay.ddinterLevel === "major");
    const bh = Number(b.overlay.oncHigh || b.overlay.ddinterLevel === "major");
    if (bh !== ah) return bh - ah;
    return b.count - a.count;
  });
}
