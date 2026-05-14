/**
 * Spatial Index Debug page.
 * Generates a synthetic mesh, builds BVH/Octree, runs raycast or
 * nearest-neighbor queries, and renders visited/pruned/leaf nodes.
 */

import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { BVH } from '@/lib/geometry/core/spatialIndex';
import { Octree } from '@/lib/geometry/spatial/octree';
import {
  traceBVHRaycast, traceBVHNearest, traceOctreeRaycast,
  collectAllSplits,
  type TraceResult,
} from '@/lib/geometry/spatial/instrumentation';
import {
  NodeBoxes, RayLine, QueryPoint, VISUALIZER_LEGEND,
} from '@/components/spatial/SpatialDebugScene';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { RawMesh, Vec3 } from '@/lib/geometry/types';

// ─── Synthetic mesh ────────────────────────────────────────────

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeMesh(triCount: number, seed: number): RawMesh {
  const r = mulberry32(seed);
  const positions = new Float32Array(triCount * 9);
  const indices = new Uint32Array(triCount * 3);
  for (let i = 0; i < triCount; i++) {
    const cx = (r() - 0.5) * 60;
    const cy = (r() - 0.5) * 60;
    const cz = (r() - 0.5) * 60;
    const o = i * 9;
    for (let v = 0; v < 3; v++) {
      positions[o + v * 3] = cx + (r() - 0.5) * 1.5;
      positions[o + v * 3 + 1] = cy + (r() - 0.5) * 1.5;
      positions[o + v * 3 + 2] = cz + (r() - 0.5) * 1.5;
      indices[i * 3 + v] = i * 3 + v;
    }
  }
  return { positions, indices };
}

type Structure = 'bvh' | 'octree';
type Operation = 'raycast' | 'nearest' | 'splits-only';

