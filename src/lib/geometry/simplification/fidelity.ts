/**
 * Mesh Fidelity Checks
 *
 * Quantifies geometric and structural-feature preservation between an original
 * mesh and a simplified mesh. Designed to plug into the simplification pipeline
 * (pre/post LOD generation) and surface diagnostics to consumers.
 *
 * Metrics:
 *  - Hausdorff (sampled, symmetric) and mean surface distance
 *  - Normal deviation (mean / max, radians)
 *  - Curvature error (mean abs delta, RMS, relative L2) using vertex angle-deficit
 *  - Sharp-edge preservation ratio (count of sharp dihedrals retained)
 *  - Boundary-edge preservation ratio
 *  - Volume / surface-area drift
 *  - Aggregate fidelity score in [0,1] (1 = perfect)
 */

import type { RawMesh, Vec3 } from '../types';

export interface FidelityOptions {
  /** Sharp-angle threshold (radians). Default π/4. */
  sharpAngle?: number;
  /** Max sample points used for Hausdorff approximation. Default 4000. */
  maxSamples?: number;
  /** Weights used when combining sub-scores into the aggregate. */
  weights?: Partial<{
    distance: number;
    normal: number;
    curvature: number;
    sharp: number;
    boundary: number;
    volume: number;
  }>;
  /** Optional bounding-box diagonal override (for normalisation). */
  bboxDiagonal?: number;
}

export interface FidelityReport {
  /** Sampled symmetric Hausdorff distance, normalised by bbox diagonal. */
  hausdorffNorm: number;
  /** Mean of one-sided distances (orig→simp + simp→orig)/2, normalised. */
  meanSurfaceDistanceNorm: number;
  /** Mean angular deviation between nearest-face normals (radians). */
  normalDeviationMean: number;
  normalDeviationMax: number;
  /** Vertex-curvature delta (mean abs, RMS) — origin baseline. */
  curvatureMeanAbsDelta: number;
  curvatureRMSDelta: number;
  curvatureRelativeL2: number;
  /** Sharp-edge preservation in (0..1]. 1 = all sharp dihedrals retained. */
  sharpEdgePreservation: number;
  /** Boundary preservation. */
  boundaryPreservation: number;
  /** Relative drift, signed (simp/orig − 1). */
  surfaceAreaDrift: number;
  volumeDrift: number;
  /** Counts (debug / UI). */
  counts: {
    originalSharpEdges: number;
    simplifiedSharpEdges: number;
    originalBoundaryEdges: number;
    simplifiedBoundaryEdges: number;
    samples: number;
  };
  /** Aggregate score in [0,1]. */
  score: number;
  /** Per-metric sub-scores in [0,1] used to compute `score`. */
  subScores: {
    distance: number;
    normal: number;
    curvature: number;
    sharp: number;
    boundary: number;
    volume: number;
  };
}

const DEFAULT_WEIGHTS = {
  distance: 0.30,
  normal: 0.20,
  curvature: 0.20,
  sharp: 0.15,
  boundary: 0.05,
  volume: 0.10,
};

// ─── Geometric helpers ──────────────────────────────────────────────

function toIndexed(mesh: RawMesh): { positions: Float64Array; indices: Uint32Array } {
  const pos = mesh.positions instanceof Float64Array
    ? mesh.positions
    : Float64Array.from(mesh.positions as ArrayLike<number>);
  let idx: Uint32Array;
  if (mesh.indices && (mesh.indices as ArrayLike<number>).length) {
    idx = mesh.indices instanceof Uint32Array
      ? mesh.indices
      : Uint32Array.from(mesh.indices as ArrayLike<number>);
  } else {
    const triCount = (pos.length / 3) | 0;
    idx = new Uint32Array(triCount);
    for (let i = 0; i < triCount; i++) idx[i] = i;
  }
  return { positions: pos, indices: idx };
}

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot(a: Vec3, b: Vec3): number { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function len(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-20 ? [a[0]/l, a[1]/l, a[2]/l] : [0, 0, 0];
}

function getVertex(positions: ArrayLike<number>, i: number): Vec3 {
  const o = i * 3;
  return [positions[o], positions[o+1], positions[o+2]];
}

function bboxDiagonal(positions: ArrayLike<number>): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i+1], z = positions[i+2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
}

