# What does great court vision look like? An NBA passing case study

DSC 106 final project: an explorable explanation of NBA passing, built with D3.js
and NBA player-tracking data pulled with [`nba_api`](https://github.com/swar/nba_api).

## Files

| Path | What it is |
|---|---|
| `index.html`, `style.css`, `main.js` | The page (served by GitHub Pages from the repo root) |
| `scripts/fetch_data.py` | Pulls data from stats.nba.com via `nba_api` and writes `data/*.json` |
| `data/players.json` | One row per player: passing tracking, box score and advanced stats |
| `data/networks.json` | Per team: rotation players and season pass counts between them |

## Regenerating the data

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_data.py            # defaults to the 2025-26 regular season
# .venv/bin/python scripts/fetch_data.py --season 2024-25
```

The first run makes about 300 API calls (one per rotation player for the pass networks)
and takes roughly 5–10 minutes. Raw responses are cached in `data/raw/` (git-ignored), so
if stats.nba.com throttles or times out part-way through, just re-run the script and it
picks up where it left off. stats.nba.com often blocks cloud and VPN IP addresses, so
run it from a home or campus network.

## Running locally

The page loads its data with `fetch`, so serve it over HTTP instead of opening the file:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Endpoints used

- `LeagueDashPtStats` (`PtMeasureType=Passing`): passes made, potential assists,
  secondary assists, assist points created
- `LeagueDashPlayerStats` (Base + Advanced): turnovers, assist %, usage %
- `PlayerDashPtPass`: each player's passes and assists to every teammate

## Acknowledgements

[Claude Code](https://claude.com/claude-code) (Anthropic) helped debug and fix the data
fetching in `scripts/fetch_data.py`. The original script passed a custom set of browser
headers to every `nba_api` endpoint, which made stats.nba.com hang until the request
timed out. Claude traced the hang to those headers and switched the calls to
`nba_api`'s built-in headers, after which the script fetched the 2025-26 data in
`data/players.json` and `data/networks.json`.
