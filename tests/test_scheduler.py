from unittest import mock

import pytest

import scheduler

SCRAPED_AT = "2026-11-06T00:00:00+00:00"
GRACE = {
    "hospital_name": "Grace Hospital",
    "facility_type": "emergency",
    "raw_wait_time": "15 hrs",
    "wait_time_minutes": 900,
    "wait_capped": True,
    "patients_waiting": 3,
}


@pytest.fixture(autouse=True)
def hospital_cache(monkeypatch):
    monkeypatch.setattr(
        scheduler,
        "_hospital_cache",
        {
            "Health Sciences Centre - Adult Emergency": 1,
            "Grace Hospital": 3,
            "Concordia Hospital": 5,
            "Pan Am Clinic Urgent Care": 8,
        },
    )
    monkeypatch.setattr(scheduler, "_active_hospital_ids", {1, 3, 5})


def test_alias_resolves_to_canonical_hospital_without_a_stub():
    client = mock.Mock()

    hospital_id = scheduler.get_hospital_id(client, "Health Sciences Centre - Adult", "emergency")

    assert hospital_id == 1
    client.table.assert_not_called()


def test_unknown_hospital_gets_a_stub_with_the_scraped_type():
    client = mock.Mock()
    insert = client.table.return_value.insert
    insert.return_value.execute.return_value.data = [{"id": 9}]

    hospital_id = scheduler.get_hospital_id(client, "New Urgent Care", "urgent_care")

    assert hospital_id == 9
    assert insert.call_args.args[0]["type"] == "urgent_care"
    assert 9 in scheduler._active_hospital_ids


def test_build_rows_flags_missing_active_sites_only():
    rows = {row["hospital_id"]: row for row in scheduler.build_rows(mock.Mock(), SCRAPED_AT, [GRACE])}

    assert rows[3]["scrape_status"] == "ok" and rows[3]["wait_capped"] is True
    assert rows[1]["scrape_status"] == "no_data"
    assert rows[5]["scrape_status"] == "no_data"
    assert 8 not in rows, "retired sites must not get sentinel rows"


@pytest.mark.parametrize(
    ("status", "expected"),
    [("success", True), ("partial", False), ("failed", False)],
)
def test_only_a_full_success_counts_as_success(status, expected):
    with (
        mock.patch.object(scheduler, "run_cycle", return_value=scheduler.CycleResult(status)),
        mock.patch.object(scheduler, "record_run"),
    ):
        assert scheduler.run_scrape_and_store() is expected


def test_failed_scrape_is_recorded_and_stores_no_readings():
    client = mock.Mock()
    snapshot = {"scraped_at": SCRAPED_AT, "hospitals": [], "source_errors": {"url": "timeout"}}

    with (
        mock.patch.object(scheduler, "scrape_wait_times", return_value=snapshot),
        mock.patch.object(scheduler, "get_supabase_client", return_value=client),
    ):
        assert scheduler.run_scrape_and_store() is False

    client.table.assert_called_once_with("scrape_runs")
    assert client.table.return_value.insert.call_args.args[0]["status"] == "failed"
