# 🎙️ InterviewAI — Production-Grade AI Technical Interviewer

**InterviewAI** is an end-to-end, voice-enabled, AI-powered technical interview platform built with **Next.js 15 (App Router)**, **TypeScript**, **Drizzle ORM**, **PostgreSQL (with pgvector)**, **Google Gemini 1.5/2.0 Flash**, and **Sarvam AI Bulbul v3 TTS**.

It automates technical candidate evaluations by parsing resumes, generating personalized 5-question interview plans, conducting real-time adaptive voice interviews with intelligent follow-ups, and delivering structured hiring feedback.

---

## 📌 Executive Summary

| Layer | Technology / Choice | Purpose |
| :--- | :--- | :--- |
| **Framework** | Next.js 15 (App Router) + React 18 | SSR, API routes, serverless orchestration |
| **Styling** | Vanilla CSS + TailwindCSS | Dark chromatic aesthetic, responsive split-screen UI |
| **Database** | PostgreSQL + pgvector + Drizzle ORM | Relational state management + Vector RAG search |
| **Auth & Security** | Clerk Auth + Custom Rate Limiter | Session control, ownership validation, abuse protection |
| **AI LLM Engine** | Google Gemini 1.5 / 2.0 Flash | Resume parsing, question plan, adaptive decision engine, feedback |
| **TTS (Text-to-Speech)** | Sarvam AI Bulbul v3 (`aditya` voice) | Indian English voice synthesis with browser TTS fallback |
| **STT (Speech-to-Text)**| Web Speech API | Browser-native live voice recognition with text input fallback |
| **Semantic Search** | Gemini Embeddings (`text-embedding-004`) | pgvector semantic search over interview transcripts |

---



## 🏗️ System Architecture & Data Flow

```
                                ┌────────────────────────────────────────────────┐
                                │                 Candidate UI                   │
                                └───────────────────────┬────────────────────────┘
                                                        │
                   ┌────────────────────────────────────┼────────────────────────────────────┐
                   ▼                                    ▼                                    ▼
       1. Resume Upload / Plan               2. Voice & Audio Lobby                   3. Live Interview Room
        POST /api/parse-resume                Mic Permission & Check                  Web Speech STT / Manual Input
      POST /api/interviews/initialize          Sarvam TTS Audio Test                    Turn-Based UI State Machine
     POST /api/interviews/generate-plan                  │                                       │
                   │                                    │                                       │
                   └────────────────────────────────────┼───────────────────────────────────────┘
                                                        │
                                                        ▼
                                   ┌──────────────────────────────────────────┐
                                   │     POST /api/interviews/[id]/orchestrator│
                                   └────────────────────┬─────────────────────┘
                                                        │
                             ┌──────────────────────────┴──────────────────────────┐
                             ▼                                                     ▼
              ┌─────────────────────────────┐                       ┌─────────────────────────────┐
              │   Adaptive Decision Engine  │                       │      Transcript & RAG       │
              │/api/.../adaptive-decision   │                       │  Save Chunks to PostgreSQL  │
              │  - Follow-up evaluation     │                       │  Generate Gemini Embeddings │
              │  - Max 2 follow-ups/question│                       │  Store in pgvector Table    │
              │  - Hindi/Off-topic redirect │                       └─────────────────────────────┘
              └──────────────┬──────────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │   Sarvam AI Bulbul v3 TTS   │
              │ (Fallback to Browser Speech)│
              └──────────────┬──────────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │  Automated Feedback Generator│
              │ /api/.../feedback/generate  │
              │  - Scores, Strengths, Gaps  │
              │  - Hiring Recommendation    │
              └─────────────────────────────┘
```

---

## 🔄 End-to-End Interview Pipeline

1. **Authentication & Rate Limiting**:
   - User signs in via Clerk. API operations verify user ownership and check rate limits (5 interviews/hr, 20 interviews/day).
2. **Resume Processing & Plan Generation**:
   - Optional PDF resume uploaded → Parsed with Gemini into structured skills, experience, and project profile.
   - Generates a tailored 5-question interview plan (or falls back to FAANG-grade default template).
3. **Lobby Device Readiness**:
   - Pre-flight audio setup checks mic permissions, tests STT input volume, and runs a TTS synthesis test.