interface FaceInfo {
  centroid: Vec3;
  normal: Vec3;
  area: number;
}

function faceInfos(positions: ArrayLike<number>, indices: Uint32Array): FaceInfo[] {
  const out: FaceInfo[] = new Array(indices.length / 3);
  for (let f = 0; f < out.length; f++) {
    const a = getVertex(positions, indices[3*f]);
    const b = getVertex(positions, indices[3*f + 1]);
    const c = getVertex(positions, indices[3*f + 2]);
    const ab = sub(b, a);
    const ac = sub(c, a);
    const n = cross(ab, ac);
    const area = 0.5 * len(n);
    out[f] = {
      centroid: [(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3, (a[2]+b[2]+c[2])/3],
      normal: normalize(n),
      area,
    };
  }
  return out;
}

function totalArea(faces: FaceInfo[]): number {
  let s = 0;
  for (const f of faces) s += f.area;
  return s;
}

function signedVolume(positions: ArrayLike<number>, indices: Uint32Array): number {
  // Sum 1/6 * (a · (b × c)) — works for closed meshes; for open meshes it
  // returns a value that is still useful as a relative drift indicator.
  let v = 0;
  for (let f = 0; f < indices.length; f += 3) {
    const a = getVertex(positions, indices[f]);
    const b = getVertex(positions, indices[f+1]);
    const c = getVertex(positions, indices[f+2]);
    v += dot(a, cross(b, c)) / 6;
  }
  return Math.abs(v);
}

// ─── Vertex-angle-deficit curvature ────────────────────────────────

function vertexCurvature(positions: ArrayLike<number>, indices: Uint32Array): Float64Array {
  const vCount = (positions.length / 3) | 0;
  const angleSum = new Float64Array(vCount);
  const incident = new Uint32Array(vCount);
  for (let f = 0; f < indices.length; f += 3) {
    const ia = indices[f], ib = indices[f+1], ic = indices[f+2];
    const a = getVertex(positions, ia);
    const b = getVertex(positions, ib);
    const c = getVertex(positions, ic);
    const ab = normalize(sub(b, a));
    const ac = normalize(sub(c, a));
    const ba = normalize(sub(a, b));
    const bc = normalize(sub(c, b));
    const ca = normalize(sub(a, c));
    const cb = normalize(sub(b, c));
    angleSum[ia] += Math.acos(Math.max(-1, Math.min(1, dot(ab, ac))));
    angleSum[ib] += Math.acos(Math.max(-1, Math.min(1, dot(ba, bc))));
    angleSum[ic] += Math.acos(Math.max(-1, Math.min(1, dot(ca, cb))));
    incident[ia]++; incident[ib]++; incident[ic]++;
  }
  const k = new Float64Array(vCount);
  for (let i = 0; i < vCount; i++) {
    if (incident[i] === 0) { k[i] = 0; continue; }
    // Boundary heuristic: low incidence → use π baseline; otherwise 2π.
    const baseline = incident[i] < 3 ? Math.PI : 2 * Math.PI;
    k[i] = baseline - angleSum[i];
  }
  return k;
}

// ─── Edge classification (sharp + boundary) ────────────────────────

function classifyEdges(
  positions: ArrayLike<number>,
  indices: Uint32Array,
  sharpAngle: number,
): { sharp: number; boundary: number } {
  const map = new Map<string, { faces: number[]; }>();
  const faces = faceInfos(positions, indices);
  const key = (a: number, b: number) => a < b ? `${a}_${b}` : `${b}_${a}`;
  for (let f = 0; f < indices.length; f += 3) {
    const tri = [indices[f], indices[f+1], indices[f+2]];
    const fid = f / 3;
    for (let e = 0; e < 3; e++) {
      const k = key(tri[e], tri[(e+1)%3]);
      let m = map.get(k);
      if (!m) { m = { faces: [] }; map.set(k, m); }
      m.faces.push(fid);
    }
  }
  let sharp = 0, boundary = 0;
  for (const { faces: fs } of map.values()) {
    if (fs.length === 1) { boundary++; continue; }
    if (fs.length >= 2) {
      const n1 = faces[fs[0]].normal;
      const n2 = faces[fs[1]].normal;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(n1, n2))));
      if (ang >= sharpAngle) sharp++;
    }
  }
  return { sharp, boundary };
}

