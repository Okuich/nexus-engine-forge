/**
 * Optimization Geometry panel.
 *
 * Shows the trajectory current → target as an ordered, annotated
 * action sequence with predicted outcome, multi-objective cost, and
 * risk drivers.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  findOptimalPath,
  type OptimizationGoal,
} from '@/lib/optimizationGeometry';
import type { OperationalSnapshot } from '@/lib/operationalState';

interface Props {
  current: OperationalSnapshot | null;
  target: OperationalSnapshot | null;
  goal: OptimizationGoal;
}

export function OptimizationGeometryPanel({ current, target, goal }: Props) {
  const data = useMemo(() => {
    if (!current || !target) return null;
    return findOptimalPath(current, target, { goal });
  }, [current, target, goal]);

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Optimization Geometry</CardTitle>
          <CardDescription>Awaiting current + target snapshots…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const steps = Math.max(0, data.nodeIds.length - 1);
  const riskPct = Math.round(data.risk.overall * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Optimization Geometry
          <Badge variant="outline">priority 4 · extremely high ROI</Badge>
        </CardTitle>
        <CardDescription>
          A* over a k-NN graph in operational state space. Goal: {goal.replace(/-/g, ' ')}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Steps" value={`${steps}`} />
          <Stat label="Total cost" value={data.totalCost.total.toFixed(2)} />
          <Stat label="Risk" value={`${riskPct}%`} />
        </div>
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Risk profile</span>
            <span>worst step {(data.risk.worstStep * 100).toFixed(0)}%</span>
          </div>
          <Progress value={riskPct} className="h-2" />
        </div>
        <div className="space-y-2">
          <h4 className="font-medium">Action sequence</h4>
          {data.actions.length === 0 && (
            <p className="text-muted-foreground text-xs">No actionable steps required.</p>
          )}
          <ol className="space-y-2">
            {data.actions.map((a, i) => (
              <li key={i} className="border border-border rounded p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{a.kind}</span>
                  <span className="text-xs text-muted-foreground">~{a.etaHours.toFixed(1)}h</span>
                </div>
                <p className="text-xs text-muted-foreground">{a.description}</p>
                {a.deltas.slice(0, 3).length > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    {a.deltas.slice(0, 3).map((d) => `${d.dimension} ${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(2)}`).join(' · ')}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <span>Predicted OEE Δ {(data.predictedOutcome.oeeDelta * 100).toFixed(1)}%</span>
          <span>Throughput Δ {data.predictedOutcome.throughputDelta.toFixed(1)} pph</span>
          <span>Scrap Δ {(data.predictedOutcome.scrapDelta * 100).toFixed(2)}%</span>
          <span>Backlog Δ {data.predictedOutcome.backlogDelta.toFixed(0)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}