export default function SpatialDebug() {
  const [triCount, setTriCount] = useState(2000);
  const [seed, setSeed] = useState(7);
  const [structure, setStructure] = useState<Structure>('bvh');
  const [operation, setOperation] = useState<Operation>('raycast');
  const [showPruned, setShowPruned] = useState(true);
  const [maxDepth, setMaxDepth] = useState(32);

  // Ray controls (spherical → cartesian)
  const [rayYaw, setRayYaw] = useState(0);
  const [rayPitch, setRayPitch] = useState(0);

  // Nearest query target
  const [qx, setQx] = useState(0);
  const [qy, setQy] = useState(0);
  const [qz, setQz] = useState(0);

  const mesh = useMemo(() => makeMesh(triCount, seed), [triCount, seed]);
  const bvh = useMemo(() => new BVH(mesh), [mesh]);
  const oct = useMemo(() => new Octree(mesh), [mesh]);

  const ray = useMemo(() => {
    const yaw = (rayYaw * Math.PI) / 180;
    const pitch = (rayPitch * Math.PI) / 180;
    const dir: Vec3 = [
      Math.cos(pitch) * Math.sin(yaw),
      Math.sin(pitch),
      -Math.cos(pitch) * Math.cos(yaw),
    ];
    return { origin: [0, 0, 80] as Vec3, direction: dir };
  }, [rayYaw, rayPitch]);

  const queryPoint: Vec3 = useMemo(() => [qx, qy, qz], [qx, qy, qz]);

  const trace: TraceResult = useMemo(() => {
    if (operation === 'splits-only') {
      const idx = structure === 'bvh' ? bvh : oct;
      const nodes = collectAllSplits(idx);
      return {
        nodes,
        totalVisited: nodes.length,
        totalPruned: 0,
        totalLeaves: nodes.filter((n) => n.isLeaf).length,
      };
    }
    if (operation === 'raycast') {
      return structure === 'bvh'
        ? traceBVHRaycast(bvh, ray)
        : traceOctreeRaycast(oct, ray);
    }
    // nearest — only BVH supports point queries here.
    return traceBVHNearest(bvh, queryPoint);
  }, [operation, structure, bvh, oct, ray, queryPoint]);

  const supportsNearest = structure === 'bvh';

  return (
    <div className="grid grid-cols-[320px_1fr] h-full">
      <aside className="border-r border-border bg-card p-4 overflow-y-auto space-y-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Spatial Index Debug</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Visualizes BVH / Octree splits and traversal pruning.
          </p>
        </div>

        <Card className="p-3 space-y-3">
          <div>
            <Label className="text-xs">Structure</Label>
            <Select value={structure} onValueChange={(v) => setStructure(v as Structure)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bvh">BVH</SelectItem>
                <SelectItem value="octree">Octree</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Operation</Label>
            <Select
              value={operation}
              onValueChange={(v) => {
                const op = v as Operation;
                if (op === 'nearest' && structure !== 'bvh') setStructure('bvh');
                setOperation(op);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="raycast">Raycast</SelectItem>
                <SelectItem value="nearest" disabled={!supportsNearest}>
                  Nearest triangle (BVH)
                </SelectItem>
                <SelectItem value="splits-only">All splits (no query)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        <Card className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Triangles</Label>
            <span className="text-xs text-muted-foreground tabular-nums">{triCount}</span>
          </div>
          <Slider
            value={[triCount]}
            min={100} max={20000} step={100}
            onValueChange={([v]) => setTriCount(v)}
          />
          <div className="flex items-center justify-between">
            <Label className="text-xs">Seed</Label>
            <Button
              variant="outline" size="sm"
              onClick={() => setSeed(Math.floor(Math.random() * 1e6))}
            >
              {seed}
            </Button>
          </div>
        </Card>

        {operation === 'raycast' && (
          <Card className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Ray yaw</Label>
              <span className="text-xs tabular-nums">{rayYaw}°</span>
            </div>
            <Slider value={[rayYaw]} min={-180} max={180} step={1}
              onValueChange={([v]) => setRayYaw(v)} />
            <div className="flex items-center justify-between">
              <Label className="text-xs">Ray pitch</Label>
              <span className="text-xs tabular-nums">{rayPitch}°</span>
            </div>
            <Slider value={[rayPitch]} min={-89} max={89} step={1}
              onValueChange={([v]) => setRayPitch(v)} />
          </Card>
        )}

        {operation === 'nearest' && (
          <Card className="p-3 space-y-3">
            {(['x', 'y', 'z'] as const).map((axis, i) => {
              const value = [qx, qy, qz][i];
              const setter = [setQx, setQy, setQz][i];
              return (
                <div key={axis}>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase">{axis}</Label>
                    <span className="text-xs tabular-nums">{value.toFixed(1)}</span>
                  </div>
                  <Slider value={[value]} min={-40} max={40} step={0.5}
                    onValueChange={([v]) => setter(v)} />
                </div>
              );
            })}
          </Card>
        )}

        <Card className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Show pruned nodes</Label>
            <Switch checked={showPruned} onCheckedChange={setShowPruned} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Max depth</Label>
            <span className="text-xs tabular-nums">{maxDepth}</span>
          </div>
          <Slider value={[maxDepth]} min={0} max={32} step={1}
            onValueChange={([v]) => setMaxDepth(v)} />
        </Card>

        <Card className="p-3 space-y-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Trace</h3>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="Visited" value={trace.totalVisited} />
            <Stat label="Pruned" value={trace.totalPruned} />
            <Stat label="Leaves" value={trace.totalLeaves} />
          </div>
          <div className="space-y-1 pt-2">
            {VISUALIZER_LEGEND.map((l) => (
              <div key={l.role} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-2 w-4 rounded-sm"
                  style={{ background: l.color }}
                />
                <span className="text-muted-foreground">{l.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </aside>

      <div className="relative bg-background">
        <Canvas camera={{ position: [120, 80, 120], fov: 45, near: 0.1, far: 2000 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[100, 100, 100]} intensity={0.4} />
          <NodeBoxes
            nodes={trace.nodes}
            showPruned={showPruned}
            maxDepth={maxDepth}
          />
          {operation === 'raycast' && <RayLine ray={ray} length={250} />}
          {operation === 'nearest' && <QueryPoint point={queryPoint} radius={1.2} />}
          <axesHelper args={[40]} />
          <OrbitControls makeDefault />
          <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
            <GizmoViewport />
          </GizmoHelper>
        </Canvas>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
}
