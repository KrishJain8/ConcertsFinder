# ConcertsFinder
Concerts Finder — High-Level README

Find upcoming concerts for the artists you actually listen to.
This app connects your Spotify account, builds a personal artist list (with a strong emphasis on your Liked Songs), and then searches Ticketmaster for real performer matches near you.

🔮 What it does (at a glance)

Log in with Spotify → securely reads your:

Liked Songs (Saved Tracks), Top Artists, and Followed Artists

Finds concerts via Ticketmaster by performer (attraction), not by title text

Multi-word names (e.g., “Chris Brown”) also match things like “Chris Brown & Friends”

One-word names stay strict (so “Drake” ≠ “Drake White”)

Ranks results for you: Liked > Top > Followed, with gentle nudges for date & distance

Simple UI:

Left: your artists (Top/Followed)

Right: upcoming events

Top header + “Use my location” button (dark, Spotify-style theme)

🧠 How it works (high level)

Spotify OAuth (Authorization Code Flow) → you grant read-only access to library/profile endpoints.

Artist pool is built only from your history (no “related”/random bands):

Liked Songs → Top Artists (all time ranges) → Followed Artists

Lists are interleaved so long-tail artists you barely listened to still get considered.

Ticketmaster Discovery API searches for future events near your coordinates.

Prefers exact attraction IDs; otherwise exact (or phrase-contains for multi-word) performer names.

Filters obvious tribute/“Music of …” programs unless it’s the official performer ID.

Ranking pushes your Liked-Song artists to the top; date/location help break ties.

🧰 What you need

Node 18+ (Node 20/22 recommended)

Spotify Developer app (Web API)

Ticketmaster Discovery API Consumer Key

You’ll keep secrets in a local .env file (not committed). A published .env.example shows the format.
