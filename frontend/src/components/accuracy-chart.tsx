"use client";
import { useId } from "react";
export default function MetricTrend({
  trend,
  name = "Score",
  unit = "",
}: {
  trend: Array<{ day: string; value: number }>;
  name?: string;
  unit?: string;
}) {
  const id = useId();
  const format = (v: number) =>
    unit === "fraction"
      ? `${(v * 100).toFixed(2)}%`
      : `${Number(v.toPrecision(5))}${unit === "percent" ? "%" : unit && unit !== "number" ? ` ${unit}` : ""}`;
  if (!trend.length)
    return <p className="compact-empty">No readings for this metric yet.</p>;
  const values = trend.map((p) => p.value),
    low = Math.min(...values),
    high = Math.max(...values);
  const padding = Math.max(
      Math.abs(high - low) * 0.12,
      Math.abs(high) * 0.05,
      0.01,
    ),
    min = low - padding,
    max = high + padding;
  const points = trend.map((p, i) => ({
    ...p,
    x: 85 + (trend.length === 1 ? 0.5 : i / (trend.length - 1)) * 480,
    y: 185 - ((p.value - min) / (max - min)) * 150,
  }));
  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <div className="native-trend">
      <svg
        viewBox="0 0 620 230"
        role="img"
        aria-label={`${name} over time. Readings are available below.`}
      >
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#2c8067" stopOpacity=".2" />
            <stop offset="1" stopColor="#2c8067" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1="85"
              x2="565"
              y1={185 - v * 150}
              y2={185 - v * 150}
              stroke="currentColor"
              opacity=".12"
              strokeDasharray="3 5"
            />
            <text x="0" y={189 - v * 150} fill="currentColor" fontSize="12">
              {format(min + v * (max - min))}
            </text>
          </g>
        ))}
        <polygon
          points={`${points[0].x},185 ${line} ${points.at(-1)!.x},185`}
          fill={`url(#${id})`}
        />
        <polyline
          points={line}
          fill="none"
          stroke="#2c8067"
          strokeWidth="2.5"
        />
        {points.map((p) => (
          <circle key={p.day} cx={p.x} cy={p.y} r="4" fill="#2c8067">
            <title>
              {p.day}: {format(p.value)}
            </title>
          </circle>
        ))}
        <text x="85" y="218" fill="currentColor" fontSize="12">
          {trend[0].day}
        </text>
        {trend.length > 1 && (
          <text
            x="565"
            y="218"
            textAnchor="end"
            fill="currentColor"
            fontSize="12"
          >
            {trend.at(-1)!.day}
          </text>
        )}
      </svg>
      <details className="chart-data">
        <summary>View {name} readings</summary>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>{name}</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((p) => (
              <tr key={p.day}>
                <td>{p.day}</td>
                <td>{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
