# ConcertsFinder
Find upcoming concerts for the artists you actually listen to.
Left column shows your Top and Followed Spotify artists. Right side lists future events near you. Dark, Spotify-like UI with a big Use my location button.

Data sources: Spotify (your library/profile) + Ticketmaster Discovery API
Matching: strict by performer (attraction) — not by event title — to avoid false positives.

Features

🔐 Spotify Login (OAuth) — pulls your Liked Songs (Saved Tracks), Top Artists (all time ranges), and Followed Artists.

🎯 Performer-based matching — only shows events where Ticketmaster’s performer equals your Spotify artist (with sensible multi-word relaxers like “Chris Brown & Friends”).

🧭 Use my location — gets your coordinates and searches within a configurable radius/time window.

🌓 Dark UI — black background, white text, “concertsfinder” header. Artists on the left 1/4, concerts on the right.

🧠 Ranking tuned for you — Liked Songs > Top > Followed. Location/date are gentle tie-breakers.

🛡️ Noise filters — blocks obvious tribute/“Music of …” concerts unless it’s the official attraction ID.

🧹 De-dupe & stable order — deterministic results with light rate-limit friendliness.

Stack

Server: Node + Express (TypeScript)

Auth: Spotify Web API (Authorization Code Flow)

Events: Ticketmaster Discovery API

Dev runtime: tsx (watch mode)

Front-end: static HTML/CSS/JS in /public

Project Structure
concerts-finder/
  src/
    server.ts          # Express server + routes (/login, /callback, /api/me/artists, /api/events)
    spotify.ts         # OAuth + Spotify fetchers (Liked/Top/Followed)
    ticketmaster.ts    # Discovery API calls + performer matching + filters
    rank.ts            # scoring (Liked > Top > Followed; light location/date nudges)
  public/
    index.html         # UI (dark theme, left artists / right events, "Use my location" button)
  package.json
  package-lock.json
  tsconfig.json        # if present in your repo
  .env                 # NOT COMMITTED (your real secrets)
  .env.example         # safe placeholders (commit this)
  .gitignore
  README.md

Prerequisites

Node 18+ (Node 20/22 recommended)

A Spotify Developer app (Web API)

A Ticketmaster Discovery API key (Consumer Key)

1) Create your .env

First, copy the example and fill your values:

cp .env.example .env


.env.example (commit this, keep placeholders):

# Session
SESSION_SECRET=change_me

# Spotify OAuth
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
# Use loopback IP per Spotify rules (Apr 2025+). "localhost" is NOT allowed.
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback
SPOTIFY_SCOPES=user-library-read user-top-read user-follow-read user-read-recently-played

# Ticketmaster
TICKETMASTER_API_KEY=your_ticketmaster_consumer_key

# Optional filtering (comma-separated, case-insensitive)
IGNORE_ARTISTS=drake white,hans zimmer

NODE_ENV=development


Do not commit .env. Only commit .env.example.

2) Spotify App Setup

Go to Spotify Developer Dashboard → Create App.

APIs/SDKs: Select Web API.

Redirect URI: http://127.0.0.1:3000/callback

Spotify’s new validation does not allow localhost. Use the loopback IP.

Copy Client ID and Client Secret into your .env.

Scopes you’ll need:

user-library-read (Liked Songs / saved tracks)

user-top-read (Top Artists)

user-follow-read (Followed Artists)

(optional) user-read-recently-played (if you keep that feature enabled)

3) Ticketmaster Setup

Create a Ticketmaster Developer app and enable Discovery API.

Copy the Consumer Key into TICKETMASTER_API_KEY in .env.

You do not need OAuth for basic Discovery queries.

4) Install & Run
npm install
npm run dev


App runs at: http://127.0.0.1:3000

Click Log in with Spotify (or hit /login).

Click Use my location in the UI.

Browse concerts! Open the Ticketmaster page via the button next to each event.

API Endpoints
GET /login

Starts Spotify OAuth.

GET /callback

Spotify redirect target (handles code exchange and stores session tokens).

