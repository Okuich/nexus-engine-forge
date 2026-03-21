/**
 * Midwater Geometry Engine — Mesh Validation
 *
 * Validates raw mesh input before feature extraction.
 * Catches degenerate geometry, NaN values, and index errors.
 */

import type { RawMesh } from './types';
import { MeshValidationError, MeshErrorCode } from './types';

export interface ValidationResult {
  valid: boolean;
  vertexCount: number;
  faceCount: number;
  warnings: string[];
}

/**
 * Validate a raw mesh for correctness and extractability.
 * Throws MeshValidationError on critical issues.
 * Returns warnings for non-critical issues.
 */
export function validateMesh(mesh: RawMesh): ValidationResult {
  const warnings: string[] = [];
  const positions = mesh.positions;

  // ── Check positions exist and have valid length ────
  if (!positions || positions.length === 0) {
    throw new MeshValidationError(
      'Mesh has no vertex positions',
      MeshErrorCode.EMPTY_POSITIONS,
    );
  }

  if (positions.length % 3 !== 0) {
    throw new MeshValidationError(
      `Position array length ${positions.length} is not divisible by 3`,
      MeshErrorCode.INVALID_VERTEX_COUNT,
      { length: positions.length },
    );
  }

  const vertexCount = positions.length / 3;

  // ── Check for NaN/Infinity in positions ────────────
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      throw new MeshValidationError(
        `Non-finite value at position index ${i}: ${positions[i]}`,
        MeshErrorCode.NON_FINITE_VALUE,
        { index: i, value: positions[i] },
      );
    }
  }

  // ── Determine face count ───────────────────────────
  let faceCount: number;

  if (mesh.indices) {
    const indices = mesh.indices;

    if (indices.length % 3 !== 0) {
      throw new MeshValidationError(
        `Index array length ${indices.length} is not divisible by 3`,
        MeshErrorCode.INVALID_INDEX,
        { length: indices.length },
      );
    }

    faceCount = indices.length / 3;

    // Validate index bounds
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      if (idx < 0 || idx >= vertexCount) {
        throw new MeshValidationError(
          `Index ${idx} at position ${i} is out of bounds [0, ${vertexCount - 1}]`,
          MeshErrorCode.INDEX_OUT_OF_BOUNDS,
          { indexPosition: i, indexValue: idx, vertexCount },
        );
      }
    }
  } else {
    // Non-indexed: every 3 vertices form a triangle
    if (vertexCount % 3 !== 0) {
      throw new MeshValidationError(
        `Non-indexed mesh has ${vertexCount} vertices, not divisible by 3`,
        MeshErrorCode.INVALID_VERTEX_COUNT,
        { vertexCount },
      );
    }
    faceCount = vertexCount / 3;
  }

  if (faceCount === 0) {
    throw new MeshValidationError(
      'Mesh has zero faces',
      MeshErrorCode.EMPTY_POSITIONS,
    );
  }

  // ── Check for degenerate (zero-area) faces ─────────
  const indices = mesh.indices;
  let degenerateCount = 0;

  for (let f = 0; f < faceCount; f++) {
    const i0 = indices ? indices[f * 3] : f * 3;
    const i1 = indices ? indices[f * 3 + 1] : f * 3 + 1;
    const i2 = indices ? indices[f * 3 + 2] : f * 3 + 2;

    const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];

    // Cross product magnitude = 2 × area
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const crossX = e1y * e2z - e1z * e2y;
    const crossY = e1z * e2x - e1x * e2z;
    const crossZ = e1x * e2y - e1y * e2x;
    const areaSq = crossX * crossX + crossY * crossY + crossZ * crossZ;

    if (areaSq < 1e-20) degenerateCount++;
  }

  if (degenerateCount > 0) {
    const pct = ((degenerateCount / faceCount) * 100).toFixed(1);
    warnings.push(`${degenerateCount} degenerate faces detected (${pct}% of total)`);
  }

  if (degenerateCount === faceCount) {
    throw new MeshValidationError(
      'All faces are degenerate (zero area)',
      MeshErrorCode.DEGENERATE_FACE,
      { degenerateCount, faceCount },
    );
  }

  return { valid: true, vertexCount, faceCount, warnings };
}
