import { useCallback, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileBox, FileCode, X, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

const ACCEPTED = ['.step', '.stp', '.stl', '.iges', '.igs'];

export function UploadOverlay() {
  const { demoPhase, setDemoPhase, setUploadedFile, setUploadProgress, uploadProgress, runDemoAnalysis, uploadedFile } = useAppStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    setUploadedFile({ name: file.name, size: file.size });
    setDemoPhase('uploading');
    setUploadProgress(0);

    // Simulate upload progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 18 + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setUploadProgress(100);
        setTimeout(() => runDemoAnalysis(), 600);
      }
      setUploadProgress(Math.min(progress, 100));
    }, 200);
  }, [setUploadedFile, setDemoPhase, setUploadProgress, runDemoAnalysis]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  if (demoPhase !== 'idle' && demoPhase !== 'uploading') return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-30 flex items-center justify-center"
        style={{ background: 'radial-gradient(ellipse at center, hsl(var(--background) / 0.95), hsl(var(--background) / 0.98))' }}
      >
        {demoPhase === 'idle' ? (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', damping: 20 }}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={() => setIsDragOver(false)}
            onClick={() => inputRef.current?.click()}
            className={`relative cursor-pointer w-[520px] rounded-2xl border-2 border-dashed transition-all duration-300 ${
              isDragOver
                ? 'border-primary bg-primary/5 scale-[1.02]'
                : 'border-border hover:border-primary/50 hover:bg-secondary/30'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(',')}
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            <div className="flex flex-col items-center py-16 px-8">
              <motion.div
                animate={isDragOver ? { scale: 1.15, y: -5 } : { scale: 1, y: 0 }}
                className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6"
              >
                <Upload className={`w-7 h-7 transition-colors ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
              </motion.div>

              <h2 className="text-xl font-semibold text-foreground mb-2">
                Drop your CAD file here
              </h2>
              <p className="text-sm text-muted-foreground mb-6 text-center">
                Upload STEP, STL, or IGES files for instant manufacturability analysis
              </p>

              <div className="flex items-center gap-3">
                {[
                  { ext: 'STEP', icon: FileCode },
                  { ext: 'STL', icon: FileBox },
                  { ext: 'IGES', icon: FileCode },
                ].map(({ ext, icon: Icon }) => (
                  <div key={ext} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/60 text-xs text-muted-foreground font-mono">
                    <Icon className="w-3.5 h-3.5" />
                    .{ext.toLowerCase()}
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground/60 mt-6">Max 50MB per file</p>
            </div>
          </motion.div>
        ) : (
          /* Upload progress */
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-[420px] rounded-2xl bg-card border border-border p-8"
          >
            <div className="flex items-center gap-3 mb-6">
              {uploadProgress >= 100 ? (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}>
                  <CheckCircle2 className="w-5 h-5 text-accent" />
                </motion.div>
              ) : (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}>
                  <Upload className="w-5 h-5 text-primary" />
                </motion.div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{uploadedFile?.name}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {uploadProgress >= 100 ? 'Starting analysis...' : `Uploading... ${Math.round(uploadProgress)}%`}
                </p>
              </div>
            </div>

            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress}%` }}
                transition={{ ease: 'easeOut' }}
              />
            </div>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
