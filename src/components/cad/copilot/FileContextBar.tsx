import { motion } from 'framer-motion';
import { FileBox, Activity } from 'lucide-react';
import { useAppStore } from '@/store/appStore';

export function FileContextBar() {
  const uploadedFile = useAppStore((s) => s.uploadedFile);
  const analysisResult = useAppStore((s) => s.analysisResult);
  const loadedGeometry = useAppStore((s) => s.loadedGeometry);

  if (!uploadedFile) return null;

  const vertexCount = loadedGeometry?.getAttribute('position')?.count ?? 0;
  const faceCount = vertexCount / 3;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="px-3 py-2 border-b border-border bg-secondary/30 shrink-0"
    >
      <div className="flex items-center gap-2">
        <FileBox className="w-3.5 h-3.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-foreground truncate">{uploadedFile.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground font-mono">
              {(uploadedFile.size / 1024).toFixed(1)} KB
            </span>
            {loadedGeometry && (
              <span className="text-[10px] text-muted-foreground font-mono">
                · {faceCount.toLocaleString()} faces
              </span>
            )}
            {analysisResult && (
              <span className="text-[10px] font-mono text-accent flex items-center gap-1">
                <Activity className="w-2.5 h-2.5" />
                Analyzed
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