4. **Adaptive Voice Interview Room**:
   - Split-screen layout displaying AI Interviewer visual container, Candidate Camera, Turn Status Indicator, and Live Transcript.
   - User speaks answer → STT converts audio to text → POSTed to Orchestrator.
   - **Adaptive Decision Engine**: Evaluates answer quality, decides whether to ask a follow-up (max 2 follow-ups per anchor question), redirect off-topic/multilingual responses (e.g., Hindi/small-talk), or progress to the next anchor question.
5. **Transcript Storage & RAG Vectorization**:
   - Each transcript chunk is stored in PostgreSQL.
   - Gemini `text-embedding-004` computes embeddings stored in `pgvector` for semantic querying (`/api/interviews/[id]/chat`).
6. **Automated Feedback & Hiring Decision**:
   - Upon completion, full transcript is synthesized into a detailed report containing overall score (0-100), domain breakdown, strengths, gaps, question evaluations, and hiring recommendation (`hire`, `consider`, `do_not_hire`).

---

## 🛠️ Feature Matrix: What Is In Use vs. What Is Left

### ✅ What is Currently Built & In Active Use

- [x] **Full Next.js 15 App Router Architecture**: Clean folder separation (`app/api`, `db`, `lib`, `schemas`).
- [x] **Clerk Auth & Protected API Endpoints**: Strict user authentication and interview ownership checks.
- [x] **PostgreSQL & Drizzle ORM Integration**: Type-safe relational schema with `interviews`, `transcript_chunks`, and `embeddings`.
- [x] **pgvector Semantic Search (RAG)**: Search transcript history semantically via Gemini embeddings.
- [x] **PDF Resume Parser**: Gemini 1.5/2.0 Flash structured JSON parsing for candidate background extraction.
- [x] **Dynamic 5-Question Plan Generator**: Tailored technical plan generation with default fallback.
- [x] **Pre-flight Audio Lobby**: Mic check, STT test, and TTS audio synthesis test prior to joining interview.
- [x] **Voice-Enabled Interview Room**:
  - Web Speech API integration for live STT with text input fallback.
  - Dual-layer TTS: Sarvam AI Bulbul v3 (`aditya` male voice, Indian English) with automatic browser `SpeechSynthesis` fallback.
  - Turn status system indicator ("AI Thinking", "AI Speaking", "User Speaking", "Idle").
  - Prominent visual microphone control button and real-time transcript streaming.
- [x] **Adaptive Interview Engine**:
  - Follow-up depth control (0–2 follow-ups per anchor question).
  - Hard limit safety cap (15 total turns max).
  - Polite redirection for off-topic, small-talk, or Hindi/multilingual answers.
- [x] **AI Feedback Report**: Structured candidate scorecard with detailed technical evaluation and hiring recommendation.
- [x] **Cost & API Safety**: Custom rate-limiting middleware (5/hr, 20/day) and environment config guardrails.

---

### 🚧 What Is Left / Partially Implemented / Pending

- [ ] **Live WebRTC Candidate Video Stream**: Currently uses camera placeholder container; native browser webcam feed integration with state toggles is pending.
- [ ] **Lip-Synced / 3D AI Interviewer Avatar**: Currently uses an aesthetic animated avatar card; full lip-synced video streaming (e.g., via HeyGen / Tavus WebRTC stream) is not connected.
- [ ] **Audio File Cloud Storage**: Audio transcripts are stored as text; raw user `.mp3`/`.wav` recordings are not uploaded to Cloud Storage / S3.
- [ ] **Low-Latency Streaming STT (Whisper / Deepgram)**: Current STT uses Web Speech API (Chrome native). Server-side WebSocket streaming STT (e.g. Deepgram / AssemblyAI / OpenAI Whisper) for low-latency non-Chrome support is not yet added.
- [ ] **Interactive Coding Sandbox / Code Editor**: Integrated Monaco code editor with live execution sandbox (e.g. Judge0 API) for live coding challenges.
- [ ] **Multi-Track Role Selector**: User role selection UI (e.g., System Design, Product Management, Frontend, Data Science, Behavioral STAR method) currently defaults to Software Engineering.

---

## 🚀 Potential Improvements & Future Roadmap

