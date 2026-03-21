import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBenchmarks, useRunBenchmark } from '@/hooks/useBenchmarks';
import { useTrainingJobs } from '@/hooks/useTrainingJobs';
import { compareBenchmarks } from '@/lib/ml/benchmarkService';
import type { BenchmarkResult } from '@/lib/ml/benchmarkTypes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ScatterChart, Scatter, Cell } from 'recharts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity, Award, Clock, Gauge, Play, TrendingDown, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

const chartConfig = {
  mae: { label: 'MAE', color: 'hsl(var(--primary))' },
  latency: { label: 'Latency (ms)', color: 'hsl(var(--accent))' },
  accuracy: { label: 'Accuracy', color: 'hsl(160 84% 39%)' },
  loss: { label: 'Val Loss', color: 'hsl(var(--destructive))' },
};

function MetricCard({ label, value, unit, icon: Icon, isBest, color }: {
  label: string; value: string; unit?: string; icon: any; isBest?: boolean; color: string;
}) {
  return (
    <Card className="bg-card border-border relative overflow-hidden">
      {isBest && (
        <div className="absolute top-2 right-2">
          <Award className="h-3.5 w-3.5 text-accent" />
        </div>
      )}
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-9 w-9 rounded-md flex items-center justify-center bg-primary/10`}>
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">{label}</p>
          <p className="text-lg font-semibold font-mono text-foreground">
            {value}<span className="text-xs text-muted-foreground ml-0.5">{unit}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function BenchmarkDashboard() {
  const { data: benchmarks, isLoading, error } = useBenchmarks();
  const { data: jobs } = useTrainingJobs();
  const runBenchmark = useRunBenchmark();
  const [selectedJobId, setSelectedJobId] = useState<string>('');

  const completedJobs = jobs?.filter(j => j.status === 'completed') ?? [];
  const comparison = compareBenchmarks(benchmarks ?? []);

  const handleRun = () => {
    const job = completedJobs.find(j => j.id === selectedJobId);
    if (!job) return;
    runBenchmark.mutate(
      { jobId: job.id, modelType: job.model_type },
      {
        onSuccess: () => toast.success('Benchmark completed'),
        onError: (e) => toast.error(`Benchmark failed: ${e.message}`),
      },
    );
  };

  // Error state
  if (error) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-mono text-destructive">Failed to load benchmarks</p>
          <p className="text-xs text-muted-foreground">{(error as Error).message}</p>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  const hasData = benchmarks && benchmarks.length > 0;

  // Chart data
  const barData = (benchmarks ?? []).slice(0, 10).reverse().map((b, i) => ({
    name: b.modelType.toUpperCase() + ` #${i + 1}`,
    mae: +(b.mae * 100).toFixed(2),
    latency: b.latencyMeanMs,
    accuracy: b.accuracy ? +(b.accuracy * 100).toFixed(1) : 0,
  }));

  const scatterData = (benchmarks ?? []).map(b => ({
    mae: +(b.mae * 100).toFixed(2),
    latency: b.latencyMeanMs,
    model: b.modelType,
  }));

  return (
    <div className="space-y-6">
      {/* Run Benchmark Controls */}
      <Card className="bg-card border-border">
        <CardContent className="p-4 flex items-center gap-3 flex-wrap">
          <Select value={selectedJobId} onValueChange={setSelectedJobId}>
            <SelectTrigger className="w-[260px] font-mono text-xs bg-secondary border-border">
              <SelectValue placeholder="Select a completed job…" />
            </SelectTrigger>
            <SelectContent>
              {completedJobs.map(j => (
                <SelectItem key={j.id} value={j.id} className="font-mono text-xs">
                  {j.name} ({j.model_type.toUpperCase()})
                </SelectItem>
              ))}
              {completedJobs.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No completed jobs</div>
              )}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={!selectedJobId || runBenchmark.isPending}
            className="gap-2 font-mono text-xs"
          >
            {runBenchmark.isPending ? (
              <Activity className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {runBenchmark.isPending ? 'Running…' : 'Run Benchmark'}
          </Button>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      {hasData && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3"
        >
          <MetricCard
            label="Best MAE"
            value={comparison.bestMae ? (comparison.bestMae.mae * 100).toFixed(2) : '—'}
            unit="%"
            icon={TrendingDown}
            isBest
            color="text-primary"
          />
          <MetricCard
            label="Best Latency"
            value={comparison.bestLatency?.latencyMeanMs.toFixed(1) ?? '—'}
            unit="ms"
            icon={Clock}
            isBest
            color="text-accent"
          />
          <MetricCard
            label="Best Accuracy"
            value={comparison.bestAccuracy?.accuracy ? (comparison.bestAccuracy.accuracy * 100).toFixed(1) : '—'}
            unit="%"
            icon={Gauge}
            isBest
            color="text-accent"
          />
          <MetricCard
            label="Total Runs"
            value={String(benchmarks?.length ?? 0)}
            icon={Activity}
            color="text-muted-foreground"
          />
        </motion.div>
      )}

      {/* Charts */}
      {hasData && barData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  MAE & Latency by Model
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[220px] w-full">
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis yAxisId="left" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar yAxisId="left" dataKey="mae" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} name="MAE (%)" />
                    <Bar yAxisId="right" dataKey="latency" fill="hsl(var(--accent))" radius={[3, 3, 0, 0]} name="Latency (ms)" />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  MAE vs Latency Tradeoff
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[220px] w-full">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="latency" name="Latency (ms)" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis dataKey="mae" name="MAE (%)" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Scatter data={scatterData} fill="hsl(var(--primary))">
                      {scatterData.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? 'hsl(var(--accent))' : 'hsl(var(--primary))'} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      )}

      {/* Results Table */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Benchmark Results
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!hasData ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Gauge className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-sm font-mono">No benchmarks yet</p>
                <p className="text-xs mt-1">Select a completed job and run a benchmark</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-mono text-[10px]">Model</TableHead>
                      <TableHead className="font-mono text-[10px]">Dataset</TableHead>
                      <TableHead className="font-mono text-[10px] text-right">MAE</TableHead>
                      <TableHead className="font-mono text-[10px] text-right">Loss</TableHead>
                      <TableHead className="font-mono text-[10px] text-right">Accuracy</TableHead>
                      <TableHead className="font-mono text-[10px] text-right">Latency</TableHead>
                      <TableHead className="font-mono text-[10px] text-right">P95</TableHead>
                      <TableHead className="font-mono text-[10px] text-right">RPS</TableHead>
                      <TableHead className="font-mono text-[10px]">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <AnimatePresence>
                      {(benchmarks ?? []).map((b, i) => {
                        const isBestMae = comparison.bestMae?.id === b.id;
                        const isBestLatency = comparison.bestLatency?.id === b.id;

                        return (
                          <motion.tr
                            key={b.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.02 }}
                            className="border-b border-border hover:bg-secondary/30 transition-colors"
                          >
                            <TableCell>
                              <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                                {b.modelType}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{b.datasetName}</TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              <span className={isBestMae ? 'text-accent font-semibold' : 'text-foreground'}>
                                {(b.mae * 100).toFixed(2)}%
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-foreground">
                              {b.valLoss?.toFixed(4) ?? '—'}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-foreground">
                              {b.accuracy ? `${(b.accuracy * 100).toFixed(1)}%` : '—'}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              <span className={isBestLatency ? 'text-accent font-semibold' : 'text-foreground'}>
                                {b.latencyMeanMs.toFixed(1)}ms
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {b.latencyP95Ms?.toFixed(1) ?? '—'}ms
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {b.throughputRps?.toFixed(0) ?? '—'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
                            </TableCell>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
