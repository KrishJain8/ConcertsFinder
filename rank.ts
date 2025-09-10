// src/rank.ts
import type { EventItem } from "./ticketmaster";

export type RankCtx = {
  userLat?: number;
  userLon?: number;
  likedArtistNames: Set<string>;       // Liked Songs (Saved Tracks) — strongest
  topArtistNames: Set<string>;
  followedArtistNames: Set<string>;
  preferredArtistNames?: Set<string>;  // everything we actually queried
  profile?: "artist-heavy" | "balanced";
};

const toLc = (s?: string) => (s || "").toLowerCase();

/** Haversine distance (miles) */
function distMiles(aLat?: number, aLon?: number, bLat?: number, bLon?: number) {
  if (
    aLat == null || aLon == null || bLat == null || bLon == null ||
    Number.isNaN(aLat) || Number.isNaN(aLon) || Number.isNaN(bLat) || Number.isNaN(bLon)
  ) return Number.POSITIVE_INFINITY;

  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const aa =
    s1 * s1 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

/** Days until event */
function daysUntil(iso?: string | null) {
  if (!iso) return 9999;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 9999;
  const now = Date.now();
  return Math.max(0, Math.round((t - now) / (1000 * 60 * 60 * 24)));
}

export function rank(events: EventItem[], ctx: RankCtx) {
  // Strongest emphasis on Liked Songs (Saved Tracks) artists
  const ART_LIKED   = 140;
  const ART_TOP     = 95;
  const ART_FOLLOW  = 75;
  const ART_PREF    = 40;  // anything else we queried
  const ART_OTHER   = 0;   // neutral

  // Location = gentle nudge (SoCal-wide OK)
  function locScore(e: EventItem) {
    const d = distMiles(ctx.userLat, ctx.userLon, e.lat, e.lon);
    if (!Number.isFinite(d)) return 0;
    if (d <= 15) return 6;
    if (d <= 50) return 5;
    if (d <= 120) return 4;
    if (d <= 200) return 3;
    if (d <= 400) return 1;
    return 0;
    }

  // Date = tiny tie-breaker
  function dateScore(e: EventItem) {
    const d = daysUntil(e.start_utc);
    if (d <= 14) return 2;
    if (d <= 45) return 1;
    if (d <= 180) return 1;
    return 0;
  }

  const preferred = ctx.preferredArtistNames ?? new Set<string>();

  function artistScore(e: EventItem) {
    const nameLc = toLc(e.artist_name) || toLc(e.event_name);
    if (ctx.likedArtistNames.has(nameLc))   return ART_LIKED;
    if (ctx.topArtistNames.has(nameLc))     return ART_TOP;
    if (ctx.followedArtistNames.has(nameLc))return ART_FOLLOW;
    if (preferred.has(nameLc))              return ART_PREF;
    return ART_OTHER;
  }

  const scored = events.map((e) => {
    const score = artistScore(e) + locScore(e) + dateScore(e);
    return { ...e, _score: score };
  });

  scored.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;

    // earlier date tie-breaker
    const ad = Date.parse(a.start_utc || "");
    const bd = Date.parse(b.start_utc || "");
    if (!Number.isNaN(ad) && !Number.isNaN(bd) && ad !== bd) return ad - bd;

    // then closer
    const da = distMiles(ctx.userLat, ctx.userLon, a.lat, a.lon);
    const db = distMiles(ctx.userLat, ctx.userLon, b.lat, b.lon);
    if (da !== db) return da - db;

    return (a.event_name || "").localeCompare(b.event_name || "");
  });

  return scored;
}
