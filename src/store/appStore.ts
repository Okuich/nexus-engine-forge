import { create } from 'zustand';

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

  // Jobs
  jobs: Job[];

  // Files
  files: FileItem[];
}

export const useAppStore = create<AppState>((set) => ({
  sidebarTab: 'jobs',
  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  copilotOpen: true,
  toggleCopilot: () => set((s) => ({ copilotOpen: !s.copilotOpen })),

  chatMessages: [
    {
      id: '1',
      role: 'assistant',
      content: 'CAD Copilot online. I can help analyze geometry, suggest toolpaths, or optimize your designs. What are you working on?',
      timestamp: new Date(),
    },
  ],
  addMessage: (msg) =>
    set((s) => ({
      chatMessages: [
        ...s.chatMessages,
        { ...msg, id: crypto.randomUUID(), timestamp: new Date() },
      ],
    })),

  selectedModel: null,
  setSelectedModel: (id) => set({ selectedModel: id }),
  viewMode: 'solid',
  setViewMode: (mode) => set({ viewMode: mode }),

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
