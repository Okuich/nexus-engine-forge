import { describe, it } from 'vitest';
import { generateBox } from '@/lib/geometry/core';
import { voxelizeForTopology, runSIMP, applyManufacturability, thresholdDensity } from '@/lib/geometry/topology';

describe('zdebug', () => {
  it('logs', () => {
    const box = generateBox({ width: 20, height: 10, depth: 10 });
    const dom = voxelizeForTopology(box, 16);
    const r = runSIMP(dom, [{point:[8,0,0],force:[0,-200,0]}], [{point:[-8,0,0]},{point:[-8,2,2]}], { maxIterations: 8, targetVolumeFraction: 0.6, timeBudgetMs: 4000 });
    console.log('iters', r.iterations, 'compl', r.compliance);
    let densSum = 0, max = 0;
    for (const v of r.density) { densSum += v; if (v > max) max = v; }
    console.log('density sum', densSum, 'max', max, 'mean', densSum/r.density.length);
    const bin0 = thresholdDensity(r.density);
    let bs = 0; for (const v of bin0) bs += v;
    console.log('binary >=0.5 count', bs);
    const post = applyManufacturability(r.density, {
      constraints: { process: 'cnc_milling', minFeatureMm: 0.5 },
      domain: dom,
      supportPoints: [[-8,0,0],[-8,2,2]],
    });
    let bs2 = 0; for (const v of post.binary) bs2 += v;
    console.log('post-process binary count', bs2);
  });
});