1. **Sub-500ms Voice Latency (WebSockets / WebRTC)**
   - Replace HTTP REST polling between front-end and `/api/.../orchestrator` with a WebSocket connection or WebRTC data channel for instant turn transitions.
2. **Dedicated Cloud STT Engine**
   - Integrate Deepgram or Whisper API to handle technical jargon, accents, and noisy backgrounds better than standard browser STT.
3. **Interactive Code Playground & Whiteboard**
   - Embed a Monaco Editor with live syntax highlighting and code execution sandbox to test candidate code against test cases in real-time.
4. **AI Integrity & Anti-Cheating Detection**
   - Add browser tab-switch detection, copy-paste prevention, and automated transcript flag indicators for external assistance.
5. **Interviewer Customization & Custom Rubrics**
   - Allow enterprise hiring managers to upload custom job descriptions, select strictness levels (e.g. Friendly Mentor vs. Strict FAANG Bar Raiser), and specify rubric weights.
6. **Analytics & Performance Benchmark Dashboard**
   - Provide historical candidate tracking, skill growth radar charts, and downloadable PDF feedback reports for recruiters.

---

## 🗄️ Database Schema Overview

```typescript
// Core Tables in src/db/schema.ts

1. users (Clerk user session mapping & metadata)
2. interviews
   - id: uuid (Primary Key)
   - userId: text (Clerk User ID)
   - jobRole: text
   - status: 'initialized' | 'in_progress' | 'completed'
   - currentPhase: text
   - plan: jsonb (5 anchor questions)
   - feedback: jsonb (Final structured evaluation report)
3. transcript_chunks
   - id: uuid
   - interviewId: uuid (FK -> interviews.id)
   - speaker: 'ai' | 'user' | 'system'
   - content: text
   - turnIndex: integer
4. embeddings (pgvector)
   - id: uuid
   - interviewId: uuid
   - chunkId: uuid
   - embedding: vector(768)
```

---

## 🛠️ Local Development Setup

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **PostgreSQL**: PostgreSQL database with `pgvector` extension enabled
- **API Keys**:
  - Google Gemini API Key
  - Sarvam AI API Key
  - Clerk Authentication Keys

### Step-by-Step Guide

1. **Clone & Install Dependencies**:
   ```bash
   git clone <repository-url>
   cd interview-ai
   npm install
   ```

2. **Configure Environment Variables**:
   Create `.env.local` in the project root:
   ```env
   DATABASE_URL=postgresql://postgres:password@localhost:5432/interview_ai
   GEMINI_API_KEY=your_google_gemini_api_key
   SARVAM_API_KEY=your_sarvam_api_key
   CLERK_SECRET_KEY=your_clerk_secret_key
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
   GROQ_API_KEY=your_groq_api_key
   ```

3. **Initialize Database & Run Migrations**:
   ```bash
   npm run db:push
   ```

4. **Launch Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🚀 Implementation Roadmap (Completed Phases 0–5)

