"use client";

// Ring selection, token storage, RingClient singleton, and the React context
// that authed pages consume via useRing().

import { createContext, useContext } from "react";
import { RingClient, type Me } from "@aragorn/sdk";

// Ring node endpoints. Default to the local demo stack; a hosted deploy points these at
// public Ring URLs via NEXT_PUBLIC_* (a localhost backend is unreachable from an https site).
export const RINGS = {
  ubs: {
    label: "JP Morgan",
    url: process.env.NEXT_PUBLIC_JPM_RING_URL ?? "http://127.0.0.1:4001",
  },
  drw: {
    label: "Goldman Sachs",
    url: process.env.NEXT_PUBLIC_GS_RING_URL ?? "http://127.0.0.1:4002",
  },
} as const;

export type RingKey = keyof typeof RINGS;

const RING_STORAGE_KEY = "aragorn-ring";
const DEV_TOKEN_KEY = "dev-token";
const CUSTOM_RING_KEY = "aragorn-custom-ring";
const biscuitKey = (ring: RingKey) => `aragorn-biscuit:${ring}`;

/** A freshly provisioned Ring that isn't in the static RINGS map — stored locally so the
 *  rest of the app (client singleton, token lookup) can treat it like any other ring. */
export interface CustomRing {
  url: string;
  token: string;
  label: string;
  ens: string;
}

export function getCustomRing(): CustomRing | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(CUSTOM_RING_KEY);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as CustomRing;
    return r.url && r.token ? r : null;
  } catch {
    return null;
  }
}

/** True when the active ring is the locally-provisioned custom one. */
export function isCustomActive(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(RING_STORAGE_KEY) === "custom" && !!getCustomRing();
}

export function getRingKey(): RingKey | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(RING_STORAGE_KEY);
  return v === "ubs" || v === "drw" ? v : null;
}

export function setRingKey(ring: RingKey): void {
  localStorage.setItem(RING_STORAGE_KEY, ring);
}

/** The ring this identity is currently acting as — a static key or a custom URL. */
export function getActiveRing(): { url: string; key: string } | null {
  const custom = isCustomActive() ? getCustomRing() : null;
  if (custom) return { url: custom.url, key: "custom" };
  const k = getRingKey();
  return k ? { url: RINGS[k].url, key: k } : null;
}

export function getRingUrl(): string | null {
  return getActiveRing()?.url ?? null;
}

/** Dev bypass token wins; otherwise the custom ring's token, otherwise the per-ring
 *  biscuit from the last exchange. */
export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  if (isCustomActive()) return getCustomRing()!.token;
  const dev = localStorage.getItem(DEV_TOKEN_KEY);
  if (dev) return dev;
  const k = getRingKey();
  return k ? localStorage.getItem(biscuitKey(k)) : null;
}

export function storeBiscuit(biscuit: string): void {
  const k = getRingKey();
  if (k) localStorage.setItem(biscuitKey(k), biscuit);
  makeClient().setToken(biscuit);
}

/** Store a ring's session biscuit by key (used when probing multiple rings at login). */
export function storeBiscuitFor(ring: RingKey, biscuit: string): void {
  localStorage.setItem(biscuitKey(ring), biscuit);
}

/** Commit to a ring: make it active and force the client singleton to rebuild for it. */
export function enterRing(ring: RingKey | "custom"): void {
  localStorage.setItem(RING_STORAGE_KEY, ring);
  singleton = null;
  singletonUrl = null;
}

/** Commit to a freshly provisioned Ring: persist it, make it active, and use its API
 *  token (clear any stale dev token so the custom token wins). */
export function enterCustomRing(ring: CustomRing): void {
  localStorage.setItem(CUSTOM_RING_KEY, JSON.stringify(ring));
  localStorage.removeItem(DEV_TOKEN_KEY);
  enterRing("custom");
}

/** A ring this identity can actually access (resolved at login by probing the nodes). */
export interface AccessibleRing {
  key: RingKey;
  url: string;
  org: string;
  ens: string | null;
  role: string;
}

/** Probe every known ring node with a Privy token; return the ones that admit this
 *  identity (domain-allowed + invited), storing each one's session biscuit. */
export async function probePrivy(privyToken: string): Promise<AccessibleRing[]> {
  const out: AccessibleRing[] = [];
  for (const key of Object.keys(RINGS) as RingKey[]) {
    const url = RINGS[key].url;
    try {
      const client = new RingClient(url);
      const { biscuit } = await client.exchange(privyToken);
      storeBiscuitFor(key, biscuit);
      client.setToken(biscuit);
      const me = await client.me();
      out.push({ key, url, org: me.org, ens: me.ens, role: me.user.role });
    } catch {
      // not a member of this ring — skip
    }
  }
  return out;
}

/** Probe every node with a service/dev token; return the one(s) it authenticates against. */
export async function probeDevToken(token: string): Promise<AccessibleRing[]> {
  const out: AccessibleRing[] = [];
  for (const key of Object.keys(RINGS) as RingKey[]) {
    const url = RINGS[key].url;
    try {
      const client = new RingClient(url, token);
      const me = await client.me();
      out.push({ key, url, org: me.org, ens: me.ens, role: me.user.role });
    } catch {
      // token not valid on this node
    }
  }
  return out;
}

export function storeDevToken(token: string): void {
  localStorage.setItem(DEV_TOKEN_KEY, token);
  makeClient().setToken(token);
}

export function clearAuth(): void {
  localStorage.removeItem(DEV_TOKEN_KEY);
  const k = getRingKey();
  if (k) localStorage.removeItem(biscuitKey(k));
  // A provisioned custom ring carries its own token — drop it too so logout fully resets.
  if (isCustomActive()) {
    localStorage.removeItem(CUSTOM_RING_KEY);
    localStorage.removeItem(RING_STORAGE_KEY);
  }
  singleton = null;
  singletonUrl = null;
}

let singleton: RingClient | null = null;
let singletonUrl: string | null = null;

/** Configured RingClient singleton for the currently selected ring. */
export function makeClient(): RingClient {
  const url = getRingUrl() ?? RINGS.ubs.url;
  if (!singleton || singletonUrl !== url) {
    singleton = new RingClient(url, getStoredToken() ?? undefined);
    singletonUrl = url;
  }
  return singleton;
}

export interface RingContextValue {
  client: RingClient;
  me: Me;
  ringUrl: string;
  /** Bumped on note_created / note_consumed / approval_* SSE events — refetch on change. */
  tick: number;
  /** Re-fetch /me (e.g. after toggling modules in Settings → Features). */
  refreshMe: () => Promise<void>;
  logout: () => void;
  /** Open the public-view panel — called from the ⊙ Public pill beside a transaction. */
  openPublic: (txid?: string) => void;
}

export const RingContext = createContext<RingContextValue | null>(null);

export function useRing(): RingContextValue {
  const ctx = useContext(RingContext);
  if (!ctx) throw new Error("useRing must be used inside the authed shell");
  return ctx;
}
