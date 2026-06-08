/**
 * Physics-Constrained Space panel.
 *
 * Evaluates each physics snapshot, plots them in 2D color-coded by
 * verdict (safe/caution/unsafe), and lists violations + nearest
 * stable & failure neighbors.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  PhysicsConstrainedEngine,
  type PhysicsSnapshot,
} from '@/lib/physicsConstrained';
import { Scatter, type ScatterPoint } from './Scatter';
import { project2D } from './project';

interface Props {
  physics: PhysicsSnapshot[];
}

export function PhysicsSpacePanel({ physics }: Props) {
  const data = useMemo(() => {
    if (physics.length === 0) return null;
    const engine = new PhysicsConstrainedEngine();
    const results = physics.map((p) => engine.evaluateAndStore(p));
    const projected = project2D(
      'phys',
      results.map((r) => ({ id: r.snapshotId, vec: r.vector.vector })),
    );
    const points: ScatterPoint[] = projected.map((p, i) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      kind: results[i].verdict,
      label: results[i].snapshotId.split('-').pop(),
      radius: 1,
      highlight: !results[i].feasible,
    }));
    return { results, points };
  }, [physics]);

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Physics-Constrained Space</CardTitle>
          <CardDescription>No physics snapshots available.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Physics-Constrained Space
          <Badge variant="outline">priority 3 · high ROI</Badge>
        </CardTitle>
        <CardDescription>
          20-D snapshots from FEA / CFD. Distance penalizes yield, thermal, fatigue, and dynamic-instability violations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="aspect-[5/3] w-full bg-muted/30 rounded border border-border">
          <Scatter points={data.points} xLabel="proj-x" yLabel="proj-y" />
        </div>
        <div className="space-y-3 text-sm">
          {data.results.map((r) => (
            <div key={r.snapshotId} className="border border-border rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.snapshotId.split('-').pop()}</span>
                <Badge variant={r.verdict === 'safe' ? 'default' : r.verdict === 'caution' ? 'secondary' : 'destructive'}>
                  {r.verdict}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Feasibility {(r.feasibilityScore * 100).toFixed(0)}% · penalty {r.penalty.toFixed(2)}
              </p>
              {r.violations.length > 0 && (
                <ul className="text-xs text-muted-foreground list-disc list-inside">
                  {r.violations.slice(0, 3).map((v, i) => (
                    <li key={i}>
                      <span className="font-mono">{v.kind}</span> · {v.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="text-xs text-muted-foreground">
                Stable neighbors: {r.stableNeighbors.length} · Failure neighbors: {r.failureNeighbors.length}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
