/**
 * Operational State Metric Space — Type Definitions
 *
 * Represents every operational snapshot of a manufacturing facility
 * as a point in a high-dimensional metric space, enabling fast
 * similarity-based retrieval of historical situations, their outcomes,
 * and the interventions that were applied.
 */

// ─── Raw Operational Inputs ──────────────────────────────────────

export interface MachineState {
  machineId: string;
  /** 0 idle, 1 running, 2 setup, 3 fault */
  status: 0 | 1 | 2 | 3;
  /** Utilization 0..1 */
  utilization: number;
  /** Spindle/axis load 0..1 */
  load: number;
  /** Temperature normalized 0..1 */
  temperature: number;
}

export interface ProductionQueue {
  /** Jobs waiting to start */
  pending: number;
  /** Jobs currently in progress */
  inProgress: number;
  /** Average queue age in hours */
  avgQueueAgeHrs: number;
  /** Critical-priority job count */
  rushCount: number;
}

export interface MaterialInventory {
  /** SKU count below reorder level */
  stockoutCount: number;
  /** Weighted inventory health 0..1 (1 = healthy) */
  inventoryHealth: number;
  /** Days of cover at current consumption */
  daysOfCover: number;
}

export interface ToolUtilization {
  /** Active tool count */
  activeTools: number;
  /** Average wear 0..1 */
  avgWear: number;
  /** Tools above wear threshold */
  toolsNeedingChange: number;
}

export interface ThroughputMetrics {
  /** Parts completed per hour */
  partsPerHour: number;
  /** Cycle-time efficiency 0..1 (actual vs target) */
  cycleEfficiency: number;
  /** Overall equipment effectiveness 0..1 */
  oee: number;
}

export interface DowntimeMetrics {
  /** Unplanned downtime hours in last 24h */
  unplannedHrs24: number;
  /** Planned downtime hours in last 24h */
  plannedHrs24: number;
  /** Mean time between failures (hours) */
  mtbfHrs: number;
}

export interface EnergyConsumption {
  /** kWh in last hour */
  kwhLastHour: number;
  /** kWh per produced part */
  kwhPerPart: number;
  /** Peak-demand ratio 0..1 */
  peakRatio: number;
}

export interface OrderBacklog {
  /** Open orders */
  openOrders: number;
  /** Total value in USD */
  backlogValueUsd: number;
  /** Orders overdue */
  overdueCount: number;
}

export interface QualityMetrics {
  /** Scrap rate 0..1 */
  scrapRate: number;
  /** First-pass yield 0..1 */
  firstPassYield: number;
  /** Open NCR count */
  openNcrs: number;
}

export interface DemandSignals {
  /** Inbound RFQs per day, smoothed */
  rfqRate: number;
  /** Quote-to-order conversion 0..1 */
  conversionRate: number;
  /** Forecast vs actual demand index (1 = on plan) */
  forecastIndex: number;
}

export interface OperationalSnapshot {
  tenantId: string;
  snapshotAt: string; // ISO timestamp
  machines: MachineState[];
  queue: ProductionQueue;
  inventory: MaterialInventory;
  tools: ToolUtilization;
  throughput: ThroughputMetrics;
  downtime: DowntimeMetrics;
  energy: EnergyConsumption;
  backlog: OrderBacklog;
  quality: QualityMetrics;
  demand: DemandSignals;
}

// ─── State Vector ────────────────────────────────────────────────

/**
 * Ordered dimension names for the OperationalStateVector.
 * Order is part of the contract — do not reorder without rebuilding
 * the vector store and re-fitting the covariance matrix.
 */
export const STATE_DIMENSIONS = [
  // Aggregated machine fleet (4)
  'machine.avgUtilization',
  'machine.avgLoad',
  'machine.avgTemperature',
  'machine.faultRatio',
  // Queue (4)
  'queue.pending',
  'queue.inProgress',
  'queue.avgQueueAgeHrs',
  'queue.rushCount',
  // Inventory (3)
  'inventory.stockoutCount',
  'inventory.inventoryHealth',
  'inventory.daysOfCover',
  // Tools (3)
  'tools.activeTools',
  'tools.avgWear',
  'tools.toolsNeedingChange',
  // Throughput (3)
  'throughput.partsPerHour',
  'throughput.cycleEfficiency',
  'throughput.oee',
  // Downtime (3)
  'downtime.unplannedHrs24',
  'downtime.plannedHrs24',
  'downtime.mtbfHrs',
  // Energy (3)
  'energy.kwhLastHour',
  'energy.kwhPerPart',
  'energy.peakRatio',
  // Backlog (3)
  'backlog.openOrders',
  'backlog.backlogValueUsd',
  'backlog.overdueCount',
  // Quality (3)
  'quality.scrapRate',
  'quality.firstPassYield',
  'quality.openNcrs',
  // Demand (3)
  'demand.rfqRate',
  'demand.conversionRate',
  'demand.forecastIndex',
] as const;

export type StateDimension = (typeof STATE_DIMENSIONS)[number];
export const VECTOR_DIM = STATE_DIMENSIONS.length; // 32

/**
 * A normalized, fixed-length vector representation of an
 * OperationalSnapshot. All components are in [0, 1] after
 * min/max normalization against fitted statistics.
 */
export interface OperationalStateVector {
  id: string;
  tenantId: string;
  snapshotAt: string;
  /** Length = VECTOR_DIM */
  vector: Float32Array;
}

// ─── Outcomes / Interventions ────────────────────────────────────

export interface StateOutcome {
  /** Throughput delta over the next 24h compared to plan */
  throughputDelta: number;
  /** Scrap delta */
  scrapDelta: number;
  /** Revenue delta in USD */
  revenueDeltaUsd: number;
  /** Did the situation resolve positively? */
  resolved: boolean;
}

export interface StateIntervention {
  id: string;
  /** Action category */
  action:
    | 'reschedule'
    | 'tool-change'
    | 'maintenance'
    | 'reroute'
    | 'expedite-material'
    | 'overtime'
    | 'price-adjust'
    | 'manual-review';
  description: string;
  appliedAt: string;
  /** Operator/agent that applied it */
  appliedBy: string;
}

export interface StatePerformanceMetrics {
  oee: number;
  scrapRate: number;
  onTimeDelivery: number;
  energyEfficiency: number;
}

export interface StoredOperationalState {
  vector: OperationalStateVector;
  outcome: StateOutcome | null;
  interventions: StateIntervention[];
  performance: StatePerformanceMetrics;
}

// ─── Distance Metrics ────────────────────────────────────────────

export type DistanceMetric = 'euclidean' | 'cosine' | 'mahalanobis';

export interface NearestNeighborResult {
  state: StoredOperationalState;
  /** Distance under the chosen metric (lower = more similar) */
  distance: number;
  /** Similarity score in [0,1] (higher = more similar) */
  similarity: number;
}

export interface FindSimilarOptions {
  k?: number;
  metric?: DistanceMetric;
  /** Optional filter by tenant */
  tenantId?: string;
  /** Optional minimum similarity threshold */
  minSimilarity?: number;
}
