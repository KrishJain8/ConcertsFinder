# 🎵 Concerts Finder

A web app that helps you discover upcoming concerts near you by combining your Spotify listening habits with the Ticketmaster Discovery API.

It pulls your Top Artists, Followed Artists, and Liked Songs from Spotify, then matches them with real Ticketmaster events happening around your location.

**✨ Features**

- Spotify OAuth Login – securely log in with your Spotify account.

- Artist Signals – fetches:

  - Liked Songs (Saved Tracks)

  - Top Artists (short/medium/long term)

  - Followed Artists

- Event Matching – queries Ticketmaster by artist name or attraction ID.

- Ranking System – prioritizes events with your liked artists, then top, then followed.

- Location Aware – search concerts near you with adjustable radius.

- Clean UI – sidebar of your artists + main feed of upcoming events.

**🚀 Getting Started**

**1. Clone the Repo**

    git clone https://github.com/<your-username>/concerts-finder.git
    cd concerts-finder

**2. Install Dependencies**
npm install

**3. Environment Variables**

Create a .env file in the project root:

    SESSION_SECRET=your_random_secret
    
    SPOTIFY_CLIENT_ID=your_spotify_client_id
    SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
    
    SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback
    
    SPOTIFY_SCOPES=user-top-read user-library-read user-follow-read user-read-recently-played
    
    TICKETMASTER_API_KEY=your_ticketmaster_api_key

_Optional: blacklist artists (comma-separated)_

You can generate Spotify credentials at Spotify Developer Dashboard
.
Get a Ticketmaster API key at Ticketmaster Developer Portal
.

**4. Run the App**

    npm run dev


Server runs on:
👉 http://127.0.0.1:3000

**🖥️ Usage**

1. Open the app and click Login with Spotify.

2. Click Use My Location to auto-fill latitude/longitude.

3. Adjust radius (default: 50 miles).

4. Hit Find Events to see upcoming concerts.

5. Open Ticketmaster links directly to purchase tickets.

**📂 Project Structure**


    src/

      server.ts       # Express server, routes, API
  
      spotify.ts      # Spotify OAuth + API helpers
  
      ticketmaster.ts # Ticketmaster API helpers
  
      rank.ts         # Event scoring + ranking logic
  
    public/

      index.html      # UI (artists sidebar + events list)
  
    .env              # Local config (not committed)
  

**🛠️ Tech Stack**

Node.js + Express – backend server

TypeScript – type safety

cookie-session – session management

Spotify Web API – music signals

Ticketmaster Discovery API – concert data

Vanilla JS + HTML/CSS – lightweight frontend

⚖️ License

MIT License – feel free to fork and build on this project.
