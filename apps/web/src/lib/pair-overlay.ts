/**
 * Curated pair overlays — observation stays separate from alert badges.
 * ONC High Priority is a 2012 class-pair floor (not an API).
 * DDInter rows here are a Major-only sample, not the full CC BY-NC-SA dump.
 */

import { normalizeAgentName, pairKey } from "./medicine-combinations";

export type OverlayLevel = "high" | "major" | "moderate" | "minor" | null;

export type PairOverlay = {
  oncHigh: boolean;
  ddinterLevel: OverlayLevel;
  note?: string;
};

/** Class tokens used to expand ONC-style class × class rules. */
const CLASS_MEMBERS: Record<string, string[]> = {
  nsaid: ["ibuprofen", "diclofenac", "naproxen", "ketoprofen", "piroxicam", "indomethacin"],
  warfarin: ["warfarin"],
  ssri: ["fluoxetine", "sertraline", "paroxetine", "citalopram", "escitalopram"],
  maoi: ["phenelzine", "tranylcypromine", "moclobemide"],
  potassium: ["potassium", "potassium-chloride"],
  acei: ["enalapril", "lisinopril", "ramipril", "perindopril", "captopril"],
  arb: ["losartan", "valsartan", "candesartan", "irbesartan"],
  spironolactone: ["spironolactone", "eplerenone"],
};

const ONC_EXPLICIT = new Set([
  pairKey("warfarin", "ibuprofen"),
  pairKey("warfarin", "diclofenac"),
  pairKey("warfarin", "amiodarone"),
  pairKey("methotrexate", "trimethoprim"),
  pairKey("simvastatin", "clarithromycin"),
]);

const ONC_CLASS_PAIRS: Array<[string, string]> = [
  ["warfarin", "nsaid"],
  ["ssri", "maoi"],
  ["acei", "potassium"],
  ["arb", "potassium"],
  ["spironolactone", "potassium"],
];

const DDINTER_MAJOR = new Set([
  pairKey("warfarin", "ibuprofen"),
  pairKey("warfarin", "diclofenac"),
  pairKey("methotrexate", "trimethoprim"),
]);

const DDINTER_MODERATE = new Set([
  pairKey("paracetamol", "warfarin"),
  pairKey("amoxicillin-clavulanate", "methotrexate"),
]);

function classKeysFor(agentKey: string): string[] {
  const out = [agentKey];
  for (const [cls, members] of Object.entries(CLASS_MEMBERS)) {
    if (members.includes(agentKey)) out.push(cls);
  }
  return out;
}

export function overlayForPair(aRaw: string, bRaw: string): PairOverlay {
  const a = normalizeAgentName(aRaw).key;
  const b = normalizeAgentName(bRaw).key;
  const key = pairKey(a, b);

  let oncHigh = ONC_EXPLICIT.has(key);
  if (!oncHigh) {
    const left = classKeysFor(a);
    const right = classKeysFor(b);
    for (const [c1, c2] of ONC_CLASS_PAIRS) {
      const hit =
        (left.includes(c1) && right.includes(c2)) ||
        (left.includes(c2) && right.includes(c1));
      if (hit) {
        oncHigh = true;
        break;
      }
    }
  }

  let ddinterLevel: OverlayLevel = null;
  if (DDINTER_MAJOR.has(key)) ddinterLevel = "major";
  else if (DDINTER_MODERATE.has(key)) ddinterLevel = "moderate";

  return { oncHigh, ddinterLevel };
}

export function overlayForPairKey(key: string): PairOverlay {
  const [a, b] = key.split("||");
  return overlayForPair(a || "", b || "");
}
