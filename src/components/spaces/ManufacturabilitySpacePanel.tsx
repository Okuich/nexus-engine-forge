/**
 * Manufacturability Space panel.
 *
 * Scores each CAD part across CNC / injection / additive / sheet
 * metal / casting, plots them in 2D, and lists feasibility +
 * difficulty drivers.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { evaluateManufacturability, type CadModel } from '@/lib/manufacturability';
import { Scatter, type ScatterPoint } from './Scatter';
import { project2D } from './project';

interface Props {
  parts: CadModel[];
}

export function ManufacturabilitySpacePanel({ parts }: Props) {
  const data = useMemo(() => {
    if (parts.length === 0) return null;
    const evals = parts.map((p) => evaluateManufacturability(p));
    const projected = project2D(
      'mfg',
      evals.map((e) => ({ id: e.modelId, vec: e.vector.vector })),
    );
    const points: ScatterPoint[] = projected.map((p, i) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      kind: evals[i].recommendedProcess,
      label: parts[i].name,
      radius: 0.9,
      highlight: evals[i].score >= 70,
    }));
    return { evals, points };
  }, [parts]);

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manufacturability Space</CardTitle>
          <CardDescription>No CAD parts available.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Manufacturability Space
          <Badge variant="outline">priority 2 · very high ROI</Badge>
        </CardTitle>
        <CardDescription>
          34-D vectors per part, color-coded by recommended process. Highlighted points score ≥70/100.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="aspect-[5/3] w-full bg-muted/30 rounded border border-border">
          <Scatter points={data.points} xLabel="proj-x" yLabel="proj-y" />
        </div>
        <div className="space-y-3 text-sm">
          {data.evals.map((ev) => (
            <div key={ev.modelId} className="border border-border rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{ev.modelId.split('-').pop()}</span>
                <Badge>{ev.recommendedProcess}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={ev.score} className="h-2" />
                <span className="text-muted-foreground text-xs w-16 text-right">{ev.score.toFixed(0)}/100</span>
              </div>
              {ev.difficulty[0] && (
                <p className="text-xs text-muted-foreground">Top driver: {ev.difficulty[0].message}</p>
              )}
              <div className="text-xs text-muted-foreground">
                Alternatives:{' '}
                {ev.alternatives
                  .slice(0, 3)
                  .map((a) => `${a.process} (${a.score.toFixed(0)})`)
                  .join(' · ')}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
