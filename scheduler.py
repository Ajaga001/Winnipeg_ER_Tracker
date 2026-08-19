"""
scheduler.py
------------
Runs the scraper every 30 minutes and upserts results into Supabase.

Setup:
    1. pip install -r requirements.txt
    2. playwright install chromium
    3. Copy .env.example → .env and fill in your Supabase credentials
    4. python scheduler.py

The scheduler keeps running until you stop it (Ctrl+C).
Each cycle:
    - Fetches live wait times from Shared Health MB
    - Looks up each hospital's ID in the `hospitals` table
    - Upserts one row per hospital into `wait_times_log`
    - Refreshes the daily_wait_time_stats materialized view
    - Logs all activity to stdout + rotating file (logs/scheduler.log)
"""

import os
import sys
import json
import logging
import logging.handlers
import time
from datetime import datetime, timezone
from pathlib import Path

import schedule
from supabase import create_client, Client
from dotenv import load_dotenv
from playwright.sync_api import Error as PlaywrightError, TimeoutError as PlaywrightTimeoutError

# ── Local import (scraper lives alongside this file at the project root) ────
sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrape_wait_times import scrape_wait_times

# ── Config ────────────────────────────────────────────────────────────────────
load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")  # service_role key, NOT anon
SCRAPE_INTERVAL_MINUTES = int(os.environ.get("SCRAPE_INTERVAL_MINUTES", "30"))

LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

# ── Logging setup ─────────────────────────────────────────────────────────────
def build_logger() -> logging.Logger:
    logger = logging.getLogger("mb_er_scheduler")
    logger.setLevel(logging.INFO)

    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

    # Console
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    # Rotating file – 5 MB max, keep 7 days worth
    fh = logging.handlers.RotatingFileHandler(
        LOG_DIR / "scheduler.log", maxBytes=5 * 1024 * 1024, backupCount=7
    )
    fh.setFormatter(fmt)
    logger.addHandler(fh)

    return logger


log = build_logger()


# ── Supabase client ───────────────────────────────────────────────────────────
def get_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise EnvironmentError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in your .env file."
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── Hospital ID cache ─────────────────────────────────────────────────────────
_hospital_cache: dict[str, int] = {}  # name → id

# The wait-times page sometimes drops trailing words (e.g. "Emergency") or
# otherwise abbreviates a facility name relative to the canonical `hospitals.name`
# row. Map those known scraped variants to the canonical name here so they
# resolve to the existing hospital instead of spawning a duplicate stub row.
HOSPITAL_NAME_ALIASES: dict[str, str] = {
    "Health Sciences Centre - Adult": "Health Sciences Centre - Adult Emergency",
    "Health Sciences Centre - Children's": "Health Sciences Centre - Children's Emergency",
}


def load_hospital_cache(client: Client) -> None:
    """Populates _hospital_cache from the hospitals table."""
    global _hospital_cache
    try:
        result = client.table("hospitals").select("id, name").execute()
        _hospital_cache = {row["name"]: row["id"] for row in result.data}
        log.info("Hospital cache loaded: %d hospitals", len(_hospital_cache))
    except Exception as e:
        log.error("Failed to load hospital cache: %s", e)
        raise


def get_hospital_id(client: Client, name: str) -> int | None:
    """Returns the DB id for a hospital name, inserting a stub row if unknown."""
    canonical_name = HOSPITAL_NAME_ALIASES.get(name, name)
    if canonical_name in _hospital_cache:
        return _hospital_cache[canonical_name]

    log.warning("Unknown hospital '%s' - inserting stub row.", canonical_name)
    try:
        result = (
            client.table("hospitals")
            .insert({"name": canonical_name, "short_name": canonical_name[:30], "type": "emergency"})
            .execute()
        )
        new_id = result.data[0]["id"]
        _hospital_cache[canonical_name] = new_id
        return new_id
    except Exception as e:
        log.error("Could not insert stub hospital '%s': %s", canonical_name, e)
        return None


