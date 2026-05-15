/**
 * Load case builder — UI for assembling multiple `LoadCase` entries with
 * loads, optional per-case supports, and weights, plus selecting the
 * aggregation strategy (`weighted-sum` vs KS soft-max with `ksRho`).
 *
 * The component is presentation-only: parent owns state and submission.
 */
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type {
  LoadCase, LoadCaseAggregation, LoadCondition, SupportCondition, V3,
} from '@/lib/geometry/topology/types';

export interface LoadCaseBuilderProps {
  cases: LoadCase[];
  onCasesChange: (next: LoadCase[]) => void;
  aggregation: LoadCaseAggregation;
  onAggregationChange: (next: LoadCaseAggregation) => void;
  ksRho: number;
  onKsRhoChange: (next: number) => void;
}

const ZERO: V3 = [0, 0, 0];

function makeEmptyLoad(): LoadCondition {
  return { point: [...ZERO] as V3, force: [0, -1000, 0] };
}

function makeEmptySupport(): SupportCondition {
  return { point: [...ZERO] as V3, fixed: true };
}

function makeEmptyCase(index: number): LoadCase {
  return {
    name: `Case ${index + 1}`,
    loads: [makeEmptyLoad()],
    weight: 1,
  };
}

function num(v: string, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

interface VectorRowProps {
  label: string;
  value: V3;
  onChange: (next: V3) => void;
}

function VectorRow({ label, value, onChange }: VectorRowProps) {
  return (
    <div className="grid grid-cols-[2.5rem_repeat(3,1fr)] items-center gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {(['x', 'y', 'z'] as const).map((axis, i) => (
        <Input
          key={axis}
          type="number"
          step="any"
          value={value[i]}
          onChange={(e) => {
            const next = [...value] as V3;
            next[i] = num(e.target.value);
            onChange(next);
          }}
          aria-label={`${label} ${axis}`}
          className="h-8 font-mono text-xs"
        />
      ))}
    </div>
  );
}

export function LoadCaseBuilder(props: LoadCaseBuilderProps) {
  const { cases, onCasesChange, aggregation, onAggregationChange, ksRho, onKsRhoChange } = props;

  const update = (i: number, patch: Partial<LoadCase>) => {
    onCasesChange(cases.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const addCase = () => onCasesChange([...cases, makeEmptyCase(cases.length)]);
  const removeCase = (i: number) =>
    onCasesChange(cases.length > 1 ? cases.filter((_, idx) => idx !== i) : cases);

  return (
    <div className="space-y-4">
      <Card className="bg-card/60 backdrop-blur-sm border-border/60 p-4 space-y-3">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Aggregation</Label>
            <Select
              value={aggregation}
              onValueChange={(v) => onAggregationChange(v as LoadCaseAggregation)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weighted-sum">Weighted sum (Σ wᵢ·cᵢ)</SelectItem>
                <SelectItem value="ks">KS soft-max (max-stiffness)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {aggregation === 'ks' && (
            <div className="flex-1">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                ksRho · {ksRho.toFixed(0)}
              </Label>
              <Slider
                value={[ksRho]}
                onValueChange={([v]) => onKsRhoChange(v)}
                min={1}
                max={64}
                step={1}
                className="mt-3"
              />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {aggregation === 'weighted-sum'
            ? 'Minimizes the weighted average compliance across all cases.'
            : 'Approximates the worst-case compliance; higher ρ → sharper (closer to true max).'}
        </p>
      </Card>

      <div className="space-y-3">
        {cases.map((c, i) => (
          <Card
            key={i}
            className="bg-card/60 backdrop-blur-sm border-border/60 p-4 space-y-4"
          >
            <div className="flex items-center gap-3">
              <Input
                value={c.name ?? ''}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder={`Case ${i + 1}`}
                className="flex-1 font-medium"
                aria-label="Case name"
              />
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">weight</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={c.weight ?? 1}
                  onChange={(e) => update(i, { weight: Math.max(0, num(e.target.value, 1)) })}
                  className="w-20 h-8 font-mono text-xs"
                  aria-label="Case weight"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeCase(i)}
                disabled={cases.length <= 1}
                aria-label="Remove case"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <Separator />

            {/* Loads */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Loads ({c.loads.length})
                </Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => update(i, { loads: [...c.loads, makeEmptyLoad()] })}
                >
                  <Plus className="h-3 w-3 mr-1" /> Load
                </Button>
              </div>
              {c.loads.map((ld, li) => (
                <div key={li} className="rounded-md border border-border/40 bg-background/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Load #{li + 1}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() =>
                        update(i, {
                          loads: c.loads.length > 1 ? c.loads.filter((_, idx) => idx !== li) : c.loads,
                        })
                      }
                      disabled={c.loads.length <= 1}
                      aria-label="Remove load"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <VectorRow
                    label="point"
                    value={ld.point}
                    onChange={(point) =>
                      update(i, { loads: c.loads.map((l, idx) => (idx === li ? { ...l, point } : l)) })
                    }
                  />
                  <VectorRow
                    label="force"
                    value={ld.force}
                    onChange={(force) =>
                      update(i, { loads: c.loads.map((l, idx) => (idx === li ? { ...l, force } : l)) })
                    }
                  />
                </div>
              ))}
            </div>

            {/* Supports (optional) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Supports ({c.supports?.length ?? 0}) — optional override
                </Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    update(i, { supports: [...(c.supports ?? []), makeEmptySupport()] })
                  }
                >
                  <Plus className="h-3 w-3 mr-1" /> Support
                </Button>
              </div>
              {(c.supports ?? []).map((sp, si) => (
                <div key={si} className="rounded-md border border-border/40 bg-background/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Support #{si + 1}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() =>
                        update(i, {
                          supports: (c.supports ?? []).filter((_, idx) => idx !== si),
                        })
                      }
                      aria-label="Remove support"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <VectorRow
                    label="point"
                    value={sp.point}
                    onChange={(point) =>
                      update(i, {
                        supports: (c.supports ?? []).map((s, idx) =>
                          idx === si ? { ...s, point } : s,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addCase} className="w-full">
        <Plus className="h-4 w-4 mr-2" /> Add load case
      </Button>
    </div>
  );
}

export const __test = { makeEmptyCase, makeEmptyLoad, makeEmptySupport };
