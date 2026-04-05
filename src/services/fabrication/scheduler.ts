/**
 * Fabrication OS — Scheduler
 *
 * Schedule jobs against capacity, detect conflicts,
 * and provide timeline views.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ──────────────────────────────────────────────────────

export type FabScheduleStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export interface FabSchedule {
  id: string;
  job_id: string;
  start_date: string;
  end_date: string;
  resource_name: string;
  status: FabScheduleStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleInput {
  job_id: string;
  start_date: string;
  end_date: string;
  resource_name?: string;
  notes?: string;
}

export interface ScheduleConflict {
  existingScheduleId: string;
  resource: string;
  overlapStart: string;
  overlapEnd: string;
}

// ─── CRUD ───────────────────────────────────────────────────────

export async function listSchedules(filters?: {
  job_id?: string;
  resource_name?: string;
  from?: string;
  to?: string;
}): Promise<FabSchedule[]> {
  let query = supabase
    .from('fabrication_schedules')
    .select('*')
    .order('start_date', { ascending: true });

  if (filters?.job_id) query = query.eq('job_id', filters.job_id);
  if (filters?.resource_name) query = query.eq('resource_name', filters.resource_name);
  if (filters?.from) query = query.gte('start_date', filters.from);
  if (filters?.to) query = query.lte('end_date', filters.to);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FabSchedule[];
}

export async function createSchedule(input: ScheduleInput): Promise<FabSchedule> {
  // Check for conflicts first
  const conflicts = await detectConflicts(
    input.start_date,
    input.end_date,
    input.resource_name ?? 'default',
  );

  if (conflicts.length > 0) {
    throw new Error(
      `Schedule conflict on resource "${input.resource_name ?? 'default'}": ` +
      `overlaps with ${conflicts.length} existing slot(s)`,
    );
  }

  const { data, error } = await supabase
    .from('fabrication_schedules')
    .insert({
      job_id: input.job_id,
      start_date: input.start_date,
      end_date: input.end_date,
      resource_name: input.resource_name ?? 'default',
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as FabSchedule;
}

export async function updateScheduleStatus(
  id: string,
  status: FabScheduleStatus,
): Promise<FabSchedule> {
  const { data, error } = await supabase
    .from('fabrication_schedules')
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as FabSchedule;
}

// ─── Conflict Detection ─────────────────────────────────────────

export async function detectConflicts(
  startDate: string,
  endDate: string,
  resourceName: string,
  excludeId?: string,
): Promise<ScheduleConflict[]> {
  let query = supabase
    .from('fabrication_schedules')
    .select('*')
    .eq('resource_name', resourceName)
    .neq('status', 'cancelled')
    .lt('start_date', endDate)
    .gt('end_date', startDate);

  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((s: any) => ({
    existingScheduleId: s.id,
    resource: s.resource_name,
    overlapStart: s.start_date > startDate ? s.start_date : startDate,
    overlapEnd: s.end_date < endDate ? s.end_date : endDate,
  }));
}

// ─── Capacity View ──────────────────────────────────────────────

export interface ResourceUtilization {
  resource: string;
  scheduledHours: number;
  slotCount: number;
}

export async function getResourceUtilization(
  from: string,
  to: string,
): Promise<ResourceUtilization[]> {
  const schedules = await listSchedules({ from, to });

  const resourceMap = new Map<string, { hours: number; count: number }>();

  for (const s of schedules) {
    if (s.status === 'cancelled') continue;
    const start = new Date(s.start_date).getTime();
    const end = new Date(s.end_date).getTime();
    const hours = (end - start) / (1000 * 60 * 60);

    const existing = resourceMap.get(s.resource_name) ?? { hours: 0, count: 0 };
    existing.hours += hours;
    existing.count += 1;
    resourceMap.set(s.resource_name, existing);
  }

  return Array.from(resourceMap.entries()).map(([resource, data]) => ({
    resource,
    scheduledHours: Math.round(data.hours * 10) / 10,
    slotCount: data.count,
  }));
}
