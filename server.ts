import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import { URLSearchParams } from "url";

import {
  exchangeCodeForToken,
  ensureAccessToken,
  getFollowedArtists,
  getTopArtists,
  getSavedTrackArtists, // Liked Songs
} from "./spotify";

import {
  findAttractionIdsByName,
  findTicketmasterEventsByAttractionId,
  findTicketmasterEventsByKeywordStrict,
  findTicketmasterEventsGeneric,
} from "./ticketmaster";

import { rank } from "./rank"; // local dedupe below

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cookieSession({
    name: "sess",
    secret: process.env.SESSION_SECRET || "dev_secret",
    httpOnly: true,
    sameSite: "lax",
  })
);

// serve static UI
app.use(express.static("public"));

/** ---------------- Spotify OAuth ---------------- */
app.get("/login", (req, res) => {
  const state = Math.random().toString(36).slice(2);
  (req.session as any).oauth_state = state;

  const q = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID || "",
    response_type: "code",
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI || "",
    scope: process.env.SPOTIFY_SCOPES || "",
    state,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${q.toString()}`);
});

app.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query as any;
    if (!code || !state || state !== (req.session as any).oauth_state) {
      return res.status(400).send("Invalid OAuth state");
    }
    const tokens = await exchangeCodeForToken(
      code,
      process.env.SPOTIFY_REDIRECT_URI!
    );
    (req.session as any).tokens = tokens;
    res.redirect("/");
  } catch (e: any) {
    console.error(e);
    res.status(500).send(e.message || "OAuth error");
  }
});

function requireAuth(req: any, res: any, next: any) {
  if (!(req.session as any).tokens) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

/** ---------------- Left column artists ---------------- */
app.get("/api/me/artists", requireAuth, async (req: any, res) => {
  try {
    const ensured = await ensureAccessToken((req.session as any).tokens);
    (req.session as any).tokens = ensured;

    const [top, followed] = await Promise.all([
      getTopArtists(ensured.access_token),
      getFollowedArtists(ensured.access_token),
    ]);

    const byId = new Map<string, any>();
    for (const a of top) byId.set(a.id, { ...a, sources: new Set(["Top"]) });
    for (const a of followed) {
      const ex = byId.get(a.id);
      if (ex) ex.sources.add("Followed");
      else byId.set(a.id, { ...a, sources: new Set(["Followed"]) });
    }

    const artists = [...byId.values()].map((a) => ({
      id: a.id,
      name: a.name,
      genres: a.genres,
      sources: [...a.sources],
    }));

    res.json({ artists });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message || "Failed to fetch artists" });
  }
});

/** ---------------- Helpers ---------------- */
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
async function runLimited<TInput, TOut>(
  inputs: TInput[],
  worker: (x: TInput) => Promise<TOut | TOut[]>,
  limit = 2,
  gapMs = 260
): Promise<TOut[]> {
  const results: TOut[] = [];
  let idx = 0;

  async function next(): Promise<void> {
    const i = idx++;
    if (i >= inputs.length) return;
    const item = inputs[i];
    try {
      const r = await worker(item);
      if (Array.isArray(r)) results.push(...r);
      else if (typeof r !== "undefined") results.push(r);
    } catch (e) { console.error(e); }
    await sleep(gapMs);
    return next();
  }

  const starters = Array.from({ length: Math.min(limit, inputs.length) }, () => next());
  await Promise.all(starters);
  return results;
}

// local de-dupe
function dedupe<T extends { source?: string; source_id?: string; url?: string; event_name?: string; start_utc?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of items) {
    const key = `${e.source || "tm"}|${e.source_id || ""}|${e.url || ""}|${(e.event_name || "").toLowerCase()}|${e.start_utc || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function uniquePreserveOrder(names: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = n.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(n); }
  }
  return out;
}

/** ---------------- Events: Liked > Top > Followed; no recent, no related ---------------- */
app.get("/api/events", requireAuth, async (req: any, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radius = req.query.radius ? parseFloat(req.query.radius) : 120;
    const days = req.query.days ? parseInt(req.query.days, 10) : 180; // ~6 months
    const breadth = (req.query.breadth || "wide").toString(); // "tight" | "balanced" | "wide"
    const capOverride = req.query.cap ? Math.max(1, Math.min(1500, parseInt(req.query.cap as string, 10))) : undefined;

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      return res.status(400).json({ error: "lat and lon required" });
    }

    // Optional blacklist (comma-separated in env or ?ignore=Drake%20White,Some%20Band)
    const ignoreParam = (req.query.ignore as string | undefined) || process.env.IGNORE_ARTISTS || "";
    const ignoreSet = new Set(
      ignoreParam.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
    );

    const ensured = await ensureAccessToken((req.session as any).tokens);
    (req.session as any).tokens = ensured;

    // ONLY your Spotify signals (no recent, no saved albums, no related)
    const [top, followed, savedTracks] = await Promise.all([
      getTopArtists(ensured.access_token),
      getFollowedArtists(ensured.access_token),
      getSavedTrackArtists(ensured.access_token).catch(() => []), // Liked Songs
    ]);

    // Order = Liked first, then Top, then Followed. Remove ignored.
    const likedNames = savedTracks.map(a => a.name).filter(n => !ignoreSet.has(n.toLowerCase()));
    const topNames = top.map(a => a.name).filter(n => !ignoreSet.has(n.toLowerCase()));
    const followedNames = followed.map(a => a.name).filter(n => !ignoreSet.has(n.toLowerCase()));

    const defaultCap =
      breadth === "tight" ? 320 :
      breadth === "balanced" ? 520 :
      820; // wide
    const cap = capOverride ?? defaultCap;

    const names = uniquePreserveOrder([
      ...likedNames,
      ...topNames,
      ...followedNames,
    ]).slice(0, cap);

    const likedSet    = new Set(likedNames.map(n => n.toLowerCase()));
    const topSet      = new Set(topNames.map(n => n.toLowerCase()));
    const followedSet = new Set(followedNames.map(n => n.toLowerCase()));
    const coreSet     = new Set(names.map(n => n.toLowerCase()));

    // date window: start-of-today UTC → +N days
    const startUtc = new Date();
    startUtc.setUTCHours(0, 0, 0, 0);
    const startIso = startUtc.toISOString();
    const endIso = new Date(startUtc.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

    // Per-artist query: attractionId (exact-only + verify name) → strict keyword (performer equality)
    async function queryForArtist(artist: string) {
      const ids = await findAttractionIdsByName(artist, { exactOnly: true });
      if (ids.length) {
        const viaIds = await runLimited(
          ids,
          (id) =>
            findTicketmasterEventsByAttractionId({
              attractionId: id,
              expectedArtistName: artist, // verify name equals Spotify artist
              lat,
              lon,
              radiusMiles: radius,
              startDateTimeISO: startIso,
              endDateTimeISO: endIso,
            }),
          2,
          200
        );
        if (viaIds.length) return viaIds;
      }

      // strict keyword (performer equality; title ignored)
      const strict = await findTicketmasterEventsByKeywordStrict({
        artistName: artist,
        lat, lon, radiusMiles: radius,
        startDateTimeISO: startIso, endDateTimeISO: endIso,
      });
      return strict;
    }

    // Conservative concurrency to avoid 429
    let all = await runLimited(names, queryForArtist, 2, 260);

    // Fallback to generic only if nothing found — liked first, then core, both minus ignored
    if (all.length === 0) {
      try {
        const generic = await findTicketmasterEventsGeneric({
          lat, lon, radiusMiles: radius,
          startDateTimeISO: startIso, endDateTimeISO: endIso,
          size: 200,
        });
        let filtered = generic.filter(e => {
          const n = (e.artist_name || "").toLowerCase();
          return !ignoreSet.has(n) && likedSet.has(n);
        });
        if (filtered.length === 0) {
          filtered = generic.filter(e => {
            const n = (e.artist_name || "").toLowerCase();
            return !ignoreSet.has(n) && coreSet.has(n);
          });
        }
        all = filtered;
      } catch (e) {
        console.error(e);
      }
    }

    const unique = dedupe(all);

    const ranked = rank(unique, {
      userLat: lat,
      userLon: lon,
      likedArtistNames: likedSet,
      topArtistNames: topSet,
      followedArtistNames: followedSet,
      preferredArtistNames: coreSet,
      profile: "artist-heavy",
    });

    res.json({ count: ranked.length, events: ranked.slice(0, 220) });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message || "Failed to fetch events" });
  }
});

const port = 3000;
app.listen(port, () => {
  console.log(`Concerts Finder running at http://127.0.0.1:${port}`);
});
