import { generateBox } from '@/lib/geometry/core';
import { voxelizeForTopology, worldToVoxel, runSIMP } from '@/lib/geometry/topology';

const box = generateBox({ width: 20, height: 10, depth: 10 });
const dom = voxelizeForTopology(box, 16);
let solid = 0;
for (const v of dom.designMask) solid += v;
console.log('dims:', dom.dims, 'voxelSize:', dom.voxelSize, 'solid:', solid, '/', dom.designMask.length);
console.log('origin:', dom.origin);
console.log('load voxel:', worldToVoxel(dom, [8,0,0]));
console.log('support voxel:', worldToVoxel(dom, [-8,0,0]));

const r = runSIMP(dom, [{point:[8,0,0],force:[0,-200,0]}], [{point:[-8,0,0]}], { maxIterations: 3, timeBudgetMs: 4000 });
console.log('iterations:', r.iterations, 'compliance:', r.compliance);
