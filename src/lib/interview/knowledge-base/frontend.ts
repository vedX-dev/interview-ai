/**
 * Knowledge Base: Frontend Engineering track.
 */
import type { KnowledgeTopicEntry } from "./types";

export const FRONTEND_KB: KnowledgeTopicEntry[] = [
  {
    id: "frontend_architecture",
    label: "Frontend Architecture",
    track: "frontend",
    concepts: [
      "state management strategies",
      "component design and composition",
      "rendering models (CSR vs SSR vs RSC)",
      "performance optimization (bundle size, LCP, CLS)",
      "accessibility fundamentals",
      "testing strategies (unit, E2E, visual regression)",
    ],
    depthLadder: {
      easy: "Ask about a frontend feature or app they built. What framework did they use and why?",
      medium: "Probe state management: how did they decide between local state, context, and a store? What problems did they hit? Or probe performance: how did they measure and improve page load times?",
      hard: "Push on architecture trade-offs: server vs client components in React/Next, hydration cost, streaming SSR, or micro-frontend considerations. What were the real-world performance impacts?",
    },
    signalsOfStrength: [
      "Core Web Vitals mentioned (LCP, CLS, FID/INP)",
      "discusses component boundary decisions",
      "has profiled bundle size or used code splitting",
      "understands hydration and SSR/RSC trade-offs",
    ],
    signalsOfWeakness: [
      "never measured front-end performance",
      "conflates SSR and SSG",
      "no opinion on state management trade-offs",
    ],
  },
];
