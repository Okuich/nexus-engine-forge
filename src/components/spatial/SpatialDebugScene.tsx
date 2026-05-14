/**
 * Spatial Index Debug Visualizer
 * ──────────────────────────────
 * Renders BVH / Octree node bounds as wireframe boxes, color-coded by
 * traversal role: visited (cyan), pruned (dim grey), leaf-hit (amber).
 * Optionally renders the active ray as a line and the nearest-neighbor
 * query point as a sphere.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { VisitedNode, VisitRole } from '@/lib/geometry/spatial/instrumentation';
import type { AABB, Ray } from '@/lib/geometry/spatial';
import type { Vec3 } from '@/lib/geometry/types';

const ROLE_COLOR: Record<VisitRole, string> = {
  'visited': '#22d3ee',   // cyan
  'pruned': '#475569',    // muted slate
  'leaf-hit': '#f59e0b',  // amber
};

const ROLE_OPACITY: Record<VisitRole, number> = {
  'visited': 0.55,
  'pruned': 0.08,
  'leaf-hit': 0.95,
};

interface BoxesProps {
  nodes: VisitedNode[];
  showPruned?: boolean;
  maxDepth?: number;
}

export function NodeBoxes({ nodes, showPruned = true, maxDepth }: BoxesProps) {
  // Group by role to instance per material/color in a few draw calls.
  const groups = useMemo(() => {
    const out: Record<VisitRole, AABB[]> = { visited: [], pruned: [], 'leaf-hit': [] };
    for (const n of nodes) {
      if (!showPruned && n.role === 'pruned') continue;
      if (maxDepth !== undefined && n.depth > maxDepth) continue;
      out[n.role].push(n.bounds);
    }
    return out;
  }, [nodes, showPruned, maxDepth]);

  return (
    <>
      {(Object.keys(groups) as VisitRole[]).map((role) => (
        <BoxGroup key={role} boxes={groups[role]} role={role} />
      ))}
    </>
  );
}

function BoxGroup({ boxes, role }: { boxes: AABB[]; role: VisitRole }) {
  const matrices = useMemo(
    () => boxes.map((b) => boxMatrix(b)),
    [boxes],
  );
  if (matrices.length === 0) return null;
  return (
    <>
      {matrices.map((m, i) => (
        <group key={i} matrix={m} matrixAutoUpdate={false}>
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
            <lineBasicMaterial
              color={ROLE_COLOR[role]}
              transparent
              opacity={ROLE_OPACITY[role]}
              depthTest={false}
            />
          </lineSegments>
        </group>
      ))}
    </>
  );
}

function boxMatrix(b: AABB): THREE.Matrix4 {
  const sx = Math.max(b.max[0] - b.min[0], 1e-6);
  const sy = Math.max(b.max[1] - b.min[1], 1e-6);
  const sz = Math.max(b.max[2] - b.min[2], 1e-6);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(cx, cy, cz),
    new THREE.Quaternion(),
    new THREE.Vector3(sx, sy, sz),
  );
  return m;
}

// ─── Query helpers ─────────────────────────────────────────────

export function RayLine({ ray, length = 200 }: { ray: Ray; length?: number }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const o = ray.origin;
    const d = ray.direction;
    const tip: Vec3 = [o[0] + d[0] * length, o[1] + d[1] * length, o[2] + d[2] * length];
    g.setAttribute('position', new THREE.Float32BufferAttribute(
      [o[0], o[1], o[2], tip[0], tip[1], tip[2]], 3,
    ));
    return g;
  }, [ray, length]);
  return (
    <line>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color="#ec4899" linewidth={2} depthTest={false} />
    </line>
  );
}

export function QueryPoint({ point, radius = 1 }: { point: Vec3; radius?: number }) {
  return (
    <mesh position={point as [number, number, number]}>
      <sphereGeometry args={[radius, 16, 16]} />
      <meshBasicMaterial color="#ec4899" />
    </mesh>
  );
}

export const VISUALIZER_LEGEND: Array<{ role: VisitRole; label: string; color: string }> = [
  { role: 'visited', label: 'Visited interior', color: ROLE_COLOR.visited },
  { role: 'leaf-hit', label: 'Leaf reached', color: ROLE_COLOR['leaf-hit'] },
  { role: 'pruned', label: 'Pruned by SAH/AABB', color: ROLE_COLOR.pruned },
];
