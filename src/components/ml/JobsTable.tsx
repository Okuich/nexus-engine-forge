import { motion } from 'framer-motion';
import type { TrainingJob } from '@/lib/ml/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { formatDistanceToNow } from 'date-fns';

const statusColors: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  preprocessing: 'bg-primary/20 text-primary',
  training: 'bg-primary/20 text-primary',
  evaluating: 'bg-accent/20 text-accent',
  completed: 'bg-accent/20 text-accent',
  failed: 'bg-destructive/20 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

interface JobsTableProps {
  jobs: TrainingJob[];
  isLoading: boolean;
  onSelect: (id: string) => void;
}

export function JobsTable({ jobs, isLoading, onSelect }: JobsTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (!jobs.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm font-mono">No training jobs yet</p>
        <p className="text-xs mt-1">Create a new job to get started</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-mono text-xs">Name</TableHead>
            <TableHead className="font-mono text-xs">Model</TableHead>
            <TableHead className="font-mono text-xs">Status</TableHead>
            <TableHead className="font-mono text-xs">Progress</TableHead>
            <TableHead className="font-mono text-xs">Accuracy</TableHead>
            <TableHead className="font-mono text-xs">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job, i) => (
            <motion.tr
              key={job.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="border-b border-border cursor-pointer hover:bg-secondary/50 transition-colors"
              onClick={() => onSelect(job.id)}
            >
              <TableCell className="font-mono text-sm text-foreground">{job.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground uppercase">{job.model_type}</TableCell>
              <TableCell>
                <Badge variant="secondary" className={`font-mono text-xs ${statusColors[job.status] ?? ''}`}>
                  {job.status === 'training' && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary mr-1.5 animate-pulse" />
                  )}
                  {job.status}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 min-w-[120px]">
                  <Progress value={job.progress} className="h-1.5 flex-1" />
                  <span className="text-xs font-mono text-muted-foreground w-8 text-right">{job.progress}%</span>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs text-foreground">
                {job.metrics?.best_accuracy != null
                  ? `${(job.metrics.best_accuracy * 100).toFixed(1)}%`
                  : '—'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
              </TableCell>
            </motion.tr>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
