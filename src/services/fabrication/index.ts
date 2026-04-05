/**
 * Fabrication OS — Public API
 */

// Job Manager
export {
  listJobs,
  getJob,
  createJob,
  updateJobStatus,
  updateJob,
  getJobStats,
  canTransition,
} from './jobManager';
export type {
  FabJob,
  FabJobStatus,
  FabJobPriority,
  CreateJobInput,
} from './jobManager';

// Scheduler
export {
  listSchedules,
  createSchedule,
  updateScheduleStatus,
  detectConflicts,
  getResourceUtilization,
} from './scheduler';
export type {
  FabSchedule,
  FabScheduleStatus,
  ScheduleInput,
  ScheduleConflict,
  ResourceUtilization,
} from './scheduler';

// Quoter
export {
  listQuotes,
  createQuote,
  sendQuote,
  updateQuoteStatus,
  estimateCost,
  getQuoteStats,
} from './quoter';
export type {
  FabQuote,
  FabQuoteStatus,
  CreateQuoteInput,
  QuoteCostBreakdown,
} from './quoter';
