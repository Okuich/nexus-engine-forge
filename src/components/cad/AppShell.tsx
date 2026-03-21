import { motion } from 'framer-motion';
import { Activity, Bell, Settings, Cpu, RotateCcw, Droplets } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { CADViewer } from './CADViewer';
import { AnalysisPanel } from './AnalysisPanel';
import { UploadOverlay } from './UploadOverlay';
import { useAppStore } from '@/store/appStore';

export function AppShell() {
  const { demoPhase, setDemoPhase, setUploadedFile, setAnalysisResult, setUploadProgress, setOptimizationResult, setAnalysisError } = useAppStore();

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
      {/* Top bar */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="h-11 border-b border-border flex items-center justify-between px-4 shrink-0 bg-card"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Droplets className="w-4.5 h-4.5 text-primary" />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              mid<span className="text-primary">water</span>
            </span>
          </div>
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
          <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors relative">
            <Bell className="w-4 h-4" />
          </button>
          <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </motion.header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar />
        <div className="flex-1 relative">
          <CADViewer />
          <UploadOverlay />
        </div>
        <AnalysisPanel />
      </div>
    </div>
  );
}
