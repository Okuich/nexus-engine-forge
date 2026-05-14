/**
 * WebGPU SDF generator (browser-only).
 *
 * Compute shader: one workgroup invocation per voxel, brute-force point→triangle
 * distance with parity sign test (3-axis raycast vote).
 *
 * Falls back gracefully — call hasWebGPU() first.
 *
 * NOTE: This module must only be loaded from client-side code (no SSR).
 */
import type { RawMesh } from '../types';
import type { SDFGenerationOptions, SDFGrid } from './types';

export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).gpu;
}

const WGSL = /* wgsl */ `
struct Params {
  origin: vec3<f32>,
  voxelSize: f32,
  dims: vec3<u32>,
  triangleCount: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> tris: array<f32>; // 9 floats per triangle (a,b,c)
@group(0) @binding(2) var<storage, read_write> field: array<f32>;

fn closest_point_on_tri(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> vec3<f32> {
  let ab = b - a;
  let ac = c - a;
  let ap = p - a;
  let d1 = dot(ab, ap);
  let d2 = dot(ac, ap);
  if (d1 <= 0.0 && d2 <= 0.0) { return a; }
  let bp = p - b;
  let d3 = dot(ab, bp);
  let d4 = dot(ac, bp);
  if (d3 >= 0.0 && d4 <= d3) { return b; }
  let vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    let v = d1 / (d1 - d3);
    return a + v * ab;
  }
  let cp = p - c;
  let d5 = dot(ab, cp);
  let d6 = dot(ac, cp);
  if (d6 >= 0.0 && d5 <= d6) { return c; }
  let vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    let w = d2 / (d2 - d6);
    return a + w * ac;
  }
  let va = d3 * d6 - d5 * d4;
  if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
    let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return b + w * (c - b);
  }
  let denom = 1.0 / (va + vb + vc);
  let v = vb * denom;
  let w = vc * denom;
  return a + ab * v + ac * w;
}

fn ray_tri_hit(ro: vec3<f32>, rd: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> f32 {
  let e1 = b - a;
  let e2 = c - a;
  let h = cross(rd, e2);
  let det = dot(e1, h);
  if (abs(det) < 1e-8) { return -1.0; }
  let inv = 1.0 / det;
  let s = ro - a;
  let u = inv * dot(s, h);
  if (u < 0.0 || u > 1.0) { return -1.0; }
  let q = cross(s, e1);
  let v = inv * dot(rd, q);
  if (v < 0.0 || u + v > 1.0) { return -1.0; }
  let t = inv * dot(e2, q);
  if (t > 1e-4) { return t; }
  return -1.0;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.dims.x || gid.y >= params.dims.y || gid.z >= params.dims.z) { return; }
  let p = params.origin + (vec3<f32>(gid) + vec3<f32>(0.5)) * params.voxelSize;

  var bestSq = 1e30;
  for (var t: u32 = 0u; t < params.triangleCount; t = t + 1u) {
    let base = t * 9u;
    let a = vec3<f32>(tris[base + 0u], tris[base + 1u], tris[base + 2u]);
    let b = vec3<f32>(tris[base + 3u], tris[base + 4u], tris[base + 5u]);
    let c = vec3<f32>(tris[base + 6u], tris[base + 7u], tris[base + 8u]);
    let q = closest_point_on_tri(p, a, b, c);
    let dv = p - q;
    let dsq = dot(dv, dv);
    if (dsq < bestSq) { bestSq = dsq; }
  }
  let unsignedDist = sqrt(bestSq);

  // Sign via 3-axis ray parity vote
  let dirs = array<vec3<f32>, 3>(
    vec3<f32>(1.0, 0.0001, 0.0002),
    vec3<f32>(0.0001, 1.0, 0.0003),
    vec3<f32>(0.0002, 0.0001, 1.0),
  );
  var insideVotes: u32 = 0u;
  for (var d: u32 = 0u; d < 3u; d = d + 1u) {
    let rd = normalize(dirs[d]);
    var count: u32 = 0u;
    for (var t: u32 = 0u; t < params.triangleCount; t = t + 1u) {
      let base = t * 9u;
      let a = vec3<f32>(tris[base + 0u], tris[base + 1u], tris[base + 2u]);
      let b = vec3<f32>(tris[base + 3u], tris[base + 4u], tris[base + 5u]);
      let c = vec3<f32>(tris[base + 6u], tris[base + 7u], tris[base + 8u]);
      let h = ray_tri_hit(p, rd, a, b, c);
      if (h > 0.0) { count = count + 1u; }
    }
    if ((count & 1u) == 1u) { insideVotes = insideVotes + 1u; }
  }
  let sign = select(1.0, -1.0, insideVotes >= 2u);

  let idx = gid.x + gid.y * params.dims.x + gid.z * params.dims.x * params.dims.y;
  field[idx] = sign * unsignedDist;
}
`;

