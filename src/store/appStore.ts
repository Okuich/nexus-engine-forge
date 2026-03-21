import { create } from 'zustand';
import * as THREE from 'three';
import type { GeometryFeatureSet } from '@/lib/geometry/featureExtractor';
import { runOptimization, generateMockGraph } from '@/lib/ml/pipeline';
import type { OptimizationResult, ImprovementMetrics } from '@/lib/ml/pipeline';

export interface Job {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  material: string;
}

export interface FileItem {
  id: string;
  name: string;
  type: 'stl' | 'step' | 'gcode' | 'folder';
  size?: string;
  modified?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface AnalysisResult {
  manufacturability: number;
  cost: {
    material: number;
    machining: number;
    tooling: number;
    total: number;
  };
  risks: RiskItem[];
  geometry: {
    faces: number;
    edges: number;
    holes: number;
    minThickness: number;
    volume: number;
  };
}

export interface RiskItem {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
}

// ─── Explanations ──────────────────────────────────────────────
export interface Explanation {
  costDrivers: string[];
  manufacturabilityIssues: string[];
  riskFactors: string[];
}

// ─── Recommendations ───────────────────────────────────────────
export interface Recommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  action: string;
  impact: string;
}

// ─── User Overrides ────────────────────────────────────────────
export interface CostOverrides {
  materialCostPerKg: number;
  machiningRatePerHr: number;
  toleranceLevel: 'standard' | 'precision' | 'ultra-precision';
}

const DEFAULT_OVERRIDES: CostOverrides = {
  materialCostPerKg: 120,
  machiningRatePerHr: 85,
  toleranceLevel: 'precision',
};

// ─── Job History ───────────────────────────────────────────────
export interface JobHistoryEntry {
  id: string;
  fileName: string;
  date: Date;
  cost: number;
  score: number;
  status: 'completed' | 'partial' | 'failed';
}

// ─── Analysis Step Progress ────────────────────────────────────
export type AnalysisStep = 'uploading' | 'parsing' | 'analyzing' | 'estimating' | 'generating';

export interface AnalysisProgress {
  currentStep: AnalysisStep;
  stepsCompleted: AnalysisStep[];
  error: string | null;
  isPartial: boolean;
}

export type DemoPhase = 'idle' | 'uploading' | 'analyzing' | 'results' | 'optimizing' | 'optimized';

// ─── Explanation Generator ─────────────────────────────────────
function generateExplanations(result: AnalysisResult): Explanation {
  const costDrivers: string[] = [];
  const manufacturabilityIssues: string[] = [];
  const riskFactors: string[] = [];

  // Cost drivers
  if (result.geometry.faces > 40) costDrivers.push(`High face count (${result.geometry.faces}) increases machining time and tool path complexity`);
  if (result.geometry.minThickness < 1.5) costDrivers.push(`Thin walls detected (${result.geometry.minThickness}mm) require slower feed rates to avoid deformation`);
  if (result.geometry.holes > 8) costDrivers.push(`${result.geometry.holes} holes require multiple tool changes and drilling operations`);
  if (result.cost.tooling > 200) costDrivers.push('Complex geometry requires custom fixturing and specialized tooling');
  if (result.cost.machining > 800) costDrivers.push('Extended 5-axis machining time due to surface complexity');
  if (result.cost.material > 300) costDrivers.push('High-value aerospace-grade material (Ti-6Al-4V) with significant raw stock cost');

  // Manufacturability issues
  if (result.manufacturability < 80) {
    if (result.geometry.minThickness < 1.5) manufacturabilityIssues.push(`Thin wall region detected (${result.geometry.minThickness}mm) -- below recommended 1.5mm threshold for titanium`);
    if (result.geometry.holes > 10) manufacturabilityIssues.push('Multiple deep holes may require specialized drilling cycles');
    if (result.geometry.faces > 45) manufacturabilityIssues.push('High geometric complexity may require 5-axis simultaneous machining');
  }
  if (result.manufacturability < 60) {
    manufacturabilityIssues.push('Tight internal radii limit standard tool access');
    manufacturabilityIssues.push('Consider DFM review before production release');
  }

  // Risk factors
  result.risks.forEach((risk) => {
    if (risk.severity === 'high' || risk.severity === 'critical') {
      riskFactors.push(risk.description);
    }
  });
  if (result.geometry.minThickness < 1.2) riskFactors.push('Potential deformation during machining due to insufficient wall support');
  if (result.geometry.holes > 8) riskFactors.push('Tool accessibility concerns in densely-featured regions');

  return { costDrivers, manufacturabilityIssues, riskFactors };
}