### ⚙️ Phase 0: Infrastructure & Modern AI Upgrades
- **Next.js 15 App Router Compatibility**: Migrated dynamic API route parameters to `params: Promise<{ id: string }>` with `await params`.
- **Google Gemini 3.8 Flash Engine**: Upgraded all LLM operations (`orchestrator`, `parse-resume`, `generate-plan`, `adaptive-decision`, `feedback/generate`, `chat`) to active `gemini-3.8-flash` and `gemini-3.5-flash-lite` models.
- **Groq Fallback Integration**: Configured multi-model fallback chain using active Groq models (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`).
- **Semantic Vector Embeddings**: Standardized pgvector vector search on `gemini-embedding-001` (768 dimensions).

---

### 🖥️ Phase 1: Zoom-Style Interview Room Layout
- **Fixed Viewport Layout**: Built `h-dvh w-full overflow-hidden` container prohibiting unwanted window scrollbars.
- **Header Stats & Timer**: Integrated real-time elapsed timer (`00:00`), dynamic phase indicator (`Q1/5`), and live AI state pill (`Thinking` / `Speaking` / `Listening`).
- **Dual-Tile Video Grid**: Equal height tile grid with speaker glow rings, ambient dark gradients, wave activity visualizers, and candidate name badges.
- **Collapsible Live Transcript**: Aside panel (`w-80 lg:w-96`) with auto-scrolling message history and toggle controls.
- **Control Bar & Hotkeys**: Microphone toggle, Camera toggle, Transcript toggle, End Call modal, and `[M]` keyboard shortcut for quick mic toggling.

---

### 📝 Phase 2: Resume Upload UI & Editable Confirmation Card
- **Drag & Drop PDF Parser**: Built interactive resume upload dropzone supporting `.pdf` files up to 5MB with live parsing progress animation.
- **Editable Candidate Profile Card**: Extracted candidate details (Full Name, Target Job Role, Experience Years, Top Skills tags, Key Projects) are editable prior to interview generation.
- **Fast-Track Demo Profile**: Included a one-click demo candidate loader for rapid testing.
- **Database Synchronization**: Extended `/api/interviews/initialize` to support custom profiles and update PostgreSQL records.

---

### 🔊 Phase 3: Server-Proxied & Budget-Capped Sarvam TTS Pipeline
- **Server Secret Isolation**: Removed `NEXT_PUBLIC_SARVAM_API_KEY` from client exposure; moved to server-only `SARVAM_API_KEY`.
- **Server Proxy `/api/tts`**: Integrated Sarvam Bulbul v3 (`bulbul:v3`, `aditya` voice) server-side.
- **Text Sentence Chunking**: Automatically splits long text (`> 250` chars) into clean sentence segments (`<= 250` chars) for optimal synthesis.
- **Server LRU Cache**: Caches base64 audio per unique prompt to eliminate redundant paid API calls.
- **Budget Cap & Browser Fallback**: Enforces a session character limit (20,000 chars) with seamless fallback to browser Web Speech API `speechSynthesis`.

---

### 📹 Phase 4: Live Candidate Webcam Feed (`getUserMedia`)
- **Webcam Stream**: Connected `navigator.mediaDevices.getUserMedia` to `<video>` element with mirrored selfie view (`transform -scale-x-100`).
- **Track Lifecycle**: Automatic track cleanup on unmount (`track.stop()`) to prevent camera leakage.
- **Status Badges & Fallback**: Cam On displays live webcam feed; Cam Off displays avatar with glowing status badge and permission alerts.

---

### ⚡ Phase 5: Streaming AI Responses, TTS Prefetching, Silence Detection & Barge-in
- **Barge-in / Speech Interruption**: Tracked `activeAudioRef` & `speechSynthesisRef`. Turning on mic or speaking immediately pauses AI speech playback (`stopAiSpeech()`) and hands turn to candidate.
- **Background TTS Prefetching**: Dispatches `/api/tts` prefetch requests in background as soon as AI response text is generated to eliminate playback latency.
- **Silence Detection Nudge**: Starts 12-second silence timer during candidate's turn. Displays gentle glowing hint badge (*"Listening... Take your time!"*) on candidate tile if silent.

---

## 📂 Project Structure

```
interview-ai/
├── docs/
│   ├── ADAPTIVE_INTERVIEW_RULES.md   # Rules for follow-up limits & redirects
│   └── GEMINI_COSTS.md               # Cost breakdown for Gemini & Sarvam APIs
├── drizzle.config.ts                 # Drizzle ORM configuration
├── docker-compose.yml                # Docker PostgreSQL + pgvector container
├── src/
│   ├── app/
│   │   ├── api/                      # Next.js Serverless API Endpoints
│   │   │   ├── tts/                  # Server-proxied Sarvam TTS with caching & budget cap
│   │   │   ├── parse-resume/         # PDF resume parsing endpoint
│   │   │   └── interviews/           # Plan generation, orchestrator, feedback, RAG
│   │   ├── dashboard/                # Candidate dashboard & resume uploader
│   │   ├── interview/[id]/           # Interview room & audio lobby
│   │   ├── layout.tsx                # Root layout & Clerk provider
│   │   └── page.tsx                  # Landing page
│   ├── components/                   # UI components (ResumeUploadFlow, etc.)
│   ├── db/                           # Drizzle schema & PostgreSQL database client
│   ├── lib/                          # Rate limiting, Gemini embeddings, env config
│   └── schemas/                      # Zod schemas for API request/response validation
└── README.md
```

---

## 📄 License

Distributed under the **MIT License**. Free for personal and commercial use.

