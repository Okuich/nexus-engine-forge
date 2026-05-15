/**
 * OpenAPI 3.1 spec for simplify-api.
 *
 * Mirrors the Zod schemas in index.ts. Exposed at:
 *   GET /simplify-api/openapi.json   → JSON spec
 *   GET /simplify-api/docs           → Swagger UI (rendered from CDN)
 */

export const MAX_TRIANGLES = 200_000;
export const MAX_LODS = 6;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Mesh Simplification API',
    version: '1.0.0',
    description:
      'Generate Level-of-Detail meshes and coarsened face-adjacency graphs ' +
      'for downstream GNN inference. Self-contained vertex-cluster simplifier ' +
      'plus heaviest-edge graph coarsening.',
  },
  servers: [
    { url: '/functions/v1/simplify-api', description: 'Lovable Cloud edge function' },
  ],
  tags: [
    { name: 'lods', description: 'Level-of-Detail mesh generation' },
    { name: 'graph', description: 'Face-adjacency graph coarsening' },
    { name: 'inference', description: 'Combined LOD + graph + feature matrix' },
    { name: 'upload', description: 'Multipart STL/OBJ upload' },
    { name: 'meta', description: 'Health and schema discovery' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['meta'],
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Service healthy',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } },
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        tags: ['meta'],
        summary: 'OpenAPI 3.1 specification',
        responses: { '200': { description: 'OpenAPI document', content: { 'application/json': {} } } },
      },
    },
    '/docs': {
      get: {
        tags: ['meta'],
        summary: 'Swagger UI for this API',
        responses: { '200': { description: 'HTML page', content: { 'text/html': {} } } },
      },
    },
    '/lods': {
      post: {
        tags: ['lods'],
        summary: 'Generate LOD chain via vertex-cluster simplification',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LODsRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'LOD chain',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LODsResponse' } } },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
    '/graph': {
      post: {
        tags: ['graph'],
        summary: 'Coarsen the face-adjacency graph (heaviest-edge matching)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/GraphRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Coarsened graph',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/GraphResponse' } } },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
    '/inference': {
      post: {
        tags: ['inference'],
        summary: 'Build LODs + coarsened graph + flat feature matrix in one call',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/InferenceRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Inference payload',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/InferenceResponse' } } },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      },
    },
    '/upload': {
      post: {
        tags: ['upload'],
        summary: 'Upload an STL or OBJ file and return LODs + coarsened graph',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { $ref: '#/components/schemas/UploadForm' },
              encoding: { file: { contentType: 'model/stl, model/obj, application/octet-stream' } },
            },
          },
        },
        responses: {
          '200': {
            description: 'Parsed mesh + LODs + graph',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UploadResponse' } } },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '413': { $ref: '#/components/responses/PayloadTooLarge' },
          '415': { $ref: '#/components/responses/UnsupportedMedia' },
        },
      },
    },
  },
  components: {
    responses: {
      BadRequest: {
        description: 'Invalid request',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      PayloadTooLarge: {
        description: 'Payload exceeds limits',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      UnsupportedMedia: {
        description: 'Unsupported media type or mesh format',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
    schemas: {
      Health: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: {},
        },
        required: ['error'],
      },
      Vec3: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'number' },
      },
      MeshInput: {
        type: 'object',
        description: 'Raw mesh. Triangles soup if `indices` omitted (positions length / 9 triangles).',
        properties: {
          positions: {
            type: 'array',
            minItems: 9,
            items: { type: 'number' },
            description: 'Flat XYZ float array.',
          },
          indices: {
            type: 'array',
            items: { type: 'integer', minimum: 0 },
            description: 'Triangle indices into positions/3.',
          },
        },
        required: ['positions'],
      },
      LODOptions: {
        type: 'object',
        properties: {
          levels: { type: 'integer', minimum: 1, maximum: MAX_LODS, default: 3 },
          ratioPerLevel: { type: 'number', minimum: 0.05, maximum: 0.95, default: 0.5 },
          minTriangles: { type: 'integer', minimum: 4, default: 64 },
          maxLevels: { type: 'integer', minimum: 1, maximum: MAX_LODS },
        },
      },
      GraphOptions: {
        type: 'object',
        properties: {
          targetNodes: { type: 'integer', minimum: 1 },
          targetRatio: { type: 'number', minimum: 0.01, maximum: 0.95, default: 0.25 },
        },
      },
      SerializedMesh: {
        type: 'object',
        properties: {
          positions: { type: 'string', description: 'base64-encoded Float32Array of XYZ.' },
          indices: { type: 'string', description: 'base64-encoded Uint32Array of triangle indices.' },
          vertexCount: { type: 'integer' },
          triangleCount: { type: 'integer' },
        },
        required: ['positions', 'indices', 'vertexCount', 'triangleCount'],
      },
      LODStats: {
        type: 'object',
        properties: {
          inputTriangles: { type: 'integer' },
          outputTriangles: { type: 'integer' },
          inputVertices: { type: 'integer' },
          outputVertices: { type: 'integer' },
          elapsedMs: { type: 'number' },
        },
        required: ['inputTriangles', 'outputTriangles', 'inputVertices', 'outputVertices', 'elapsedMs'],
      },
      LOD: {
        type: 'object',
        properties: {
          level: { type: 'integer', minimum: 0 },
          ratio: { type: 'number', minimum: 0, maximum: 1 },
          mesh: { $ref: '#/components/schemas/SerializedMesh' },
          stats: { $ref: '#/components/schemas/LODStats' },
        },
        required: ['level', 'ratio', 'mesh', 'stats'],
      },
      NodeFeature: {
        type: 'object',
        properties: {
          area: { type: 'number' },
          avgNormal: { $ref: '#/components/schemas/Vec3' },
          avgCurvature: { type: 'number' },
        },
        required: ['area', 'avgNormal', 'avgCurvature'],
      },
      GraphPayload: {
        type: 'object',
        properties: {
          nodeCount: { type: 'integer' },
          edgeCount: { type: 'integer' },
          edges: {
            type: 'array',
            items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
          },
          clusters: {
            type: 'array',
            description: 'Cluster id → list of original face indices.',
            items: { type: 'array', items: { type: 'integer' } },
          },
          nodeFeatures: { type: 'array', items: { $ref: '#/components/schemas/NodeFeature' } },
          edgeCompression: { type: 'number', description: 'coarse edges / original edges.' },
        },
        required: ['nodeCount', 'edgeCount', 'edges', 'clusters', 'nodeFeatures', 'edgeCompression'],
      },
      LODsRequest: {
        type: 'object',
        properties: {
          mesh: { $ref: '#/components/schemas/MeshInput' },
          options: { $ref: '#/components/schemas/LODOptions' },
        },
        required: ['mesh'],
      },
      LODsResponse: {
        type: 'object',
        properties: {
          lods: { type: 'array', items: { $ref: '#/components/schemas/LOD' } },
          totalElapsedMs: { type: 'number' },
        },
        required: ['lods', 'totalElapsedMs'],
      },
      GraphRequest: {
        type: 'object',
        properties: {
          mesh: { $ref: '#/components/schemas/MeshInput' },
          options: { $ref: '#/components/schemas/GraphOptions' },
        },
        required: ['mesh'],
      },
      GraphResponse: {
        type: 'object',
        properties: {
          graph: { $ref: '#/components/schemas/GraphPayload' },
          elapsedMs: { type: 'number' },
        },
        required: ['graph', 'elapsedMs'],
      },
      InferenceRequest: {
        type: 'object',
        properties: {
          mesh: { $ref: '#/components/schemas/MeshInput' },
          lod: { $ref: '#/components/schemas/LODOptions' },
          graph: { $ref: '#/components/schemas/GraphOptions' },
        },
        required: ['mesh'],
      },
      InferenceResponse: {
        type: 'object',
        properties: {
          coarseMesh: { $ref: '#/components/schemas/SerializedMesh' },
          lods: { type: 'array', items: { $ref: '#/components/schemas/LOD' } },
          graph: { $ref: '#/components/schemas/GraphPayload' },
          features: {
            type: 'string',
            description: 'base64-encoded Float32Array, length = nodeCount × featureDim.',
          },
          featureDim: { type: 'integer', description: 'Currently 7: [area, nx, ny, nz, curvature, |members|, levelHint].' },
          nodeToFaces: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
          elapsedMs: { type: 'number' },
        },
        required: ['coarseMesh', 'lods', 'graph', 'features', 'featureDim', 'nodeToFaces', 'elapsedMs'],
      },
      UploadForm: {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary', description: `STL or OBJ file (max ${MAX_UPLOAD_BYTES} bytes).` },
          format: { type: 'string', enum: ['stl', 'obj'], description: 'Optional override; otherwise inferred from filename/Content-Type.' },
          levels: { type: 'integer', minimum: 1, maximum: MAX_LODS },
          ratioPerLevel: { type: 'number', minimum: 0.05, maximum: 0.95 },
          minTriangles: { type: 'integer', minimum: 4 },
          maxLevels: { type: 'integer', minimum: 1, maximum: MAX_LODS },
          targetNodes: { type: 'integer', minimum: 1 },
          targetRatio: { type: 'number', minimum: 0.01, maximum: 0.95 },
        },
        required: ['file'],
      },
      UploadResponse: {
        type: 'object',
        properties: {
          upload: {
            type: 'object',
            properties: {
              filename: { type: 'string' },
              format: { type: 'string', enum: ['stl', 'obj'] },
              bytes: { type: 'integer' },
              triangleCount: { type: 'integer' },
              vertexCount: { type: 'integer' },
            },
            required: ['filename', 'format', 'bytes', 'triangleCount', 'vertexCount'],
          },
          lods: { type: 'array', items: { $ref: '#/components/schemas/LOD' } },
          coarseMesh: { $ref: '#/components/schemas/SerializedMesh' },
          graph: { $ref: '#/components/schemas/GraphPayload' },
          elapsedMs: { type: 'number' },
        },
        required: ['upload', 'lods', 'coarseMesh', 'graph', 'elapsedMs'],
      },
    },
  },
} as const;

export const swaggerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Mesh Simplification API — Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: './openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      docExpansion: 'list',
    });
  </script>
</body>
</html>`;
