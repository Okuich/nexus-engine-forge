export {
  processOutcome,
  submitFeedback,
  buildLearningContext,
  getLearningStats,
  loadWeights,
} from './service';

export {
  computeReward,
  updateWeights,
  createDefaultWeights,
} from './reinforcementEngine';

export type {
  ExecutionOutcome,
  StepOutcome,
  OutcomeFeedback,
  FeedbackSource,
  RewardSignal,
  RewardComponents,
  StrategyWeights,
  LearningEpisode,
  LearningStats,
} from './types';
