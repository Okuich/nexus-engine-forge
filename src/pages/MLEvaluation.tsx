/**
 * ML Evaluation Dashboard
 *
 * Enterprise-grade UI for model evaluation, A/B comparison,
 * drift detection, and accuracy tracking.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useEvaluation } from '@/hooks/useEvaluation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar, ResponsiveContainer } from 'recharts';
import {
  Activity, ArrowLeft, Brain, CheckCircle2, XCircle,
  TrendingDown, TrendingUp, Minus, AlertTriangle, Shield,
  GitCompare, Gauge, Play, BarChart3, Link as LinkIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { DriftSeverity } from '@/lib/ml/evaluation';

const chartConfig = {
  mae: { label: 'MAE', color: 'hsl(var(--chart-1))' },
  accuracy: { label: 'Accuracy', color: 'hsl(var(--chart-2))' },
  f1: { label: 'F1', color: 'hsl(var(--chart-3))' },
  latency: { label: 'P95 Latency', color: 'hsl(var(--chart-4))' },
};

const MODEL_TYPES = ['gat', 'gcn', 'transformer', 'mlp'];

function SeverityBadge({ severity }: { severity: DriftSeverity }) {
  const config: Record<DriftSeverity, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    none: { variant: 'secondary', label: 'None' },
    low: { variant: 'outline', label: 'Low' },
    medium: { variant: 'default', label: 'Medium' },
    high: { variant: 'destructive', label: 'High' },
    critical: { variant: 'destructive', label: 'Critical' },
  };
  const c = config[severity];
  return <Badge variant={c.variant} className="font-mono text-[10px]">{c.label}</Badge>;
}

function TrendIcon({ trend }: { trend: 'improving' | 'stable' | 'degrading' }) {
  if (trend === 'improving') return <TrendingDown className="h-3.5 w-3.5 text-accent" />;
  if (trend === 'degrading') return <TrendingUp className="h-3.5 w-3.5 text-destructive" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

export default function MLEvaluation() {
  const eval_ = useEvaluation();
  const [tab, setTab] = useState('evaluate');
  const [evalModel, setEvalModel] = useState('gat');
  const [champModel, setChampModel] = useState('gat');
  const [challModel, setChallModel] = useState('gcn');

  const handleRunEval = () => {
    const result = eval_.runEvaluation(evalModel);
    const gates = result.metrics;
    toast.success(`Evaluation complete — MAE: ${(gates.mae * 100).toFixed(2)}%, Accuracy: ${(gates.accuracy * 100).toFixed(1)}%`);
  };

  const handleRunComparison = () => {
    const result = eval_.runComparison(champModel, challModel);
    toast.success(`Comparison complete — Winner: ${result.winner}, Recommendation: ${result.recommendation}`);
  };

  const handleRunDrift = () => {
    const report = eval_.runDriftCheck('model-1', 'v1');
    toast[report.overallSeverity === 'none' || report.overallSeverity === 'low' ? 'success' : 'warning'](
      `Drift check: ${report.overallSeverity} severity`
    );
  };

  const latestEval = eval_.evaluations[0];
  const latestComparison = eval_.comparisons[0];
  const latestDrift = eval_.driftReports[0];

  const timelineData = eval_.accuracyTimeline.map((s, i) => ({
    index: i + 1,
    mae: +(s.mae * 100).toFixed(2),
    accuracy: +(s.accuracy * 100).toFixed(1),
    f1: +(s.f1 * 100).toFixed(1),
    maeEMA: +(s.maeMovingAvg * 100).toFixed(2),
  }));

  return (
    <div className="min-h-screen bg-background industrial-grid">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/ml">
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                <Shield className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-foreground font-mono">ML Evaluation Pipeline</h1>
                <p className="text-xs text-muted-foreground">Model accuracy, drift detection & promotion</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {eval_.evaluations.length > 0 && (
              <Badge variant="secondary" className="font-mono text-[10px] gap-1">
                <Activity className="h-3 w-3" /> {eval_.evaluations.length} runs
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-card border border-border mb-6">
            <TabsTrigger value="evaluate" className="gap-2 font-mono text-xs">
              <Gauge className="h-3.5 w-3.5" /> Evaluate
            </TabsTrigger>
            <TabsTrigger value="compare" className="gap-2 font-mono text-xs">
              <GitCompare className="h-3.5 w-3.5" /> A/B Compare
            </TabsTrigger>
            <TabsTrigger value="drift" className="gap-2 font-mono text-xs">
              <AlertTriangle className="h-3.5 w-3.5" /> Drift
            </TabsTrigger>
            <TabsTrigger value="timeline" className="gap-2 font-mono text-xs">
              <BarChart3 className="h-3.5 w-3.5" /> Timeline
            </TabsTrigger>
          </TabsList>

          {/* ─── Evaluate Tab ─── */}
          <TabsContent value="evaluate">
            <div className="space-y-6">
              <Card className="dashboard-card">
                <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                  <Select value={evalModel} onValueChange={setEvalModel}>
                    <SelectTrigger className="w-[180px] font-mono text-xs bg-secondary border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_TYPES.map((m) => (
                        <SelectItem key={m} value={m} className="font-mono text-xs uppercase">{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={handleRunEval} className="gap-2 font-mono text-xs">
                    <Play className="h-3.5 w-3.5" /> Run Evaluation
                  </Button>
                </CardContent>
              </Card>

              {latestEval && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  {/* KPI Row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'MAE', value: `${(latestEval.metrics.mae * 100).toFixed(2)}%`, color: 'text-primary' },
                      { label: 'Accuracy', value: `${(latestEval.metrics.accuracy * 100).toFixed(1)}%`, color: 'text-accent' },
                      { label: 'F1 Score', value: `${(latestEval.metrics.f1 * 100).toFixed(1)}%`, color: 'text-accent' },
                      { label: 'P95 Latency', value: `${latestEval.metrics.latencyP95.toFixed(1)}ms`, color: 'text-muted-foreground' },
                    ].map((kpi) => (
                      <Card key={kpi.label} className="dashboard-card">
                        <CardContent className="p-4">
                          <p className="metric-label">{kpi.label}</p>
                          <p className={`metric-value ${kpi.color}`}>{kpi.value}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Gate Results */}
                  <Card className="dashboard-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="panel-title">Quality Gates</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {latestEval.config.gates.map((gate, i) => {
                        const metricMap: Record<string, number> = {
                          mae: latestEval.metrics.mae, accuracy: latestEval.metrics.accuracy,
                          latency_p95: latestEval.metrics.latencyP95,
                        };
                        const actual = metricMap[gate.metric] ?? 0;
                        const ops: Record<string, (a: number, t: number) => boolean> = {
                          lt: (a, t) => a < t, gt: (a, t) => a > t,
                          lte: (a, t) => a <= t, gte: (a, t) => a >= t,
                        };
                        const passed = (ops[gate.operator] ?? (() => false))(actual, gate.threshold);
                        return (
                          <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-secondary/30">
                            <div className="flex items-center gap-2">
                              {passed
                                ? <CheckCircle2 className="h-4 w-4 text-accent" />
                                : <XCircle className="h-4 w-4 text-destructive" />}
                              <span className="text-xs font-mono text-foreground">{gate.label}</span>
                            </div>
                            <span className={`text-xs font-mono ${passed ? 'text-accent' : 'text-destructive'}`}>
                              {typeof actual === 'number' && actual < 1 ? `${(actual * 100).toFixed(2)}%` : actual.toFixed(1)}
                            </span>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>

                  {/* Fold Results */}
                  {latestEval.metrics.foldResults && latestEval.metrics.foldResults.length > 0 && (
                    <Card className="dashboard-card">
                      <CardHeader className="pb-2">
                        <CardTitle className="panel-title">Cross-Validation Folds</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ChartContainer config={chartConfig} className="h-[200px] w-full">
                          <BarChart data={latestEval.metrics.foldResults.map((f) => ({
                            fold: `Fold ${f.fold}`,
                            mae: +(f.mae * 100).toFixed(2),
                            accuracy: +(f.accuracy * 100).toFixed(1),
                          }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="fold" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="accuracy" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Accuracy %" />
                          </BarChart>
                        </ChartContainer>
                      </CardContent>
                    </Card>
                  )}
                </motion.div>
              )}
            </div>
          </TabsContent>

          {/* ─── A/B Compare Tab ─── */}
          <TabsContent value="compare">
            <div className="space-y-6">
              <Card className="dashboard-card">
                <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">Champion:</span>
                    <Select value={champModel} onValueChange={setChampModel}>
                      <SelectTrigger className="w-[140px] font-mono text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                      <SelectContent>{MODEL_TYPES.map((m) => <SelectItem key={m} value={m} className="font-mono text-xs uppercase">{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">Challenger:</span>
                    <Select value={challModel} onValueChange={setChallModel}>
                      <SelectTrigger className="w-[140px] font-mono text-xs bg-secondary border-border"><SelectValue /></SelectTrigger>
                      <SelectContent>{MODEL_TYPES.map((m) => <SelectItem key={m} value={m} className="font-mono text-xs uppercase">{m}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" onClick={handleRunComparison} className="gap-2 font-mono text-xs">
                    <GitCompare className="h-3.5 w-3.5" /> Compare
                  </Button>
                </CardContent>
              </Card>

              {latestComparison && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <Card className="dashboard-card text-center">
                      <CardContent className="p-4">
                        <p className="metric-label">Winner</p>
                        <p className="metric-value text-primary capitalize">{latestComparison.winner}</p>
                      </CardContent>
                    </Card>
                    <Card className="dashboard-card text-center">
                      <CardContent className="p-4">
                        <p className="metric-label">Recommendation</p>
                        <p className={`metric-value capitalize ${
                          latestComparison.recommendation === 'promote' ? 'text-accent' :
                          latestComparison.recommendation === 'reject' ? 'text-destructive' : 'text-warning'
                        }`}>{latestComparison.recommendation.replace('_', ' ')}</p>
                      </CardContent>
                    </Card>
                    <Card className="dashboard-card text-center">
                      <CardContent className="p-4">
                        <p className="metric-label">MAE Delta</p>
                        <p className={`metric-value ${(latestComparison.deltas.mae ?? 0) < 0 ? 'text-accent' : 'text-destructive'}`}>
                          {((latestComparison.deltas.mae ?? 0) * 100).toFixed(2)}%
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="dashboard-card">
                    <CardHeader className="pb-2"><CardTitle className="panel-title">Metric Deltas (Challenger - Champion)</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {Object.entries(latestComparison.deltas).map(([key, delta]) => {
                        const sig = latestComparison.significance[key];
                        return (
                          <div key={key} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-secondary/30">
                            <span className="text-xs font-mono text-foreground uppercase">{key}</span>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-mono ${delta < 0 ? 'text-accent' : delta > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                                {delta > 0 ? '+' : ''}{(delta * 100).toFixed(3)}%
                              </span>
                              {sig && (
                                <Badge variant={sig.significant ? 'default' : 'secondary'} className="text-[9px] font-mono">
                                  p={sig.pValue.toFixed(3)}
                                </Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </div>
          </TabsContent>

          {/* ─── Drift Tab ─── */}
          <TabsContent value="drift">
            <div className="space-y-6">
              <Card className="dashboard-card">
                <CardContent className="p-4 flex items-center gap-3">
                  <Button size="sm" onClick={handleRunDrift} className="gap-2 font-mono text-xs">
                    <AlertTriangle className="h-3.5 w-3.5" /> Run Drift Check
                  </Button>
                </CardContent>
              </Card>

              {latestDrift && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card className="dashboard-card">
                      <CardContent className="p-4">
                        <p className="metric-label">Overall Severity</p>
                        <div className="mt-1"><SeverityBadge severity={latestDrift.overallSeverity} /></div>
                      </CardContent>
                    </Card>
                    <Card className="dashboard-card">
                      <CardContent className="p-4">
                        <p className="metric-label">Prediction PSI</p>
                        <p className="metric-value text-primary">{latestDrift.predictionDrift.psi.toFixed(4)}</p>
                      </CardContent>
                    </Card>
                    <Card className="dashboard-card">
                      <CardContent className="p-4">
                        <p className="metric-label">Accuracy Δ</p>
                        <p className={`metric-value ${latestDrift.accuracyDrift.degradationPct > 2 ? 'text-destructive' : 'text-accent'}`}>
                          {latestDrift.accuracyDrift.degradationPct.toFixed(1)}%
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="dashboard-card">
                      <CardContent className="p-4">
                        <p className="metric-label">MAE Increase</p>
                        <p className={`metric-value ${latestDrift.accuracyDrift.maeIncreasePct > 5 ? 'text-destructive' : 'text-foreground'}`}>
                          {latestDrift.accuracyDrift.maeIncreasePct.toFixed(1)}%
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Feature Drift Table */}
                  <Card className="dashboard-card">
                    <CardHeader className="pb-2"><CardTitle className="panel-title">Feature Drift</CardTitle></CardHeader>
                    <CardContent className="space-y-1">
                      {latestDrift.featureDrift.map((f) => (
                        <div key={f.featureName} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-secondary/30">
                          <span className="text-xs font-mono text-foreground">{f.featureName}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-mono text-muted-foreground">PSI: {f.psi.toFixed(4)}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">KS: {f.ksStatistic.toFixed(4)}</span>
                            <SeverityBadge severity={f.severity} />
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Recommendations */}
                  <Card className="dashboard-card">
                    <CardHeader className="pb-2"><CardTitle className="panel-title">Recommendations</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {latestDrift.recommendations.map((r, i) => (
                        <p key={i} className="text-xs text-foreground leading-relaxed">• {r}</p>
                      ))}
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </div>
          </TabsContent>

          {/* ─── Timeline Tab ─── */}
          <TabsContent value="timeline">
            <div className="space-y-6">
              {timelineData.length === 0 ? (
                <Card className="dashboard-card">
                  <CardContent className="p-8 text-center">
                    <BarChart3 className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                    <p className="text-sm font-mono text-muted-foreground">No evaluation data yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Run evaluations to see accuracy trends over time</p>
                  </CardContent>
                </Card>
              ) : (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  {/* Latest trend */}
                  {eval_.accuracyTimeline.length > 0 && (
                    <div className="flex items-center gap-2">
                      <TrendIcon trend={eval_.accuracyTimeline[eval_.accuracyTimeline.length - 1].trend} />
                      <span className="text-xs font-mono text-muted-foreground capitalize">
                        {eval_.accuracyTimeline[eval_.accuracyTimeline.length - 1].trend}
                      </span>
                    </div>
                  )}

                  <Card className="dashboard-card">
                    <CardHeader className="pb-2"><CardTitle className="panel-title">MAE Over Time (with EMA)</CardTitle></CardHeader>
                    <CardContent>
                      <ChartContainer config={chartConfig} className="h-[250px] w-full">
                        <LineChart data={timelineData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="index" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line type="monotone" dataKey="mae" stroke="hsl(var(--chart-1))" strokeWidth={1.5} dot={{ r: 3 }} name="MAE %" />
                          <Line type="monotone" dataKey="maeEMA" stroke="hsl(var(--chart-3))" strokeWidth={2} strokeDasharray="5 5" dot={false} name="EMA" />
                        </LineChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  <Card className="dashboard-card">
                    <CardHeader className="pb-2"><CardTitle className="panel-title">Accuracy & F1 Over Time</CardTitle></CardHeader>
                    <CardContent>
                      <ChartContainer config={chartConfig} className="h-[250px] w-full">
                        <LineChart data={timelineData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="index" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={[80, 100]} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line type="monotone" dataKey="accuracy" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} name="Accuracy %" />
                          <Line type="monotone" dataKey="f1" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ r: 3 }} name="F1 %" />
                        </LineChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
