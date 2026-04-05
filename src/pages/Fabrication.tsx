import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  listJobs, createJob, updateJobStatus, getJobStats, canTransition,
  type FabJob, type FabJobStatus, type FabJobPriority,
} from '@/services/fabrication';
import {
  listQuotes, createQuote, sendQuote, estimateCost, getQuoteStats,
  type FabQuote,
} from '@/services/fabrication';
import {
  listSchedules, createSchedule, getResourceUtilization,
  type FabSchedule,
} from '@/services/fabrication';
import {
  Package, Clock, CheckCircle2, Truck, Plus, Send, ArrowRight,
  Calendar, Wrench, DollarSign, AlertTriangle, Factory,
} from 'lucide-react';

// ─── Status Config ──────────────────────────────────────────────

const STATUS_CONFIG: Record<FabJobStatus, { label: string; color: string; icon: React.ElementType }> = {
  queued: { label: 'Queued', color: 'bg-muted text-muted-foreground', icon: Clock },
  in_progress: { label: 'In Progress', color: 'bg-primary/20 text-primary', icon: Wrench },
  qc: { label: 'QC', color: 'bg-amber-500/20 text-amber-700', icon: AlertTriangle },
  complete: { label: 'Complete', color: 'bg-emerald-500/20 text-emerald-700', icon: CheckCircle2 },
  shipped: { label: 'Shipped', color: 'bg-blue-500/20 text-blue-700', icon: Truck },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/20 text-destructive', icon: Package },
};

const PRIORITY_COLORS: Record<FabJobPriority, string> = {
  low: 'border-muted-foreground/30',
  normal: 'border-primary/30',
  high: 'border-amber-500/50',
  urgent: 'border-destructive/50',
};

const ALL_STATUSES: FabJobStatus[] = ['queued', 'in_progress', 'qc', 'complete', 'shipped', 'cancelled'];

// ─── Jobs Tab ───────────────────────────────────────────────────