/** Pack indexed mesh into a flat triangle buffer (9 floats per triangle). */
function packTriangles(mesh: RawMesh): Float32Array {
  const idx = mesh.indices as ArrayLike<number>;
  const pos = mesh.positions as ArrayLike<number>;
  const triCount = idx.length / 3;
  const out = new Float32Array(triCount * 9);
  for (let f = 0; f < triCount; f++) {
    const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
    const o = f * 9;
    out[o + 0] = pos[a];     out[o + 1] = pos[a + 1]; out[o + 2] = pos[a + 2];
    out[o + 3] = pos[b];     out[o + 4] = pos[b + 1]; out[o + 5] = pos[b + 2];
    out[o + 6] = pos[c];     out[o + 7] = pos[c + 1]; out[o + 8] = pos[c + 2];
  }
  return out;
}

export async function generateSDFGPU(
  mesh: RawMesh,
  options: SDFGenerationOptions = {},
): Promise<SDFGrid> {
  if (!hasWebGPU()) throw new Error('WebGPU not available in this environment.');
  const t0 = performance.now();
  const adapter = await (navigator as any).gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter found.');
  const device: GPUDevice = await adapter.requestDevice();

  const tris = packTriangles(mesh);
  const triCount = tris.length / 9;

  // Compute bounds
  const pos = mesh.positions as ArrayLike<number>;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] < min[0]) min[0] = pos[i];
    if (pos[i + 1] < min[1]) min[1] = pos[i + 1];
    if (pos[i + 2] < min[2]) min[2] = pos[i + 2];
    if (pos[i] > max[0]) max[0] = pos[i];
    if (pos[i + 1] > max[1]) max[1] = pos[i + 1];
    if (pos[i + 2] > max[2]) max[2] = pos[i + 2];
  }
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const padding = options.padding ?? diag * 0.05;
  const origin: [number, number, number] = [min[0] - padding, min[1] - padding, min[2] - padding];
  const sx = (max[0] - min[0]) + 2 * padding;
  const sy = (max[1] - min[1]) + 2 * padding;
  const sz = (max[2] - min[2]) + 2 * padding;
  const longest = Math.max(sx, sy, sz);
  const resolution = options.resolution ?? 64;
  const voxelSize = longest / resolution;
  const nx = Math.max(2, Math.ceil(sx / voxelSize));
  const ny = Math.max(2, Math.ceil(sy / voxelSize));
  const nz = Math.max(2, Math.ceil(sz / voxelSize));
  const total = nx * ny * nz;

  // Uniform layout: vec3 origin + f32 voxelSize + vec3<u32> dims + u32 triCount
  // = 32 bytes (vec3 padded to 16, then f32 in slot 4, vec3<u32> padded, u32)
  const paramsBuf = device.createBuffer({
    size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const paramsData = new ArrayBuffer(32);
  const fview = new Float32Array(paramsData);
  const uview = new Uint32Array(paramsData);
  fview[0] = origin[0]; fview[1] = origin[1]; fview[2] = origin[2];
  fview[3] = voxelSize;
  uview[4] = nx; uview[5] = ny; uview[6] = nz;
  uview[7] = triCount;
  device.queue.writeBuffer(paramsBuf, 0, paramsData);

  const triBuf = device.createBuffer({
    size: tris.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(triBuf, 0, tris);

  const fieldBuf = device.createBuffer({
    size: total * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramsBuf } },
      { binding: 1, resource: { buffer: triBuf } },
      { binding: 2, resource: { buffer: fieldBuf } },
    ],
  });

  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(nx / 4), Math.ceil(ny / 4), Math.ceil(nz / 4));
  pass.end();

  const readback = device.createBuffer({
    size: total * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  enc.copyBufferToBuffer(fieldBuf, 0, readback, 0, total * 4);
  device.queue.submit([enc.finish()]);

  await readback.mapAsync(GPUMapMode.READ);
  const data = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();

  return {
    data,
    dims: [nx, ny, nz],
    bounds: { min: origin, max: [origin[0] + nx * voxelSize, origin[1] + ny * voxelSize, origin[2] + nz * voxelSize] },
    voxelSize,
    sourceTriangles: triCount,
    backend: 'gpu',
    elapsedMs: performance.now() - t0,
  };
}
