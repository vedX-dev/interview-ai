/**
 * Knowledge Base: Data Science track.
 */
import type { KnowledgeTopicEntry } from "./types";

export const DATA_SCIENCE_KB: KnowledgeTopicEntry[] = [
  {
    id: "ml_fundamentals",
    label: "ML/Data Fundamentals",
    track: "data_science",
    concepts: [
      "model selection and evaluation",
      "feature engineering",
      "overfitting, regularization, and validation",
      "data pipeline design",
      "experimentation and A/B testing",
    ],
    depthLadder: {
      easy: "Ask what ML models or data techniques they have used in production and what problems they solved.",
      medium: "Probe evaluation: how did they measure model performance, what metrics did they choose and why, how did they handle class imbalance or data skew?",
      hard: "Push on production ML: how did they monitor model drift, handle data quality issues, or roll back a bad model? What was their retraining pipeline?",
    },
    signalsOfStrength: [
      "discusses metrics appropriate to the problem (F1 vs AUC vs precision)",
      "mentions train/val/test split discipline",
      "has built a retraining or monitoring pipeline",
      "aware of data leakage",
    ],
    signalsOfWeakness: [
      "only uses accuracy as a metric",
      "cannot explain why they chose a model",
      "no experience with production ML monitoring",
    ],
  },
];
