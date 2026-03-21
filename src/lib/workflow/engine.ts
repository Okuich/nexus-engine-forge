/**
 * Workflow Engine — Plan Generator
 *
 * Converts AI agent outputs into detailed execution plans
 * with operation sequencing, resource allocation, dependency
 * resolution, critical path analysis, and timeline generation.
 */

import type {
  AgentOutputs,
  ExecutionPlan,
  OperationStep,
  OperationCategory,
  Resource,
  ResourceAssignment,
  QualityCheckpoint,
  TimelineSummary,
  CostSummary,
  GanttBar,
  PlanRisk,
} from './types';

// ─── Resource Pool ───────────────────────────────────────────────

const DEFAULT_RESOURCES: Resource[] = [
  { id: 'cnc-5ax', type: 'machine', name: '5-Axis CNC Mill', availabilityHrs: 16, costPerHr: 95, utilization: 0, capabilities: ['milling', 'drilling', 'contouring'] },
  { id: 'cnc-3ax', type: 'machine', name: '3-Axis CNC Mill', availabilityHrs: 16, costPerHr: 65, utilization: 0, capabilities: ['milling', 'drilling', 'facing'] },
  { id: 'lathe-cnc', type: 'machine', name: 'CNC Lathe', availabilityHrs: 16, costPerHr: 55, utilization: 0, capabilities: ['turning', 'boring', 'threading'] },
  { id: 'edm-wire', type: 'machine', name: 'Wire EDM', availabilityHrs: 8, costPerHr: 120, utilization: 0, capabilities: ['edm', 'fine-cutting'] },
  { id: 'cmm', type: 'inspection', name: 'CMM Station', availabilityHrs: 8, costPerHr: 75, utilization: 0, capabilities: ['dimensional', 'cmm', 'profile'] },
  { id: 'operator-sr', type: 'operator', name: 'Senior Machinist', availabilityHrs: 8, costPerHr: 55, utilization: 0, capabilities: ['setup', 'programming', '5-axis'] },
  { id: 'operator-jr', type: 'operator', name: 'Machinist', availabilityHrs: 8, costPerHr: 38, utilization: 0, capabilities: ['setup', 'operation', 'deburring'] },
  { id: 'inspector', type: 'operator', name: 'QC Inspector', availabilityHrs: 8, costPerHr: 45, utilization: 0, capabilities: ['inspection', 'cmm-operation', 'reporting'] },
];

// ─── Material Properties for Planning ────────────────────────────

const MATERIAL_MACHINABILITY: Record<string, number> = {
  'Ti-6Al-4V': 0.3,
  'Inconel 718': 0.2,
  'Al 7075-T6': 1.0,
  'Al 6061-T6': 1.1,
  'SS 304': 0.5,
  'SS 316': 0.45,
  '4340 Steel': 0.6,
  'Copper C110': 0.9,
};

