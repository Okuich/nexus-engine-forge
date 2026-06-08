/**
 * Unified ROI Gating panel.
 *
 * Runs the gating engine over the tenant's spaces and renders the
 * prioritized recommendations in strict priority order. Skipped
 * capabilities are shown with the reason for transparency.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import {
  CAPABILITY_ORDER,
  evaluateRoi,
  type GatedRecommendation,
  type RoiGateInputs,
} from '@/lib/roiGating';
import type { OptimizationGoal } from '@/lib/optimizationGeometry';

interface Props {
  inputs: Omit<RoiGateInputs, 'goal'> & { goal: OptimizationGoal };
}

export function RoiGatingPanel({ inputs }: Props) {
  const [shortCircuit, setShortCircuit] = useState(false);
  const result = useMemo(
    () => evaluateRoi(inputs, { shortCircuit, perTierLimit: 3, minRoi: 0.02 }),
    [inputs, shortCircuit],
  );

  const grouped = new Map<string, GatedRecommendation[]>();
  for (const r of result.recommendations) {
    const list = grouped.get(r.capability.id) ?? [];
    list.push(r);
    grouped.set(r.capability.id, list);
  }
  const skippedMap = new Map(result.skipped.map((s) => [s.capability, s.reason]));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Unified ROI Gating</CardTitle>
            <CardDescription>
              Capabilities fire in strict priority order. {result.recommendations.length} recommendation
              {result.recommendations.length === 1 ? '' : 's'} surfaced
              {result.shortCircuited ? ' (short-circuited)' : ''}.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="short-circuit" checked={shortCircuit} onCheckedChange={setShortCircuit} />
            <Label htmlFor="short-circuit" className="text-xs">
              Short-circuit
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {CAPABILITY_ORDER.map((cap) => {
          const recs = grouped.get(cap.id) ?? [];
          const skipped = skippedMap.get(cap.id);
          return (
            <div key={cap.id} className="border border-border rounded p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono">
                    {cap.priority}
                  </Badge>
                  <span className="font-medium text-sm">{cap.title}</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Badge variant="outline">{cap.roi}</Badge>
                  <Badge variant="outline">{cap.difficulty}</Badge>
                </div>
              </div>
              {recs.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  {skipped ? `Skipped: ${skipped}` : 'No recommendations.'}
                </p>
              )}
              {recs.map((r, i) => (
                <div key={i} className="text-sm space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.title}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      ROI {(r.roiScore * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{r.rationale}</p>
                  <Progress value={r.roiScore * 100} className="h-1.5" />
                  <p className="text-[11px] text-muted-foreground">
                    Confidence {(r.confidence * 100).toFixed(0)}%
                    {r.blocksDownstream && ' · blocks downstream'}
                  </p>
                </div>
              ))}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
