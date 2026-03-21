import { create } from 'zustand';
import type { GeometryFeatureSet } from '@/lib/geometry/featureExtractor';

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
  manufacturability: number; // 0-100
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

export type DemoPhase = 'idle' | 'uploading' | 'analyzing' | 'results' | 'optimizing' | 'optimized';

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

  // Geometry features
  extractedFeatures: GeometryFeatureSet | null;
  setExtractedFeatures: (f: GeometryFeatureSet | null) => void;

  // Jobs
  jobs: Job[];
  files: FileItem[];

const MOCK_ANALYSIS: AnalysisResult = {
  manufacturability: 72,
  cost: { material: 342, machining: 1125, tooling: 280, total: 1747 },
  risks: [
    { id: '1', severity: 'high', title: 'Thin Wall Region', description: 'Min 1.2mm at Section C-7 — below 1.5mm threshold for Ti-6Al-4V' },
    { id: '2', severity: 'medium', title: 'Deep Hole L/D', description: 'Hole #3 L/D ratio of 7.8 exceeds recommended 6.0 — requires special tooling' },
    { id: '3', severity: 'medium', title: 'Insufficient Draft', description: '3 faces below 3° draft angle — may cause extraction issues' },
    { id: '4', severity: 'low', title: 'Surface Complexity', description: '2 B-spline surfaces add finishing cost — consider simplification' },
  ],
  geometry: { faces: 47, edges: 112, holes: 12, minThickness: 1.2, volume: 284.3 },
};

const OPTIMIZED_ANALYSIS: AnalysisResult = {
  manufacturability: 91,
  cost: { material: 298, machining: 845, tooling: 180, total: 1323 },
  risks: [
    { id: '1', severity: 'low', title: 'Surface Complexity', description: '1 B-spline surface remaining — acceptable for 5-axis' },
  ],
  geometry: { faces: 42, edges: 98, holes: 10, minThickness: 2.1, volume: 271.8 },
};

export const useAppStore = create<AppState>((set, get) => ({
  sidebarTab: 'jobs',
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  copilotOpen: false,
  toggleCopilot: () => set((s) => ({ copilotOpen: !s.copilotOpen })),

  chatMessages: [
    { id: '1', role: 'assistant', content: 'CAD Copilot online. Upload a part to begin analysis.', timestamp: new Date() },
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

  runDemoAnalysis: () => {
    set({ demoPhase: 'analyzing', uploadProgress: 100 });
    // Simulate analysis steps
    setTimeout(() => set({ analysisResult: MOCK_ANALYSIS, demoPhase: 'results' }), 2800);
  },

  runOptimize: () => {
    set({ demoPhase: 'optimizing' });
    setTimeout(() => set({ analysisResult: OPTIMIZED_ANALYSIS, demoPhase: 'optimized' }), 3200);
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
