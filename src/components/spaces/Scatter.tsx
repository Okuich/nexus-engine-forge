/**
 * Scatter — generic 2D projection of vector-space points.
 *
 * Lightweight SVG renderer with deterministic point shapes per kind.
 * Trajectories are drawn as polylines connecting projected points.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

export interface ScatterPoint {
  id: string;
  /** Normalized x and y in [0,1]. */
  x: number;
  y: number;
  /** Logical category — drives color. */
  kind?: string;
  label?: string;
  radius?: number;
  highlight?: boolean;
}

export interface ScatterTrajectory {
  id: string;
  pointIds: string[];
  color?: string;
  label?: string;
}

export interface ScatterRegion {
  id: string;
  cx: number;
  cy: number;
  r: number;
  kind: string;
  label?: string;
}

interface ScatterProps {
  points: ScatterPoint[];
  trajectories?: ScatterTrajectory[];
  regions?: ScatterRegion[];
  xLabel?: string;
  yLabel?: string;
  className?: string;
  /** Color map kind → CSS color (hsl tokens). */
  colorMap?: Record<string, string>;
}

const DEFAULT_COLORS: Record<string, string> = {
  default: 'hsl(var(--primary))',
  stable: 'hsl(var(--primary))',
  optimal: 'hsl(142 70% 50%)',
  inefficient: 'hsl(38 92% 55%)',
  failure: 'hsl(var(--destructive))',
  current: 'hsl(var(--accent))',
  target: 'hsl(142 70% 50%)',
  safe: 'hsl(142 70% 50%)',
  caution: 'hsl(38 92% 55%)',
  unsafe: 'hsl(var(--destructive))',
  cnc: 'hsl(210 90% 60%)',
  'injection-molding': 'hsl(280 70% 60%)',
  additive: 'hsl(160 70% 50%)',
  'sheet-metal': 'hsl(38 92% 55%)',
  casting: 'hsl(0 0% 65%)',
};

export function Scatter({
  points,
  trajectories = [],
  regions = [],
  xLabel,
  yLabel,
  className,
  colorMap,
}: ScatterProps) {
  const colors = { ...DEFAULT_COLORS, ...(colorMap ?? {}) };
  const idMap = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const W = 100;
  const H = 60;
  const px = (x: number) => 4 + x * (W - 8);
  const py = (y: number) => H - 4 - y * (H - 8);

  return (
    <div className={cn('relative w-full', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Metric space projection"
      >
        {/* Grid */}
        <g stroke="hsl(var(--border))" strokeWidth={0.1} opacity={0.4}>
          {Array.from({ length: 5 }).map((_, i) => (
            <line key={`vx${i}`} x1={px(i / 4)} y1={py(0)} x2={px(i / 4)} y2={py(1)} />
          ))}
          {Array.from({ length: 5 }).map((_, i) => (
            <line key={`vy${i}`} x1={px(0)} y1={py(i / 4)} x2={px(1)} y2={py(i / 4)} />
          ))}
        </g>

        {/* Regions */}
        {regions.map((r) => {
          const color = colors[r.kind] ?? colors.default;
          return (
            <g key={r.id}>
              <circle
                cx={px(r.cx)}
                cy={py(r.cy)}
                r={Math.max(2, r.r * 30)}
                fill={color}
                opacity={0.12}
                stroke={color}
                strokeWidth={0.2}
                strokeDasharray="0.5 0.5"
              />
            </g>
          );
        })}

        {/* Trajectories */}
        {trajectories.map((t) => {
          const pts = t.pointIds.map((id) => idMap.get(id)).filter(Boolean) as ScatterPoint[];
          if (pts.length < 2) return null;
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.x)} ${py(p.y)}`).join(' ');
          return (
            <g key={t.id}>
              <path d={d} fill="none" stroke={t.color ?? 'hsl(var(--accent))'} strokeWidth={0.5} strokeLinecap="round" />
              {pts.slice(1).map((p, i) => {
                const prev = pts[i];
                const mx = (px(prev.x) + px(p.x)) / 2;
                const my = (py(prev.y) + py(p.y)) / 2;
                return (
                  <polygon
                    key={`arrow-${t.id}-${i}`}
                    points={`${mx},${my} ${mx - 0.8},${my - 0.6} ${mx - 0.8},${my + 0.6}`}
                    fill={t.color ?? 'hsl(var(--accent))'}
                    opacity={0.7}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Points */}
        {points.map((p) => {
          const color = colors[p.kind ?? 'default'] ?? colors.default;
          const r = p.radius ?? 0.7;
          return (
            <g key={p.id}>
              {p.highlight && (
                <circle cx={px(p.x)} cy={py(p.y)} r={r * 2.2} fill="none" stroke={color} strokeWidth={0.25} opacity={0.6} />
              )}
              <circle cx={px(p.x)} cy={py(p.y)} r={r} fill={color} opacity={p.highlight ? 1 : 0.85} />
            </g>
          );
        })}
      </svg>
      {(xLabel || yLabel) && (
        <div className="absolute inset-0 pointer-events-none text-[10px] text-muted-foreground">
          {xLabel && <span className="absolute bottom-1 right-2">{xLabel}</span>}
          {yLabel && <span className="absolute top-1 left-2 -rotate-90 origin-top-left translate-y-3">{yLabel}</span>}
        </div>
      )}
    </div>
  );
}
