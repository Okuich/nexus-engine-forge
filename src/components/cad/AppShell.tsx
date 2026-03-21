import { motion } from 'framer-motion';
import { Activity, Bell, Settings, Cpu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { CADViewer } from './CADViewer';
import { CopilotPanel } from './CopilotPanel';

export function AppShell() {
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
            <Cpu className="w-4.5 h-4.5 text-primary" />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              FORGE<span className="text-primary">CAD</span>
            </span>
          </div>
          <div className="w-px h-5 bg-border" />
          <span className="text-xs text-muted-foreground font-mono">v2.4.1</span>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex items-center gap-2 mr-3 px-2.5 py-1 rounded-md bg-secondary/50">
            <Activity className="w-3.5 h-3.5 text-success" />
            <span className="text-xs font-mono text-muted-foreground">GPU: 42% · RAM: 6.1GB</span>
          </div>
          <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors relative">
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
          </button>
          <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </motion.header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <CADViewer />
        <CopilotPanel />
      </div>
    </div>
  );
}