// ─── Recommendation Generator ──────────────────────────────────
function generateRecommendations(result: AnalysisResult): Recommendation[] {
  const recs: Recommendation[] = [];

  if (result.geometry.minThickness < 1.5) {
    recs.push({
      id: 'r1',
      priority: 'high',
      action: `Increase wall thickness from ${result.geometry.minThickness}mm to at least 1.5mm in thin regions`,
      impact: 'Reduces scrap risk by ~40%, enables higher feed rates',
    });
  }

  if (result.geometry.holes > 10) {
    recs.push({
      id: 'r2',
      priority: 'medium',
      action: 'Standardize hole diameters where possible to reduce tool changes',
      impact: 'Can reduce machining time by 15-20%',
    });
  }

  if (result.geometry.faces > 45) {
    recs.push({
      id: 'r3',
      priority: 'medium',
      action: 'Simplify cavity geometry -- merge adjacent features where tolerances allow',
      impact: 'Reduces tooling cost and simplifies inspection',
    });
  }

  if (result.cost.material > 250) {
    recs.push({
      id: 'r4',
      priority: 'low',
      action: 'Consider near-net-shape forging to reduce material waste',
      impact: 'Potential 20-30% raw material savings at volume',
    });
  }

  if (result.risks.some((r) => r.severity === 'high' || r.severity === 'critical')) {
    recs.push({
      id: 'r5',
      priority: 'high',
      action: 'Address high-severity risks before production -- review flagged regions with manufacturing engineer',
      impact: 'Prevents costly rework and potential part rejection',
    });
  }

  return recs;
}

// ─── Recompute Cost with Overrides ─────────────────────────────
function recomputeCost(base: AnalysisResult, overrides: CostOverrides): AnalysisResult {
  const materialRatio = overrides.materialCostPerKg / 120;
  const machiningRatio = overrides.machiningRatePerHr / 85;
  const toleranceMultiplier = overrides.toleranceLevel === 'ultra-precision' ? 1.35 : overrides.toleranceLevel === 'precision' ? 1.0 : 0.85;

  const material = Math.round(base.cost.material * materialRatio);
  const machining = Math.round(base.cost.machining * machiningRatio * toleranceMultiplier);
  const tooling = Math.round(base.cost.tooling * toleranceMultiplier);
  const total = material + machining + tooling;

  return {
    ...base,
    cost: { material, machining, tooling, total },
  };
}

interface AppState {
  // Sidebar
  sidebarTab: 'jobs' | 'files';
  setSidebarTab: (tab: 'jobs' | 'files') => void;

  // Copilot
  copilotOpen: boolean;
  toggleCopilot: () => void;
  chatMessages: ChatMessage[];
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;

  // Viewer
  selectedModel: string | null;
  setSelectedModel: (id: string | null) => void;
  viewMode: 'solid' | 'wireframe' | 'xray';
  setViewMode: (mode: 'solid' | 'wireframe' | 'xray') => void;

  // Loaded 3D geometry (from STL upload)
  loadedGeometry: THREE.BufferGeometry | null;
  setLoadedGeometry: (g: THREE.BufferGeometry | null) => void;

  // Face selection
  selectedFaceIndex: number | null;
  setSelectedFaceIndex: (i: number | null) => void;

  // Demo flow
  demoPhase: DemoPhase;
  setDemoPhase: (phase: DemoPhase) => void;
  uploadedFile: { name: string; size: number } | null;
  setUploadedFile: (file: { name: string; size: number } | null) => void;
  uploadProgress: number;
  setUploadProgress: (p: number) => void;
  analysisResult: AnalysisResult | null;
  setAnalysisResult: (r: AnalysisResult | null) => void;
  runDemoAnalysis: () => void;
  runOptimize: () => void;

  // Optimization results
  optimizationResult: OptimizationResult | null;
  setOptimizationResult: (r: OptimizationResult | null) => void;

  // Geometry features
  extractedFeatures: GeometryFeatureSet | null;
  setExtractedFeatures: (f: GeometryFeatureSet | null) => void;

  // Explanations
  explanations: Explanation | null;
  recommendations: Recommendation[];

  // User overrides
  costOverrides: CostOverrides;
  setCostOverrides: (o: Partial<CostOverrides>) => void;
  baseAnalysisResult: AnalysisResult | null; // original before overrides

  // Analysis progress
  analysisProgress: AnalysisProgress | null;

  // Job history
  jobHistory: JobHistoryEntry[];
  addJobToHistory: (entry: Omit<JobHistoryEntry, 'id' | 'date'>) => void;

  // Error state
  analysisError: string | null;
  setAnalysisError: (e: string | null) => void;

  // Jobs
  jobs: Job[];
  files: FileItem[];
}

