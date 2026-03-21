import { motion } from 'framer-motion';
import type { TrainingJob } from '@/lib/ml/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { XCircle, Clock, Cpu, Layers, Zap } from 'lucide-react';

interface JobDetailProps {
  job: TrainingJob;
  onCancel: () => void;
}

export function JobDetail({ job, onCancel }: JobDetailProps) {
  const isActive = job.status === 'training' || job.status === 'preprocessing' || job.status === 'evaluating';

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Job Info */}
      <Card className="md:col-span-2 bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="font-mono text-base text-foreground">{job.name}</CardTitle>
            {isActive && (
              <Button variant="ghost" size="sm" onClick={onCancel} className="text-destructive gap-1.5 text-xs">
                <XCircle className="h-3.5 w-3.5" /> Cancel
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="font-mono text-xs uppercase">{job.model_type}</Badge>
            <Badge variant="outline" className="font-mono text-xs">{job.status}</Badge>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground font-mono">
                Epoch {job.epochs_completed} / {job.epochs_total}
              </span>
              <span className="text-xs font-mono text-primary">{job.progress}%</span>
            </div>
            <Progress value={job.progress} className="h-2" />
          </div>

          {job.error_message && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive font-mono"
            >
              {job.error_message}
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* Metrics Summary */}
      <div className="space-y-3">
        {[
          { label: 'Best Accuracy', value: job.metrics?.best_accuracy != null ? `${(job.metrics.best_accuracy * 100).toFixed(2)}%` : '—', icon: Zap, color: 'text-accent' },
          { label: 'Best Val Loss', value: job.metrics?.best_val_loss?.toFixed(4) ?? '—', icon: Layers, color: 'text-primary' },
          { label: 'Best F1', value: job.metrics?.best_f1?.toFixed(4) ?? '—', icon: Cpu, color: 'text-primary' },
          { label: 'Train Loss', value: job.metrics?.final_train_loss?.toFixed(4) ?? '—', icon: Clock, color: 'text-muted-foreground' },
        ].map((m, i) => (
          <motion.div
            key={m.label}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card className="bg-card border-border">
              <CardContent className="p-3 flex items-center gap-3">
                <m.icon className={`h-4 w-4 ${m.color}`} />
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">{m.label}</p>
                  <p className={`text-sm font-mono font-semibold ${m.color}`}>{m.value}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
