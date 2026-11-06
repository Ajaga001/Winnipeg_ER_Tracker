# Data Dictionary

All timestamps are stored in UTC. Local-time fields use `America/Winnipeg`. Wait times are minutes unless a name says otherwise.

## Tables

### `hospitals`

One row per site. Rarely changes.

| Column | Type | Meaning |
|---|---|---|
| `id` | integer | Primary key |
| `name` | text | Canonical name, unique. Scraped names map to this through `HOSPITAL_NAME_ALIASES` |
| `short_name` | text | Label used in charts and cards |
| `type` | text | `emergency` or `urgent_care`, which decides the WRHA page a site appears on |
| `region` | text | Health authority, currently always `WRHA` |
| `city` | text | Currently always `Winnipeg` |
| `address`, `latitude`, `longitude` | text, numeric | Reserved for mapping, not populated |
| `is_active` | boolean | `FALSE` means the source doesn't publish the site, so it gets no rows and stays off the dashboard |
| `created_at`, `updated_at` | timestamptz | Row audit times |

### `wait_times_log`

The main fact table: one row per site per scrape. Rows are appended, not edited.

| Column | Type | Meaning |
|---|---|---|
| `id` | bigint | Primary key |
| `hospital_id` | integer | Foreign key to `hospitals.id` |
| `scraped_at` | timestamptz | When the scraper ran. Unique per site, and not the time WRHA last updated its page |
| `raw_wait_time` | text | Exactly what the source showed, such as `14.25 hrs` |
| `wait_time_minutes` | integer | Parsed wait. `NULL` when nothing was posted |
| `wait_capped` | boolean | `TRUE` when the reading sits at the 15-hour ceiling, so the true wait is at least this long |
| `patients_waiting` | integer | People not yet assessed by a physician, physician assistant or nurse practitioner |
| `scrape_status` | text | See below |
| `notes` | text | Failure detail on older sentinel rows |
| `created_at` | timestamptz | Insert time |

WRHA defines the wait as the time between registering and seeing a physician, physician assistant or nurse practitioner.

| `scrape_status` | Meaning |
|---|---|
| `ok` | A real reading |
| `no_data` | The site was expected but missing from this scrape |
| `site_down`, `parse_error` | Legacy. Whole-scrape failures were once logged here against HSC Adult, and now go to `scrape_runs` |

Filter on `scrape_status = 'ok'` for any analysis. Every `no_data` row before 2026-11-06 for Concordia, Seven Oaks, Victoria and Pan Am is a placeholder, because their page wasn't being scraped.

### `scrape_runs`

The heartbeat: one row per scrape cycle, including failures. Started 2026-11-06. Readable only with the service role.

| Column | Type | Meaning |
|---|---|---|
| `id` | bigint | Primary key |
| `started_at`, `finished_at` | timestamptz | Cycle start and end |
| `status` | text | `success`, `partial` (one page failed, the other was stored) or `failed` |
| `hospitals_parsed` | integer | Sites read from the source |
| `error` | text | First 500 characters of the failure |

## Views

| View | Grain | Purpose |
|---|---|---|
| `latest_wait_times` | Site | Newest row for each active site, including `no_data` rows |
| `daily_wait_time_stats` (materialized) | Site, day | Daily counts, mean, min, max and median. Refreshed after each scrape |
| `analysis_readings` | Reading | Clean base: `ok` rows from active sites, with local date and hour |
| `analysis_hourly_heatmap` | Site, hour of day | Mean, median and reading count |
| `analysis_weekday_weekend` | Site | Hour-balanced weekday and weekend means |
| `analysis_hospital_ranking` | Site | p50, p90 and ranks, for sites with 30+ readings |
| `analysis_cap_rate` | Site | Share of readings at the cap, days affected and longest streak |
| `analysis_rolling_trend` | Site, day | Seven-day rolling mean, with gaps kept for missing days |

The `analysis_*` definitions live in [`queries/`](../queries).

## How capped readings are treated

| Measure | Capped readings | Why |
|---|---|---|
| Means | Excluded | 900 isn't the true value |
| Medians, percentiles | Included | They use rank, and "at least 900" ranks correctly |
| Forecast scoring | Excluded as targets | The true value is unknown |
