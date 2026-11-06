from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

from scrape_wait_times import (
    build_hospital_record,
    is_wait_capped,
    parse_patient_count,
    parse_rows,
    parse_wait_minutes,
)

FIXTURE = Path(__file__).parent / "fixtures" / "emergency_table.html"


@pytest.mark.parametrize(
    ("raw", "minutes"),
    [
        ("15 hrs", 900),
        ("14.75 hrs", 885),
        ("3.5 hrs", 210),
        ("2h 15m", 135),
        ("45m", 45),
        ("90", 90),
        ("n/a", None),
        ("Closed", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_wait_minutes(raw, minutes):
    assert parse_wait_minutes(raw) == minutes


@pytest.mark.parametrize(("raw", "count"), [("58", 58), ("12 patients", 12), ("--", None), (None, None)])
def test_parse_patient_count(raw, count):
    assert parse_patient_count(raw) == count


@pytest.mark.parametrize(("minutes", "capped"), [(900, True), (885, False), (0, False), (None, False)])
def test_is_wait_capped(minutes, capped):
    assert is_wait_capped(minutes) is capped


def test_build_hospital_record_keeps_raw_value_and_flags_cap():
    record = build_hospital_record(["Grace Hospital", "16", "54", "15 hrs"], "emergency")

    assert record == {
        "hospital_name": "Grace Hospital",
        "facility_type": "emergency",
        "raw_wait_time": "15 hrs",
        "wait_time_minutes": 900,
        "wait_capped": True,
        "patients_waiting": 16,
    }


def test_parse_rows_reads_saved_page_and_skips_malformed_rows():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content(FIXTURE.read_text(encoding="utf-8"))
        records = parse_rows(page, "emergency")
        browser.close()

    assert [record["hospital_name"] for record in records] == [
        "St. Boniface Hospital",
        "Health Sciences Centre - Children's",
    ]
    assert records[0]["wait_capped"] is True
    assert records[1]["wait_time_minutes"] == 210
