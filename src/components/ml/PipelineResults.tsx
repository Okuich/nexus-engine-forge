import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, AlertTriangle, XCircle, Clock, Zap, DollarSign, Shield, Lightbulb } from 'lucide-react';
import type { TrainingJob } from '@/lib/ml/types';
import type { InferenceResult } from '@/lib/ml/pipeline';

interface PipelineResultsProps {
  pipelineJob: TrainingJob | null;
  inferenceResult: InferenceResult | null;
  pipelineId: string | null;
}

const STAGES = ['Upload Verified', 'Geometry Preprocessed', 'GNN Inference', 'Report Generated'];

const riskColors = {
  low: 'text-accent',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  critical: 'text-destructive',
};

export function PipelineResults({ pipelineJob, inferenceResult, pipelineId }: PipelineResultsProps) {
  // Show inference-only results
  if (inferenceResult && !pipelineId) {
    return <InferenceOnlyResults result={inferenceResult} />;
  }

  // Show pipeline progress / results
  if (!pipelineJob && pipelineId) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Clock className="h-8 w-8 text-primary mx-auto mb-3 animate-pulse" />
          <p className="text-sm font-mono text-muted-foreground">Waiting for pipeline data…</p>
        </div>
      </div>
    );
  }

  if (!pipelineJob) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm font-mono">No active pipeline</p>
        <p className="text-xs mt-1">Upload a CAD file to start analysis</p>
      </div>
    );
  }

  const isComplete = pipelineJob.status === 'completed';
  const isFailed = pipelineJob.status === 'failed';
  const metrics = pipelineJob.metrics as any;

  return (
    <div className="space-y-6">
      {/* Pipeline Progress */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="font-mono text-sm text-muted-foreground uppercase tracking-wider">
              Pipeline Progress
            </CardTitle>
            <Badge
              variant="secondary"
              className={`font-mono text-xs ${
                isComplete ? 'bg-accent/20 text-accent' : isFailed ? 'bg-destructive/20 text-destructive' : 'bg-primary/20 text-primary'
              }`}
            >
              {pipelineJob.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Progress value={pipelineJob.progress} className="h-2 mb-4" />
          <div className="grid grid-cols-4 gap-2">
            {STAGES.map((stage, i) => {
              const done = pipelineJob.epochs_completed > i;
              const active = pipelineJob.epochs_completed === i && !isComplete && !isFailed;
              return (
                <motion.div
                  key={stage}
                  initial={{ opacity: 0.5 }}
                  animate={{ opacity: done || active ? 1 : 0.4 }}
                  className="flex items-center gap-2 p-2 rounded-md bg-secondary/30"
                >
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 text-accent shrink-0" />
                  ) : active ? (
                    <Clock className="h-4 w-4 text-primary shrink-0 animate-pulse" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border border-border shrink-0" />
                  )}
                  <span className="text-[10px] font-mono text-muted-foreground leading-tight">{stage}</span>
                </motion.div>
              );
            })}
          </div>

          {isFailed && pipelineJob.error_message && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive font-mono flex items-start gap-2"
            >
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {pipelineJob.error_message}
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* Results (when complete) */}
      {isComplete && metrics && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          <ScoreCard
            label="Manufacturability"
            value={`${metrics.manufacturability_score}`}
            unit="/100"
            icon={Zap}
            color={metrics.manufacturability_score >= 80 ? 'text-accent' : metrics.manufacturability_score >= 60 ? 'text-yellow-400' : 'text-destructive'}
          />
          <ScoreCard
            label="Estimated Cost"
            value={`$${metrics.estimated_cost_usd?.toLocaleString()}`}
            icon={DollarSign}
            color="text-primary"
          />
          <ScoreCard
            label="Risk Level"
            value={metrics.risk_level?.toUpperCase()}
            icon={Shield}
            color={riskColors[metrics.risk_level as keyof typeof riskColors] ?? 'text-muted-foreground'}
          />
        </motion.div>
      )}
    </div>
  );
}

// ─── Inference-Only Results ─────────────────────────────────────

function InferenceOnlyResults({ result }: { result: InferenceResult }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ScoreCard
          label="Manufacturability"
          value={`${result.manufacturability_score}`}
          unit="/100"
          icon={Zap}
          color={result.manufacturability_score >= 80 ? 'text-accent' : result.manufacturability_score >= 60 ? 'text-yellow-400' : 'text-destructive'}
        />
        <ScoreCard label="Estimated Cost" value={`$${result.estimated_cost_usd.toLocaleString()}`} icon={DollarSign} color="text-primary" />
        <ScoreCard label="Risk Level" value={result.risk_level.toUpperCase()} icon={Shield} color={riskColors[result.risk_level]} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Risk Regions */}
        {result.risk_regions.length > 0 && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" /> Risk Regions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {result.risk_regions.map((r, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-2 p-2 rounded bg-secondary/30"
                >
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0 mt-0.5">
                    {r.severity}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{r.description}</span>
                </motion.div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Lightbulb className="h-3.5 w-3.5 text-accent" /> Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.recommendations.map((r, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-start gap-2 p-2 rounded bg-secondary/30"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-accent shrink-0 mt-0.5" />
                <span className="text-xs text-muted-foreground">{r}</span>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="text-right">
        <span className="text-[10px] font-mono text-muted-foreground">
          Inference latency: {result.latency_ms}ms
        </span>
      </div>
    </div>
  );
}

// ─── Shared ─────────────────────────────────────────────────────

function ScoreCard({ label, value, unit, icon: Icon, color }: {
  label: string;
  value: string;
  unit?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="bg-card border-border">
        <CardContent className="p-4 flex items-center gap-3">
          <div className={`h-10 w-10 rounded-md bg-secondary flex items-center justify-center`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">{label}</p>
            <p className={`text-lg font-mono font-bold ${color}`}>
              {value}<span className="text-xs text-muted-foreground">{unit}</span>
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
