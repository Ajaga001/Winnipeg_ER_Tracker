"""
forecast.py
-----------
Can a model predict tomorrow's wait better than "same time last week"?

Both forecasts are made from information at least 24 hours old, so neither sees
the current queue. Results are scored on the same held-out readings, taken from
the end of the history so the model is never trained on the future.

Usage: python analysis/forecast.py
Writes analysis/forecast_results.json. See requirements-analysis.txt.
"""

import json
import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from supabase import create_client

RESULTS_PATH = Path(__file__).parent / "forecast_results.json"
LOCAL_TIMEZONE = "America/Winnipeg"
PAGE_SIZE = 1000

HORIZON = pd.Timedelta(hours=24)
WEEK = pd.Timedelta(days=7)
# Snapshots are irregular, so a past reading counts if it's within this of the target time.
MATCH_TOLERANCE = pd.Timedelta(hours=2)

TEST_SHARE = 0.25
MIN_SITE_READINGS = 30
FEATURES = [
    "hospital_id", "hour", "weekday", "is_weekend",
    "wait_last_week", "wait_yesterday", "site_recent_mean",
]


def fetch_readings(client):
    """Pages through every valid reading, since Supabase caps a response at 1000 rows."""
    rows, start = [], 0
    while True:
        page = (
            client.table("wait_times_log")
            .select("hospital_id, scraped_at, wait_time_minutes, wait_capped")
            .eq("scrape_status", "ok")
            .not_.is_("wait_time_minutes", "null")
            .order("id")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
            .data
        )
        rows += page
        if len(page) < PAGE_SIZE:
            return pd.DataFrame(rows)
        start += PAGE_SIZE


def prepare_readings(raw):
    """Parses timestamps, adds local time parts, and drops sites with too little history."""
    df = raw.copy()
    df["scraped_at"] = pd.to_datetime(df["scraped_at"], utc=True, format="ISO8601")
    local = df["scraped_at"].dt.tz_convert(LOCAL_TIMEZONE)
    df["hour"] = local.dt.hour
    df["weekday"] = local.dt.day_of_week
    df["is_weekend"] = (df["weekday"] >= 5).astype(int)

    counts = df.groupby("hospital_id")["scraped_at"].transform("count")
    return df[counts >= MIN_SITE_READINGS].sort_values("scraped_at").reset_index(drop=True)


def value_at_lag(df, lag, direction="nearest"):
    """Each reading's same-site value from `lag` earlier, or NaN if none is close enough."""
    targets = df[["hospital_id", "scraped_at"]].assign(lookup_time=df["scraped_at"] - lag)
    history = df[["hospital_id", "scraped_at", "wait_time_minutes"]].rename(
        columns={"scraped_at": "lookup_time", "wait_time_minutes": "lagged"}
    )
    matched = pd.merge_asof(
        targets.sort_values("lookup_time"),
        history.sort_values("lookup_time"),
        on="lookup_time",
        by="hospital_id",
        direction=direction,
        tolerance=MATCH_TOLERANCE,
    )
    keyed = df[["hospital_id", "scraped_at"]].merge(matched, on=["hospital_id", "scraped_at"], how="left")
    return keyed["lagged"].to_numpy()


def recent_mean(df, window="7D"):
    """Each site's average over the window ending one horizon before the reading."""
    indexed = df.set_index("scraped_at").sort_index()
    rolling = (
        indexed.groupby("hospital_id")["wait_time_minutes"]
        .rolling(window)
        .mean()
        .reset_index()
        .rename(columns={"scraped_at": "available_at", "wait_time_minutes": "site_recent_mean"})
    )
    targets = df[["hospital_id", "scraped_at"]].assign(available_at=df["scraped_at"] - HORIZON)
    matched = pd.merge_asof(
        targets.sort_values("available_at"),
        rolling.sort_values("available_at"),
        on="available_at",
        by="hospital_id",
        direction="backward",
    )
    keyed = df[["hospital_id", "scraped_at"]].merge(matched, on=["hospital_id", "scraped_at"], how="left")
    return keyed["site_recent_mean"].to_numpy()


def add_features(df):
    """Adds lag features. Every one is at least 24 hours old at prediction time."""
    out = df.copy()
    out["wait_last_week"] = value_at_lag(df, WEEK)
    # "backward" so a reading from 23 hours ago can't slip in as yesterday's value
    out["wait_yesterday"] = value_at_lag(df, HORIZON, direction="backward")
    out["site_recent_mean"] = recent_mean(df)
    return out


def time_split(df, test_share=TEST_SHARE):
    """Splits by time: the newest readings are the test set, with a horizon-long gap
    so no training row sits close enough to a test row to leak into its features."""
    ordered = df.sort_values("scraped_at")
    cutoff = ordered["scraped_at"].quantile(1 - test_share)
    train = ordered[ordered["scraped_at"] < cutoff - HORIZON]
    test = ordered[ordered["scraped_at"] >= cutoff]
    return train, test


def evaluate(df):
    """Scores the baseline and the model on the same uncapped, comparable test readings."""
    usable = df.dropna(subset=["wait_last_week"])
    train, test = time_split(usable)

    # A capped target's true value is unknown, so neither forecast can be scored on it.
    scored = test[~test["wait_capped"]]

    model = RandomForestRegressor(n_estimators=300, min_samples_leaf=5, random_state=42, n_jobs=-1)
    medians = train[FEATURES].median()
    model.fit(train[FEATURES].fillna(medians), train["wait_time_minutes"])
    predictions = model.predict(scored[FEATURES].fillna(medians))

    baseline_mae = mean_absolute_error(scored["wait_time_minutes"], scored["wait_last_week"])
    model_mae = mean_absolute_error(scored["wait_time_minutes"], predictions)

    by_site = (
        scored.assign(
            baseline_error=(scored["wait_time_minutes"] - scored["wait_last_week"]).abs(),
            model_error=(scored["wait_time_minutes"] - predictions).abs(),
        )
        .groupby("hospital_id")[["baseline_error", "model_error"]]
        .mean()
        .round(1)
    )

    return {
        "horizon_hours": HORIZON.total_seconds() / 3600,
        "train_readings": len(train),
        "test_readings_scored": len(scored),
        "test_readings_capped_excluded": int(test["wait_capped"].sum()),
        "train_period": [str(train["scraped_at"].min().date()), str(train["scraped_at"].max().date())],
        "test_period": [str(test["scraped_at"].min().date()), str(test["scraped_at"].max().date())],
        "baseline_mae_minutes": round(float(baseline_mae), 1),
        "model_mae_minutes": round(float(model_mae), 1),
        "improvement_pct": round(float(100 * (baseline_mae - model_mae) / baseline_mae), 1),
        "mae_by_hospital_id": {str(k): v for k, v in by_site.to_dict("index").items()},
        "feature_importance": dict(
            sorted(
                ((f, round(float(i), 3)) for f, i in zip(FEATURES, model.feature_importances_)),
                key=lambda item: item[1],
                reverse=True,
            )
        ),
    }


def main():
    load_dotenv()
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    readings = prepare_readings(fetch_readings(client))
    results = evaluate(add_features(readings))

    RESULTS_PATH.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