GET /api/me/artists (auth required)

Returns your combined artists for the left column:

{
  "artists": [
    { "id": "123", "name": "Artist", "genres": ["pop"], "sources": ["Top","Followed"] },
    ...
  ]
}

GET /api/events (auth required)

Finds future events for your artists near a location.

Query params:

lat (required): latitude (e.g., 34.0522)

lon (required): longitude (e.g., -118.2437)

radius (optional): miles (default ~200)

days (optional): days into the future (default ~270)

cap (optional): max artists to query (e.g., 1500, 2200)

ignore (optional): comma-separated names to exclude (case-insensitive)

Example:

/api/events?lat=34.0522&lon=-118.2437&radius=200&days=270&cap=1500&ignore=drake%20white


Response:

{
  "count": 123,
  "events": [
    {
      "source": "tm",
      "source_id": "Z7r9jZ1Adf..",
      "event_name": "Chris Brown & Friends",
      "artist_name": "Chris Brown",
      "venue_name": "Crypto.com Arena",
      "city": "Los Angeles",
      "state": "CA",
      "country": "US",
      "lat": 34.043,
      "lon": -118.267,
      "start_utc": "2025-10-05T03:00:00Z",
      "url": "https://www.ticketmaster.com/..."
    }
  ]
}

How Results Are Chosen (Quick Model)

Your artist pool (broad but 100% yours)

Liked Songs (Saved Tracks) → Top Artists (all time ranges) → Followed Artists.

We interleave these lists and use a high cap so “artists you barely listened to” still get queried.

Ticketmaster search

Prefer attractionId matches (exact-name).

Otherwise perform strict performer matching by name.

Multi-word artists allow “contains phrase” in performer name (e.g., “Chris Brown & Friends”).

Single-word artists stay strict to avoid mismatches (e.g., “Drake” vs “Drake White”).

Filters

Future-only (start from today, UTC).

Tribute/“Music of …”/orchestra titles are filtered unless we’re on an exact official attractionId.

Ranking

Highest weight: Liked Songs artists.

Then Top, then Followed.

Light nudges for location proximity and date (tie-breakers).

.gitignore
# node
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# env / secrets
.env
.env.*
!.env.example

# builds / caches
dist/
build/
.temp/
.cache/
.out/

# OS/editor
.DS_Store
Thumbs.db
.vscode/
.idea/
*.swp

Troubleshooting

“Redirect URI is not secure / localhost not allowed”
Use http://127.0.0.1:3000/callback in both your .env and Spotify app settings.

Texas/Random location results

In DevTools → Network → check /api/events?lat=...&lon=....

LA should be lat≈34.x, lon≈-118.x.

If swapped or missing, fix your frontend call. The server can auto-swap if clearly wrong.

Ticketmaster 429 (rate limit) or 1015 (date format)

The code spaces requests, but large caps can still spike. Lower cap or radius while testing.

Dates are sent in ISO with Z and constrained to future-only.

I see tribute/“Music of …” shows

We filter those on the keyword path. If a specific one slips through, add to IGNORE_ARTISTS or query param ignore=....

No events

Try widening: radius=200&days=270&cap=2200.

Some artists simply have no Ticketmaster events; generic fallback is filtered to your artists.

Scripts

npm run dev — start server in watch mode (tsx watch src/server.ts)

(Add build/lint scripts if you have them.)

Security & Keys

Never commit .env or real keys.

If you accidentally push secrets, rotate keys in Spotify/Ticketmaster and purge from Git history.

Roadmap (optional ideas)

Save/subscribe to artists or shows

Calendar export (ICS)

Additional ticket providers (SeatGeek, AXS)

Map view & filters (date range, price, venue)

Lightweight cache to reduce API calls

License

MIT (or your preferred license). Add a LICENSE file if you want to be explicit.

Quick Start (TL;DR)
git clone <your-repo>
cd concerts-finder
cp .env.example .env   # fill in keys
npm install
npm run dev
# open http://127.0.0.1:3000, login, click "Use my location"
