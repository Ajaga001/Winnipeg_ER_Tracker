import json
import re
from datetime import datetime, timezone
from playwright.sync_api import Error as PlaywrightError, sync_playwright

# WRHA publishes emergency departments and urgent care centres on separate
# pages with identical table layouts. Each entry maps a facility type (the
# `hospitals.type` value) to the page that lists those facilities.
SOURCES = (
    ("emergency", "https://wrha.mb.ca/wait-times/emergency/"),
    ("urgent_care", "https://wrha.mb.ca/wait-times/urgent-care/"),
)

# The source never reports more than "15 hrs", so a reading at this value means
# "15 hours or longer" rather than an exact wait.
WAIT_CAP_MINUTES = 900


def parse_wait_minutes(raw_wait_time):
    """Parses strings like '2h 15m', '45m', '1h' into total minutes. Returns None if unparseable."""
    if not raw_wait_time:
        return None

    text = raw_wait_time.strip().lower()
    if not text or text in {"n/a", "na", "-", "--", "not available", "closed"}:
        return None

    hours_match = re.search(r"(\d+(?:\.\d+)?)\s*h", text)
    minutes_match = re.search(r"(\d+)\s*m", text)

    if hours_match or minutes_match:
        hours = float(hours_match.group(1)) if hours_match else 0.0
        minutes = int(minutes_match.group(1)) if minutes_match else 0
        return round(hours * 60 + minutes)

    # Fall back to a bare number, treated as minutes
    if text.isdigit():
        return int(text)

    return None


def parse_patient_count(raw_count):
    """Extracts the first integer found in a string like '12 patients'. Returns None if unparseable."""
    if not raw_count:
        return None
    match = re.search(r"\d+", raw_count)
    return int(match.group()) if match else None


def is_wait_capped(wait_minutes):
    """True when a parsed wait sits at the source's reporting cap."""
    return wait_minutes is not None and wait_minutes >= WAIT_CAP_MINUTES


def build_hospital_record(cell_texts, facility_type):
    """Turns one table row (facility, waiting, treating, wait time) into a hospital record."""
    facility, waiting, _treating, raw_wait_time = cell_texts
    wait_minutes = parse_wait_minutes(raw_wait_time)
    return {
        "hospital_name": facility,
        "facility_type": facility_type,
        "raw_wait_time": raw_wait_time,
        "wait_time_minutes": wait_minutes,
        "wait_capped": is_wait_capped(wait_minutes),
        "patients_waiting": parse_patient_count(waiting),
    }


def scrape_source(page, facility_type, url):
    """Scrapes every facility row from one WRHA wait-times page."""
    # Navigate and wait for the network to settle
    page.goto(url, wait_until="networkidle")

    # Wait specifically for the table to appear on the page
    page.wait_for_selector("table.dcf-table")

    records = []

    # Target the specific rows inside the table body
    for row in page.query_selector_all("table.dcf-table tbody tr"):
        cells = row.query_selector_all("td")

        if len(cells) == 4:
            cell_texts = [cell.inner_text().strip() for cell in cells]
            records.append(build_hospital_record(cell_texts, facility_type))

    return records


def scrape_wait_times():
    hospitals = []
    source_errors = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # One page failing shouldn't cost us the other page's readings
        for facility_type, url in SOURCES:
            try:
                hospitals.extend(scrape_source(page, facility_type, url))
            except PlaywrightError as e:
                source_errors[url] = str(e)

        browser.close()

    # Structure the final output to match the scheduler/DB contract
    return {
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "hospitals": hospitals,
        "source_errors": source_errors,
    }


if __name__ == "__main__":
    print(json.dumps(scrape_wait_times(), indent=2))
