// frontend/src/components/findings/WeekdayWeekendChart.jsx
// Hour-balanced average wait on weekdays against weekends, per site.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard from "./ChartCard";
import ChartLegend from "./ChartLegend";
import ChartTooltip from "./ChartTooltip";
import { AXIS_TICK, CURSOR_FILL, GRID_COLOUR, SERIES_COLOURS, WAIT_AXIS } from "./chartTheme";
import { formatHours } from "@/lib/findings";

const [WEEKDAY_COLOUR, WEEKEND_COLOUR] = SERIES_COLOURS;

export default function WeekdayWeekendChart({ sites }) {
  const longerOnWeekends = sites.filter((site) => site.weekend_minus_weekday_minutes > 0).length;

  return (
    <ChartCard
      title={`${longerOnWeekends} of ${sites.length} sites run longer on weekends`}
      subtitle="Each hour of the day counts equally, so uneven scraping doesn't tilt the comparison. Differences under an hour are small next to normal swings."
      columns={[
        { label: "Site", value: (row) => row.short_name },
        { label: "Weekday", value: (row) => formatHours(row.weekday_mean_minutes) },
        { label: "Weekend", value: (row) => formatHours(row.weekend_mean_minutes) },
        { label: "Difference (min)", value: (row) => row.weekend_minus_weekday_minutes },
      ]}
      rows={sites}
    >
      <ChartLegend items={[{ label: "Weekday", colour: WEEKDAY_COLOUR }, { label: "Weekend", colour: WEEKEND_COLOUR }]} />
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={sites} barGap={2} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_COLOUR} />
          <XAxis dataKey="short_name" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
          <YAxis {...WAIT_AXIS} tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
          <Tooltip cursor={CURSOR_FILL} content={<ChartTooltip formatValue={formatHours} />} />
          <Bar dataKey="weekday_mean_minutes" name="Weekday" fill={WEEKDAY_COLOUR} barSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="weekend_mean_minutes" name="Weekend" fill={WEEKEND_COLOUR} barSize={16} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
