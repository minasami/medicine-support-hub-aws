/**
 * Anonymous session co-view. sessionStorage only — no user id.
 * Opening two agents in one tab session increments pair open_both.
 */

import { normalizeAgentName, pairKey } from "./medicine-combinations";
import { recordPairEvent } from "./pair-interactions";

const STORE = "msh:session-coview:v1";
const MAX = 8;
const PAIR_TTL_MS = 30 * 60 * 1000;
const seenPairs = new Set<string>();

type Visit = { key: string; label: string; at: number };

function read(): Visit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORE);
    const list: Visit[] = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - PAIR_TTL_MS;
    return list.filter((v) => v.at >= cutoff);
  } catch {
    return [];
  }
}

function write(list: Visit[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORE, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* ignore */
  }
}

/** Record this agent view and emit open_both vs prior agents in the session. */
export function noteSessionAgentView(agentRaw: string): void {
  const { key, label } = normalizeAgentName(agentRaw);
  if (!key) return;
  const now = Date.now();
  const prior = read();
  for (const prev of prior) {
    if (prev.key === key) continue;
    const pk = pairKey(prev.key, key);
    const gate = pk;
    if (seenPairs.has(gate)) continue;
    seenPairs.add(gate);
    recordPairEvent(pk, "openBoth");
  }
  const next = prior.filter((v) => v.key !== key);
  next.push({ key, label, at: now });
  write(next);
}
