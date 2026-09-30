/**
 * Knowledge Base: Backend Engineering track.
 */
import type { KnowledgeTopicEntry } from "./types";

export const BACKEND_KB: KnowledgeTopicEntry[] = [
  {
    id: "backend_depth",
    label: "Backend Architecture Depth",
    track: "backend",
    concepts: [
      "data modeling and schema design",
      "API design trade-offs (REST vs gRPC vs GraphQL)",
      "failure handling and retry strategies",
      "scaling strategies (vertical vs horizontal, sharding)",
      "caching layers and cache invalidation",
      "background job processing and queues",
      "debugging production issues",
    ],
    depthLadder: {
      easy: "Ask about a backend system they built: what it did, what technologies it used, and what they are most proud of. Let them anchor the conversation.",
      medium: "Probe API design decisions: why REST vs gRPC, how they handled versioning, how they designed error responses. Or probe database choices: why this schema, why this index, what queries were slow?",
      hard: "Push on failure modes: what happens when the database is down, when a downstream service is slow, when a queue backs up? How did they design for and test these? Probe for circuit breakers, fallbacks, backpressure.",
    },
    signalsOfStrength: [
      "mentions idempotency, retries, backoff, or circuit breakers unprompted",
      "discusses data consistency trade-offs (eventual vs strong)",
      "has specific metrics on query latency or throughput",
      "explains schema design rationale",
    ],
    signalsOfWeakness: [
      "only knows happy-path flows",
      "cannot explain why they chose a specific database or ORM",
      "no awareness of failure modes or retry logic",
    ],
  },
  {
    id: "database_knowledge",
    label: "Database & Persistence",
    track: "backend",
    concepts: [
      "relational vs NoSQL trade-offs",
      "indexing strategy and query optimization",
      "transactions and isolation levels",
      "connection pooling and N+1 queries",
      "migration strategies",
      "read replicas and write scaling",
    ],
    depthLadder: {
      easy: "Ask about databases they have used and why they chose them for a project.",
      medium: "Probe indexing: how did they identify a slow query, what did they do to fix it? Or probe transactions: when did they use transactions, what isolation level?",
      hard: "Push on scale: how did they handle a database that was becoming the bottleneck? Sharding, read replicas, caching, or schema changes? What were the migration risks?",
    },
    signalsOfStrength: [
      "EXPLAIN ANALYZE or query plan analysis mentioned",
      "specific index types discussed (composite, partial, covering)",
      "aware of N+1 problem and how to detect it",
      "mentions migration safety (zero downtime, backwards compatible)",
    ],
    signalsOfWeakness: [
      "cannot explain why they chose a database",
      "unaware of what indexes do",
      "has never profiled a slow query",
    ],
  },
];
