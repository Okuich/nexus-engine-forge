/**
 * Operational State Space panel.
 *
 * Plots the tenant's historical operational snapshots in a 2D
 * projection, highlights the current state, draws the optimization
 * trajectory toward the chosen target, and lists the nearest
 * historical neighbors.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  findOptimalPath,
  type OptimizationGoal,
} from '@/lib/optimizationGeometry';
import {
  OperationalStateEngine,
  type OperationalSnapshot,
} from '@/lib/operationalState';
import {
  AutonomousNavigationEngine,
  type BasinKind,
} from '@/lib/autonomousNavigation';
import { Scatter, type ScatterPoint, type ScatterRegion, type ScatterTrajectory } from './Scatter';
import { project2D } from './project';

interface Props {
  tenantId: string;
  history: OperationalSnapshot[];
  current: OperationalSnapshot | null;
  target: OperationalSnapshot | null;
  goal: OptimizationGoal;
}

export function OperationalSpacePanel({ tenantId, history, current, target, goal }: Props) {
  const data = useMemo(() => {
    if (!current || history.length === 0) return null;
    const nav = new AutonomousNavigationEngine({ config: { minBasinSize: 2, basinRadius: 0.25 } });
    for (const h of history) nav.ingest(h);
    nav.updateMetrics();
    const basins = nav.basinsSnapshot();

    const states = new OperationalStateEngine();
    for (const h of history) states.ingest(h, {});
    const similar = states.findSimilarStates(current, { k: 5, tenantId });
    const currentVec = states.embed(current);

    const path = target ? findOptimalPath(current, target, { goal }) : null;

    // Project everything together so positions are comparable.
    const items: { id: string; vec: Float32Array; meta: Record<string, unknown> }[] = history.map((h) => {
      const v = states.embed(h);
      return { id: v.id, vec: v.vector, meta: { snapshot: h, kind: 'history' } };
    });
    const projected = project2D(`op-${tenantId}`, items.map((i) => ({ id: i.id, vec: i.vec })));
    const map = new Map(projected.map((p) => [p.id, p]));

    const points: ScatterPoint[] = items.map((it, i) => {
      const p = map.get(it.id)!;
      return {
        id: it.id,
        x: p.x,
        y: p.y,
        kind: 'stable' as BasinKind,
        label: history[i].snapshotAt.slice(0, 10),
      };
    });

    // Tag basin per-point by looking them up.
    const navPoints = Array.from(
      (nav as unknown as { points: Map<string, { id: string; basin: BasinKind; value: number }> }).points.values(),
    );
    const byVec = new Map(navPoints.map((p) => [p.id, p.basin]));
    items.forEach((it, idx) => {
      const basin = byVec.get(it.id) ?? 'stable';
      points[idx].kind = basin;
    });

    // Current point
    const currentProj = projected.find((p) => p.id === currentVec.id);
    if (currentProj) {
      points.push({
        id: 'current-marker',
        x: currentProj.x,
        y: currentProj.y,
        kind: 'current',
        label: 'current',
        highlight: true,
        radius: 1.1,
      });
    }

    // Target point (projected via append) — re-project including target for stability
    let trajectories: ScatterTrajectory[] = [];
    if (target && path) {
      const targetVec = states.embed(target);
      const allItems = [...items, { id: 'target-marker', vec: targetVec.vector, meta: {} }];
      const reproj = project2D(`op-${tenantId}`, allItems.map((i) => ({ id: i.id, vec: i.vec })));
      const reMap = new Map(reproj.map((p) => [p.id, p]));
      // Update existing point positions
      points.forEach((pt) => {
        if (pt.id === 'current-marker') {
          const cp = reMap.get(currentVec.id);
          if (cp) {
            pt.x = cp.x;
            pt.y = cp.y;
          }
          return;
        }
        const np = reMap.get(pt.id);
        if (np) {
          pt.x = np.x;
          pt.y = np.y;
        }
      });
      const tp = reMap.get('target-marker');
      if (tp) {
        points.push({ id: 'target-marker', x: tp.x, y: tp.y, kind: 'target', label: 'target', highlight: true, radius: 1.1 });
      }
      trajectories = [
        {
          id: 'opt-path',
          pointIds: ['current-marker', 'target-marker'],
          color: 'hsl(var(--accent))',
          label: 'optimization',
        },
      ];
    }

    // Basin regions
    const allItemsForBasins = items.map((i) => ({ id: i.id, vec: i.vec }));
    const projForRegions = project2D(`op-${tenantId}`, allItemsForBasins);
    const projMap = new Map(projForRegions.map((p) => [p.id, p]));
    const regions: ScatterRegion[] = basins.map((b) => {
      const memberProj = b.members.map((id) => projMap.get(id)).filter(Boolean) as { x: number; y: number }[];
      const cx = memberProj.reduce((s, p) => s + p.x, 0) / Math.max(1, memberProj.length);
      const cy = memberProj.reduce((s, p) => s + p.y, 0) / Math.max(1, memberProj.length);
      const r = Math.max(...memberProj.map((p) => Math.hypot(p.x - cx, p.y - cy)), 0.05);
      return { id: b.id, cx, cy, r, kind: b.kind, label: b.kind };
    });

    return { points, trajectories, regions, similar, basins, path };
  }, [tenantId, history, current, target, goal]);

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Operational State Space</CardTitle>
          <CardDescription>Awaiting tenant data…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Operational State Space
          <Badge variant="outline">priority 1 · very high ROI</Badge>
        </CardTitle>
        <CardDescription>
          32-D snapshots projected to 2D. Current state, target, basins, and the chosen trajectory are highlighted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="aspect-[5/3] w-full bg-muted/30 rounded border border-border">
          <Scatter
            points={data.points}
            trajectories={data.trajectories}
            regions={data.regions}
            xLabel="proj-x"
            yLabel="proj-y"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <h4 className="font-medium mb-2">Nearest historical states</h4>
            <ul className="space-y-1 text-muted-foreground">
              {data.similar.slice(0, 5).map((s) => (
                <li key={s.state.vector.id} className="flex justify-between gap-2">
                  <span className="truncate">{new Date(s.state.vector.snapshotAt).toLocaleString()}</span>
                  <span>{(s.similarity * 100).toFixed(0)}%</span>
                </li>
              ))}
              {data.similar.length === 0 && <li>No similar states yet.</li>}
            </ul>
          </div>
          <div>
            <h4 className="font-medium mb-2">Discovered basins</h4>
            <ul className="space-y-1 text-muted-foreground">
              {data.basins.map((b) => (
                <li key={b.id} className="flex justify-between gap-2">
                  <span className="capitalize">{b.kind}</span>
                  <span>{b.members.length} members · value {b.meanValue.toFixed(2)}</span>
                </li>
              ))}
              {data.basins.length === 0 && <li>Not enough data to form basins.</li>}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
