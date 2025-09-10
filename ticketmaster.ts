import fetch from "node-fetch";

const TM_BASE = "https://app.ticketmaster.com/discovery/v2";

function tmKey() {
  const k = process.env.TICKETMASTER_API_KEY;
  if (!k) throw new Error("Missing TICKETMASTER_API_KEY");
  return k;
}

function isoToTm(iso: string) {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function norm(s?: string) {
  return (s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019’]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function tmGet(
  path: string,
  params: Record<string, string | number | boolean | undefined>
) {
  const url = new URL(`${TM_BASE}${path}`);
  url.searchParams.set("apikey", tmKey());
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  const text = await res.text();
  if (!res.ok) throw new Error(`Ticketmaster ${path} failed: ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return {}; }
}

/* ---------------- Types ---------------- */
type TMAttraction = { id: string; name: string };
type TMVenue = {
  name?: string;
  city?: { name?: string };
  state?: { name?: string };
  country?: { name?: string };
  location?: { latitude?: string; longitude?: string };
};
type TMEvent = {
  id: string;
  name: string;
  url: string;
  dates?: { start?: { dateTime?: string } };
  _embedded?: { attractions?: TMAttraction[]; venues?: TMVenue[] };
};

export type EventItem = {
  source: "tm";
  source_id: string;
  event_name: string;
  artist_name: string;
  venue_name?: string;
  city?: string;
  state?: string;
  country?: string;
  lat?: number;
  lon?: number;
  start_utc?: string;
  url: string;
};

/* ---------------- Performer-based mapper with title guardrails ---------------- */
function mapEvents(
  artistName: string,      // Spotify artist (may be "")
  events: TMEvent[],
  ensureId?: string,       // TM attractionId we queried
  expectedName?: string    // also require name==Spotify on ID path
): EventItem[] {
  const nExpected = norm(expectedName || artistName);
  const out: EventItem[] = [];

  // Ban tribute/“music of” style titles when we're NOT on an exact-id path.
  // (Still allow if ensureId present & name matches — i.e., the official tour.)
  const bannedTitle = /\b(tribute|a tribute to|music of|the music of|performs the music of|performing the music of|plays the music of|vs|night|party|orchestra|symphony|philharmonic|candlelight|string quartet|ensemble|experience|film concert|in concert with)\b/;

  for (const ev of events || []) {
    const atts = ev._embedded?.attractions || [];
    let matched: TMAttraction | undefined;

    for (const a of atts) {
      const byId = ensureId && a.id === ensureId;
      const byName = nExpected ? norm(a.name) === nExpected : false;

      const ok =
        (ensureId && expectedName ? (byId && byName) :
        ensureId ? byId :
        nExpected ? byName : false);

      if (ok) { matched = a; break; }
    }

    if (!matched) continue;

    // Title guard: if this is a name-match (no ensureId), reject obvious tributes/“music of …”
    if (!ensureId && nExpected) {
      const titleN = norm(ev.name);
      if (bannedTitle.test(titleN)) {
        // Drop likely non-artist performances (e.g., "The Music of Hans Zimmer & Others")
        continue;
      }
    }

    const v = ev._embedded?.venues?.[0] || {};
    out.push({
      source: "tm",
      source_id: ev.id,
      event_name: ev.name,
      artist_name: matched.name || artistName,
      venue_name: v.name,
      city: v.city?.name,
      state: v.state?.name,
      country: v.country?.name,
      lat: v.location?.latitude ? parseFloat(v.location.latitude) : undefined,
      lon: v.location?.longitude ? parseFloat(v.location.longitude) : undefined,
      start_utc: ev.dates?.start?.dateTime,
      url: ev.url,
    });
  }
  return out;
}

/* ---------------- Public APIs ---------------- */

export async function findAttractionIdsByName(
  artistName: string,
  opts?: { exactOnly?: boolean }
): Promise<string[]> {
  const data = await tmGet("/attractions.json", {
    classificationName: "Music",
    keyword: artistName,
    size: 50,
    sort: "name,asc",
  });
  const items: TMAttraction[] = data?._embedded?.attractions || [];
  const target = norm(artistName);

  const exactIds = items.filter(a => norm(a.name) === target).map(a => a.id);
  if (opts?.exactOnly !== false) return exactIds;

  const others = items.filter(a => norm(a.name) !== target).map(a => a.id);
  return [...exactIds, ...others];
}

export async function findTicketmasterEventsByAttractionId(opts: {
  attractionId: string;
  expectedArtistName: string;
  lat: number;
  lon: number;
  radiusMiles: number;
  startDateTimeISO: string;
  endDateTimeISO: string;
  size?: number;
}) {
  const data = await tmGet("/events.json", {
    classificationName: "Music",
    attractionId: opts.attractionId,
    latlong: `${opts.lat},${opts.lon}`,
    radius: Math.max(1, Math.min(200, Math.round(opts.radiusMiles))),
    unit: "miles",
    startDateTime: isoToTm(opts.startDateTimeISO),
    endDateTime: isoToTm(opts.endDateTimeISO),
    size: opts.size ?? 100,
    sort: "date,asc",
  });
  const events: TMEvent[] = data?._embedded?.events || [];
  return mapEvents(opts.expectedArtistName, events, opts.attractionId, opts.expectedArtistName);
}

export async function findTicketmasterEventsByKeywordStrict(opts: {
  artistName: string;
  lat: number;
  lon: number;
  radiusMiles: number;
  startDateTimeISO: string;
  endDateTimeISO: string;
  size?: number;
}) {
  const data = await tmGet("/events.json", {
    classificationName: "Music",
    keyword: opts.artistName,
    latlong: `${opts.lat},${opts.lon}`,
    radius: Math.max(1, Math.min(200, Math.round(opts.radiusMiles))),
    unit: "miles",
    startDateTime: isoToTm(opts.startDateTimeISO),
    endDateTime: isoToTm(opts.endDateTimeISO),
    size: opts.size ?? 100,
    sort: "date,asc",
  });
  const events: TMEvent[] = data?._embedded?.events || [];
  return mapEvents(opts.artistName, events);
}

export async function findTicketmasterEventsGeneric(opts: {
  lat: number;
  lon: number;
  radiusMiles: number;
  startDateTimeISO: string;
  endDateTimeISO: string;
  size?: number;
}) {
  const data = await tmGet("/events.json", {
    classificationName: "Music",
    latlong: `${opts.lat},${opts.lon}`,
    radius: Math.max(1, Math.min(200, Math.round(opts.radiusMiles))),
    unit: "miles",
    startDateTime: isoToTm(opts.startDateTimeISO),
    endDateTime: isoToTm(opts.endDateTimeISO),
    size: opts.size ?? 100,
    sort: "date,asc",
  });
  const events: TMEvent[] = data?._embedded?.events || [];
  return mapEvents("", events);
}
