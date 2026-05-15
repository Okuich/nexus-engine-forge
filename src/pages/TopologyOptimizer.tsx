/**
 * Topology Optimizer — multi-load-case builder + submission page.
 *
 * Lets the user assemble several `LoadCase` entries (loads, optional
 * supports, weight), pick the aggregation strategy (`weighted-sum` or
 * `ks` with `ksRho`), and submit to the topology compliance endpoint.
 * The response surfaces `perCaseCompliance` next to the aggregated
 * objective so the user can compare cases at a glance.
 */
import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadCaseBuilder } from '@/components/topology/LoadCaseBuilder';
import {
  evaluateCompliance, type ComplianceResponse,
} from '@/lib/api/topologyApi';
import type { LoadCase, LoadCaseAggregation } from '@/lib/geometry/topology/types';

const INITIAL_CASES: LoadCase[] = [
  { name: 'Case 1', loads: [{ point: [0, 0, 0], force: [0, -1000, 0] }], weight: 1 },
];

export default function TopologyOptimizer() {
  const [cases, setCases] = useState<LoadCase[]>(INITIAL_CASES);
  const [aggregation, setAggregation] = useState<LoadCaseAggregation>('weighted-sum');
  const [ksRho, setKsRho] = useState(8);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ComplianceResponse | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await evaluateCompliance({
        loadCases: cases,
        loadCaseAggregation: aggregation,
        ksRho: aggregation === 'ks' ? ksRho : undefined,
      });
      setResult(res);
      toast.success('Compliance evaluated', {
        description: `${res.perCaseCompliance.length} cases · aggregated ${res.aggregatedCompliance.toFixed(3)}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'request failed';
      toast.error('Submission failed', { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Topology Optimizer</h1>
        <p className="text-sm text-muted-foreground">
          Define load cases, choose an aggregation, and submit to the multi-load compliance solver.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-label="Load cases">
          <LoadCaseBuilder
            cases={cases}
            onCasesChange={setCases}
            aggregation={aggregation}
            onAggregationChange={setAggregation}
            ksRho={ksRho}
            onKsRhoChange={setKsRho}
          />
        </section>

        <aside className="space-y-4">
          <Card className="bg-card/60 backdrop-blur-sm border-border/60 p-4 space-y-3">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
              Submission
            </h2>
            <dl className="text-xs space-y-1">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Cases</dt>
                <dd className="font-mono">{cases.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Aggregation</dt>
                <dd className="font-mono">{aggregation}</dd>
              </div>
              {aggregation === 'ks' && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">ksRho</dt>
                  <dd className="font-mono">{ksRho}</dd>
                </div>
              )}
            </dl>
            <Button onClick={submit} disabled={submitting} className="w-full">
              {submitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Solving…</>
              ) : (
                <><Play className="h-4 w-4 mr-2" /> Submit to optimizer</>
              )}
            </Button>
          </Card>

          {result && (
            <Card className="bg-card/60 backdrop-blur-sm border-border/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                  Result
                </h2>
                {result.surrogate && <Badge variant="outline" className="text-[10px]">surrogate</Badge>}
              </div>
              <div className="rounded-md border border-border/40 bg-background/40 p-3">
                <div className="text-xs text-muted-foreground">Aggregated compliance</div>
                <div className="text-2xl font-mono">{result.aggregatedCompliance.toFixed(4)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Per-case compliance
                </div>
                {result.perCase.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs rounded-md border border-border/40 bg-background/30 px-3 py-2"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="font-mono text-muted-foreground">w={p.weight}</span>
                    <span className="font-mono">{p.compliance.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
