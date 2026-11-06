// frontend/src/components/findings/RankingChart.jsx
// Typical (p50) and bad-day (p90) waits per site.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard from "./ChartCard";
import ChartLegend from "./ChartLegend";
import ChartTooltip from "./ChartTooltip";
import { AXIS_TICK, CURSOR_FILL, GRID_COLOUR, SERIES_COLOURS, WAIT_AXIS } from "./chartTheme";
import { formatHours } from "@/lib/findings";

const [P50_COLOUR, P90_COLOUR] = SERIES_COLOURS;

export default function RankingChart({ ranking }) {
  const sites = [...ranking].sort((a, b) => a.p50_rank - b.p50_rank);
  const top = sites[0];

  return (
    <ChartCard
      title={`${top.short_name} has the longest typical wait`}
      subtitle="Half of readings fall below the median. One in ten runs above p90, which stops at the 15-hour cap."
      columns={[
        { label: "Site", value: (row) => row.short_name },
        { label: "Median", value: (row) => formatHours(row.p50_minutes) },
        { label: "p90", value: (row) => formatHours(row.p90_minutes) },
        { label: "Readings", value: (row) => row.readings },
      ]}
      rows={sites}
    >
      <ChartLegend items={[{ label: "Median (p50)", colour: P50_COLOUR }, { label: "p90", colour: P90_COLOUR }]} />
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={sites} layout="vertical" barGap={2} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={GRID_COLOUR} />
          <XAxis type="number" {...WAIT_AXIS} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="short_name" width={100} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <Tooltip cursor={CURSOR_FILL} content={<ChartTooltip formatValue={formatHours} />} />
          <Bar dataKey="p50_minutes" name="Median (p50)" fill={P50_COLOUR} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          <Bar dataKey="p90_minutes" name="p90" fill={P90_COLOUR} barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
