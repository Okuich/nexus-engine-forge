import { useCallback, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileBox, FileCode, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { parseSTLFile } from './CADViewer';

const ACCEPTED = ['.step', '.stp', '.stl', '.iges', '.igs'];

export function UploadOverlay() {
  const {
    demoPhase, setDemoPhase, setUploadedFile, setUploadProgress,
    uploadProgress, runDemoAnalysis, uploadedFile, setLoadedGeometry,
    setSelectedFaceIndex,
  } = useAppStore();
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setUploadedFile({ name: file.name, size: file.size });
    setDemoPhase('uploading');
    setUploadProgress(0);
    setSelectedFaceIndex(null);

    const isSTL = file.name.toLowerCase().endsWith('.stl');

    // Parse STL geometry in parallel with upload animation
    let geometryPromise: Promise<void> | null = null;
    if (isSTL) {
      geometryPromise = parseSTLFile(file).then((geo) => {
        // Center and scale the geometry
        geo.computeBoundingBox();
        const box = geo.boundingBox!;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = maxDim > 0 ? 3 / maxDim : 1;
        geo.translate(-center.x, -center.y, -center.z);
        geo.scale(scale, scale, scale);
        setLoadedGeometry(geo);
      }).catch((err) => {
        console.error('STL parse error:', err);
      });
    }

    // Simulate upload progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 18 + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setUploadProgress(100);
        // Wait for geometry parse to finish before starting analysis
        const proceed = () => setTimeout(() => runDemoAnalysis(), 600);
        if (geometryPromise) {
          geometryPromise.then(proceed).catch(proceed);
        } else {
          proceed();
        }
      }
      setUploadProgress(Math.min(progress, 100));
    }, 200);
  }, [setUploadedFile, setDemoPhase, setUploadProgress, runDemoAnalysis, setLoadedGeometry, setSelectedFaceIndex]);

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
                Upload STL files for instant 3D viewing, or STEP/IGES for manufacturability analysis
              </p>

              <div className="flex items-center gap-3">
                {[
                  { ext: 'STL', icon: FileBox, highlight: true },
                  { ext: 'STEP', icon: FileCode, highlight: false },
                  { ext: 'IGES', icon: FileCode, highlight: false },
                ].map(({ ext, icon: Icon, highlight }) => (
                  <div key={ext} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono ${
                    highlight ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-secondary/60 text-muted-foreground'
                  }`}>
                    <Icon className="w-3.5 h-3.5" />
                    .{ext.toLowerCase()}
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground/60 mt-6">Max 20MB per file · STL files render in 3D</p>
            </div>
          </motion.div>
        ) : (
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

// THREE import for Vector3 usage
import * as THREE from 'three';
