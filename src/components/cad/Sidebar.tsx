import { motion, AnimatePresence } from 'framer-motion';
import { Briefcase, FolderOpen, Play, CheckCircle2, Clock, AlertTriangle, ChevronRight, FileBox, FileCode, File } from 'lucide-react';
import { useAppStore, type Job, type FileItem } from '@/store/appStore';

const statusConfig = {
  running: { icon: Play, dotClass: 'status-dot-online', label: 'Running' },
  completed: { icon: CheckCircle2, dotClass: 'status-dot bg-primary', label: 'Done' },
  queued: { icon: Clock, dotClass: 'status-dot-idle', label: 'Queued' },
  failed: { icon: AlertTriangle, dotClass: 'status-dot-warning', label: 'Failed' },
};

const fileIcons = {
  folder: FolderOpen,
  stl: FileBox,
  step: FileCode,
  gcode: File,
};

function JobItem({ job }: { job: Job }) {
  const cfg = statusConfig[job.status];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="group px-3 py-2.5 hover:bg-secondary/50 cursor-pointer rounded-md mx-2 transition-colors"
    >
      <div className="flex items-center gap-2.5">
        <div className={cfg.dotClass} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{job.name}</p>
          <p className="text-xs text-muted-foreground font-mono">{job.material}</p>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      {job.status === 'running' && (
        <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${job.progress}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </div>
      )}
    </motion.div>
  );
}

function FileRow({ file }: { file: FileItem }) {
  const Icon = fileIcons[file.type];
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="group flex items-center gap-2.5 px-3 py-2 hover:bg-secondary/50 cursor-pointer rounded-md mx-2 transition-colors"
    >
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{file.name}</p>
        {file.size && (
          <p className="text-xs text-muted-foreground font-mono">{file.size}</p>
        )}
      </div>
    </motion.div>
  );
}

export function Sidebar() {
  const { sidebarTab, setSidebarTab, jobs, files } = useAppStore();

  return (
    <div className="w-64 h-full bg-card border-r border-border flex flex-col shrink-0">
      {/* Tab switcher */}
      <div className="flex border-b border-border">
        {[
          { key: 'jobs' as const, icon: Briefcase, label: 'Jobs' },
          { key: 'files' as const, icon: FolderOpen, label: 'Files' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSidebarTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-xs font-semibold uppercase tracking-wider transition-colors relative ${
              sidebarTab === tab.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {sidebarTab === tab.key && (
              <motion.div
                layoutId="sidebar-tab-indicator"
                className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-full"
              />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-2">
        <AnimatePresence mode="wait">
          {sidebarTab === 'jobs' ? (
            <motion.div
              key="jobs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-1"
            >
              {jobs.map((job) => (
                <JobItem key={job.id} job={job} />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="files"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-1"
            >
              {files.map((file) => (
                <FileRow key={file.id} file={file} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status bar */}
      <div className="px-4 py-2.5 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="status-dot-online" />
          <span className="text-xs text-muted-foreground font-mono">CNC-04 Connected</span>
        </div>
      </div>
    </div>
  );
}
