"""
Fetch NBA passing data with nba_api and write the JSON files the site reads.

Usage (from the repo root):
    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python scripts/fetch_data.py                 # 2025-26 regular season
    .venv/bin/python scripts/fetch_data.py --season 2024-25

Outputs:
    data/players.json   one row per player: passing tracking + box score + advanced
    data/networks.json  per team: rotation players (nodes) and passes between them (links)

Raw API responses are cached in data/raw/ (git-ignored), so if the NBA stats
server rate-limits you part-way through, just re-run the script and it resumes.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import pandas as pd
from nba_api.stats.endpoints import (
    leaguedashplayerstats,
    leaguedashptstats,
    playerdashptpass,
)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"

SLEEP = 0.8  # seconds between live requests; stats.nba.com throttles bursts

# stats.nba.com silently hangs on requests that don't look like they come from
# a browser on nba.com, so send a full set of browser headers.
HEADERS = {
    "Host": "stats.nba.com",
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Sec-Fetch-Site": "same-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
}


# ---------------------------------------------------------------- helpers ---

def to_frames(raw):
    """Turn a raw stats.nba.com response dict into {resultSetName: DataFrame}."""
    sets = raw.get("resultSets", raw.get("resultSet"))
    if isinstance(sets, dict):
        sets = [sets]
    return {s["name"]: pd.DataFrame(s["rowSet"], columns=s["headers"]) for s in sets}


def call(endpoint_cls, cache_key, retries=4, **params):
    """Call an nba_api endpoint, caching the raw JSON response on disk."""
    path = RAW / f"{cache_key}.json"
    if path.exists():
        return to_frames(json.loads(path.read_text()))

    for attempt in range(1, retries + 1):
        try:
            ep = endpoint_cls(**params, headers=HEADERS, timeout=90)
            raw = ep.get_dict()
            path.write_text(json.dumps(raw))
            time.sleep(SLEEP)
            return to_frames(raw)
        except Exception as exc:  # network hiccups / throttling
            wait = 5 * attempt
            print(f"  ! {cache_key}: {type(exc).__name__} - retrying in {wait}s "
                  f"({attempt}/{retries})", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(
        f"Giving up on {cache_key} after {retries} attempts. stats.nba.com is not "
        "answering from this network. Try another network (e.g. a phone hotspot), "
        "turn off any VPN, then re-run - finished requests are cached.")


def clean(v):
    """JSON-safe scalar: NaN -> None, numpy types -> python, round floats."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float):
        return round(v, 4)
    return v


