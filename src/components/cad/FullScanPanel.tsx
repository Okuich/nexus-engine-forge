import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Loader2, CheckCircle2, XCircle, MinusCircle, Clock, Database,
  RefreshCw, Layers, AlertTriangle, Zap,
} from 'lucide-react';
import * as THREE from 'three';
import { useAppStore } from '@/store/appStore';
import {
  runFullScan,
  FULL_SCAN_LAYERS,
  scanCacheStats,
  clearScanCache,
  type FullScanReport,
  type FullScanLayer,
  type LayerReport,
} from '@/lib/pipeline';
import type { RawMesh } from '@/lib/geometry';

const LAYER_META: Record<FullScanLayer, { label: string; sub: string }> = {
  geometryOs: { label: 'Geometry OS', sub: 'Feature extraction · adjacency · stats' },
  computationalGeometry: { label: 'Computational Geometry', sub: 'Topology · Euler · BVH index' },
  physicsOs: { label: 'Physics OS', sub: 'Structural FEA feasibility' },
  fieldOs: { label: 'Field OS', sub: 'Eikonal · Poisson metric fields' },
};

function geometryToRawMesh(geo: THREE.BufferGeometry): RawMesh | null {
  const posAttr = geo.getAttribute('position');
  if (!posAttr) return null;
  const positions = posAttr.array as Float32Array;
  const idx = geo.getIndex();
  return {
    positions,
    indices: idx ? (idx.array as Uint32Array | Uint16Array) : undefined,
  };
}

function statusIcon(s: LayerReport['status']) {
  switch (s) {
    case 'done':    return <CheckCircle2 className="w-4 h-4 text-accent" />;
    case 'error':   return <XCircle className="w-4 h-4 text-destructive" />;
    case 'running': return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
    case 'skipped': return <MinusCircle className="w-4 h-4 text-muted-foreground" />;
    default:        return <Clock className="w-4 h-4 text-muted-foreground/60" />;
  }
}

function statusTint(s: LayerReport['status']) {
  switch (s) {
    case 'done':    return 'border-accent/30 bg-accent/5';
    case 'error':   return 'border-destructive/40 bg-destructive/5';
    case 'running': return 'border-primary/40 bg-primary/5';
    case 'skipped': return 'border-border bg-muted/20';
    default:        return 'border-border bg-card';
  }
}

function fmtMs(ms?: number) {
  if (ms === undefined) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function FullScanPanel() {
  const loadedGeometry = useAppStore((s) => s.loadedGeometry);
  const uploadedFile = useAppStore((s) => s.uploadedFile);

  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<FullScanReport | null>(null);
  const [liveLayers, setLiveLayers] = useState<Record<FullScanLayer, LayerReport>>(() =>
    Object.fromEntries(
      FULL_SCAN_LAYERS.map((l) => [l, { layer: l, status: 'pending' } as LayerReport]),
    ) as Record<FullScanLayer, LayerReport>,
  );
  const [stats, setStats] = useState(() => scanCacheStats());
  const abortRef = useRef<AbortController | null>(null);

  const mesh = useMemo(
    () => (loadedGeometry ? geometryToRawMesh(loadedGeometry) : null),
    [loadedGeometry],
  );

  const refreshStats = useCallback(() => setStats(scanCacheStats()), []);

  const run = useCallback(async () => {
    if (!mesh || running) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setRunning(true);
    setReport(null);
    setLiveLayers(
      Object.fromEntries(
        FULL_SCAN_LAYERS.map((l) => [l, { layer: l, status: 'pending' } as LayerReport]),
      ) as Record<FullScanLayer, LayerReport>,
    );
    try {
      const r = await runFullScan(
        { mesh, filename: uploadedFile?.name },
        {
          signal: abortRef.current.signal,
          onLayerUpdate: (lr) =>
            setLiveLayers((prev) => ({ ...prev, [lr.layer]: lr })),
        },
      );
      setReport(r);
    } finally {
      setRunning(false);
      refreshStats();
    }
  }, [mesh, running, uploadedFile?.name, refreshStats]);

  // Auto-run when a new geometry is loaded — caches make repeat calls free.
  const lastMeshRef = useRef<RawMesh | null>(null);
  useEffect(() => {
    if (mesh && mesh !== lastMeshRef.current) {
      lastMeshRef.current = mesh;
      void run();
    }
  }, [mesh, run]);

  const onClearCache = useCallback(() => {
    clearScanCache();
    refreshStats();
  }, [refreshStats]);

  const layers = report?.layers ?? liveLayers;
  const done = (Object.values(layers) as LayerReport[]).filter((l) => l.status === 'done').length;
  const errored = (Object.values(layers) as LayerReport[]).filter((l) => l.status === 'error').length;
  const totalMs = report?.durationMs;
  const wasCached = report?.cached;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-wide uppercase text-foreground">Full Scan</h3>
          </div>
          {wasCached && (
            <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/15 text-accent">
              <Database className="w-3 h-3" /> CACHED
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Runs Geometry OS, Computational Geometry, Physics OS, and Field OS in parallel.
        </p>

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={run}
            disabled={!mesh || running}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {running ? 'Scanning…' : 'Run Full Scan'}
          </button>
          <button
            onClick={onClearCache}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary text-foreground text-xs font-medium hover:bg-secondary/70 transition-colors"
            title={`${stats.reports} cached reports · ${stats.meshes} cached meshes`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Clear cache
          </button>
        </div>

        {!mesh && (
          <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border rounded-md p-2">
            <AlertTriangle className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
            Upload an STL/STEP/IGES to enable full scanning.
          </div>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-border text-center shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Layers</div>
          <div className="text-sm font-mono text-foreground">{done}/{FULL_SCAN_LAYERS.length}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Errors</div>
          <div className={`text-sm font-mono ${errored ? 'text-destructive' : 'text-foreground'}`}>{errored}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
          <div className="text-sm font-mono text-foreground">{fmtMs(totalMs)}</div>
        </div>
      </div>

      {/* Layer rows */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        <AnimatePresence initial={false}>
          {FULL_SCAN_LAYERS.map((l) => {
            const lr = layers[l];
            const meta = LAYER_META[l];
            return (
              <motion.div
                key={l}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-lg border p-3 transition-colors ${statusTint(lr.status)}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {statusIcon(lr.status)}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{meta.label}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{meta.sub}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {lr.cached && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                        cache
                      </span>
                    )}
                    {lr.status === 'running' && (
                      <Zap className="w-3 h-3 text-primary animate-pulse" />
                    )}
                    <span className="text-xs font-mono text-muted-foreground tabular-nums w-16 text-right">
                      {fmtMs(lr.durationMs)}
                    </span>
                  </div>
                </div>

                {lr.status === 'error' && lr.error && (
                  <div className="mt-2 text-xs text-destructive font-mono break-words">
                    {lr.error.name ? `${lr.error.name}: ` : ''}{lr.error.message}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        <div className="pt-2 text-[10px] text-muted-foreground font-mono flex items-center justify-between">
          <span>Cache: {stats.reports} reports · {stats.meshes} meshes</span>
          {report?.meshHash && <span title={`opts ${report.optsHash}`}>mesh#{report.meshHash}</span>}
        </div>
      </div>
    </div>
  );
}
