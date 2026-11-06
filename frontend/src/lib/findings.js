// frontend/src/lib/findings.js
// Pure helpers that shape the analysis views for the Findings charts, so chart
// headlines are worked out from the data and can't drift away from it.

// Sites below this have too little history to say anything about.
const MIN_READINGS = 30;

export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function formatHours(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  return `${(minutes / 60).toFixed(1)}h`;
}

export function formatHourOfDay(hour) {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12} ${suffix}`;
}

export function sitesWithEnoughData(capRate) {
  return capRate.filter((site) => site.readings >= MIN_READINGS);
}

// Groups heatmap rows into one entry per site, busiest site first.
export function buildHeatmapRows(heatmap) {
  const sites = new Map();
  for (const cell of heatmap) {
    const site = sites.get(cell.short_name) ?? { name: cell.short_name, readings: 0, cells: {} };
    site.readings += cell.readings;
    site.cells[cell.local_hour] = cell;
    sites.set(cell.short_name, site);
  }

  return [...sites.values()]
    .filter((site) => site.readings >= MIN_READINGS)
    .sort((a, b) => siteMean(b) - siteMean(a));
}

function siteMean(site) {
  const means = Object.values(site.cells)
    .map((cell) => cell.mean_wait_minutes)
    .filter((mean) => mean !== null);
  return means.reduce((sum, mean) => sum + mean, 0) / means.length;
}

// The hour with the lowest average wait once every site's hours are averaged together.
export function quietestHour(rows) {
  const hourlyAverage = HOURS.map((hour) => {
    const means = rows
      .map((site) => site.cells[hour]?.mean_wait_minutes)
      .filter((mean) => mean !== null && mean !== undefined);
    return { hour, average: means.reduce((sum, mean) => sum + mean, 0) / means.length };
  });

  return hourlyAverage.reduce((low, entry) => (entry.average < low.average ? entry : low));
}

// Pivots [{short_name, local_date, value}] into [{date, HSC Adult: 120, ...}].
export function buildTrendRows(trend) {
  const byDate = new Map();
  for (const row of trend) {
    const entry = byDate.get(row.local_date) ?? { date: row.local_date };
    entry[row.short_name] = row.rolling_7d_mean_minutes;
    byDate.set(row.local_date, entry);
  }
  return [...byDate.values()];
}

// Fixed by hospital id, not rank, so a site keeps its colour when the ranking changes.
export function trendSites(ranking) {
  return [...ranking].sort((a, b) => a.hospital_id - b.hospital_id).map((site) => site.short_name);
}
