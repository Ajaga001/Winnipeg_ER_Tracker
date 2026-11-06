import pandas as pd

from analysis.forecast import HORIZON, add_features, time_split, value_at_lag


def readings(times, waits, hospital_id=1):
    return pd.DataFrame(
        {
            "hospital_id": hospital_id,
            "scraped_at": pd.to_datetime(times, utc=True),
            "wait_time_minutes": waits,
        }
    )


def test_last_week_lookup_finds_the_nearest_reading_within_tolerance():
    df = readings(["2026-10-01 12:30", "2026-10-08 12:00"], [100, 200])

    assert value_at_lag(df, pd.Timedelta(days=7))[1] == 100


def test_last_week_lookup_is_empty_when_nothing_is_close():
    df = readings(["2026-10-01 06:00", "2026-10-08 12:00"], [100, 200])

    assert pd.isna(value_at_lag(df, pd.Timedelta(days=7))[1])


def test_lag_lookup_stays_within_one_hospital():
    df = pd.concat(
        [
            readings(["2026-10-01 12:00"], [100], hospital_id=2),
            readings(["2026-10-08 12:00"], [200], hospital_id=1),
        ],
        ignore_index=True,
    )

    assert pd.isna(value_at_lag(df, pd.Timedelta(days=7))).all()


def test_yesterday_feature_never_uses_a_reading_newer_than_the_horizon():
    # The 23-hour-old reading is the closest match but wouldn't exist yet at forecast time.
    df = readings(["2026-10-07 11:00", "2026-10-07 13:00", "2026-10-08 12:00"], [100, 999, 200])

    assert add_features(df)["wait_yesterday"].iloc[2] == 100


def test_time_split_leaves_a_gap_so_test_rows_cannot_leak():
    times = pd.date_range("2026-09-01", periods=400, freq="3h", tz="UTC")
    df = pd.DataFrame({"scraped_at": times, "wait_time_minutes": range(400)})

    train, test = time_split(df)

    assert train["scraped_at"].max() < test["scraped_at"].min() - HORIZON + pd.Timedelta(hours=3)
    assert len(train) + len(test) < len(df)