# ── Core job ──────────────────────────────────────────────────────────────────
def run_scrape_and_store() -> None:
    log.info("-- Scrape cycle starting --------------------------------")

    # 1. Fetch data
    try:
        snapshot = scrape_wait_times()
    except (PlaywrightTimeoutError, PlaywrightError) as e:
        log.error("Scrape failed (browser/network): %s", e)
        _store_error_row(status="site_down", notes=str(e))
        return

    scraped_at = snapshot["scraped_at"]
    hospitals = snapshot.get("hospitals", [])

    if not hospitals:
        log.warning("Scrape succeeded but returned 0 hospitals. Page structure may have changed.")
        _store_error_row(status="parse_error", notes="Zero hospitals parsed from page.")
        return

    log.info("Fetched %d hospitals at %s", len(hospitals), scraped_at)

    # 2. Build rows
    try:
        client = get_supabase_client()
        if not _hospital_cache:
            load_hospital_cache(client)
    except (EnvironmentError, Exception) as e:
        log.error("Cannot connect to Supabase: %s", e)
        return

    rows = []
    for h in hospitals:
        hosp_id = get_hospital_id(client, h["hospital_name"])
        if hosp_id is None:
            log.warning("Skipping hospital '%s' – no DB id.", h["hospital_name"])
            continue

        rows.append(
            {
                "hospital_id": hosp_id,
                "scraped_at": scraped_at,
                "raw_wait_time": h.get("raw_wait_time"),
                "wait_time_minutes": h.get("wait_time_minutes"),
                "patients_waiting": h.get("patients_waiting"),
                "scrape_status": "ok",
            }
        )

    if not rows:
        log.warning("No valid rows to insert after hospital ID lookup.")
        return

    # 3. Upsert into wait_times_log
    # The unique index on (hospital_id, scraped_at) prevents true duplicates.
    # on_conflict="hospital_id,scraped_at" with ignoreDuplicates makes re-runs safe.
    try:
        result = (
            client.table("wait_times_log")
            .upsert(rows, on_conflict="hospital_id,scraped_at", ignore_duplicates=True)
            .execute()
        )
        inserted = len(result.data) if result.data else 0
        log.info("Upserted %d rows into wait_times_log.", inserted)
    except Exception as e:
        log.error("Supabase upsert failed: %s", e)
        log.debug("Failed rows: %s", json.dumps(rows, indent=2))
        return

    # 4. Refresh materialized view (best-effort; non-fatal if it fails)
    try:
        client.rpc("refresh_daily_stats", {}).execute()
        log.info("Materialized view refreshed.")
    except Exception as e:
        # View refresh via RPC requires a Postgres function wrapper (see db/functions.sql).
        # Silently skip if not set up yet.
        log.debug("Could not refresh materialized view (set up db/functions.sql to enable): %s", e)

    log.info("-- Cycle complete ---------------------------------------")


def _store_error_row(status: str, notes: str) -> None:
    """Logs a sentinel error row so gaps in the time series are visible."""
    try:
        client = get_supabase_client()
        client.table("wait_times_log").insert(
            {
                "hospital_id": 1,  # HSC Adult as a proxy; adjust if needed
                "scraped_at": datetime.now(timezone.utc).isoformat(),
                "scrape_status": status,
                "notes": notes[:500],
            }
        ).execute()
    except Exception as e:
        log.error("Could not store error sentinel row: %s", e)


# ── Entry point ───────────────────────────────────────────────────────────────
def main() -> None:
    log.info("Manitoba ER Wait Time Scheduler starting.")
    log.info("Scrape interval: every %d minutes.", SCRAPE_INTERVAL_MINUTES)

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        log.error(
            "Missing Supabase credentials. Copy .env.example → .env and fill in values."
        )
        sys.exit(1)

    # Run once immediately on startup
    run_scrape_and_store()

    # Then schedule repeating runs
    schedule.every(SCRAPE_INTERVAL_MINUTES).minutes.do(run_scrape_and_store)

    try:
        while True:
            schedule.run_pending()
            time.sleep(30)  # check the schedule every 30 seconds
    except KeyboardInterrupt:
        log.info("Scheduler stopped by user.")


if __name__ == "__main__":
    main()
