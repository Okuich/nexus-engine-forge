import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Bell, Settings, Cpu, RotateCcw, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { MidwaterLogo } from '@/components/brand/MidwaterLogo';
import { Sidebar } from './Sidebar';
import { CADViewer } from './CADViewer';
import { AnalysisPanel } from './AnalysisPanel';
import { CopilotPanel } from './CopilotPanel';
import { UploadOverlay } from './UploadOverlay';
import { useAppStore } from '@/store/appStore';

type RightTab = 'analysis' | 'copilot';

export function AppShell() {
  const { demoPhase, setDemoPhase, setUploadedFile, setAnalysisResult, setUploadProgress, setOptimizationResult, setAnalysisError } = useAppStore();
  const [rightTab, setRightTab] = useState<RightTab>('analysis');
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const handleReset = () => {
    setDemoPhase('idle');
    setUploadedFile(null);
    setAnalysisResult(null);
    setUploadProgress(0);
    setOptimizationResult(null);
    setAnalysisError(null);
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
      {/* ── Top bar ──────────────────────────────────── */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="h-11 border-b border-border flex items-center justify-between px-4 shrink-0 bg-card"
      >
        <div className="flex items-center gap-3">
          <MidwaterLogo size={22} showWordmark />
          <div className="w-px h-5 bg-border" />
          <span className="text-xs text-muted-foreground font-mono">v1.0</span>
        </div>

        <div className="flex items-center gap-1">
          {demoPhase !== 'idle' && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={handleReset}
              className="flex items-center gap-1.5 mr-2 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              New Upload
            </motion.button>
          )}
          <div className="flex items-center gap-2 mr-3 px-2.5 py-1 rounded-md bg-secondary/50">
            <Activity className="w-3.5 h-3.5 text-accent" />
            <span className="text-xs font-mono text-muted-foreground">System Ready</span>
          </div>
          <button
            onClick={() => setRightCollapsed(!rightCollapsed)}
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title={rightCollapsed ? 'Show right panel' : 'Hide right panel'}
          >
            {rightCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
          </button>
          <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors relative">
            <Bell className="w-4 h-4" />
          </button>
          <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </motion.header>

      {/* ── Three-panel body ─────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Sidebar */}
        <Sidebar />

        {/* Center: 3D Viewer */}
        <div className="flex-1 relative">
          <CADViewer />
          <UploadOverlay />
        </div>

        {/* Right: Analysis / Copilot */}
        <AnimatePresence mode="wait">
          {!rightCollapsed && (
            <motion.div
              key="right-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="shrink-0 h-full border-l border-border bg-card flex flex-col overflow-hidden"
            >
              {/* Tab switcher */}
              <div className="flex border-b border-border shrink-0">
                {([
                  { key: 'analysis' as const, label: 'Analysis' },
                  { key: 'copilot' as const, label: 'AI Copilot' },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setRightTab(tab.key)}
                    className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors relative ${
                      rightTab === tab.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                    {rightTab === tab.key && (
                      <motion.div
                        layoutId="right-tab-indicator"
                        className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary rounded-full"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden">
                {rightTab === 'analysis' ? <AnalysisPanel /> : <CopilotPanel />}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
