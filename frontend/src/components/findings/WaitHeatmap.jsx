// frontend/src/components/findings/WaitHeatmap.jsx
// Site-by-hour grid of average waits, with brighter cells meaning longer waits.

import ChartCard from "./ChartCard";
import { HOURS, formatHourOfDay, formatHours, quietestHour } from "@/lib/findings";

// One hue, dark to light, so the longest waits stand out on the dark card.
const RAMP = ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6"];

// Too few readings to trust, so these cells stay blank rather than imply a pattern.
const MIN_CELL_READINGS = 5;

function cellColour(mean, low, high) {
  const position = (mean - low) / (high - low || 1);
  return RAMP[Math.min(RAMP.length - 1, Math.floor(position * RAMP.length))];
}

function cellLabel(site, hour, cell) {
  const time = formatHourOfDay(hour);
  if (!cell) return `${site}, ${time}: no readings`;
  const mean = formatHours(cell.mean_wait_minutes);
  return `${site}, ${time}: ${mean} average from ${cell.readings} readings`;
}

function usableMeans(rows) {
  return rows.flatMap((site) =>
    Object.values(site.cells)
      .filter((cell) => cell.readings >= MIN_CELL_READINGS && cell.mean_wait_minutes !== null)
      .map((cell) => cell.mean_wait_minutes)
  );
}

export default function WaitHeatmap({ rows }) {
  const means = usableMeans(rows);
  const low = Math.min(...means);
  const high = Math.max(...means);
  const { hour } = quietestHour(rows);

  return (
    <ChartCard
      title={`Waits are shortest around ${formatHourOfDay(hour)}`}
      subtitle="Average wait by hour of day, Winnipeg time. Readings at the 15-hour cap are left out of the average. Blank cells have fewer than 5 readings."
      columns={[
        { label: "Site", value: (row) => row.name },
        ...[0, 6, 12, 18].map((h) => ({
          label: formatHourOfDay(h),
          value: (row) => formatHours(row.cells[h]?.mean_wait_minutes),
        })),
      ]}
      rows={rows}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[110px_repeat(24,1fr)] gap-0.5 items-center">
            <span />
            {HOURS.map((h) => (
              <span key={h} className="text-[10px] text-slate-400 text-center whitespace-nowrap">
                {h % 6 === 0 ? formatHourOfDay(h) : ""}
              </span>
            ))}
            {rows.map((site) => (
              <div key={site.name} className="contents">
                <span className="text-xs text-slate-300 truncate pr-2">{site.name}</span>
                {HOURS.map((h) => {
                  const cell = site.cells[h];
                  const usable = cell && cell.readings >= MIN_CELL_READINGS && cell.mean_wait_minutes !== null;
                  return (
                    <div
                      key={h}
                      title={cellLabel(site.name, h, cell)}
                      aria-label={cellLabel(site.name, h, cell)}
                      role="img"
                      className="h-8 rounded-sm"
                      style={{ backgroundColor: usable ? cellColour(cell.mean_wait_minutes, low, high) : "#1e293b" }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3 text-[11px] text-slate-400">
            <span>{formatHours(low)}</span>
            <div className="flex">
              {RAMP.map((colour) => (
                <span key={colour} className="w-6 h-2.5" style={{ backgroundColor: colour }} />
              ))}
            </div>
            <span>{formatHours(high)}</span>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