function JobsBoard() {
  const queryClient = useQueryClient();
  const { data: jobs = [], isLoading } = useQuery({ queryKey: ['fab-jobs'], queryFn: () => listJobs() });
  const { data: stats } = useQuery({ queryKey: ['fab-job-stats'], queryFn: getJobStats });

  const transitionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: FabJobStatus }) => updateJobStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fab-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['fab-job-stats'] });
      toast.success('Job status updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: FabJobStatus[] = ['queued', 'in_progress', 'qc', 'complete', 'shipped'];

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {ALL_STATUSES.map(s => {
          const cfg = STATUS_CONFIG[s];
          return (
            <Card key={s} className="border-0 shadow-none bg-secondary/30">
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{stats?.[s] ?? 0}</p>
                <p className="text-xs text-muted-foreground">{cfg.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Kanban board */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 overflow-x-auto">
        {columns.map(col => {
          const cfg = STATUS_CONFIG[col];
          const colJobs = jobs.filter(j => j.status === col);
          return (
            <div key={col} className="min-w-[200px]">
              <div className="flex items-center gap-2 mb-2 px-1">
                <cfg.icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {cfg.label}
                </span>
                <Badge variant="secondary" className="text-[10px] ml-auto">{colJobs.length}</Badge>
              </div>
              <div className="space-y-2">
                {colJobs.map(job => (
                  <Card key={job.id} className={`border-l-2 ${PRIORITY_COLORS[job.priority]}`}>
                    <CardContent className="p-3 space-y-2">
                      <p className="text-sm font-medium text-foreground leading-tight">{job.title}</p>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span>{job.material}</span>
                        <span>·</span>
                        <span>{job.process}</span>
                        <span>·</span>
                        <span>×{job.quantity}</span>
                      </div>
                      {job.due_date && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-2.5 w-2.5" />
                          Due {new Date(job.due_date).toLocaleDateString()}
                        </p>
                      )}
                      {/* Transition buttons */}
                      <div className="flex flex-wrap gap-1 pt-1">
                        {ALL_STATUSES.filter(s => canTransition(job.status, s)).map(nextStatus => (
                          <Button
                            key={nextStatus}
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[10px] px-2"
                            onClick={() => transitionMutation.mutate({ id: job.id, status: nextStatus })}
                          >
                            <ArrowRight className="h-2.5 w-2.5 mr-1" />
                            {STATUS_CONFIG[nextStatus].label}
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {colJobs.length === 0 && (
                  <div className="text-center py-6 text-xs text-muted-foreground">No jobs</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Schedule Tab ───────────────────────────────────────────────

function ScheduleView() {
  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ['fab-schedules'],
    queryFn: () => listSchedules(),
  });
  const { data: utilization = [] } = useQuery({
    queryKey: ['fab-utilization'],
    queryFn: () => {
      const now = new Date();
      const from = now.toISOString();
      const to = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      return getResourceUtilization(from, to);
    },
  });

  return (
    <div className="space-y-4">
      {/* Resource utilization */}
      {utilization.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {utilization.map(u => (
            <Card key={u.resource} className="border-0 shadow-none bg-secondary/30">
              <CardContent className="p-3">
                <p className="text-sm font-medium text-foreground">{u.resource}</p>
                <p className="text-2xl font-bold text-primary">{u.scheduledHours}h</p>
                <p className="text-xs text-muted-foreground">{u.slotCount} scheduled slots</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Schedule list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Upcoming Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No scheduled slots yet. Create a job and schedule it.</p>
          ) : (
            <div className="space-y-2">
              {schedules.map(s => (
                <div key={s.id} className="flex items-center gap-3 p-2 rounded-md bg-secondary/20">
                  <Calendar className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{s.resource_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(s.start_date).toLocaleDateString()} → {new Date(s.end_date).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{s.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Quotes Tab ─────────────────────────────────────────────────

function QuotesPanel() {
  const queryClient = useQueryClient();
  const { data: quotes = [] } = useQuery({ queryKey: ['fab-quotes'], queryFn: () => listQuotes() });
  const { data: stats } = useQuery({ queryKey: ['fab-quote-stats'], queryFn: getQuoteStats });

  const sendMutation = useMutation({
    mutationFn: (id: string) => sendQuote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fab-quotes'] });
      queryClient.invalidateQueries({ queryKey: ['fab-quote-stats'] });
      toast.success('Quote sent');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const statusColors: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    sent: 'bg-primary/20 text-primary',
    accepted: 'bg-emerald-500/20 text-emerald-700',
    rejected: 'bg-destructive/20 text-destructive',
    expired: 'bg-amber-500/20 text-amber-700',
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {(['draft', 'sent', 'accepted', 'rejected', 'expired'] as const).map(s => (
          <Card key={s} className="border-0 shadow-none bg-secondary/30">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-foreground">{stats?.[s] ?? 0}</p>
              <p className="text-xs text-muted-foreground capitalize">{s}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        {quotes.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No quotes yet. Create one from a job or RFQ.
            </CardContent>
          </Card>
        ) : quotes.map(q => (
          <Card key={q.id}>
            <CardContent className="p-3 flex items-center gap-3">
              <DollarSign className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  ${Number(q.unit_price_usd).toFixed(2)}/unit × {Math.round(Number(q.total_price_usd) / Number(q.unit_price_usd))} = ${Number(q.total_price_usd).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {q.lead_time_days}d lead time · Created {new Date(q.created_at).toLocaleDateString()}
                </p>
              </div>
              <Badge className={`text-[10px] ${statusColors[q.status] ?? ''}`}>{q.status}</Badge>
              {q.status === 'draft' && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => sendMutation.mutate(q.id)}>
                  <Send className="h-3 w-3 mr-1" /> Send
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── New Job Dialog ─────────────────────────────────────────────

function NewJobDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: '', material: 'aluminum', process: 'cnc_milling',
    quantity: '1', priority: 'normal' as FabJobPriority, due_date: '', notes: '',
  });

  const mutation = useMutation({
    mutationFn: () => createJob({
      title: form.title,
      material: form.material,
      process: form.process,
      quantity: parseInt(form.quantity) || 1,
      priority: form.priority,
      due_date: form.due_date || undefined,
      notes: form.notes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fab-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['fab-job-stats'] });
      toast.success('Job created');
      setOpen(false);
      setForm({ title: '', material: 'aluminum', process: 'cnc_milling', quantity: '1', priority: 'normal', due_date: '', notes: '' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs gap-1">
          <Plus className="h-3.5 w-3.5" /> New Job
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Factory className="h-4 w-4" /> Create Fabrication Job
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Part name or description" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Material</Label>
              <Select value={form.material} onValueChange={v => setForm(f => ({ ...f, material: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['aluminum', 'steel', 'titanium', 'plastic', 'copper'].map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Process</Label>
              <Select value={form.process} onValueChange={v => setForm(f => ({ ...f, process: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['cnc_milling', 'turning', 'edm', 'grinding', 'injection_molding'].map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Quantity</Label>
              <Input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as FabJobPriority }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['low', 'normal', 'high', 'urgent'].map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Due Date</Label>
              <Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional notes..." />
          </div>
          <Button className="w-full" onClick={() => mutation.mutate()} disabled={!form.title || mutation.isPending}>
            {mutation.isPending ? 'Creating...' : 'Create Job'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ──────────────────────────────────────────────────

export default function Fabrication() {
  return (
    <div className="h-full flex flex-col p-4 overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Factory className="h-5 w-5 text-primary" />
            Fabrication OS
          </h1>
          <p className="text-xs text-muted-foreground">Manage jobs, scheduling, and quoting</p>
        </div>
        <NewJobDialog />
      </div>

      <Tabs defaultValue="jobs" className="flex-1">
        <TabsList className="mb-3">
          <TabsTrigger value="jobs" className="text-xs gap-1"><Package className="h-3 w-3" /> Jobs</TabsTrigger>
          <TabsTrigger value="schedule" className="text-xs gap-1"><Calendar className="h-3 w-3" /> Schedule</TabsTrigger>
          <TabsTrigger value="quotes" className="text-xs gap-1"><DollarSign className="h-3 w-3" /> Quotes</TabsTrigger>
        </TabsList>
        <TabsContent value="jobs"><JobsBoard /></TabsContent>
        <TabsContent value="schedule"><ScheduleView /></TabsContent>
        <TabsContent value="quotes"><QuotesPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
