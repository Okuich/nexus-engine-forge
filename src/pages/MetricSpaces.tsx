/**
 * Metric Spaces page.
 *
 * Unified view of the four metric spaces wired to the active tenant,
 * plus the ROI-gated recommendation panel that enforces capability
 * priority order.
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Compass } from 'lucide-react';
import { useTenantSpaces } from '@/hooks/useTenantSpaces';
import { OperationalSpacePanel } from '@/components/spaces/OperationalSpacePanel';
import { ManufacturabilitySpacePanel } from '@/components/spaces/ManufacturabilitySpacePanel';
import { PhysicsSpacePanel } from '@/components/spaces/PhysicsSpacePanel';
import { OptimizationGeometryPanel } from '@/components/spaces/OptimizationGeometryPanel';
import { RoiGatingPanel } from '@/components/spaces/RoiGatingPanel';
import { FieldOsPanel } from '@/components/spaces/FieldOsPanel';
import type { OptimizationGoal } from '@/lib/optimizationGeometry';

const GOALS: { value: OptimizationGoal; label: string }[] = [
  { value: 'throughput-improvement', label: 'Throughput improvement' },
  { value: 'downtime-reduction', label: 'Downtime reduction' },
  { value: 'production-scaling', label: 'Production scaling' },
  { value: 'inventory-optimization', label: 'Inventory optimization' },
];

export default function MetricSpaces() {
  const spaces = useTenantSpaces();
  const [goal, setGoal] = useState<OptimizationGoal>('throughput-improvement');

  if (!spaces.tenantId) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle>Metric Spaces</CardTitle>
            <CardDescription>Select an active tenant to view the metric spaces.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background industrial-grid overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-medium flex items-center gap-2">
              <Compass className="h-5 w-5 text-primary" />
              Metric Spaces
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Every operational and manufacturing condition is a point in a metric space. The four spaces
              feed a unified ROI-gating engine that enforces the capability priority order before any
              recommendation is surfaced.
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              tenant {spaces.tenantId.slice(0, 8)}… · {spaces.history.length} snapshots · {spaces.parts.length} parts ·{' '}
              {spaces.physics.length} physics samples · {spaces.live.openRfqCount} open RFQs
            </p>
          </div>
          <div className="w-64">
            <Select value={goal} onValueChange={(v) => setGoal(v as OptimizationGoal)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOALS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        <Tabs defaultValue="operational" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="operational">Operational</TabsTrigger>
            <TabsTrigger value="manufacturability">Manufacturability</TabsTrigger>
            <TabsTrigger value="physics">Physics</TabsTrigger>
            <TabsTrigger value="optimization">Optimization</TabsTrigger>
            <TabsTrigger value="roi">ROI Gating</TabsTrigger>
            <TabsTrigger value="field-os">Field OS</TabsTrigger>
          </TabsList>

          <TabsContent value="operational">
            <OperationalSpacePanel
              tenantId={spaces.tenantId}
              history={spaces.history}
              current={spaces.current}
              target={spaces.target}
              goal={goal}
            />
          </TabsContent>
          <TabsContent value="manufacturability">
            <ManufacturabilitySpacePanel parts={spaces.parts} />
          </TabsContent>
          <TabsContent value="physics">
            <PhysicsSpacePanel physics={spaces.physics} />
          </TabsContent>
          <TabsContent value="optimization">
            <OptimizationGeometryPanel current={spaces.current} target={spaces.target} goal={goal} />
          </TabsContent>
          <TabsContent value="roi">
            <RoiGatingPanel
              inputs={{
                tenantId: spaces.tenantId,
                current: spaces.current ?? undefined,
                target: spaces.target ?? undefined,
                history: spaces.history,
                parts: spaces.parts,
                physics: spaces.physics,
                goal,
              }}
            />
          </TabsContent>
          <TabsContent value="field-os">
            <FieldOsPanel
              current={spaces.current}
              target={spaces.target}
              physics={spaces.physics}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