// ─── Sampled nearest-face distance + normal deviation ──────────────

function sampleSurface(
  positions: ArrayLike<number>,
  indices: Uint32Array,
  faces: FaceInfo[],
  totalA: number,
  count: number,
  rng: () => number,
): { points: Vec3[]; normals: Vec3[] } {
  const cdf = new Float64Array(faces.length);
  let acc = 0;
  for (let i = 0; i < faces.length; i++) { acc += faces[i].area; cdf[i] = acc; }
  const points: Vec3[] = new Array(count);
  const normals: Vec3[] = new Array(count);
  for (let s = 0; s < count; s++) {
    const r = rng() * totalA;
    // binary search
    let lo = 0, hi = faces.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1; else hi = mid;
    }
    const f = lo;
    let u = rng(), v = rng();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    const a = getVertex(positions, indices[3*f]);
    const b = getVertex(positions, indices[3*f + 1]);
    const c = getVertex(positions, indices[3*f + 2]);
    points[s] = [
      a[0]*w + b[0]*u + c[0]*v,
      a[1]*w + b[1]*u + c[1]*v,
      a[2]*w + b[2]*u + c[2]*v,
    ];
    normals[s] = faces[f].normal;
  }
  return { points, normals };
}

function nearestFaceDistance(
  p: Vec3,
  faces: FaceInfo[],
): { dist: number; normal: Vec3 } {
  // O(F) brute-force using centroid distance to pick the nearest face,
  // then report point-to-plane distance for that face. Adequate for sampled
  // fidelity (samples ≪ faces·F). For very large meshes reduce maxSamples.
  let best = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const d = (p[0]-f.centroid[0])**2 + (p[1]-f.centroid[1])**2 + (p[2]-f.centroid[2])**2;
    if (d < best) { best = d; bestIdx = i; }
  }
  const f = faces[bestIdx];
  const dx = p[0]-f.centroid[0], dy = p[1]-f.centroid[1], dz = p[2]-f.centroid[2];
  const planeDist = Math.abs(dx*f.normal[0] + dy*f.normal[1] + dz*f.normal[2]);
  return { dist: planeDist, normal: f.normal };
}

// Deterministic mulberry32 for reproducible sampling.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function() {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Public API ────────────────────────────────────────────────────

