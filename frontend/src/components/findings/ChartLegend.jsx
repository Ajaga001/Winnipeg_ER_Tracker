// frontend/src/components/findings/ChartLegend.jsx
// Series key shown above a chart, so identity never rests on hovering.

export default function ChartLegend({ items }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-slate-300">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.colour }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
