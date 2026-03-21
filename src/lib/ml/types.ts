// ─── Geometry & Dataset Schemas ─────────────────────────────────

export interface GeometryNode {
  id: string;
  type: 'face' | 'edge' | 'vertex';
  features: number[];
  position?: [number, number, number];
  normal?: [number, number, number];
}

export interface GeometryEdge {
  source: string;
  target: string;
  type: 'adjacent' | 'tangent' | 'concentric';
  features?: number[];
}

export interface GeometrySample {
  id: string;
  name: string;
  nodes: GeometryNode[];
  edges: GeometryEdge[];
  labels?: {
    manufacturability: number;
    estimated_cost: number;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
  };
  metadata?: {
    material?: string;
    process?: string;
    source_file?: string;
  };
}

// ─── Training Job ───────────────────────────────────────────────

export type JobStatus =
  | 'queued'
  | 'preprocessing'
  | 'training'
  | 'evaluating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TrainingJobConfig {
  learning_rate: number;
  batch_size: number;
  epochs: number;
  hidden_dim: number;
  num_heads: number;
  dropout: number;
  optimizer: 'adam' | 'adamw' | 'sgd';
  scheduler: 'cosine' | 'step' | 'plateau' | 'none';
  early_stopping_patience: number;
}

export interface TrainingJob {
  id: string;
  name: string;
  status: JobStatus;
  model_type: string;
  dataset_id: string | null;
  config: TrainingJobConfig;
  metrics: TrainingMetricsSummary;
  progress: number;
  epochs_completed: number;
  epochs_total: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrainingMetricsSummary {
  best_val_loss?: number;
  best_accuracy?: number;
  best_f1?: number;
  final_train_loss?: number;
}

// ─── Epoch Metrics ──────────────────────────────────────────────

export interface EpochMetric {
  id: string;
  job_id: string;
  epoch: number;
  train_loss: number | null;
  val_loss: number | null;
  accuracy: number | null;
  f1_score: number | null;
  learning_rate: number | null;
  recorded_at: string;
}

// ─── Model Version ──────────────────────────────────────────────

export interface ModelVersion {
  id: string;
  job_id: string;
  version: string;
  model_type: string;
  metrics: TrainingMetricsSummary;
  artifact_path: string | null;
  is_active: boolean;
  created_at: string;
}

// ─── API Request / Response ─────────────────────────────────────

export interface StartTrainingRequest {
  name: string;
  model_type?: string;
  dataset_id?: string;
  config?: Partial<TrainingJobConfig>;
}

export interface StartTrainingResponse {
  job: TrainingJob;
}

export interface DatasetUploadRequest {
  name: string;
  samples: GeometrySample[];
}

export interface DatasetPreprocessRequest {
  dataset_id: string;
  normalize?: boolean;
  augment?: boolean;
  train_split?: number;
}

export const DEFAULT_TRAINING_CONFIG: TrainingJobConfig = {
  learning_rate: 0.001,
  batch_size: 32,
  epochs: 100,
  hidden_dim: 128,
  num_heads: 4,
  dropout: 0.1,
  optimizer: 'adamw',
  scheduler: 'cosine',
  early_stopping_patience: 15,
};
