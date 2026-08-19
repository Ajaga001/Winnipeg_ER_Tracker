import json
import re
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

# Pointing to the live emergency department data
WAIT_TIMES_URL = "https://wrha.mb.ca/wait-times/emergency/"


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


def scrape_wait_times():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate and wait for the network to settle
        page.goto(WAIT_TIMES_URL, wait_until="networkidle")

        # Wait specifically for the table to appear on the page
        page.wait_for_selector("table.dcf-table")

        hospitals = []

        # Target the specific rows inside the table body
        rows = page.query_selector_all("table.dcf-table tbody tr")

        for row in rows:
            # Extract the four data compartments found in the HTML:
            # facility name, patients waiting, patients being treated, wait time
            cells = row.query_selector_all("td")

            if len(cells) == 4:
                facility = cells[0].inner_text().strip()
                waiting = cells[1].inner_text().strip()
                raw_wait_time = cells[3].inner_text().strip()

                hospitals.append({
                    "hospital_name": facility,
                    "raw_wait_time": raw_wait_time,
                    "wait_time_minutes": parse_wait_minutes(raw_wait_time),
                    "patients_waiting": parse_patient_count(waiting),
                })

        browser.close()

        # Structure the final output to match the scheduler/DB contract
        result = {
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "source_url": WAIT_TIMES_URL,
            "hospitals": hospitals,
        }

        print(json.dumps(result, indent=2))
        return result


if __name__ == "__main__":
    scrape_wait_times()
