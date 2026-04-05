/**
 * Fabrication OS — Job Manager
 *
 * CRUD and status transitions for fabrication jobs.
 * Enforces valid state machine transitions.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ──────────────────────────────────────────────────────

export type FabJobStatus = 'queued' | 'in_progress' | 'qc' | 'complete' | 'shipped' | 'cancelled';
export type FabJobPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface FabJob {
  id: string;
  title: string;
  status: FabJobStatus;
  priority: FabJobPriority;
  supplier_id: string;
  rfq_id: string | null;
  material: string;
  process: string;
  quantity: number;
  due_date: string | null;
  notes: string | null;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJobInput {
  title: string;
  material: string;
  process: string;
  quantity: number;
  priority?: FabJobPriority;
  rfq_id?: string;
  due_date?: string;
  notes?: string;
  tenant_id?: string;
}

// ─── Valid Transitions ──────────────────────────────────────────

const VALID_TRANSITIONS: Record<FabJobStatus, FabJobStatus[]> = {
  queued: ['in_progress', 'cancelled'],
  in_progress: ['qc', 'cancelled'],
  qc: ['complete', 'in_progress'], // can return to in_progress if QC fails
  complete: ['shipped'],
  shipped: [],
  cancelled: ['queued'], // can re-queue a cancelled job
};

export function canTransition(from: FabJobStatus, to: FabJobStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── CRUD ───────────────────────────────────────────────────────

export async function listJobs(filters?: {
  status?: FabJobStatus;
  priority?: FabJobPriority;
}): Promise<FabJob[]> {
  let query = supabase
    .from('fabrication_jobs')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.priority) query = query.eq('priority', filters.priority);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FabJob[];
}

export async function getJob(id: string): Promise<FabJob> {
  const { data, error } = await supabase
    .from('fabrication_jobs')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as FabJob;
}

export async function createJob(input: CreateJobInput): Promise<FabJob> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('fabrication_jobs')
    .insert({
      title: input.title,
      material: input.material,
      process: input.process,
      quantity: input.quantity,
      priority: input.priority ?? 'normal',
      rfq_id: input.rfq_id ?? null,
      due_date: input.due_date ?? null,
      notes: input.notes ?? null,
      tenant_id: input.tenant_id ?? null,
      supplier_id: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return data as FabJob;
}

export async function updateJobStatus(
  id: string,
  newStatus: FabJobStatus,
): Promise<FabJob> {
  const job = await getJob(id);
  if (!canTransition(job.status, newStatus)) {
    throw new Error(`Cannot transition from "${job.status}" to "${newStatus}"`);
  }

  const { data, error } = await supabase
    .from('fabrication_jobs')
    .update({ status: newStatus })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as FabJob;
}

export async function updateJob(
  id: string,
  updates: Partial<Pick<FabJob, 'title' | 'priority' | 'due_date' | 'notes' | 'quantity'>>,
): Promise<FabJob> {
  const { data, error } = await supabase
    .from('fabrication_jobs')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as FabJob;
}

// ─── Stats ──────────────────────────────────────────────────────

export async function getJobStats(): Promise<Record<FabJobStatus, number>> {
  const jobs = await listJobs();
  const stats: Record<FabJobStatus, number> = {
    queued: 0, in_progress: 0, qc: 0, complete: 0, shipped: 0, cancelled: 0,
  };
  for (const j of jobs) {
    stats[j.status] = (stats[j.status] || 0) + 1;
  }
  return stats;
}
