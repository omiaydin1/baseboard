"use client";

/**
 * Dynamic community-event registry.
 *
 * The static seed list in `lib/event.ts` (the launch artwork, free) is merged
 * with events created through the "Create event" flow, which are stored in
 * Turso and fetched from `GET /api/events`. The merged list is cached at module
 * level so the canvas render loop can read it SYNCHRONOUSLY (it cannot await),
 * while React components subscribe via `useEvents()`.
 */

import { useEffect, useSyncExternalStore } from "react";
import { EVENT_REVEALS, eventPlotCount, type EventReveal } from "./event";

interface WireEvent {
  id: number;
  title: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  image: string;
  link: string;
  creator: string;
  txHash: string;
  createdAt: number;
  soldCount: number;
}

let _dbEvents: EventReveal[] = [];
let _all: EventReveal[] = EVENT_REVEALS;
let _loadPromise: Promise<void> | null = null;
const _listeners = new Set<() => void>();

function toReveal(w: WireEvent): EventReveal {
  return {
    id: String(w.id),
    title: w.title,
    x1: w.x1,
    y1: w.y1,
    x2: w.x2,
    y2: w.y2,
    imagePath: w.image,
    link: w.link || undefined,
    creator: w.creator || undefined,
    soldCount: w.soldCount ?? 0,
    ghostAlpha: 0.5,
    outlineColor: "#0052ff",
  };
}

function publish() {
  _all = [...EVENT_REVEALS, ..._dbEvents];
  _listeners.forEach((fn) => fn());
}

/** Subscribe to event-list changes (used by useEvents and the canvas). */
export function subscribeEvents(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** Synchronous snapshot of all events (seed + created). For render loops. */
export function getEvents(): EventReveal[] {
  return _all;
}

/** Find the event whose region contains cell (x, y), or null. */
export function getEventForCell(x: number, y: number): EventReveal | null {
  for (const c of _all) {
    if (x >= c.x1 && x <= c.x2 && y >= c.y1 && y <= c.y2) return c;
  }
  return null;
}

/** Number of plots inside an event region. */
export { eventPlotCount };

/**
 * Fetch the created events from the API and refresh the module cache.
 * Deduplicated: concurrent callers share one in-flight request; pass
 * `force = true` after creating an event or editing a link to re-fetch.
 */
export async function loadEvents(force = false): Promise<void> {
  if (force) _loadPromise = null;
  if (!_loadPromise) {
    _loadPromise = (async () => {
      try {
        const res = await fetch("/api/events", { cache: "no-store" });
        if (!res.ok) throw new Error(`Events API ${res.status}`);
        // GET /api/events responds `{ events: [...] }`.
        const data = (await res.json()) as { events: WireEvent[] };
        _dbEvents = (data.events ?? []).map(toReveal);
      } catch (err) {
        console.error("loadEvents: failed to load created events", err);
        // Allow a later call (e.g. after the profile opens) to retry.
        _loadPromise = null;
      }
      publish();
    })();
  }
  return _loadPromise;
}

/**
 * React subscription to the event list. Mounting this also kicks off the
 * initial fetch. The returned array is referentially stable until the list
 * actually changes, so it is safe in dependency arrays.
 */
export function useEvents(): EventReveal[] {
  const events = useSyncExternalStore(subscribeEvents, getEvents, getEvents);
  useEffect(() => {
    void loadEvents();
  }, []);
  return events;
}
