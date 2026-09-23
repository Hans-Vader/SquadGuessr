
<h1 align="center">
    <a href="https://squadcalc.app">
      <img src="./public/img/github/logo.png" alt="squadcalc logo">
    </a>
</h1>

<div align="center">
    <a href="https://discord.gg/BNPAc5kEJP">  
      <img src="https://img.shields.io/badge/Discord-111?style=for-the-badge&logo=discord&logoColor=white" alt="discord"></a>
</div>


</br>
</br>

# Submit a new guess 

</br>

1. Take your screenshot ingame (go into "screenshot mode" by clicking the eye icon at bottom of screen in main menu to remove compass, and Shift+P ingame for free camera), it should be a square and **at least 900px*900px**. Please consider taking your screenshots at quite high graphics settings for best UX on squadguessr.
Using a screenshot tool like [GreenShot](https://getgreenshot.org/)/[ShareX](https://getsharex.com/) helps a lot.  
Format don't matter as i will convert everything to `.webp` with a script anyway.

3. Open console on your browser (F12)

4. Enable "Debug" logging

<div align="center"><img src="./public/img/github/debug.png" alt="squadcalc logo"></div></br>

4. Start a new classic game to show any map, then in the console type `debugChangeMap('yourmapname')` to change the map to show the map you took your screenshot on

<div align="center"><img src="./public/img/github/debugCmd.png" alt="squadcalc logo"></div>

</br>

5. Click where your screenshot is taken from

<div align="center"><img src="./public/img/github/latlng.png" alt="squadcalc logo"></div>


</br>

6. Submit your screenshot + latlng on [Discord](https://discord.gg/BNPAc5kEJP) (suggestion channel), e.g. : 


```json
{ 
    "map": "narva",
    "mode": "easy",
    "url": "/img/guesses/yourimagename.webp",
    "lat": -1402.4167693765319,
    "lng": 1438.0344360576973,
    "submitter": "your preferred nickname/ingame-nick here"
},
```

</br></br></br>
# Multiplayer server

Group sessions ("Play with friends") need the small WebSocket server in `server/`.

**Development**

```bash
npm run server   # ws server on :3001 (MP_PORT to change)
npm start        # dev server proxies /mp to it, reachable from phones on the LAN
npm test         # server + scoring tests
```

**Production (Docker Compose)**

Your existing reverse proxy terminates TLS and forwards the domain to the `web` container:

```bash
cp .env.example .env   # optional, see variables below
docker compose up -d --build
```

| Variable | Default | |
|---|---|---|
| `WEB_BIND` | `127.0.0.1` | use `0.0.0.0` if the reverse proxy runs on another host |
| `WEB_PORT` | `8080` | point your reverse proxy here |
| `API_URL` | `https://squadcalc.app` | upstream for `/api/` (guesses and images) |
| `API_KEY` | empty | sent as `X-API-Key` if set |
| `SEARCH_ENGINES` | `false` | allow indexing in `robots.txt` |

The reverse proxy must pass WebSocket upgrades for `/mp` (Caddy and Traefik do this automatically; plain nginx needs `proxy_http_version 1.1` plus `Upgrade`/`Connection` headers; Nginx Proxy Manager: enable "Websockets Support").

Sessions live in memory only; `docker compose up -d --build` after an update restarts the server and ends all running sessions.

The SquadCalc API currently answers `403 Unauthorized` to requests without a key, so a self-hosted instance needs `API_KEY` for guesses and images to load.
Building the frontend outside Docker needs Node ≥ 20.9 (required by `copy-webpack-plugin`); the server and `npm test` run on Node 18.

</br></br>

# **Support the project**
</br>

[![buy me a coffee](https://img.shields.io/badge/BUY%20ME%20A%20COFFEE-b12222?style=for-the-badge&logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/sharkman)  



