/**
 * Field Core Intelligence (Field OS) integration panel.
 *
 * Surfaces Midwater's two registered Field OS bindings:
 *   • op.eikonal.fsm  → MID_ARRIVAL_TIME      (navigation arrival-time field)
 *   • op.poisson.jacobi → MID_NAV_POTENTIAL   (steering potential)
 *
 * The grid is a coarse 2D projection: x = throughput axis,
 * y = downtime axis. Current operational state is the start cell,
 * target operational state is the goal cell. Obstacles are drawn
 * from low-feasibility physics samples.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Activity, Loader2, Radio, Waves } from 'lucide-react';
import { useFieldOs } from '@/hooks/useFieldOs';
import { getFieldOsConfig } from '@/lib/fieldOs';
import type { OperationalSnapshot } from '@/lib/operationalState';
import type { PhysicsSnapshot } from '@/lib/physicsConstrained';

const GRID = 48;

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function snapshotToCell(s: OperationalSnapshot | null): [number, number] {
  if (!s) return [Math.floor(GRID / 2), Math.floor(GRID / 2)];
  // x axis = throughput efficiency, y axis = downtime pressure
  const x = clamp01(s.throughput?.cycleEfficiency ?? s.throughput?.oee ?? 0.5);
  const downtime =
    (s.downtime?.unplannedHrs24 ?? 0) /
    Math.max(1, (s.downtime?.unplannedHrs24 ?? 0) + (s.downtime?.plannedHrs24 ?? 1));
  const y = clamp01(downtime);
  return [
    Math.min(GRID - 1, Math.max(0, Math.round(x * (GRID - 1)))),
    Math.min(GRID - 1, Math.max(0, Math.round(y * (GRID - 1)))),
  ];
}

function buildObstacles(physics: PhysicsSnapshot[]): number[] {
  const mask = new Array<number>(GRID * GRID).fill(1);
  for (const p of physics) {
    // High stress utilization (vs material yield) or high thermal load → obstacle blob.
    const yieldMPa = Math.max(1, p.material?.yieldMPa ?? 1);
    const maxServiceK = Math.max(1, p.material?.maxServiceK ?? 1);
    const stressRatio = clamp01((p.stress?.vonMisesMPa ?? 0) / yieldMPa);
    const thermalRatio = clamp01((p.thermal?.peakK ?? 0) / maxServiceK);
    if (stressRatio < 0.85 && thermalRatio < 0.85) continue;
    const cx = Math.round(stressRatio * (GRID - 1));
    const cy = Math.round(thermalRatio * (GRID - 1));
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
        mask[y * GRID + x] = 0;
      }
    }
  }
  return mask;
}

function renderField(
  canvas: HTMLCanvasElement,
  data: number[],
  w: number,
  h: number,
  palette: 'arrival' | 'potential',
  markers: Array<{ x: number; y: number; color: string }>,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  let min = Infinity, max = -Infinity;
  for (const v of data) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  for (let i = 0; i < data.length; i++) {
    const v = Number.isFinite(data[i]) ? (data[i] - min) / range : 1;
    const t = clamp01(v);
    let r: number, g: number, b: number;
    if (palette === 'arrival') {
      // teal → magenta heat
      r = Math.round(20 + 220 * t);
      g = Math.round(180 * (1 - t));
      b = Math.round(180 - 60 * t);
    } else {
      // cool potential: blue (low / attractor) → yellow (high)
      r = Math.round(40 + 200 * t);
      g = Math.round(60 + 180 * t);
      b = Math.round(220 * (1 - t) + 30);
    }
    const j = i * 4;
    img.data[j] = r;
    img.data[j + 1] = g;
    img.data[j + 2] = b;
    img.data[j + 3] = 255;
  }
  canvas.width = w;
  canvas.height = h;
  ctx.putImageData(img, 0, 0);
  // markers
  for (const m of markers) {
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(m.x + 0.5, m.y + 0.5, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

type Props = {
  current: OperationalSnapshot | null;
  target: OperationalSnapshot | null;
  physics: PhysicsSnapshot[];
};

export function FieldOsPanel({ current, target, physics }: Props) {
  const fos = useFieldOs();
  const arrivalRef = useRef<HTMLCanvasElement>(null);
  const potentialRef = useRef<HTMLCanvasElement>(null);

  const source = useMemo(() => snapshotToCell(current), [current]);
  const goal = useMemo(() => snapshotToCell(target), [target]);
  const obstacles = useMemo(() => buildObstacles(physics), [physics]);

  const reachable = !!fos.health && !fos.healthError;

  useEffect(() => {
    if (fos.result && arrivalRef.current) {
      renderField(
        arrivalRef.current,
        fos.result.arrival.field.data,
        fos.result.arrival.field.w,
        fos.result.arrival.field.h,
        'arrival',
        [
          { x: source[0], y: source[1], color: '#fff' },
          { x: goal[0], y: goal[1], color: '#22d3ee' },
        ],
      );
    }
    if (fos.result && potentialRef.current) {
      renderField(
        potentialRef.current,
        fos.result.potential.field.data,
        fos.result.potential.field.w,
        fos.result.potential.field.h,
        'potential',
        [
          { x: source[0], y: source[1], color: '#fff' },
          { x: goal[0], y: goal[1], color: '#22d3ee' },
        ],
      );
    }
  }, [fos.result, source, goal]);

  const onRun = () =>
    fos.runNavigation({
      w: GRID,
      h: GRID,
      source,
      target: goal,
      obstacles,
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Waves className="h-4 w-4 text-primary" />
                Field Core Intelligence
                <Badge variant="outline" className="font-mono text-[10px]">
                  Field OS
                </Badge>
              </CardTitle>
              <CardDescription>
                Routes Midwater's navigation queries through Field OS operators:
                <span className="font-mono"> op.eikonal.fsm</span> →{' '}
                <span className="font-mono">MID_ARRIVAL_TIME</span>,{' '}
                <span className="font-mono">op.poisson.jacobi</span> →{' '}
                <span className="font-mono">MID_NAV_POTENTIAL</span>.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Radio className={`h-3.5 w-3.5 ${reachable ? 'text-emerald-400' : 'text-amber-400'}`} />
              <span className="font-mono text-muted-foreground">
                {reachable ? `online · v${fos.health?.version ?? '?'}` : 'offline'}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!reachable && (
            <Alert variant="destructive">
              <AlertTitle>Field OS API unreachable</AlertTitle>
              <AlertDescription className="space-y-2 text-xs">
                <p>{fos.healthError ?? 'No /api/health response.'}</p>
                <p>
                  Set <code className="font-mono">VITE_FIELD_OS_URL</code> to the published Field Core
                  Intelligence URL, and ensure its <code>/api/op/*</code> routes are deployed.
                </p>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground font-mono">
            <span>
              source ({source[0]},{source[1]})
            </span>
            <span>
              target ({goal[0]},{goal[1]})
            </span>
            <span>
              obstacles {obstacles.filter((v) => v === 0).length} cells
            </span>
            <Button
              size="sm"
              onClick={onRun}
              disabled={fos.loading || !current || !target}
              className="ml-auto"
            >
              {fos.loading ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Solving
                </>
              ) : (
                <>
                  <Activity className="mr-2 h-3.5 w-3.5" />
                  Run Field OS solve
                </>
              )}
            </Button>
          </div>

          {fos.error && (
            <Alert variant="destructive">
              <AlertDescription className="text-xs font-mono">{fos.error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground font-mono">
                MID_ARRIVAL_TIME · eikonal |∇T|=1/F
              </div>
              <div className="rounded-md border border-border/60 bg-card/50 p-2">
                <canvas
                  ref={arrivalRef}
                  className="w-full h-auto image-render-pixel"
                  style={{ imageRendering: 'pixelated', aspectRatio: '1 / 1' }}
                />
              </div>
              {fos.result && (
                <div className="text-[11px] font-mono text-muted-foreground">
                  T ∈ [{fos.result.arrival.stats.min.toFixed(2)},{' '}
                  {fos.result.arrival.stats.max.toFixed(2)}] · sweeps{' '}
                  {fos.result.arrival.stats.sweeps}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground font-mono">
                MID_NAV_POTENTIAL · Δu = f (Jacobi)
              </div>
              <div className="rounded-md border border-border/60 bg-card/50 p-2">
                <canvas
                  ref={potentialRef}
                  className="w-full h-auto"
                  style={{ imageRendering: 'pixelated', aspectRatio: '1 / 1' }}
                />
              </div>
              {fos.result && (
                <div className="text-[11px] font-mono text-muted-foreground">
                  iter {fos.result.potential.stats.iterations} · residual{' '}
                  {fos.result.potential.stats.residual.toExponential(2)}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
