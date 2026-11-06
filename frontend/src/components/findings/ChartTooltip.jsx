// frontend/src/components/findings/ChartTooltip.jsx
// Tooltip for the Recharts charts on the Findings page.

export default function ChartTooltip({ active, payload, label, formatLabel, formatValue }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-slate-900 border border-slate-600 rounded-lg p-3 shadow-xl text-xs min-w-[150px]">
      <p className="text-slate-400 mb-2 font-medium">{formatLabel ? formatLabel(label) : label}</p>
      {payload
        .filter((entry) => entry.value !== null && entry.value !== undefined)
        .map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}
            </span>
            <span className="text-white font-mono">{formatValue(entry.value)}</span>
          </div>
        ))}
    </div>
  );
}
