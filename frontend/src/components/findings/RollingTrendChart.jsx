// frontend/src/components/findings/RollingTrendChart.jsx
// Seven-day rolling average wait per site. Scraper outages stay as gaps.

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard from "./ChartCard";
import ChartLegend from "./ChartLegend";
import ChartTooltip from "./ChartTooltip";
import { AXIS_TICK, GRID_COLOUR, SERIES_COLOURS, WAIT_AXIS } from "./chartTheme";
import { formatHours } from "@/lib/findings";

// local_date is a calendar date, so parse it as local time rather than UTC.
function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export default function RollingTrendChart({ rows, sites }) {
  const series = sites.map((name, i) => ({ label: name, colour: SERIES_COLOURS[i] }));

  return (
    <ChartCard
      title="Seven-day average wait over time"
      subtitle="Gaps mean too little data, including the outage from Oct 26 to Nov 6, when the scraper's schedule was switched off."
      columns={[
        { label: "Week ending", value: (row) => formatDate(row.date) },
        ...series.map((site) => ({ label: site.label, value: (row) => formatHours(row[site.label]) })),
      ]}
      rows={rows.filter((_, i) => (rows.length - 1 - i) % 7 === 0)}
    >
      <ChartLegend items={series} />
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_COLOUR} />
          <XAxis dataKey="date" tickFormatter={formatDate} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={48} />
          <YAxis {...WAIT_AXIS} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={<ChartTooltip formatValue={formatHours} formatLabel={formatDate} />} />
          {series.map((site) => (
            <Line
              key={site.label}
              dataKey={site.label}
              name={site.label}
              stroke={site.colour}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
