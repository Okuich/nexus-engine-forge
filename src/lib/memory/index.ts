export {
  storeMemory,
  searchMemory,
  recordFeedback,
  getMemoryStats,
  storeIssueResolution,
  findSimilarIssues,
} from './service';

export {
  generateLocalEmbedding,
  cosineSimilarity,
  keywordSimilarity,
  tagSimilarity,
  combinedSimilarity,
} from './embeddingEngine';

export type {
  MemoryCategory,
  IssueResolution,
  MemoryRecord,
  MemorySearchOptions,
  MemorySearchResult,
  StoreMemoryInput,
  MemoryFeedback,
  MemoryStats,
} from './types';