export function checkFidelity(
  original: RawMesh,
  simplified: RawMesh,
  options: FidelityOptions = {},
): FidelityReport {
  const sharpAngle = options.sharpAngle ?? Math.PI / 4;
  const maxSamples = Math.max(64, options.maxSamples ?? 4000);

  const orig = toIndexed(original);
  const simp = toIndexed(simplified);

  const diag = options.bboxDiagonal ?? bboxDiagonal(orig.positions);

  const fOrig = faceInfos(orig.positions, orig.indices);
  const fSimp = faceInfos(simp.positions, simp.indices);
  const aOrig = totalArea(fOrig);
  const aSimp = totalArea(fSimp);

  // Sample budget split between the two directions.
  const halfSamples = Math.min(maxSamples / 2, fOrig.length * 4, fSimp.length * 4) | 0;
  const rng = mulberry32(0xC0FFEE);

  const sOrig = sampleSurface(orig.positions, orig.indices, fOrig, aOrig, halfSamples, rng);
  const sSimp = sampleSurface(simp.positions, simp.indices, fSimp, aSimp || 1, halfSamples, rng);

  let sumDist = 0, maxDist = 0;
  let sumAng = 0, maxAng = 0;
  let sampleCount = 0;

  const accumulate = (pts: Vec3[], normals: Vec3[], targetFaces: FaceInfo[]) => {
    for (let i = 0; i < pts.length; i++) {
      const { dist, normal } = nearestFaceDistance(pts[i], targetFaces);
      sumDist += dist;
      if (dist > maxDist) maxDist = dist;
      const cosA = Math.max(-1, Math.min(1, Math.abs(dot(normals[i], normal))));
      const ang = Math.acos(cosA);
      sumAng += ang;
      if (ang > maxAng) maxAng = ang;
      sampleCount++;
    }
  };

  accumulate(sOrig.points, sOrig.normals, fSimp);
  accumulate(sSimp.points, sSimp.normals, fOrig);

  const meanDist = sampleCount > 0 ? sumDist / sampleCount : 0;
  const meanAng = sampleCount > 0 ? sumAng / sampleCount : 0;

  // Curvature comparison: aggregate stats only (vertex sets differ).
  const kOrig = vertexCurvature(orig.positions, orig.indices);
  const kSimp = vertexCurvature(simp.positions, simp.indices);
  const meanCurvOrig = mean(kOrig);
  const meanCurvSimp = mean(kSimp);
  const stdOrig = std(kOrig, meanCurvOrig);
  const stdSimp = std(kSimp, meanCurvSimp);
  const curvMeanAbs = Math.abs(meanCurvSimp - meanCurvOrig);
  const curvRMS = Math.hypot(curvMeanAbs, Math.abs(stdSimp - stdOrig));
  const denom = Math.hypot(meanCurvOrig, stdOrig) || 1;
  const curvRelL2 = curvRMS / denom;

  // Edge classification.
  const eOrig = classifyEdges(orig.positions, orig.indices, sharpAngle);
  const eSimp = classifyEdges(simp.positions, simp.indices, sharpAngle);
  const sharpPres = eOrig.sharp === 0 ? 1 : Math.min(1, eSimp.sharp / eOrig.sharp);
  const boundPres = eOrig.boundary === 0 ? 1 : Math.min(1, eSimp.boundary / eOrig.boundary);

  // Volume / area drift.
  const vOrig = signedVolume(orig.positions, orig.indices);
  const vSimp = signedVolume(simp.positions, simp.indices);
  const surfDrift = aOrig > 0 ? (aSimp / aOrig) - 1 : 0;
  const volDrift = vOrig > 0 ? (vSimp / vOrig) - 1 : 0;

  // ── Sub-scores in [0,1] ──
  const distScore = clamp01(1 - (meanDist / diag) * 20);             // 5% diag → 0
  const normalScore = clamp01(1 - meanAng / (Math.PI / 4));           // 45° → 0
  const curvScore = clamp01(1 - curvRelL2);
  const sharpScore = sharpPres;
  const boundScore = boundPres;
  const volScore = clamp01(1 - Math.min(1, Math.abs(volDrift) + Math.abs(surfDrift) * 0.5));

  const w = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
  const wSum = w.distance + w.normal + w.curvature + w.sharp + w.boundary + w.volume;
  const score = (
    w.distance * distScore +
    w.normal * normalScore +
    w.curvature * curvScore +
    w.sharp * sharpScore +
    w.boundary * boundScore +
    w.volume * volScore
  ) / (wSum || 1);

  return {
    hausdorffNorm: maxDist / diag,
    meanSurfaceDistanceNorm: meanDist / diag,
    normalDeviationMean: meanAng,
    normalDeviationMax: maxAng,
    curvatureMeanAbsDelta: curvMeanAbs,
    curvatureRMSDelta: curvRMS,
    curvatureRelativeL2: curvRelL2,
    sharpEdgePreservation: sharpPres,
    boundaryPreservation: boundPres,
    surfaceAreaDrift: surfDrift,
    volumeDrift: volDrift,
    counts: {
      originalSharpEdges: eOrig.sharp,
      simplifiedSharpEdges: eSimp.sharp,
      originalBoundaryEdges: eOrig.boundary,
      simplifiedBoundaryEdges: eSimp.boundary,
      samples: sampleCount,
    },
    score,
    subScores: {
      distance: distScore,
      normal: normalScore,
      curvature: curvScore,
      sharp: sharpScore,
      boundary: boundScore,
      volume: volScore,
    },
  };
}

/** Convenience: report fidelity for every LOD level relative to L0. */
export function checkLODFidelity(
  base: RawMesh,
  lods: Array<{ level: number; mesh: RawMesh }>,
  options: FidelityOptions = {},
): Array<{ level: number; report: FidelityReport }> {
  const diag = options.bboxDiagonal ?? bboxDiagonal(toIndexed(base).positions);
  return lods.map((l) => ({
    level: l.level,
    report: checkFidelity(base, l.mesh, { ...options, bboxDiagonal: diag }),
  }));
}

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
function mean(a: ArrayLike<number>): number {
  if (a.length === 0) return 0;
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}
function std(a: ArrayLike<number>, m: number): number {
  if (a.length === 0) return 0;
  let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - m; s += d*d; }
  return Math.sqrt(s / a.length);
}
