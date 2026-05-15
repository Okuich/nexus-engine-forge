import { describe, it, expect } from 'vitest';
import { openApiSpec } from '../../supabase/functions/simplify-api/openapi.ts';

describe('simplify-api OpenAPI spec', () => {
  it('declares OpenAPI 3.1 with required REST paths', () => {
    expect(openApiSpec.openapi).toMatch(/^3\.1/);
    const paths = Object.keys(openApiSpec.paths);
    for (const p of ['/health', '/openapi.json', '/docs', '/lods', '/graph', '/inference', '/upload']) {
      expect(paths).toContain(p);
    }
  });

  it('exposes request and response schemas for LODs and graph coarsening', () => {
    const schemas = openApiSpec.components.schemas as Record<string, unknown>;
    for (const name of [
      'MeshInput', 'LODOptions', 'GraphOptions',
      'LODsRequest', 'LODsResponse',
      'GraphRequest', 'GraphResponse',
      'InferenceRequest', 'InferenceResponse',
      'UploadForm', 'UploadResponse',
      'SerializedMesh', 'GraphPayload', 'NodeFeature',
    ]) {
      expect(schemas[name], `missing schema ${name}`).toBeDefined();
    }
  });

  it('binds /upload to multipart/form-data', () => {
    const upload = openApiSpec.paths['/upload'].post;
    expect(upload.requestBody.content['multipart/form-data']).toBeDefined();
  });
});
