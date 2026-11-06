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
    - Records the outcome in `scrape_runs` (the heartbeat)
    - Logs all activity to stdout + rotating file (logs/scheduler.log)

`python scheduler.py --once` runs a single cycle and exits non-zero on failure.
"""

import argparse
import os
import sys
import logging
import logging.handlers
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import schedule
from supabase import create_client, Client
from dotenv import load_dotenv
from playwright.sync_api import Error as PlaywrightError

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
_active_hospital_ids: set[int] = set()  # sites we expect to see in each scrape

# The wait-times page sometimes drops trailing words (e.g. "Emergency") or
# otherwise abbreviates a facility name relative to the canonical `hospitals.name`
# row. Map those known scraped variants to the canonical name here so they
# resolve to the existing hospital instead of spawning a duplicate stub row.
HOSPITAL_NAME_ALIASES: dict[str, str] = {
    "Health Sciences Centre - Adult": "Health Sciences Centre - Adult Emergency",
    "Health Sciences Centre - Children's": "Health Sciences Centre - Children's Emergency",
}


def load_hospital_cache(client: Client) -> None:
    """Populates the hospital caches from the hospitals table."""
    global _hospital_cache, _active_hospital_ids
    try:
        result = client.table("hospitals").select("id, name, is_active").execute()
        _hospital_cache = {row["name"]: row["id"] for row in result.data}
        _active_hospital_ids = {row["id"] for row in result.data if row["is_active"]}
        log.info("Hospital cache loaded: %d hospitals", len(_hospital_cache))
    except Exception as e:
        log.error("Failed to load hospital cache: %s", e)
        raise


def get_hospital_id(client: Client, name: str, facility_type: str) -> int | None:
    """Returns the DB id for a hospital name, inserting a stub row if unknown."""
    canonical_name = HOSPITAL_NAME_ALIASES.get(name, name)
    if canonical_name in _hospital_cache:
        return _hospital_cache[canonical_name]

    log.warning("Unknown hospital '%s' - inserting stub row.", canonical_name)
    try:
        result = (
            client.table("hospitals")
            .insert({"name": canonical_name, "short_name": canonical_name[:30], "type": facility_type})
            .execute()
        )
        new_id = result.data[0]["id"]
        _hospital_cache[canonical_name] = new_id
        _active_hospital_ids.add(new_id)
        return new_id
    except Exception as e:
        log.error("Could not insert stub hospital '%s': %s", canonical_name, e)
        return None


# ── Core job ──────────────────────────────────────────────────────────────────
@dataclass
class CycleResult:
    status: str  # 'success' | 'partial' | 'failed' (see scrape_runs.status)
    hospitals_parsed: int = 0
    error: str | None = None


def build_rows(client: Client, scraped_at: str, hospitals: list[dict]) -> list[dict]:
    """Builds one wait_times_log row per scraped hospital, plus no_data sentinels."""
    rows = []
    reported_hospital_ids = set()
    for h in hospitals:
        hosp_id = get_hospital_id(client, h["hospital_name"], h["facility_type"])
        if hosp_id is None:
            log.warning("Skipping hospital '%s' – no DB id.", h["hospital_name"])
            continue

        reported_hospital_ids.add(hosp_id)
        rows.append(
            {
                "hospital_id": hosp_id,
                "scraped_at": scraped_at,
                "raw_wait_time": h.get("raw_wait_time"),
                "wait_time_minutes": h.get("wait_time_minutes"),
                "wait_capped": h.get("wait_capped", False),
                "patients_waiting": h.get("patients_waiting"),
                "scrape_status": "ok",
            }
        )

    # An active hospital that's missing from this cycle's results (e.g. the
    # source page dropped it) would otherwise leave its last real reading
    # sitting in `latest_wait_times` forever, looking live when it's actually
    # stale. Record a `no_data` sentinel for it instead, so the gap is visible.
    # Inactive sites aren't published at all, so they get no sentinel rows.
    missing_hospital_ids = _active_hospital_ids - reported_hospital_ids
    if missing_hospital_ids:
        log.warning(
            "%d known hospital(s) missing from this scrape: %s",
            len(missing_hospital_ids), sorted(missing_hospital_ids),
        )
        for hosp_id in missing_hospital_ids:
            rows.append(
                {
                    "hospital_id": hosp_id,
                    "scraped_at": scraped_at,
                    "raw_wait_time": None,
                    "wait_time_minutes": None,
                    "wait_capped": False,
                    "patients_waiting": None,
                    "scrape_status": "no_data",
                }
            )

    return rows


def upsert_rows(client: Client, rows: list[dict]) -> None:
    """Writes rows to wait_times_log. Raises if Supabase rejects them."""
    # The unique index on (hospital_id, scraped_at) prevents true duplicates.
    # on_conflict="hospital_id,scraped_at" with ignoreDuplicates makes re-runs safe.
    result = (
        client.table("wait_times_log")
        .upsert(rows, on_conflict="hospital_id,scraped_at", ignore_duplicates=True)
        .execute()
    )
    inserted = len(result.data) if result.data else 0
    log.info("Upserted %d rows into wait_times_log.", inserted)


def refresh_daily_stats(client: Client) -> None:
    """Refreshes the materialized view (best-effort; non-fatal if it fails)."""
    try:
        client.rpc("refresh_daily_stats", {}).execute()
        log.info("Materialized view refreshed.")
    except Exception as e:
        # View refresh via RPC requires a Postgres function wrapper (see db/functions.sql).
        # Silently skip if not set up yet.
        log.debug("Could not refresh materialized view (set up db/functions.sql to enable): %s", e)


def run_cycle() -> CycleResult:
    """Scrapes the source and stores the readings."""
    try:
        snapshot = scrape_wait_times()
    except PlaywrightError as e:
        log.error("Scrape failed (browser/network): %s", e)
        return CycleResult("failed", error=str(e))

    hospitals = snapshot.get("hospitals", [])
    source_errors = snapshot.get("source_errors", {})

    for url, error in source_errors.items():
        log.error("Scrape failed for %s: %s", url, error)

    if not hospitals:
        error = "; ".join(source_errors.values()) or "Zero hospitals parsed from page."
        log.warning("No hospitals scraped: %s", error)
        return CycleResult("failed", error=error)

    log.info("Fetched %d hospitals at %s", len(hospitals), snapshot["scraped_at"])

    try:
        client = get_supabase_client()
        if not _hospital_cache:
            load_hospital_cache(client)
        upsert_rows(client, build_rows(client, snapshot["scraped_at"], hospitals))
    except Exception as e:
        log.error("Could not store readings: %s", e)
        return CycleResult("failed", len(hospitals), str(e))

    refresh_daily_stats(client)

    if source_errors:
        return CycleResult("partial", len(hospitals), "; ".join(source_errors.values()))
    return CycleResult("success", len(hospitals))


def record_run(started_at: datetime, result: CycleResult) -> None:
    """Writes the heartbeat row. A failure here must not mask the cycle's own outcome."""
    try:
        get_supabase_client().table("scrape_runs").insert(
            {
                "started_at": started_at.isoformat(),
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "status": result.status,
                "hospitals_parsed": result.hospitals_parsed,
                "error": result.error[:500] if result.error else None,
            }
        ).execute()
    except Exception as e:
        log.error("Could not record scrape run: %s", e)


def run_scrape_and_store() -> bool:
    """Runs one cycle and records it. Returns True only if every source succeeded."""
    log.info("-- Scrape cycle starting --------------------------------")
    started_at = datetime.now(timezone.utc)
    result = run_cycle()
    record_run(started_at, result)
    log.info("-- Cycle finished: %s ------------------------------", result.status)
    return result.status == "success"


# ── Entry point ───────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape ER wait times into Supabase.")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run one cycle and exit non-zero on failure (used by GitHub Actions).",
    )
    args = parser.parse_args()

    log.info("Manitoba ER Wait Time Scheduler starting.")
    log.info("Scrape interval: every %d minutes.", SCRAPE_INTERVAL_MINUTES)

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        log.error(
            "Missing Supabase credentials. Copy .env.example → .env and fill in values."
        )
        sys.exit(1)

    if args.once:
        sys.exit(0 if run_scrape_and_store() else 1)

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
