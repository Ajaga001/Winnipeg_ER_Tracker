// frontend/src/components/findings/CapRateChart.jsx
// Share of each site's readings that sit at the 15-hour reporting ceiling.

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard from "./ChartCard";
import ChartTooltip from "./ChartTooltip";
import { AXIS_TICK, CURSOR_FILL, GRID_COLOUR, SERIES_COLOURS } from "./chartTheme";

const formatPercent = (value) => `${value}%`;

export default function CapRateChart({ sites }) {
  const sorted = [...sites].sort((a, b) => b.cap_rate_pct - a.cap_rate_pct);
  const top = sorted[0];

  return (
    <ChartCard
      title={`${top.short_name} hit the 15-hour ceiling in ${top.cap_rate_pct}% of readings`}
      subtitle="The source never reports above 15 hours, so these waits could be longer than shown."
      columns={[
        { label: "Site", value: (row) => row.short_name },
        { label: "Cap rate", value: (row) => formatPercent(row.cap_rate_pct) },
        { label: "Capped readings", value: (row) => row.capped_readings },
        { label: "Days affected", value: (row) => row.days_with_cap },
        { label: "Longest streak", value: (row) => row.longest_capped_streak },
      ]}
      rows={sorted}
    >
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={GRID_COLOUR} />
          <XAxis type="number" tickFormatter={formatPercent} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="short_name" width={100} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <Tooltip cursor={CURSOR_FILL} content={<ChartTooltip formatValue={formatPercent} />} />
          <Bar dataKey="cap_rate_pct" name="Cap rate" fill={SERIES_COLOURS[0]} barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList dataKey="cap_rate_pct" position="right" formatter={formatPercent} fill="#cbd5e1" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