# ------------------------------------------------------------------- main ---

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2025-26")
    ap.add_argument("--season-type", default="Regular Season")
    ap.add_argument("--min-gp", type=int, default=20,
                    help="minimum games played to appear on the page")
    ap.add_argument("--net-min-mpg", type=float, default=12.0,
                    help="minimum minutes/game to be a node in a team network")
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    tag = f"{args.season}_{args.season_type.replace(' ', '')}"
    common = dict(season=args.season, season_type_all_star=args.season_type)

    # 1. League-wide player passing tracking (per game) -----------------------
    print("Fetching league passing tracking ...")
    passing = call(
        leaguedashptstats.LeagueDashPtStats, f"passing_{tag}",
        player_or_team="Player", pt_measure_type="Passing",
        per_mode_simple="PerGame", **common,
    )
    passing = next(iter(passing.values()))

    # 2. Box score + advanced (per game) --------------------------------------
    print("Fetching box score + advanced stats ...")
    base = next(iter(call(
        leaguedashplayerstats.LeagueDashPlayerStats, f"base_{tag}",
        measure_type_detailed_defense="Base", per_mode_detailed="PerGame", **common,
    ).values()))
    adv = next(iter(call(
        leaguedashplayerstats.LeagueDashPlayerStats, f"adv_{tag}",
        measure_type_detailed_defense="Advanced", per_mode_detailed="PerGame", **common,
    ).values()))

    keep_pass = [c for c in [
        "PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "TEAM_ABBREVIATION", "GP", "MIN",
        "PASSES_MADE", "PASSES_RECEIVED", "AST", "FT_AST", "SECONDARY_AST",
        "POTENTIAL_AST", "AST_POINTS_CREATED", "AST_ADJ", "AST_TO_PASS_PCT",
        "AST_TO_PASS_PCT_ADJ",
    ] if c in passing.columns]
    keep_base = [c for c in ["PLAYER_ID", "PTS", "TOV"] if c in base.columns]
    keep_adv = [c for c in ["PLAYER_ID", "AST_PCT", "AST_TO", "AST_RATIO", "USG_PCT"]
                if c in adv.columns]

    players = (passing[keep_pass]
               .merge(base[keep_base], on="PLAYER_ID", how="left")
               .merge(adv[keep_adv], on="PLAYER_ID", how="left"))
    players = players[players["GP"] >= args.min_gp].copy()

    # Derived: what share of potential assists did teammates actually convert?
    players["CONVERSION"] = players["AST"] / players["POTENTIAL_AST"].where(
        players["POTENTIAL_AST"] > 0)
    # Potential assists created per 100 passes: how often a pass creates a shot
    players["POT_AST_PER_100_PASSES"] = 100 * players["POTENTIAL_AST"] / players[
        "PASSES_MADE"].where(players["PASSES_MADE"] > 0)

    players_out = [{k: clean(v) for k, v in row.items()}
                   for row in players.to_dict(orient="records")]
    meta = {"season": args.season, "season_type": args.season_type,
            "min_gp": args.min_gp, "source": "stats.nba.com via nba_api",
            "fetched": time.strftime("%Y-%m-%d")}
    (DATA / "players.json").write_text(
        json.dumps({"meta": meta, "players": players_out}, indent=0))
    print(f"  wrote data/players.json ({len(players_out)} players)")

    # 3. Pass networks: who passes to whom, per team --------------------------
    rotation = players[players["MIN"] >= args.net_min_mpg]
    print(f"Fetching pass breakdowns for {len(rotation)} rotation players "
          f"(cached after first run) ...")

    links = []
    for i, r in enumerate(rotation.itertuples(index=False), 1):
        pid, tid = int(r.PLAYER_ID), int(r.TEAM_ID)
        print(f"  [{i:>3}/{len(rotation)}] {r.PLAYER_NAME}")
        frames = call(
            playerdashptpass.PlayerDashPtPass, f"pass_{tag}_{pid}_{tid}",
            team_id=tid, player_id=pid, per_mode_simple="Totals", **common,
        )
        made = frames.get("PassesMade")
        if made is None or made.empty:
            continue
        for m in made.itertuples(index=False):
            links.append({
                "team": r.TEAM_ABBREVIATION,
                "source": pid,
                "target": int(m.PASS_TEAMMATE_PLAYER_ID),
                "passes": clean(m.PASS),
                "ast": clean(m.AST),
                "fgm": clean(m.FGM),
                "fga": clean(m.FGA),
            })

    networks = {}
    for team, grp in rotation.groupby("TEAM_ABBREVIATION"):
        ids = set(grp["PLAYER_ID"].astype(int))
        team_links = [l for l in links
                      if l["team"] == team and l["source"] in ids and l["target"] in ids
                      and (l["passes"] or 0) > 0]
        nodes = [{
            "id": int(p.PLAYER_ID), "name": p.PLAYER_NAME, "gp": clean(p.GP),
            "min": clean(p.MIN), "ast": clean(p.AST),
            "potential_ast": clean(p.POTENTIAL_AST),
            "passes_made": clean(p.PASSES_MADE),
        } for p in grp.itertuples(index=False)]
        networks[team] = {"nodes": nodes,
                          "links": [{k: v for k, v in l.items() if k != "team"}
                                    for l in team_links]}

    (DATA / "networks.json").write_text(
        json.dumps({"meta": meta, "teams": networks}, indent=0))
    print(f"  wrote data/networks.json ({len(networks)} teams)")


if __name__ == "__main__":
    main()
