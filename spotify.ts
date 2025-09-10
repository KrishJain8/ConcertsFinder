// src/spotify.ts
import fetch from "node-fetch";

/* =========================
   OAuth: tokens & helpers
   ========================= */

export type SpotifyTokens = {
  access_token: string;
  refresh_token: string;
  /** epoch ms when the access token expires */
  expires_at: number;
  scope?: string;
  token_type?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requiredEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function basicAuth() {
  const id = requiredEnv("SPOTIFY_CLIENT_ID");
  const secret = requiredEnv("SPOTIFY_CLIENT_SECRET");
  const raw = Buffer.from(`${id}:${secret}`).toString("base64");
  return `Basic ${raw}`;
}

/** Exchange authorization code for access+refresh tokens */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Spotify token exchange failed: ${res.status} ${text}`);
  }
  const json: any = JSON.parse(text);

  const expires_in = Number(json.expires_in ?? 3600);
  const now = Date.now();
  // set a small safety margin
  const expires_at = now + (expires_in - 30) * 1000;

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at,
    scope: json.scope,
    token_type: json.token_type,
  };
}

/** Refresh access token using refresh_token */
async function refreshAccessToken(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Spotify token refresh failed: ${res.status} ${text}`);
  }
  const json: any = JSON.parse(text);

  const expires_in = Number(json.expires_in ?? 3600);
  const now = Date.now();
  const expires_at = now + (expires_in - 30) * 1000;

  return {
    access_token: json.access_token,
    // Spotify may or may not return a new refresh_token
    refresh_token: json.refresh_token || tokens.refresh_token,
    expires_at,
    scope: json.scope ?? tokens.scope,
    token_type: json.token_type ?? tokens.token_type,
  };
}

/** Ensure access token is valid; refresh if near/after expiry */
export async function ensureAccessToken(tokens: SpotifyTokens): Promise<SpotifyTokens> {
  if (!tokens || !tokens.access_token) throw new Error("No tokens available");
  const now = Date.now();
  if (tokens.expires_at && now < tokens.expires_at) {
    return tokens;
  }
  return refreshAccessToken(tokens);
}

/* =========================
   Spotify Web API helpers
   ========================= */

async function spGetUrl(url: string, accessToken: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Spotify GET ${url} failed: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function spGet(
  path: string,
  accessToken: string,
  params: Record<string, any> = {}
) {
  const url = new URL(`https://api.spotify.com/v1${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  }
  return spGetUrl(url.toString(), accessToken);
}

/* =========================
   User library & profile
   ========================= */

/** Liked Songs (Saved Tracks) — returns ALL unique artists (paged) */
export async function getSavedTrackArtists(accessToken: string, maxArtists = 10000) {
  const out = new Map<string, { id: string; name: string }>();
  let url: string | null = "https://api.spotify.com/v1/me/tracks?limit=50"; // max=50

  while (url && out.size < maxArtists) {
    const data = await spGetUrl(url, accessToken);
    for (const item of data.items || []) {
      const artists = item?.track?.artists || [];
      for (const a of artists) {
        if (a?.id && a?.name && !out.has(a.id)) {
          out.set(a.id, { id: a.id, name: a.name });
        }
      }
    }
    url = data.next || null; // cursor paging
    if (url) await sleep(120); // gentle throttle
  }

  return Array.from(out.values());
}

/** Top Artists — combines long_term + medium_term + short_term (unique) */
export async function getTopArtists(accessToken: string) {
  const ranges = ["long_term", "medium_term", "short_term"] as const;
  const seen = new Map<string, { id: string; name: string; genres: string[] }>();

  for (const range of ranges) {
    const data = await spGet("/me/top/artists", accessToken, {
      time_range: range,
      limit: 50,
    });
    for (const a of data.items || []) {
      if (a?.id && !seen.has(a.id)) {
        seen.set(a.id, { id: a.id, name: a.name, genres: a.genres || [] });
      }
    }
    await sleep(120);
  }

  return Array.from(seen.values());
}

/** Followed Artists — fetches ALL pages (cursor: after) */
export async function getFollowedArtists(accessToken: string) {
  const out = new Map<string, { id: string; name: string; genres: string[] }>();
  let url: string | null =
    "https://api.spotify.com/v1/me/following?type=artist&limit=50";

  while (url) {
    const data = await spGetUrl(url, accessToken);
    const block = data?.artists;
    for (const a of block?.items || []) {
      if (a?.id && !out.has(a.id)) {
        out.set(a.id, { id: a.id, name: a.name, genres: a.genres || [] });
      }
    }
    const after = block?.cursors?.after;
    url = block?.next || (after
      ? `https://api.spotify.com/v1/me/following?type=artist&limit=50&after=${encodeURIComponent(after)}`
      : null);
    if (url) await sleep(120);
  }

  return Array.from(out.values());
}

/** (Optional) Recently Played — keep if you need it elsewhere */
export async function getRecentlyPlayedArtists(accessToken: string, limit = 50) {
  const data = await spGet("/me/player/recently-played", accessToken, { limit });
  const set = new Map<string, { id: string; name: string }>();
  for (const item of data.items || []) {
    for (const a of item?.track?.artists || []) {
      if (a?.id && !set.has(a.id)) set.set(a.id, { id: a.id, name: a.name });
    }
  }
  return Array.from(set.values());
}
