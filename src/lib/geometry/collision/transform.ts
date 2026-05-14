/**
 * Affine transform helpers for assembly parts.
 */

import type { RawMesh, Vec3 } from '../types';
import type { Transform } from './types';

export const IDENTITY: Required<Transform> = {
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: [0, 0, 0],
};

export function applyTransform(v: Vec3, t?: Transform): Vec3 {
  if (!t) return v;
  const r = t.rotation ?? IDENTITY.rotation;
  const tr = t.translation ?? IDENTITY.translation;
  return [
    r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + tr[0],
    r[3] * v[0] + r[4] * v[1] + r[5] * v[2] + tr[1],
    r[6] * v[0] + r[7] * v[1] + r[8] * v[2] + tr[2],
  ];
}

/** Produce a transformed copy of a mesh's positions (indices reused). */
export function transformMesh(mesh: RawMesh, t?: Transform): RawMesh {
  if (!t) return mesh;
  const src = mesh.positions;
  const out = new Float32Array(src.length);
  const r = t.rotation ?? IDENTITY.rotation;
  const tr = t.translation ?? IDENTITY.translation;
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i] = r[0] * x + r[1] * y + r[2] * z + tr[0];
    out[i + 1] = r[3] * x + r[4] * y + r[5] * z + tr[1];
    out[i + 2] = r[6] * x + r[7] * y + r[8] * z + tr[2];
  }
  return { positions: out, indices: mesh.indices };
}

/** Linear interpolation of two transforms (translation lerp + rotation lerp). */
export function lerpTransform(a: Transform, b: Transform, t: number): Transform {
  const ar = a.rotation ?? IDENTITY.rotation;
  const br = b.rotation ?? IDENTITY.rotation;
  const at = a.translation ?? IDENTITY.translation;
  const bt = b.translation ?? IDENTITY.translation;
  return {
    rotation: ar.map((v, i) => v + (br[i] - v) * t) as Transform['rotation'],
    translation: [
      at[0] + (bt[0] - at[0]) * t,
      at[1] + (bt[1] - at[1]) * t,
      at[2] + (bt[2] - at[2]) * t,
    ],
  };
}

/** Sample a motion track at time t (clamped, piecewise-linear). */
export function sampleMotion(
  keyframes: Array<{ t: number; transform: Transform }>,
  t: number,
): Transform {
  if (keyframes.length === 0) return IDENTITY;
  if (keyframes.length === 1) return keyframes[0].transform;
  if (t <= keyframes[0].t) return keyframes[0].transform;
  if (t >= keyframes[keyframes.length - 1].t)
    return keyframes[keyframes.length - 1].transform;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i], b = keyframes[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t || 1);
      return lerpTransform(a.transform, b.transform, u);
    }
  }
  return keyframes[keyframes.length - 1].transform;
}
