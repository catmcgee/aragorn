"use client";

// Ring selection, token storage, RingClient singleton, and the React context
// that authed pages consume via useRing().

import { createContext, useContext } from "react";
import { RingClient, type Me } from "@aragorn/sdk";

export const RINGS = {
  ubs: { label: "UBS Ring", url: "http://127.0.0.1:4001" },
  drw: { label: "DRW Ring", url: "http://127.0.0.1:4002" },
} as const;

export type RingKey = keyof typeof RINGS;

const RING_STORAGE_KEY = "aragorn-ring";
const DEV_TOKEN_KEY = "dev-token";
const biscuitKey = (ring: RingKey) => `aragorn-biscuit:${ring}`;

export function getRingKey(): RingKey | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(RING_STORAGE_KEY);
  return v === "ubs" || v === "drw" ? v : null;
}

export function setRingKey(ring: RingKey): void {
  localStorage.setItem(RING_STORAGE_KEY, ring);
}

export function getRingUrl(): string | null {
  const k = getRingKey();
  return k ? RINGS[k].url : null;
}

/** Dev bypass token wins; otherwise the per-ring biscuit from the last exchange. */
export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
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

export function storeDevToken(token: string): void {
  localStorage.setItem(DEV_TOKEN_KEY, token);
  makeClient().setToken(token);
}

export function clearAuth(): void {
  localStorage.removeItem(DEV_TOKEN_KEY);
  const k = getRingKey();
  if (k) localStorage.removeItem(biscuitKey(k));
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
  logout: () => void;
}

export const RingContext = createContext<RingContextValue | null>(null);

export function useRing(): RingContextValue {
  const ctx = useContext(RingContext);
  if (!ctx) throw new Error("useRing must be used inside the authed shell");
  return ctx;
}
