import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { FileBox, ArrowRight } from 'lucide-react';
import type { TrainingJob } from '@/lib/ml/types';

interface PipelineHistoryProps {
  pipelines: TrainingJob[];
  isLoading: boolean;
  onSelect: (id: string) => void;
}

const statusColors: Record<string, string> = {
  completed: 'bg-accent/20 text-accent',
  failed: 'bg-destructive/20 text-destructive',
  preprocessing: 'bg-primary/20 text-primary',
  evaluating: 'bg-primary/20 text-primary',
  queued: 'bg-muted text-muted-foreground',
};

export function PipelineHistory({ pipelines, isLoading, onSelect }: PipelineHistoryProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!pipelines.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <FileBox className="h-8 w-8 mb-3 opacity-50" />
        <p className="text-sm font-mono">No pipeline runs yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pipelines.map((p, i) => {
        const config = p.config as any;
        const metrics = p.metrics as any;
        return (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            <Card
              className="bg-card border-border cursor-pointer hover:border-primary/30 transition-colors"
              onClick={() => onSelect(p.id)}
            >
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-md bg-secondary flex items-center justify-center shrink-0">
                    <FileBox className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-mono text-foreground">{config?.file_name ?? p.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-mono text-muted-foreground">{config?.material ?? '—'}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{config?.process ?? '—'}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {metrics?.manufacturability_score != null && (
                    <span className="text-sm font-mono font-semibold text-accent">
                      {metrics.manufacturability_score}/100
                    </span>
                  )}
                  <Badge variant="secondary" className={`font-mono text-[10px] ${statusColors[p.status] ?? ''}`}>
                    {p.status}
                  </Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
