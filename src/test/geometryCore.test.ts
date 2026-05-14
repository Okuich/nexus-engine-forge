import { describe, it, expect } from 'vitest';
import {
  generateBox,
  generateSphere,
  generateCylinder,
  generatePlane,
  subdivide,
  analyzeTopology,
  BVH,
  UniformGrid,
  parseStep,
  processStep,
} from '@/lib/geometry/core';

describe('geometry core — mesh generation', () => {
  it('box has 12 triangles and 8 verts', () => {
    const m = generateBox({ width: 2, height: 2, depth: 2 });
    expect(m.positions.length / 3).toBe(8);
    expect(m.indices!.length / 3).toBe(12);
  });

  it('sphere is closed and manifold', () => {
    const s = generateSphere({ radius: 1, latSegments: 8, lonSegments: 12 });
    const t = analyzeTopology(s);
    expect(t.isClosed).toBe(true);
    expect(t.isManifold).toBe(true);
    expect(t.connectedComponents).toBe(1);
  });

  it('subdivision multiplies face count by 4 per pass', () => {
    const m = generateBox();
    const original = m.indices!.length / 3;
    const sub = subdivide(m, 1);
    expect(sub.indices!.length / 3).toBe(original * 4);
  });
});

describe('geometry core — topology', () => {
  it('closed box: χ=2, genus=0, watertight', () => {
    const t = analyzeTopology(generateBox());
    expect(t.eulerCharacteristic).toBe(2);
    expect(t.genus).toBe(0);
    expect(t.isWatertight).toBe(true);
    expect(t.boundaryEdges).toBe(0);
  });

  it('open plane has boundary edges and a single boundary loop', () => {
    const p = generatePlane({ widthSegments: 2, heightSegments: 2 });
    const t = analyzeTopology(p);
    expect(t.boundaryEdges).toBeGreaterThan(0);
    expect(t.isClosed).toBe(false);
    expect(t.isWatertight).toBe(false);
    expect(t.boundaryLoops).toBeGreaterThanOrEqual(1);
  });

  it('uncapped cylinder has 2 boundary loops', () => {
    const c = generateCylinder({ capped: false });
    const t = analyzeTopology(c);
    expect(t.isClosed).toBe(false);
    expect(t.boundaryLoops).toBe(2);
  });
});

describe('geometry core — spatial acceleration', () => {
  it('BVH raycast hits a unit box from outside', () => {
    const bvh = new BVH(generateBox({ width: 2, height: 2, depth: 2 }));
    const hit = bvh.raycast({ origin: [0, 0, 5], direction: [0, 0, -1] });
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeGreaterThan(0);
    expect(hit!.point[2]).toBeCloseTo(1, 3);
  });

  it('BVH box query returns subset overlapping bounds', () => {
    const bvh = new BVH(generateSphere({ radius: 1, latSegments: 8, lonSegments: 12 }));
    const subset = bvh.queryBox({ min: [0, 0, 0], max: [1.1, 1.1, 1.1] });
    expect(subset.length).toBeGreaterThan(0);
    expect(subset.length).toBeLessThan(bvh.triangleCount);
  });

  it('UniformGrid point query returns triangles near point', () => {
    const grid = new UniformGrid(generateBox({ width: 2, height: 2, depth: 2 }), { resolution: 8 });
    const result = grid.queryPoint([1, 0, 0]);
    expect(result.length).toBeGreaterThan(0);
  });

  it('BVH nearest triangle returns finite distance', () => {
    const bvh = new BVH(generateSphere({ radius: 1 }));
    const n = bvh.nearestTriangle([2, 0, 0]);
    expect(n).not.toBeNull();
    expect(Number.isFinite(n!.distance)).toBe(true);
  });
});

describe('geometry core — STEP processor', () => {
  const SAMPLE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('test part'),'2;1');
FILE_NAME('part.step','2024-01-01T00:00:00',('Author'),('Org'),'Preproc 1.0','System X','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = APPLICATION_CONTEXT('mechanical design');
#2 = CARTESIAN_POINT('',(0.,0.,0.));
#3 = ADVANCED_FACE('',(#2),#1,.T.);
ENDSEC;
END-ISO-10303-21;`;

  it('parses header and entities', () => {
    const doc = parseStep(SAMPLE);
    expect(doc.header.fileName).toBe('part.step');
    expect(doc.header.schema).toContain('AUTOMOTIVE_DESIGN');
    expect(doc.entities.length).toBe(3);
    expect(doc.entityCounts.ADVANCED_FACE).toBe(1);
    expect(doc.entityMap.get(2)?.type).toBe('CARTESIAN_POINT');
  });

  it('processStep returns empty mesh without tessellator', async () => {
    const r = await processStep(SAMPLE);
    expect(r.tessellated).toBe(false);
    expect(r.document.entities.length).toBe(3);
    expect(r.parseMs).toBeGreaterThanOrEqual(0);
  });

  it('processStep invokes pluggable tessellator', async () => {
    const r = await processStep(SAMPLE, {
      tessellator: () => generateBox(),
    });
    expect(r.tessellated).toBe(true);
    expect(r.mesh.indices!.length).toBeGreaterThan(0);
  });
});
