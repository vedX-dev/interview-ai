/**
 * Knowledge Base: System Design track.
 */
import type { KnowledgeTopicEntry } from "./types";

export const SYSTEM_DESIGN_KB: KnowledgeTopicEntry[] = [
  {
    id: "distributed_systems",
    label: "Distributed Systems & Reliability",
    track: "system_design",
    concepts: [
      "CAP theorem trade-offs",
      "service mesh and inter-service communication",
      "rate limiting and backpressure",
      "distributed tracing and observability",
      "event-driven architecture patterns",
      "consensus and leader election",
    ],
    depthLadder: {
      easy: "Ask the candidate to describe a distributed system they worked on. What services did it have, how did they communicate?",
      medium: "Probe reliability: how did they handle a downstream service failure? What monitoring did they have? How were incidents detected and resolved?",
      hard: "Push on trade-offs: consistency vs availability, synchronous vs async communication, fan-out problems, or idempotency at scale. Have them reason through a design they have not built before.",
    },
    signalsOfStrength: [
      "mentions CAP, eventual consistency, or idempotency unprompted",
      "has real experience with distributed tracing (Jaeger, Datadog, etc.)",
      "discusses backpressure or graceful degradation",
      "concrete story of a distributed system failure they debugged",
    ],
    signalsOfWeakness: [
      "thinks distributed means just multiple servers",
      "no awareness of consistency vs availability trade-offs",
      "cannot describe an observability strategy",
    ],
  },
  {
    id: "scalability_design",
    label: "Scalability & High-Level Design",
    track: "system_design",
    concepts: [
      "horizontal vs vertical scaling",
      "load balancing strategies",
      "CDN and edge computing",
      "database sharding and partitioning",
      "message queues for decoupling",
      "caching layers (L1 in-process, L2 Redis, L3 CDN)",
    ],
    depthLadder: {
      easy: "Ask the candidate to walk through how they would scale a web application from 1k to 100k users.",
      medium: "Probe specific bottlenecks they encountered: where did their system start failing under load, how did they diagnose it, what did they change?",
      hard: "Push on a specific design problem: design a rate limiter, a URL shortener, or a notification system for 10M users. Evaluate their ability to reason about trade-offs without a rehearsed answer.",
    },
    signalsOfStrength: [
      "identifies bottlenecks systematically (db, network, compute)",
      "uses load testing and profiling, not guesswork",
      "discusses stateless services and sticky sessions trade-offs",
      "has real production scaling story",
    ],
    signalsOfWeakness: [
      "recommends adding more servers without reasoning",
      "no awareness of database as bottleneck",
      "cannot reason about caching trade-offs",
    ],
  },
];
