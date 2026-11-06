// frontend/src/components/findings/ChartCard.jsx
// Shared frame for a Findings chart: the takeaway as a title, then the chart,
// then the same numbers as a table for anyone who can't read the chart.

import { Card } from "@/components/ui/card";

export default function ChartCard({ title, subtitle, columns, rows, children }) {
  return (
    <Card className="gap-0 border-slate-700/50 bg-slate-800/70 p-5">
      <h3 className="text-slate-100 font-semibold text-base">{title}</h3>
      {subtitle && <p className="text-slate-400 text-xs mt-1 mb-4">{subtitle}</p>}
      {children}
      <details className="mt-4 text-xs text-slate-400">
        <summary className="cursor-pointer hover:text-slate-200">View as table</summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-700">
                {columns.map((column) => (
                  <th key={column.label} scope="col" className="py-1.5 pr-4 font-medium">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-800">
                  {columns.map((column) => (
                    <td key={column.label} className="py-1.5 pr-4 tabular-nums text-slate-300">
                      {column.value(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}