function getMachinability(material: string): number {
  for (const [key, val] of Object.entries(MATERIAL_MACHINABILITY)) {
    if (material.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return 0.6; // default
}

// ─── Step Generation ─────────────────────────────────────────────

function generateSteps(inputs: AgentOutputs): OperationStep[] {
  const steps: OperationStep[] = [];
  const machinability = getMachinability(inputs.material);
  const complexity = inputs.geometry?.complexityScore ?? 50;
  const volume = inputs.geometry?.volume ?? 100;
  const faceCount = inputs.geometry?.faceCount ?? 30;
  const holeCount = inputs.geometry?.holeCount ?? 5;
  const minThickness = inputs.geometry?.minThickness ?? 2;
  const needsHeatTreat = inputs.simulation?.requiresHeatTreatment ?? false;
  const criticalRegions = inputs.simulation?.criticalRegionCount ?? 0;

  let seq = 0;

  // 1. Material preparation / stock cutting
  const stockSetupHrs = 0.25 + volume / 5000;
  steps.push(makeStep({
    id: 'stock-prep',
    sequence: ++seq,
    name: 'Stock Preparation',
    description: `Cut raw ${inputs.material} stock to near-net size. Verify material cert.`,
    category: 'setup',
    durationHrs: stockSetupHrs,
    setupHrs: 0.15,
    resources: [{ resourceId: 'operator-jr', resourceName: 'Machinist', resourceType: 'operator', hoursNeeded: stockSetupHrs, costUsd: 0 }],
  }));

  // 2. Machine setup
  const needs5Axis = complexity > 60 || faceCount > 40;
  const machineId = needs5Axis ? 'cnc-5ax' : 'cnc-3ax';
  const machineName = needs5Axis ? '5-Axis CNC Mill' : '3-Axis CNC Mill';
  const setupHrs = needs5Axis ? 1.5 : 0.75;

  steps.push(makeStep({
    id: 'machine-setup',
    sequence: ++seq,
    name: `${machineName} Setup`,
    description: `Load program, mount fixture, zero work coordinate system. ${needs5Axis ? 'Calibrate rotary axes.' : ''}`,
    category: 'setup',
    durationHrs: setupHrs,
    setupHrs,
    dependsOn: ['stock-prep'],
    resources: [
      { resourceId: machineId, resourceName: machineName, resourceType: 'machine', hoursNeeded: setupHrs, costUsd: 0 },
      { resourceId: 'operator-sr', resourceName: 'Senior Machinist', resourceType: 'operator', hoursNeeded: setupHrs, costUsd: 0 },
    ],
  }));

  // 3. Roughing
  const roughingHrs = (volume / 200) / machinability * (1 + complexity / 200);
  steps.push(makeStep({
    id: 'roughing',
    sequence: ++seq,
    name: 'Roughing Pass',
    description: `Remove bulk material. Adaptive clearing strategy. Target: 0.5mm stock remaining.`,
    category: 'roughing',
    durationHrs: roundHrs(roughingHrs),
    setupHrs: 0.1,
    dependsOn: ['machine-setup'],
    resources: [
      { resourceId: machineId, resourceName: machineName, resourceType: 'machine', hoursNeeded: roundHrs(roughingHrs), costUsd: 0 },
      { resourceId: 'operator-jr', resourceName: 'Machinist', resourceType: 'operator', hoursNeeded: roundHrs(roughingHrs) * 0.5, costUsd: 0 },
    ],
  }));

  // 4. Semi-finishing (if complex)
  if (complexity > 40) {
    const semiHrs = roughingHrs * 0.4;
    steps.push(makeStep({
      id: 'semi-finish',
      sequence: ++seq,
      name: 'Semi-Finishing Pass',
      description: `Reduce stock to 0.15mm. Pencil milling on fillets and transitions.`,
      category: 'finishing',
      durationHrs: roundHrs(semiHrs),
      setupHrs: 0.05,
      dependsOn: ['roughing'],
      resources: [
        { resourceId: machineId, resourceName: machineName, resourceType: 'machine', hoursNeeded: roundHrs(semiHrs), costUsd: 0 },
      ],
    }));
  }

  // 5. Drilling operations
  if (holeCount > 0) {
    const drillHrs = holeCount * 0.12 / machinability;
    steps.push(makeStep({
      id: 'drilling',
      sequence: ++seq,
      name: `Drilling (${holeCount} holes)`,
      description: `Drill, ream, and chamfer ${holeCount} holes. Peck cycle for deep holes.`,
      category: 'drilling',
      durationHrs: roundHrs(drillHrs),
      setupHrs: 0.1,
      dependsOn: [complexity > 40 ? 'semi-finish' : 'roughing'],
      resources: [
        { resourceId: machineId, resourceName: machineName, resourceType: 'machine', hoursNeeded: roundHrs(drillHrs), costUsd: 0 },
      ],
    }));
  }

  // 6. Finishing
  const finishHrs = (faceCount * 0.05 + complexity * 0.02) / machinability;
  steps.push(makeStep({
    id: 'finishing',
    sequence: ++seq,
    name: 'Finish Machining',
    description: `Final contour passes. Target Ra 1.6µm. Ball-nose for freeform surfaces.`,
    category: 'finishing',
    durationHrs: roundHrs(finishHrs),
    setupHrs: 0.05,
    dependsOn: [holeCount > 0 ? 'drilling' : (complexity > 40 ? 'semi-finish' : 'roughing')],
    resources: [
      { resourceId: machineId, resourceName: machineName, resourceType: 'machine', hoursNeeded: roundHrs(finishHrs), costUsd: 0 },
      { resourceId: 'operator-sr', resourceName: 'Senior Machinist', resourceType: 'operator', hoursNeeded: roundHrs(finishHrs) * 0.3, costUsd: 0 },
    ],
  }));

  // 7. In-process inspection
  steps.push(makeStep({
    id: 'in-process-inspect',
    sequence: ++seq,
    name: 'In-Process Inspection',
    description: `CMM check of critical dimensions. Verify wall thickness ≥${minThickness}mm.`,
    category: 'inspection',
    durationHrs: 0.5 + criticalRegions * 0.15,
    setupHrs: 0.1,
    dependsOn: ['finishing'],
    resources: [
      { resourceId: 'cmm', resourceName: 'CMM Station', resourceType: 'inspection', hoursNeeded: 0.5, costUsd: 0 },
      { resourceId: 'inspector', resourceName: 'QC Inspector', resourceType: 'operator', hoursNeeded: 0.5, costUsd: 0 },
    ],
    qualityCheck: {
      id: 'qc-dimensional',
      name: 'Dimensional Inspection',
      method: 'cmm',
      tolerance: 'IT7 (±0.025mm)',
      holdPoint: true,
    },
  }));

  // 8. Heat treatment (if needed)
  if (needsHeatTreat) {
    steps.push(makeStep({
      id: 'heat-treat',
      sequence: ++seq,
      name: 'Heat Treatment',
      description: `Stress-relief anneal per AMS spec. Controlled atmosphere furnace.`,
      category: 'heat-treatment',
      durationHrs: 8,
      setupHrs: 0.5,
      dependsOn: ['in-process-inspect'],
      resources: [],
      notes: ['Outsourced to certified heat treatment facility', 'Lead time: 2-3 business days'],
    }));
  }

  // 9. Deburring / surface treatment
  const deburrHrs = 0.3 + faceCount * 0.01 + holeCount * 0.05;
  steps.push(makeStep({
    id: 'deburr',
    sequence: ++seq,
    name: 'Deburr & Surface Finish',
    description: `Hand deburr edges. Break sharp corners 0.3mm. Bead blast if required.`,
    category: 'surface-treatment',
    durationHrs: roundHrs(deburrHrs),
    setupHrs: 0.05,
    dependsOn: [needsHeatTreat ? 'heat-treat' : 'in-process-inspect'],
    resources: [
      { resourceId: 'operator-jr', resourceName: 'Machinist', resourceType: 'operator', hoursNeeded: roundHrs(deburrHrs), costUsd: 0 },
    ],
  }));

  // 10. Final inspection
  steps.push(makeStep({
    id: 'final-inspect',
    sequence: ++seq,
    name: 'Final Inspection',
    description: `Full CMM report. Surface finish verification. Visual inspection per AS9102.`,
    category: 'inspection',
    durationHrs: 1.0 + criticalRegions * 0.2,
    setupHrs: 0.15,
    dependsOn: ['deburr'],
    resources: [
      { resourceId: 'cmm', resourceName: 'CMM Station', resourceType: 'inspection', hoursNeeded: 0.75, costUsd: 0 },
      { resourceId: 'inspector', resourceName: 'QC Inspector', resourceType: 'operator', hoursNeeded: 1.0, costUsd: 0 },
    ],
    qualityCheck: {
      id: 'qc-final',
      name: 'Final Article Inspection',
      method: 'cmm',
      tolerance: 'Per drawing GD&T',
      holdPoint: true,
    },
  }));

  // 11. Documentation
  steps.push(makeStep({
    id: 'documentation',
    sequence: ++seq,
    name: 'Documentation Package',
    description: `Generate CoC, inspection report, material cert, process traveler.`,
    category: 'documentation',
    durationHrs: 0.5,
    setupHrs: 0,
    dependsOn: ['final-inspect'],
    resources: [
      { resourceId: 'inspector', resourceName: 'QC Inspector', resourceType: 'operator', hoursNeeded: 0.5, costUsd: 0 },
    ],
  }));

  // 12. Packaging
  steps.push(makeStep({
    id: 'packaging',
    sequence: ++seq,
    name: 'Packaging & Shipping Prep',
    description: `Clean, wrap, label. Anti-corrosion treatment for ${inputs.material}.`,
    category: 'packaging',
    durationHrs: 0.25,
    setupHrs: 0,
    dependsOn: ['documentation'],
    resources: [
      { resourceId: 'operator-jr', resourceName: 'Machinist', resourceType: 'operator', hoursNeeded: 0.25, costUsd: 0 },
    ],
  }));

  return steps;
}

// ─── Scheduling (Forward Pass) ───────────────────────────────────

function scheduleSteps(steps: OperationStep[]): OperationStep[] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const scheduled = [...steps];

  // Forward pass: earliest start
  for (const step of scheduled) {
    let earliest = 0;
    for (const depId of step.dependsOn) {
      const dep = stepMap.get(depId);
      if (dep) {
        earliest = Math.max(earliest, dep.startOffsetHrs + dep.durationHrs);
      }
    }
    step.startOffsetHrs = roundHrs(earliest);
    step.endOffsetHrs = roundHrs(earliest + step.durationHrs);
    step.status = 'scheduled';
  }

  return scheduled;
}

// ─── Critical Path ───────────────────────────────────────────────

function findCriticalPath(steps: OperationStep[]): string[] {
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  // Late pass
  const totalEnd = Math.max(...steps.map((s) => s.endOffsetHrs));
  const lateFinish = new Map<string, number>();
  const lateStart = new Map<string, number>();

  // Initialize all to total end
  for (const s of steps) lateFinish.set(s.id, totalEnd);

  // Reverse topological order
  const reversed = [...steps].reverse();
  for (const step of reversed) {
    // Find successors
    const successors = steps.filter((s) => s.dependsOn.includes(step.id));
    if (successors.length > 0) {
      const lf = Math.min(...successors.map((s) => lateStart.get(s.id) ?? totalEnd));
      lateFinish.set(step.id, lf);
    }
    lateStart.set(step.id, (lateFinish.get(step.id) ?? totalEnd) - step.durationHrs);
  }

  // Critical path: slack = 0
  const critical: string[] = [];
  for (const step of steps) {
    const slack = (lateStart.get(step.id) ?? 0) - step.startOffsetHrs;
    if (Math.abs(slack) < 0.01) {
      critical.push(step.id);
    }
  }

  return critical;
}

// ─── Cost Calculation ────────────────────────────────────────────

function calculateCosts(steps: OperationStep[], resources: Resource[], inputs: AgentOutputs): CostSummary {
  const materialCost = inputs.cost?.materialCost ?? 0;
  let laborCost = 0;
  let machineCost = 0;
  let inspectionCost = 0;

  for (const step of steps) {
    for (const ra of step.resources) {
      const res = resources.find((r) => r.id === ra.resourceId);
      const rate = res?.costPerHr ?? 50;
      const cost = ra.hoursNeeded * rate;
      ra.costUsd = Math.round(cost * 100) / 100;

      if (ra.resourceType === 'operator') laborCost += cost;
      else if (ra.resourceType === 'machine') machineCost += cost;
      else if (ra.resourceType === 'inspection') inspectionCost += cost;
    }
    step.costUsd = step.resources.reduce((sum, r) => sum + r.costUsd, 0);
  }

  const toolingCost = inputs.cost?.toolingCost ?? 0;
  const overheadCost = (laborCost + machineCost) * 0.15;
  const totalCost = materialCost + laborCost + machineCost + toolingCost + inspectionCost + overheadCost;

  return {
    materialCost: round2(materialCost),
    laborCost: round2(laborCost),
    machineCost: round2(machineCost),
    toolingCost: round2(toolingCost),
    inspectionCost: round2(inspectionCost),
    overheadCost: round2(overheadCost),
    totalCost: round2(totalCost),
    costPerUnit: round2(totalCost / Math.max(inputs.quantity, 1)),
  };
}

// ─── Risk Assessment ─────────────────────────────────────────────

function assessRisks(steps: OperationStep[], inputs: AgentOutputs): PlanRisk[] {
  const risks: PlanRisk[] = [];

  if ((inputs.geometry?.minThickness ?? 99) < 1.5) {
    risks.push({
      id: 'thin-wall',
      severity: 'high',
      category: 'Manufacturing',
      description: `Minimum wall thickness ${inputs.geometry?.minThickness}mm is below 1.5mm threshold — risk of distortion during machining.`,
      mitigation: 'Reduce feed rates in thin regions. Add support fixtures. Consider stress-relief between passes.',
      affectedSteps: ['roughing', 'finishing'],
    });
  }

  if ((inputs.simulation?.safetyFactor ?? 99) < 1.5) {
    risks.push({
      id: 'low-sf',
      severity: 'high',
      category: 'Structural',
      description: `Safety factor ${inputs.simulation?.safetyFactor?.toFixed(2)} is below 1.5 — part may not meet load requirements.`,
      mitigation: 'Review design with stress engineer. Consider material upgrade or geometry reinforcement.',
      affectedSteps: ['final-inspect'],
    });
  }

  if ((inputs.geometry?.complexityScore ?? 0) > 70) {
    risks.push({
      id: 'high-complexity',
      severity: 'medium',
      category: 'Process',
      description: 'High geometric complexity may extend machining time and increase tool wear.',
      mitigation: 'Use adaptive toolpath strategies. Plan for mid-cycle tool changes.',
      affectedSteps: ['roughing', 'finishing'],
    });
  }

  if (inputs.priority === 'rush' || inputs.priority === 'critical') {
    risks.push({
      id: 'rush-schedule',
      severity: inputs.priority === 'critical' ? 'high' : 'medium',
      category: 'Schedule',
      description: `${inputs.priority === 'critical' ? 'Critical' : 'Rush'} priority — compressed timeline increases risk of quality issues.`,
      mitigation: 'Add additional inspection checkpoints. Assign senior operators.',
      affectedSteps: steps.map((s) => s.id),
    });
  }

  if ((inputs.geometry?.holeCount ?? 0) > 15) {
    risks.push({
      id: 'many-holes',
      severity: 'low',
      category: 'Tooling',
      description: `${inputs.geometry?.holeCount} holes require multiple tool changes — plan for tool inventory.`,
      mitigation: 'Pre-stage all drill sizes. Consider combination tools.',
      affectedSteps: ['drilling'],
    });
  }

  return risks;
}

// ─── Timeline Generation ─────────────────────────────────────────

function buildTimeline(steps: OperationStep[], criticalPath: string[], inputs: AgentOutputs): TimelineSummary {
  const totalHrs = Math.max(...steps.map((s) => s.endOffsetHrs));
  const priorityFactor = inputs.priority === 'critical' ? 0.7 : inputs.priority === 'rush' ? 0.85 : 1.0;
  const hrsPerDay = 8;
  const totalDays = Math.ceil((totalHrs * priorityFactor) / hrsPerDay);

  const machiningHrs = steps
    .filter((s) => ['roughing', 'finishing', 'drilling'].includes(s.category))
    .reduce((sum, s) => sum + s.durationHrs, 0);

  const setupHrs = steps.reduce((sum, s) => sum + s.setupHrs, 0);
  const inspectionHrs = steps
    .filter((s) => s.category === 'inspection')
    .reduce((sum, s) => sum + s.durationHrs, 0);

  const activeHrs = machiningHrs + setupHrs + inspectionHrs;
  const idleHrs = Math.max(0, totalHrs - activeHrs);
  const efficiency = totalHrs > 0 ? (activeHrs / totalHrs) * 100 : 0;

  const now = new Date();
  const completionDate = new Date(now.getTime() + totalDays * 24 * 60 * 60 * 1000);

  const ganttBars: GanttBar[] = steps.map((s) => ({
    stepId: s.id,
    label: s.name,
    category: s.category,
    startHrs: s.startOffsetHrs,
    endHrs: s.endOffsetHrs,
    isCriticalPath: criticalPath.includes(s.id),
  }));

  return {
    totalDays,
    machiningHrs: roundHrs(machiningHrs),
    setupHrs: roundHrs(setupHrs),
    inspectionHrs: roundHrs(inspectionHrs),
    idleHrs: roundHrs(idleHrs),
    efficiency: Math.round(efficiency),
    earliestStart: now.toISOString(),
    estimatedCompletion: completionDate.toISOString(),
    ganttBars,
  };
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Generate a complete execution plan from AI agent outputs.
 */
export function generateExecutionPlan(inputs: AgentOutputs): ExecutionPlan {
  // 1. Generate operation steps
  const rawSteps = generateSteps(inputs);

  // 2. Schedule (forward pass)
  const scheduledSteps = scheduleSteps(rawSteps);

  // 3. Find critical path
  const criticalPath = findCriticalPath(scheduledSteps);

  // 4. Resource pool
  const resources = [...DEFAULT_RESOURCES];

  // 5. Calculate costs
  const costSummary = calculateCosts(scheduledSteps, resources, inputs);

  // 6. Assess risks
  const risks = assessRisks(scheduledSteps, inputs);

  // 7. Build timeline
  const timeline = buildTimeline(scheduledSteps, criticalPath, inputs);

  // Update resource utilization
  const totalHrs = Math.max(...scheduledSteps.map((s) => s.endOffsetHrs));
  for (const res of resources) {
    const totalUsed = scheduledSteps
      .flatMap((s) => s.resources)
      .filter((r) => r.resourceId === res.id)
      .reduce((sum, r) => sum + r.hoursNeeded, 0);
    res.utilization = totalHrs > 0 ? Math.min(totalUsed / totalHrs, 1) : 0;
  }

  // Track which agents contributed
  const sourceAgents: string[] = [];
  if (inputs.geometry) sourceAgents.push('geometry');
  if (inputs.cost) sourceAgents.push('cost');
  if (inputs.simulation) sourceAgents.push('simulation');

  return {
    id: crypto.randomUUID(),
    partName: inputs.partName,
    material: inputs.material,
    quantity: inputs.quantity,
    steps: scheduledSteps,
    resources: resources.filter((r) => r.utilization > 0),
    timeline,
    costSummary,
    risks,
    criticalPath,
    createdAt: new Date().toISOString(),
    sourceAgents,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function makeStep(partial: Partial<OperationStep> & { id: string; sequence: number; name: string; category: OperationCategory; durationHrs: number }): OperationStep {
  return {
    description: '',
    dependsOn: [],
    resources: [],
    setupHrs: 0,
    startOffsetHrs: 0,
    endOffsetHrs: 0,
    costUsd: 0,
    qualityCheck: null,
    status: 'pending',
    notes: [],
    ...partial,
  };
}

function roundHrs(h: number): number {
  return Math.round(h * 100) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
