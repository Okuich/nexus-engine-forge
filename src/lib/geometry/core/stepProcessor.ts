/**
 * STEP (ISO 10303-21) Processor.
 *
 * Lightweight, dependency-free STEP/STP file processor that extracts
 * header metadata, schema info, and entity records, then drives a
 * pluggable tessellator to produce a triangulated RawMesh.
 *
 * Full BREP-to-mesh conversion is out of scope — production deployments
 * inject a server-side tessellator (e.g., Open CASCADE) via the
 * `tessellator` option. When omitted, the processor returns parsed
 * structure plus an empty mesh, which is still useful for catalog
 * ingest, entity counting, and metadata workflows.
 */

import type { RawMesh } from '../types';

// ─── Types ──────────────────────────────────────────────────────

export interface StepHeader {
  description: string[];
  fileName: string;
  author: string[];
  organization: string[];
  preprocessorVersion: string;
  originatingSystem: string;
  authorization: string;
  schema: string[];
  timestamp: string;
}

export interface StepEntity {
  /** Entity reference id (e.g. 42 from `#42`). */
  id: number;
  /** Entity type name (e.g. ADVANCED_FACE). */
  type: string;
  /** Raw parameter string between the parentheses. */
  params: string;
}

export interface StepDocument {
  header: StepHeader;
  entities: StepEntity[];
  /** Map for O(1) lookup by id. */
  entityMap: Map<number, StepEntity>;
  /** Counts by entity type, useful for analytics. */
  entityCounts: Record<string, number>;
}

export interface StepTessellationOptions {
  /** Linear deflection (model units). Default 0.1. */
  linearDeflection?: number;
  /** Angular deflection (radians). Default 0.5. */
  angularDeflection?: number;
}

/** Pluggable tessellator. Receives the parsed STEP document and tolerance. */
export type StepTessellator = (
  doc: StepDocument,
  opts: Required<StepTessellationOptions>,
) => Promise<RawMesh> | RawMesh;

export interface StepProcessResult {
  document: StepDocument;
  mesh: RawMesh;
  /** True when the tessellator produced any triangles. */
  tessellated: boolean;
  /** Time spent parsing (ms). */
  parseMs: number;
  /** Time spent tessellating (ms). */
  tessellateMs: number;
}

// ─── Header & entity parsing ───────────────────────────────────

const EMPTY_HEADER: StepHeader = {
  description: [],
  fileName: '',
  author: [],
  organization: [],
  preprocessorVersion: '',
  originatingSystem: '',
  authorization: '',
  schema: [],
  timestamp: '',
};

/**
 * Parse a STEP file string into a StepDocument.
 * Tolerant of whitespace, line wrapping, and inline comments (/* ... *​/).
 */
export function parseStep(source: string): StepDocument {
  // Strip block comments.
  const cleaned = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const headerSection = extractSection(cleaned, 'HEADER', 'ENDSEC');
  const dataSection = extractSection(cleaned, 'DATA', 'ENDSEC');

  const header = parseHeader(headerSection);
  const entities = parseEntities(dataSection);
  const entityMap = new Map<number, StepEntity>();
  const entityCounts: Record<string, number> = {};
  for (const e of entities) {
    entityMap.set(e.id, e);
    entityCounts[e.type] = (entityCounts[e.type] ?? 0) + 1;
  }
  return { header, entities, entityMap, entityCounts };
}

function extractSection(src: string, start: string, end: string): string {
  const re = new RegExp(`${start};([\\s\\S]*?)${end};`, 'i');
  const m = src.match(re);
  return m ? m[1] : '';
}

function parseHeader(src: string): StepHeader {
  if (!src) return { ...EMPTY_HEADER };
  const out: StepHeader = { ...EMPTY_HEADER, schema: [], description: [], author: [], organization: [] };
  const stmtRe = /([A-Z_]+)\s*\(([\s\S]*?)\)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = stmtRe.exec(src))) {
    const name = match[1].toUpperCase();
    const args = splitTopLevelArgs(match[2]);
    switch (name) {
      case 'FILE_DESCRIPTION':
        out.description = parseStringList(args[0]);
        break;
      case 'FILE_NAME':
        out.fileName = stripQuotes(args[0] ?? '');
        out.timestamp = stripQuotes(args[1] ?? '');
        out.author = parseStringList(args[2]);
        out.organization = parseStringList(args[3]);
        out.preprocessorVersion = stripQuotes(args[4] ?? '');
        out.originatingSystem = stripQuotes(args[5] ?? '');
        out.authorization = stripQuotes(args[6] ?? '');
        break;
      case 'FILE_SCHEMA':
        out.schema = parseStringList(args[0]);
        break;
    }
  }
  return out;
}

function parseEntities(src: string): StepEntity[] {
  if (!src) return [];
  const entities: StepEntity[] = [];
  // #ID = TYPE( ... );    (params may contain nested parens/strings)
  const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const id = parseInt(m[1], 10);
    const type = m[2];
    const start = re.lastIndex; // first char after '('
    const end = matchClosingParen(src, start - 1);
    if (end < 0) continue;
    const params = src.slice(start, end);
    entities.push({ id, type, params });
    re.lastIndex = end + 1;
  }
  return entities;
}

function matchClosingParen(src: string, openIdx: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" && src[i - 1] !== '\\') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevelArgs(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" && src[i - 1] !== '\\') {
      inStr = !inStr;
      cur += ch;
      continue;
    }
    if (!inStr) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim().length) out.push(cur.trim());
  return out;
}

function parseStringList(src: string | undefined): string[] {
  if (!src) return [];
  const trimmed = src.trim().replace(/^\(|\)$/g, '');
  return splitTopLevelArgs(trimmed).map(stripQuotes).filter(Boolean);
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^'|'$/g, '');
}

// ─── Top-level processing ──────────────────────────────────────

const DEFAULT_TESS: Required<StepTessellationOptions> = {
  linearDeflection: 0.1,
  angularDeflection: 0.5,
};

export interface ProcessStepOptions extends StepTessellationOptions {
  tessellator?: StepTessellator;
}

/**
 * Parse a STEP source string and (optionally) produce a tessellated mesh.
 */
export async function processStep(
  source: string,
  opts: ProcessStepOptions = {},
): Promise<StepProcessResult> {
  const tessOpts = { ...DEFAULT_TESS, ...opts };
  const t0 = nowMs();
  const document = parseStep(source);
  const parseMs = nowMs() - t0;

  const t1 = nowMs();
  let mesh: RawMesh = { positions: new Float32Array(0), indices: new Uint32Array(0) };
  if (opts.tessellator) {
    mesh = await opts.tessellator(document, tessOpts);
  }
  const tessellateMs = nowMs() - t1;
  const tessellated = (mesh.indices?.length ?? 0) > 0;

  return { document, mesh, tessellated, parseMs, tessellateMs };
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
