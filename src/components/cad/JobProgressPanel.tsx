/**
 * JobProgressPanel
 *
 * Live progress UI for a `simplify-jobs` job. Polls `status` while the job
 * is non-terminal, displays a progress bar + status badge, and accumulates
 * per-level messages reported by the worker (e.g. "LOD 1/4: 12,432 → 6,210
 * triangles").
 *
 * Purely presentational — does not download or parse the result payload.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, CheckCircle2, XCircle, Ban, Clock, Activity,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  simplifyJobsApi,
  waitForSimplificationJob,
  type SimplificationJob,
  type SimplificationJobStatus,
} from '@/lib/api/simplifyJobsApi';

interface ProgressEntry {
  /** Monotonic id (ms timestamp + counter) for stable list keys. */
  id: string;
  at: number;
  status: SimplificationJobStatus;
  progress: number;
  message: string;
  /** Parsed level number when the message looks like "LOD k/N …". */
  level?: number;
}

export interface JobProgressPanelProps {
  jobId: string;
  /** Polling cadence; defaults to 1.2s. */
  intervalMs?: number;
  /** Notified when the job reaches a terminal state. */
  onSettled?: (job: SimplificationJob) => void;
  /** Show a Cancel button while the job is still running. */
  allowCancel?: boolean;
  className?: string;
}

const STATUS_META: Record<
  SimplificationJobStatus,
  { label: string; icon: typeof Loader2; tone: string; spin: boolean }
> = {
  queued:    { label: 'Queued',    icon: Clock,        tone: 'bg-muted text-muted-foreground',          spin: false },
  running:   { label: 'Running',   icon: Loader2,      tone: 'bg-primary/15 text-primary',              spin: true  },
  completed: { label: 'Completed', icon: CheckCircle2, tone: 'bg-accent/15 text-accent',                spin: false },
  failed:    { label: 'Failed',    icon: XCircle,      tone: 'bg-destructive/15 text-destructive',      spin: false },
  cancelled: { label: 'Cancelled', icon: Ban,          tone: 'bg-muted text-muted-foreground',          spin: false },
};

/** Pull a leading "LOD k/N" or "Level k" hint out of a status message. */
function parseLevel(message: string | null | undefined): number | undefined {
  if (!message) return undefined;
  const m = message.match(/(?:LOD|Level)\s+(\d+)\s*(?:\/\s*\d+)?/i);
  return m ? Number(m[1]) : undefined;
}

export function JobProgressPanel({
  jobId,
  intervalMs = 1200,
  onSettled,
  allowCancel = true,
  className,
}: JobProgressPanelProps) {
  const [job, setJob] = useState<SimplificationJob | null>(null);
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Avoid pushing duplicate consecutive (progress, message) pairs.
  const lastSigRef = useRef<string>('');
  const counterRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setJob(null);
    setEntries([]);
    setError(null);
    lastSigRef.current = '';
    counterRef.current = 0;

    const ac = new AbortController();
    abortRef.current = ac;

    waitForSimplificationJob(jobId, {
      intervalMs,
      signal: ac.signal,
      onProgress: (snap) => {
        setJob(snap);
        const sig = `${snap.status}|${snap.progress}|${snap.message ?? ''}`;
        if (sig === lastSigRef.current) return;
        lastSigRef.current = sig;
        counterRef.current += 1;
        setEntries((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${counterRef.current}`,
            at: Date.now(),
            status: snap.status,
            progress: snap.progress,
            message: snap.message ?? STATUS_META[snap.status].label,
            level: parseLevel(snap.message),
          },
        ]);
      },
    })
      .then((finalJob) => {
        setJob(finalJob);
        onSettled?.(finalJob);
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => ac.abort();
    // onSettled intentionally excluded to keep the polling loop stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, intervalMs]);

  const status: SimplificationJobStatus = job?.status ?? 'queued';
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';
  const progressPct = Math.max(0, Math.min(100, Math.round((job?.progress ?? 0) * 100)));

  const handleCancel = async () => {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      await simplifyJobsApi.cancel(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div
      className={
        'rounded-lg border border-border bg-card/60 backdrop-blur p-4 space-y-3 ' +
        (className ?? '')
      }
      role="status"
      aria-live="polite"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={'h-4 w-4 shrink-0 ' + (meta.spin ? 'animate-spin' : '')} />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              Simplification job
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {jobId.slice(0, 8)}
              </span>
            </div>
            {job?.job_type && (
              <div className="text-xs text-muted-foreground">{job.job_type}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={meta.tone} variant="secondary">{meta.label}</Badge>
          {allowCancel && !isTerminal && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <Progress value={progressPct} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span className="truncate pr-2">{job?.message ?? 'Waiting for worker…'}</span>
          <span className="tabular-nums">{progressPct}%</span>
        </div>
      </div>

      {/* Per-level message log */}
      <div className="rounded-md border border-border/60 bg-background/40">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          Activity
          <span className="ml-auto tabular-nums">{entries.length}</span>
        </div>
        <ScrollArea className="h-40">
          <ul className="p-2 space-y-1">
            <AnimatePresence initial={false}>
              {entries.map((e) => (
                <motion.li
                  key={e.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-start gap-2 text-xs"
                >
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                    {Math.round(e.progress * 100).toString().padStart(3, ' ')}%
                  </span>
                  {typeof e.level === 'number' && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px] shrink-0">
                      L{e.level}
                    </Badge>
                  )}
                  <span className="text-foreground/90 break-words">{e.message}</span>
                </motion.li>
              ))}
              {entries.length === 0 && (
                <li className="text-xs text-muted-foreground px-2 py-3 text-center">
                  No updates yet…
                </li>
              )}
            </AnimatePresence>
          </ul>
        </ScrollArea>
      </div>

      {/* Failure / error */}
      {(error || job?.error_message) && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error ?? job?.error_message}
        </div>
      )}
    </div>
  );
}

export default JobProgressPanel;
