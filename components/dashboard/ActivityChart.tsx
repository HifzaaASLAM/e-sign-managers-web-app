"use client";

import type { ActivityPoint } from "../../lib/dashboard/serialize-docs";

type Props = {
  series: ActivityPoint[];
  totals: { sent: number; viewed: number; signed: number };
};

const COLORS = {
  sent: "#3b82f6",
  viewed: "#f59e0b",
  signed: "#22c55e",
};

function buildPath(values: number[], width: number, height: number, max: number) {
  if (values.length === 0) return "";
  const step = width / (values.length - 1 || 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = height - (max > 0 ? (v / max) * height : 0);
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}

export function ActivityChart({ series, totals }: Props) {
  const width = 720;
  const height = 120;
  const sent = series.map((p) => p.sent);
  const viewed = series.map((p) => p.viewed);
  const signed = series.map((p) => p.signed);
  const max = Math.max(5, ...sent, ...viewed, ...signed);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full" preserveAspectRatio="none">
            {[0, 0.5, 1].map((ratio) => (
              <line
                key={ratio}
                x1={0}
                y1={height * ratio}
                x2={width}
                y2={height * ratio}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
            ))}
            <path d={buildPath(sent, width, height, max)} fill="none" stroke={COLORS.sent} strokeWidth={2} />
            <path d={buildPath(viewed, width, height, max)} fill="none" stroke={COLORS.viewed} strokeWidth={2} />
            <path d={buildPath(signed, width, height, max)} fill="none" stroke={COLORS.signed} strokeWidth={2} />
          </svg>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
            <span>Last 30 days</span>
            <span className="flex gap-2">
              <button type="button" className="rounded border border-slate-200 px-2 py-0.5 hover:bg-slate-50" aria-label="Previous period">
                ‹
              </button>
              <button type="button" className="rounded border border-slate-200 px-2 py-0.5 hover:bg-slate-50" aria-label="Next period">
                ›
              </button>
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 text-sm lg:w-44">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS.sent }} />
              SENT
            </span>
            <strong className="text-slate-900">{totals.sent}</strong>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS.viewed }} />
              VIEWED
            </span>
            <strong className="text-slate-900">{totals.viewed}</strong>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS.signed }} />
              SIGNED
            </span>
            <strong className="text-slate-900">{totals.signed}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
