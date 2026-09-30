"use client";
import { useId } from "react";
export default function AccuracyChart({
  trend,
}: {
  trend: Array<{ day: string; value: number }>;
}) {
  const id = useId();
  const max = Math.max(100, ...trend.map((p) => p.value));
  const points = trend.map((p, i) => ({
    x: 48 + (trend.length === 1 ? 0.5 : i / (trend.length - 1)) * 530,
    y: 190 - (p.value / max) * 155,
    ...p,
  }));
  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <div className="native-trend">
      <svg
        viewBox="0 0 620 230"
        role="img"
        aria-label={`Best daily accuracy: ${trend.map((p) => `${p.day}: ${p.value.toFixed(1)}%`).join(", ")}`}
      >
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#2c8067" stopOpacity=".16" />
            <stop offset="1" stopColor="#2c8067" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1="48"
              x2="580"
              y1={190 - v * 155}
              y2={190 - v * 155}
              stroke="#e6e9e3"
              strokeDasharray="3 5"
            />
            <text x="0" y={194 - v * 155} fill="#78847c" fontSize="11">
              {Math.round(v * max)}%
            </text>
          </g>
        ))}
        <polygon
          points={`${points[0]?.x},190 ${line} ${points.at(-1)?.x},190`}
          fill={`url(#${id})`}
        />
        <polyline
          points={line}
          fill="none"
          stroke="#27785f"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {points.map((p) => (
          <circle
            key={p.day}
            cx={p.x}
            cy={p.y}
            r="4"
            fill="#27785f"
            stroke="white"
            strokeWidth="2"
          >
            <title>
              {p.day}: {p.value.toFixed(1)}%
            </title>
          </circle>
        ))}
        <text x="48" y="221" fill="#78847c" fontSize="11">
          {trend[0]?.day}
        </text>
        {trend.length > 1 && (
          <text x="580" y="221" textAnchor="end" fill="#78847c" fontSize="11">
            {trend.at(-1)?.day}
          </text>
        )}
      </svg>
      <details className="chart-data">
        <summary>View daily scores</summary>
        <dl>
          {trend.map((p) => (
            <div key={p.day}>
              <dt>{p.day}</dt>
              <dd>{p.value.toFixed(1)}%</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
