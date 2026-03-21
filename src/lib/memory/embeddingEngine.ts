/**
 * Embedding Engine — Generates and compares text embeddings
 *
 * Uses a lightweight bag-of-words TF approach for local similarity,
 * with an optional hook for external embedding APIs.
 */

// ─── Local Embedding (TF-based bag-of-words) ────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
  'it', 'its', 'he', 'she', 'we', 'they', 'them', 'what', 'which', 'who',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Build a vocabulary from a set of documents (or a single text).
 * Returns a sorted array of unique tokens.
 */
function buildVocab(texts: string[]): string[] {
  const vocab = new Set<string>();
  for (const t of texts) {
    for (const token of tokenize(t)) vocab.add(token);
  }
  return [...vocab].sort();
}

/**
 * Generate a local TF embedding vector for a given text
 * against a fixed vocabulary.
 */
export function generateLocalEmbedding(text: string, vocab?: string[]): number[] {
  const tokens = tokenize(text);
  const v = vocab ?? buildVocab([text]);
  const vec = new Array(v.length).fill(0);
  const tokenIndex = new Map(v.map((t, i) => [t, i]));

  for (const token of tokens) {
    const idx = tokenIndex.get(token);
    if (idx !== undefined) vec[idx]++;
  }

  // L2-normalize
  const norm = Math.sqrt(vec.reduce((sum: number, x: number) => sum + x * x, 0));
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }

  return vec;
}

/**
 * Cosine similarity between two vectors of the same length.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Keyword-based similarity using Jaccard coefficient.
 */
export function keywordSimilarity(textA: string, textB: string): number {
  const tokensA = new Set(tokenize(textA));
  const tokensB = new Set(tokenize(textB));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Tag overlap similarity (Jaccard on tag arrays).
 */
export function tagSimilarity(tagsA: string[], tagsB: string[]): number {
  const setA = new Set(tagsA.map((t) => t.toLowerCase()));
  const setB = new Set(tagsB.map((t) => t.toLowerCase()));

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Combined similarity score using multiple signals.
 */
export function combinedSimilarity(
  queryText: string,
  candidateText: string,
  queryTags: string[],
  candidateTags: string[],
  queryEmbedding?: number[] | null,
  candidateEmbedding?: number[] | null,
): { similarity: number; matchType: 'embedding' | 'keyword' | 'tag' } {
  const keyword = keywordSimilarity(queryText, candidateText);
  const tag = tagSimilarity(queryTags, candidateTags);

  let embedding = 0;
  let hasEmbedding = false;

  if (queryEmbedding && candidateEmbedding && queryEmbedding.length === candidateEmbedding.length) {
    embedding = cosineSimilarity(queryEmbedding, candidateEmbedding);
    hasEmbedding = true;
  }

  // Weighted combination
  const weights = hasEmbedding
    ? { embedding: 0.5, keyword: 0.3, tag: 0.2 }
    : { embedding: 0, keyword: 0.6, tag: 0.4 };

  const score =
    weights.embedding * embedding +
    weights.keyword * keyword +
    weights.tag * tag;

  // Determine primary match type
  const matchType =
    hasEmbedding && embedding >= keyword && embedding >= tag ? 'embedding' :
    tag >= keyword ? 'tag' : 'keyword';

  return { similarity: Math.round(score * 1000) / 1000, matchType };
}
