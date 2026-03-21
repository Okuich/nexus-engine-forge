import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import type { EpochMetric } from '@/lib/ml/types';

interface MetricsChartProps {
  metrics: EpochMetric[];
}

const chartConfig = {
  train_loss: { label: 'Train Loss', color: 'hsl(var(--primary))' },
  val_loss: { label: 'Val Loss', color: 'hsl(var(--warning))' },
  accuracy: { label: 'Accuracy', color: 'hsl(var(--accent))' },
};

export function MetricsChart({ metrics }: MetricsChartProps) {
  const data = useMemo(
    () =>
      metrics.map((m) => ({
        epoch: m.epoch,
        train_loss: m.train_loss,
        val_loss: m.val_loss,
        accuracy: m.accuracy != null ? m.accuracy * 100 : null,
      })),
    [metrics]
  );

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Loss Chart */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Loss Curve
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="epoch" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="train_loss" stroke="var(--color-train_loss)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="val_loss" stroke="var(--color-val_loss)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Accuracy Chart */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="epoch" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" domain={[0, 100]} unit="%" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="accuracy" stroke="var(--color-accuracy)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
