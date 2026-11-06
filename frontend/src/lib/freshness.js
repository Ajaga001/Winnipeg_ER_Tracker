// frontend/src/lib/freshness.js
// How old the scraped data is, for the header timestamp and the hospital cards.

// A reading older than this is more likely stale than accurate (roughly 3x
// the scraper's default 30-minute interval).
export const STALE_THRESHOLD_MINUTES = 90;

export function formatAge(minutes) {
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Newest scrape time across the sites that actually reported a reading.
export function newestScrape(hospitals) {
  const times = hospitals
    .filter((hospital) => hospital.scrape_status === "ok" && hospital.scraped_at)
    .map((hospital) => new Date(hospital.scraped_at).getTime())
    .filter(Number.isFinite);

  return times.length ? new Date(Math.max(...times)) : null;
}
