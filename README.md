# InterviewAI

A production-grade, voice-enabled AI technical interview platform built with **Next.js 15**, **TypeScript**, **Drizzle ORM + Postgres (pgvector)**, **Clerk**, and a resilient **Multi-Provider LLM Routing Layer**.

---

## 🎯 Project Overview

InterviewAI delivers realistic, adaptive technical interviews. Candidates can upload resumes or start with default tracks, interact via real-time voice synthesis and speech recognition, and receive structured feedback upon interview completion.

---

## ✨ Key Features & Architecture Enhancements

### 🛡️ Resilient Multi-Provider LLM Layer
- **Centralized Registry**: All model IDs and limits managed in `src/lib/llm/config.ts`.
- **Circuit Breaker**: In-memory state tracking consecutive failures per provider with auto-reset windows (`src/lib/llm/circuit-breaker.ts`).
- **Hedging & Fallbacks**: Requests fire to primary models (Gemini) with instant fallback to secondary providers (Groq `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, Cerebras) if latency thresholds or errors occur (`src/lib/llm/hedging.ts`).
- **Non-Crashing Startup**: Missing API keys trigger runtime warnings rather than application startup crashes.

### ⚡ Optimized High-Frequency Hot Path
- **Inline Orchestration**: Adaptive interview phase decisions run directly inside the orchestrator route—eliminating internal HTTP hop delays.
- **Async Embeddings via `after()`**: Embedding calculation for pgvector RAG index is deferred to Next.js `after()` background tasks, removing ~600ms of blocking latency per turn.

### 🔊 Enhanced TTS Proxy (Sarvam AI Bulbul v3)
- **Text Sanitization**: Automatically strips markdown, code blocks, URLs, and emojis before synthesis.
- **SHA-256 Caching**: Content-addressed cache keys cached via Upstash Redis (with in-memory LRU fallback).
- **Budget Protection**: Enforces per-user daily limits (5,000 chars) and global daily caps (200,000 chars) with day-boundary resets.
- **Zero API Key Leaks**: All Sarvam credentials remain strictly server-side.

### 🎥 Stable Camera Stream Handling
- **Race-Condition Fix**: Decoupled `getUserMedia` stream acquisition from DOM property assignment. Uses dedicated `useEffect([mediaStream])` hooks and persistent DOM element mounting to guarantee reliable stream binding.

### 📄 Robust Multi-Format Resume Parsing
- **Multi-Format Support**: Parses PDF (`unpdf`), Word documents (`mammoth`), Plain Text (`.txt`), and Markdown (`.md`).
- **Safety & Verification**: Validates file types via magic bytes (`%PDF-`, `PK\x03\x04`) and enforces a 5 MB limit.
- **Heuristic Fallback**: Generates structured profile cards via fallback heuristic parser if LLM quota is exhausted, ensuring users never hit a dead end.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 15 (App Router, `runtime = 'nodejs'`) |
| **Language** | TypeScript (Strict mode) |
| **Database & ORM** | PostgreSQL + pgvector via Drizzle ORM |
| **Authentication** | Clerk Auth |
| **LLM Routing** | Custom Resilient Router (`src/lib/llm`) — Gemini, Groq, Cerebras |
| **Voice Synthesis** | Sarvam AI (`bulbul:v3`) + Web Speech API fallback |
| **Caching** | Upstash Redis + In-Memory LRU |
| **Parsing** | `unpdf` (PDF), `mammoth` (DOCX) |

---

## 🚦 Environment Setup

Copy `.env.example` to `.env.local` and configure your credentials:

```bash
# PostgreSQL Connection
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/interviewai"

# Clerk Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# LLM Providers (At least one required)
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key
CEREBRAS_API_KEY=your_cerebras_key

# TTS & Caching
SARVAM_API_KEY=your_sarvam_key
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

---

## 🏃 Running Locally

```bash
# Install dependencies
npm install

# Run database migrations
npx drizzle-kit push

# Start development server
npm run dev
```

---

## 🧪 Verification & Type Safety

Ensure project integrity with:

```bash
npx tsc --noEmit --skipLibCheck
```
