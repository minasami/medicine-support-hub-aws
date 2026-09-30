/**
 * Aggregate pair interest — no user id, no prescription id.
 * Local cache + Appwrite collection `pair_interest`.
 */

import { Query } from "appwrite";
import { databases, functions } from "@/lib/appwrite";
import { DB } from "@/components/rx/rx-types";

const KEY = "msh:pair-interest:v1";
const SESSION_WRITES = "msh:pair-interest-writes:v1";
const COLLECTION = "pair_interest";
const lastSent = new Map<string, number>();
const MAX_REMOTE_WRITES_PER_SESSION = 40;

export type PairInterest = {
  impressions: number;
  clicks: number;
  openBoth: number;
};

export type InterestStore = Record<string, PairInterest>;

function empty(): PairInterest {
  return { impressions: 0, clicks: 0, openBoth: 0 };
}

function sessionWrites(): number {
  if (typeof window === "undefined") return MAX_REMOTE_WRITES_PER_SESSION;
  try {
    return Number(sessionStorage.getItem(SESSION_WRITES) || 0);
  } catch {
    return MAX_REMOTE_WRITES_PER_SESSION;
  }
}

function bumpSessionWrites(): boolean {
  if (typeof window === "undefined") return false;
  const n = sessionWrites();
  if (n >= MAX_REMOTE_WRITES_PER_SESSION) return false;
  try {
    sessionStorage.setItem(SESSION_WRITES, String(n + 1));
  } catch {
    return false;
  }
  return true;
}

export function loadInterest(): InterestStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as InterestStore) : {};
  } catch {
    return {};
  }
}

function save(store: InterestStore): void {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(store);
    const trimmed =
      keys.length > 400
        ? Object.fromEntries(
            keys
              .map((k) => [k, store[k]] as const)
              .sort((a, b) => interestScore(b[1]) - interestScore(a[1]))
              .slice(0, 400),
          )
        : store;
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* quota */
  }
}

export function interestScore(row: PairInterest): number {
  return row.clicks + 1.5 * row.openBoth;
}

export function blendScore(rxCount: number, interest: number): number {
  return 0.7 * Math.log(1 + Math.max(0, rxCount)) + 0.3 * Math.log(1 + Math.max(0, interest));
}

function bumpLocal(pairKey: string, kind: "impression" | "click" | "openBoth"): PairInterest {
  const store = loadInterest();
  const row = store[pairKey] || empty();
  if (kind === "impression") row.impressions += 1;
  if (kind === "click") row.clicks += 1;
  if (kind === "openBoth") row.openBoth += 1;
  store[pairKey] = row;
  save(store);
  return row;
}

async function persistRemote(
  pairKey: string,
  kind: "impression" | "click" | "openBoth",
): Promise<void> {
  const gate = `${pairKey}:${kind}`;
  const now = Date.now();
  if ((lastSent.get(gate) || 0) > now - 2500 && kind === "impression") return;
  lastSent.set(gate, now);
  if (!bumpSessionWrites()) return;

  try {
    await functions.createExecution("record-pair-interest", JSON.stringify({ pairKey, kind }), false);
  } catch {
    /* stay local */
  }
}

export function recordPairEvent(
  pairKey: string,
  kind: "impression" | "click" | "openBoth",
): void {
  if (!pairKey) return;
  bumpLocal(pairKey, kind);
  void persistRemote(pairKey, kind);
}

export async function hydrateInterestFromAppwrite(): Promise<InterestStore> {
  const local = loadInterest();
  try {
    const list = await databases.listDocuments(DB, COLLECTION, [Query.limit(200)]);
    for (const raw of list.documents) {
      const row = raw as Record<string, unknown>;
      const key = String(row.pair_key || "");
      if (!key) continue;
      const remote: PairInterest = {
        impressions: Number(row.impressions || 0),
        clicks: Number(row.clicks || 0),
        openBoth: Number(row.open_both || 0),
      };
      const cur = local[key] || empty();
      local[key] = {
        impressions: Math.max(cur.impressions, remote.impressions),
        clicks: Math.max(cur.clicks, remote.clicks),
        openBoth: Math.max(cur.openBoth, remote.openBoth),
      };
    }
    save(local);
  } catch {
    /* keep local */
  }
  return local;
}

export function interestFor(pairKey: string): PairInterest {
  return loadInterest()[pairKey] || empty();
}