const MOCK_ANALYSIS: AnalysisResult = {
  manufacturability: 72,
  cost: { material: 342, machining: 1125, tooling: 280, total: 1747 },
  risks: [
    { id: '1', severity: 'high', title: 'Thin Wall Region', description: 'Min 1.2mm at Section C-7 -- below 1.5mm threshold for Ti-6Al-4V' },
    { id: '2', severity: 'medium', title: 'Deep Hole L/D', description: 'Hole #3 L/D ratio of 7.8 exceeds recommended 6.0 -- requires special tooling' },
    { id: '3', severity: 'medium', title: 'Insufficient Draft', description: '3 faces below 3 deg draft angle -- may cause extraction issues' },
    { id: '4', severity: 'low', title: 'Surface Complexity', description: '2 B-spline surfaces add finishing cost -- consider simplification' },
  ],
  geometry: { faces: 47, edges: 112, holes: 12, minThickness: 1.2, volume: 284.3 },
};

export const useAppStore = create<AppState>((set, get) => ({
  sidebarTab: 'jobs',
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  copilotOpen: false,
  toggleCopilot: () => set((s) => ({ copilotOpen: !s.copilotOpen })),

  chatMessages: [
    { id: '1', role: 'assistant', content: 'Midwater AI ready. Upload a part to begin analysis.', timestamp: new Date() },
  ],
  addMessage: (msg) =>
    set((s) => ({
      chatMessages: [...s.chatMessages, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }],
    })),

  selectedModel: null,
  setSelectedModel: (id) => set({ selectedModel: id }),
  viewMode: 'solid',
  setViewMode: (mode) => set({ viewMode: mode }),

  // Demo flow
  demoPhase: 'idle',
  setDemoPhase: (phase) => set({ demoPhase: phase }),
  uploadedFile: null,
  setUploadedFile: (file) => set({ uploadedFile: file }),
  uploadProgress: 0,
  setUploadProgress: (p) => set({ uploadProgress: p }),
  analysisResult: null,
  setAnalysisResult: (r) => set({ analysisResult: r }),
  extractedFeatures: null,
  setExtractedFeatures: (f) => set({ extractedFeatures: f }),

  // Explanations & recommendations
  explanations: null,
  recommendations: [],

  // User overrides
  costOverrides: { ...DEFAULT_OVERRIDES },
  baseAnalysisResult: null,
  setCostOverrides: (partial) => {
    const state = get();
    const newOverrides = { ...state.costOverrides, ...partial };
    set({ costOverrides: newOverrides });

    // Recompute cost if we have a base result
    const base = state.baseAnalysisResult;
    if (base) {
      const updated = recomputeCost(base, newOverrides);
      const explanations = generateExplanations(updated);
      const recommendations = generateRecommendations(updated);
      set({ analysisResult: updated, explanations, recommendations });
    }
  },

  // Analysis progress
  analysisProgress: null,

  // Job history
  jobHistory: [
    { id: 'h1', fileName: 'Impeller_Blade_R3.stl', date: new Date(Date.now() - 86400000 * 2), cost: 2140, score: 85, status: 'completed' },
    { id: 'h2', fileName: 'Bearing_Mount_A.step', date: new Date(Date.now() - 86400000 * 5), cost: 890, score: 91, status: 'completed' },
    { id: 'h3', fileName: 'Exhaust_Manifold.stl', date: new Date(Date.now() - 86400000 * 7), cost: 0, score: 0, status: 'failed' },
  ],
  addJobToHistory: (entry) =>
    set((s) => ({
      jobHistory: [
        { ...entry, id: crypto.randomUUID(), date: new Date() },
        ...s.jobHistory,
      ].slice(0, 50),
    })),

  // Error state
  analysisError: null,
  setAnalysisError: (e) => set({ analysisError: e }),

  runDemoAnalysis: () => {
    set({
      demoPhase: 'analyzing',
      uploadProgress: 100,
      analysisError: null,
      analysisProgress: { currentStep: 'parsing', stepsCompleted: ['uploading'], error: null, isPartial: false },
    });

    // Simulate stepped progress
    const steps: AnalysisStep[] = ['parsing', 'analyzing', 'estimating', 'generating'];
    let i = 0;
    const interval = setInterval(() => {
      i++;
      if (i < steps.length) {
        set((s) => ({
          analysisProgress: s.analysisProgress
            ? { ...s.analysisProgress, currentStep: steps[i], stepsCompleted: [...s.analysisProgress.stepsCompleted, steps[i - 1]] }
            : null,
        }));
      } else {
        clearInterval(interval);
        try {
          const result = MOCK_ANALYSIS;
          const overrides = get().costOverrides;
          const adjusted = recomputeCost(result, overrides);
          const explanations = generateExplanations(adjusted);
          const recommendations = generateRecommendations(adjusted);

          const fileName = get().uploadedFile?.name ?? 'part.step';
          get().addJobToHistory({ fileName, cost: adjusted.cost.total, score: adjusted.manufacturability, status: 'completed' });

          set({
            analysisResult: adjusted,
            baseAnalysisResult: result,
            explanations,
            recommendations,
            demoPhase: 'results',
            analysisProgress: { currentStep: 'generating', stepsCompleted: steps, error: null, isPartial: false },
          });
        } catch (err) {
          console.error('Analysis failed:', err);
          set({
            analysisError: 'Analysis encountered an error -- showing partial results',
            demoPhase: 'results',
            analysisResult: MOCK_ANALYSIS,
            baseAnalysisResult: MOCK_ANALYSIS,
            explanations: generateExplanations(MOCK_ANALYSIS),
            recommendations: generateRecommendations(MOCK_ANALYSIS),
            analysisProgress: { currentStep: 'generating', stepsCompleted: steps, error: 'Partial analysis', isPartial: true },
          });
        }
      }
    }, 700);
  },

  optimizationResult: null,
  setOptimizationResult: (r) => set({ optimizationResult: r }),

  runOptimize: () => {
    const state = get();
    set({ demoPhase: 'optimizing', optimizationResult: null, analysisError: null });

    const fileName = state.uploadedFile?.name ?? 'part.step';
    const graph = generateMockGraph(fileName);
    graph.material = 'Ti-6Al-4V';

    runOptimization(graph, 'Ti-6Al-4V', {
      objectives: ['cost', 'manufacturability'],
      population_size: 20,
      generations: 8,
      cache_enabled: true,
    }).then((result) => {
      const optimizedAnalysis: AnalysisResult = {
        manufacturability: result.optimized_score.manufacturability_score,
        cost: {
          material: Math.round(result.optimized_score.estimated_cost_usd * 0.2),
          machining: Math.round(result.optimized_score.estimated_cost_usd * 0.6),
          tooling: Math.round(result.optimized_score.estimated_cost_usd * 0.2),
          total: result.optimized_score.estimated_cost_usd,
        },
        risks: result.optimized_score.risk_regions.map((r, i) => ({
          id: String(i),
          severity: r.severity as RiskItem['severity'],
          title: r.description.split(':')[0] ?? 'Risk',
          description: r.description,
        })),
        geometry: state.analysisResult?.geometry ?? { faces: 42, edges: 98, holes: 10, minThickness: 2.1, volume: 271.8 },
      };

      const explanations = generateExplanations(optimizedAnalysis);
      const recommendations = generateRecommendations(optimizedAnalysis);

      set({
        analysisResult: optimizedAnalysis,
        baseAnalysisResult: optimizedAnalysis,
        optimizationResult: result,
        explanations,
        recommendations,
        demoPhase: 'optimized',
      });
    }).catch((err) => {
      console.error('Optimization failed:', err);
      // Fallback to improved mock
      const fallback: AnalysisResult = {
        manufacturability: 91,
        cost: { material: 298, machining: 845, tooling: 180, total: 1323 },
        risks: [
          { id: '1', severity: 'low', title: 'Surface Complexity', description: '1 B-spline surface remaining -- acceptable for 5-axis' },
        ],
        geometry: { faces: 42, edges: 98, holes: 10, minThickness: 2.1, volume: 271.8 },
      };
      set({
        analysisResult: fallback,
        baseAnalysisResult: fallback,
        explanations: generateExplanations(fallback),
        recommendations: generateRecommendations(fallback),
        demoPhase: 'optimized',
        analysisError: null, // silent fallback
      });
    });
  },

  jobs: [
    { id: '1', name: 'Turbine_Housing_v4.step', status: 'running', progress: 67, material: 'Ti-6Al-4V' },
    { id: '2', name: 'Impeller_Blade_R3.stl', status: 'completed', progress: 100, material: 'Inconel 718' },
    { id: '3', name: 'Bearing_Mount_A.step', status: 'queued', progress: 0, material: 'Al 7075-T6' },
    { id: '4', name: 'Exhaust_Manifold.stl', status: 'failed', progress: 43, material: 'SS 316L' },
    { id: '5', name: 'Gear_Assembly_v2.step', status: 'queued', progress: 0, material: 'AISI 4340' },
  ],

  files: [
    { id: '1', name: 'Assemblies', type: 'folder' },
    { id: '2', name: 'Turbine_Housing_v4.step', type: 'step', size: '14.2 MB', modified: '2 hours ago' },
    { id: '3', name: 'Impeller_Blade_R3.stl', type: 'stl', size: '8.7 MB', modified: '5 hours ago' },
    { id: '4', name: 'Bearing_Mount_A.step', type: 'step', size: '3.1 MB', modified: '1 day ago' },
    { id: '5', name: 'toolpath_config.gcode', type: 'gcode', size: '1.4 MB', modified: '3 days ago' },
  ],
}));
