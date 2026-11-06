"""
check_heartbeat.py
------------------
Exits non-zero when no scrape has succeeded recently, so the watchdog workflow
turns red and GitHub sends an email. Reads the newest successful `scrape_runs` row.
"""

import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client

# Matches SCRAPE_STALE_MINUTES in server.js
STALE_AFTER_MINUTES = 360


def fetch_last_success(client):
    """Returns the finish time of the newest usable scrape, or None."""
    result = (
        client.table("scrape_runs")
        .select("finished_at")
        .in_("status", ["success", "partial"])
        .order("finished_at", desc=True)
        .limit(1)
        .execute()
    )
    return datetime.fromisoformat(result.data[0]["finished_at"]) if result.data else None


def age_in_minutes(finished_at, now):
    return round((now - finished_at).total_seconds() / 60)


def main():
    load_dotenv()
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    last_success = fetch_last_success(client)

    if last_success is None:
        sys.exit("No successful scrape has been recorded.")

    age = age_in_minutes(last_success, datetime.now(timezone.utc))
    if age > STALE_AFTER_MINUTES:
        sys.exit(f"Last successful scrape was {age} minutes ago ({last_success.isoformat()}).")

    print(f"Heartbeat OK: last successful scrape was {age} minutes ago.")


if __name__ == "__main__":
    main()
