# InterviewAI

A production-grade AI-powered technical interview platform with voice interaction, dynamic question generation, and automated feedback.

## 🎯 Project Overview

InterviewAI is a sophisticated technical interview platform that combines cutting-edge AI technologies to create realistic, voice-enabled interview experiences. The platform features real-time speech recognition, AI-powered question generation, automated feedback, and a clean, modern interface designed for both candidates and interviewers.

## ✨ Key Features

### 🎤 Voice-Enabled Interviews
- **Speech-to-Text**: Real-time speech recognition using Web Speech API
- **Text-to-Speech**: AI questions spoken aloud with natural voice synthesis
- **Sarvam TTS Integration**: Primary TTS using Sarvam AI's Bulbul v3 model with Indian English voices
- **Browser Fallback**: Automatic fallback to browser TTS when Sarvam unavailable
- **Male AI Voice**: AI interviewer uses "aditya" male voice for authentic experience
- **Audio Quality**: Proper base64 decoding and audio handling to prevent voice cutoff

### 📄 Resume-Based Personalization
- **Resume Parsing**: AI extracts skills, experience, and projects from PDF resumes
- **Dynamic Questions**: Interview questions tailored to candidate's background
- **Generic Fallback**: Default FAANG-track questions when resume not provided
- **Optional Upload**: Users can skip resume and use generic interview plan

### 🤖 AI-Powered Feedback
- **Auto-Generated**: Comprehensive feedback report after interview completion
- **Structured Analysis**: Overall score, strengths, gaps, skill assessments
- **Question-by-Question**: Detailed feedback on each response
- **Hiring Recommendation**: AI suggests hire/consider/do_not_hire

### 🎨 Modern UI Design
- **Chromatic Black Theme**: Clean, professional dark theme throughout
- **Split Layout**: AI/user videos on left, conversation transcript on right
- **Turn Indicator**: Prominent, easily spottable turn-wise system detector
- **Big Mic Toggle**: Large, accessible microphone button for voice control
- **Responsive Design**: Works seamlessly across different screen sizes

### 🔒 Security & Rate Limiting
- **Clerk Authentication**: Secure user authentication
- **Ownership Verification**: All API routes verify user owns the interview
- **Rate Limiting**: 5 interviews/hour, 20 interviews/day per user
- **Cost Protection**: Guards against API abuse

## 🏗️ Technical Architecture

### Technology Stack & Rationale

#### Frontend
- **Next.js 15**: Latest React framework with App Router for optimal performance and SEO
  - *Why*: Server-side rendering, automatic code splitting, excellent developer experience
  - *Usage*: Main application framework, routing, API routes
- **React 18**: Modern React with hooks for state management
  - *Why*: Component-based architecture, excellent ecosystem, performance optimizations
  - *Usage*: UI components, state management with useState/useCallback/useEffect
- **TailwindCSS**: Utility-first CSS framework
  - *Why*: Rapid development, consistent design system, small bundle size
  - *Usage*: All styling, responsive design, dark theme implementation
- **TypeScript**: Type-safe JavaScript
  - *Why*: Catch errors at compile time, better IDE support, maintainability
  - *Usage*: All source files, type definitions, API interfaces

#### Backend
- **Next.js API Routes**: Serverless API endpoints
  - *Why*: Seamless integration with frontend, no separate backend needed, easy deployment
  - *Usage*: All API endpoints, interview orchestration, resume parsing
- **Drizzle ORM**: Type-safe SQL toolkit
  - *Why*: Excellent TypeScript support, lightweight, performant queries
  - *Usage*: Database operations, migrations, type-safe queries
- **PostgreSQL**: Relational database with pgvector extension
  - *Why*: Reliable, ACID compliant, excellent for structured data, pgvector for embeddings
  - *Usage*: User data, interview records, transcripts, vector embeddings

#### AI & ML
- **Google Gemini 1.5 Flash**: Primary AI model
  - *Why*: Fast, cost-effective, excellent reasoning capabilities, large context window
  - *Usage*: Question generation, feedback analysis, resume parsing
- **Sarvam AI Bulbul v3**: Text-to-speech for Indian English
  - *Why*: Natural Indian English voices, high quality, cost-effective
  - *Usage*: Primary TTS for AI interviewer voice
- **Web Speech API**: Browser-native speech recognition/synthesis
  - *Why*: No additional cost, works offline, good fallback option
  - *Usage*: Speech recognition, TTS fallback

#### Authentication
- **Clerk**: Authentication and user management
  - *Why*: Easy integration, excellent security, built-in user management
  - *Usage*: User authentication, session management, protected routes

#### Infrastructure
- **Vercel**: Deployment platform
  - *Why*: Excellent Next.js support, automatic SSL, easy scaling
  - *Usage*: Production deployment, preview deployments

## 🔄 System Architecture & Pipeline

### Interview Flow Pipeline

```
1. User Authentication (Clerk)
   ↓
2. Interview Initialization
   - Create interview record in database
   - Generate interview ID
   ↓
3. Resume Processing (Optional)
   - PDF upload → Parse Resume API
   - Extract skills, experience, projects
   - Generate personalized question plan
   ↓
4. Lobby Setup
   - Microphone permission check
   - Audio level testing
   - Speech recognition verification
   - TTS testing
   ↓
5. Interview Room
   - Display AI/user video placeholders
   - Show conversation transcript
   - Turn-based interaction:
     * AI speaks (Sarvam TTS → Browser TTS fallback)
     * User responds (Speech recognition → Text input fallback)
     * Transcript updates in real-time
   - Orchestrator manages flow
   ↓
6. Feedback Generation
   - Collect full transcript
   - Send to AI for analysis
   - Generate structured feedback
   - Calculate overall score
   - Provide hiring recommendation
```

### API Architecture

#### Core API Endpoints

**Interview Management**
- `POST /api/interviews/initialize` - Create new interview session
- `POST /api/interviews/generate-plan` - Generate question plan (with/without resume)
- `GET /api/interviews/[id]/transcript` - Fetch interview transcript
- `POST /api/interviews/[id]/feedback/generate` - Generate AI feedback

**Resume Processing**
- `POST /api/parse-resume` - Parse PDF resume and extract candidate data

**Interview Orchestration**
- `POST /api/interviews/[id]/orchestrator` - Main interview flow controller
  - Manages turn-taking
  - Calls AI for question generation
  - Updates transcript
  - Handles interview completion

**RAG-Powered Chat**
- `POST /api/interviews/[id]/chat` - Query interview history with semantic search

### Data Flow

```
User Action → Frontend State → API Route → AI Service → Database
     ↓              ↓              ↓            ↓           ↓
  Speak      Update UI    Process     Generate    Store
  Text      Transcript   Request    Response    Transcript
```

### State Management Strategy

**Frontend State (React Hooks)**
- `useState`: Component-level state (turn state, transcript, user input)
- `useCallback`: Memoized functions for performance
- `useEffect`: Side effects (audio playback, speech recognition)
- `useRef`: Persistent references (audio elements, recognition objects)

**Database State**
- Interview records with status tracking
- Transcript chunks with timestamps
- User authentication state (Clerk)
- Rate limiting state (Redis/PostgreSQL)

### Error Handling Strategy

**TTS Fallback Chain**
1. Primary: Sarvam AI (Bulbul v3, "aditya" male voice)
2. Fallback: Browser TTS (male voice selection)
3. Last Resort: Text-only mode

**Speech Recognition Fallback**
1. Primary: Web Speech API
2. Fallback: Text input field

**API Error Handling**
- Graceful degradation
- User-friendly error messages
- Automatic retry for transient failures
- Fallback to generic questions when AI fails

## 📊 Database Schema

### Core Tables

**interviews**
- id, userId, jobRole, status, currentPhase
- createdAt, updatedAt
- feedback (JSONB)

**transcript_chunks**
- id, interviewId, content, speaker, createdAt
- Indexed by interviewId for fast retrieval

**users** (via Clerk)
- userId, email, metadata
- Rate limiting data

**embeddings** (pgvector)
- id, interviewId, chunkId, embedding (vector)
- For RAG-powered semantic search

## 🔐 Security Considerations

### Authentication & Authorization
- Clerk handles user authentication
- All API routes verify user ownership of interviews
- Rate limiting prevents abuse
- API keys stored in environment variables

### Data Privacy
- User data encrypted at rest
- Transcript data stored securely
- No PII in logs
- GDPR compliance considerations

### API Security
- Request validation on all endpoints
- SQL injection prevention (parameterized queries)
- XSS prevention (React's built-in escaping)
- CSRF protection (Next.js built-in)

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL with pgvector extension
- Google Gemini API key
- Sarvam AI API key
- Clerk application (for auth)

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd interview-ai
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your values:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/interview_ai
GEMINI_API_KEY=your_gemini_api_key
NEXT_PUBLIC_SARVAM_API_KEY=your_sarvam_api_key
CLERK_SECRET_KEY=your_clerk_secret_key
CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
```

4. Run database migrations:
```bash
npm run db:push
```

5. Start the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 📖 Usage Guide

### Starting an Interview

1. **Sign In**: Create account or sign in with Clerk
2. **Dashboard**: Click "Start Interview" to begin
3. **Lobby Setup**: Complete audio setup check
4. **Interview Room**: Begin voice-enabled interview

### During Interview

- **Voice Mode**: Tap large microphone button to speak answers
- **Text Mode**: Type answers if voice unavailable
- **Turn Indicator**: Watch the prominent turn status indicator
- **Transcript**: View real-time conversation on right side

### After Interview

- Automatic feedback generation
- View detailed performance report
- Check hiring recommendation

## 💰 API Cost Analysis

Approximate cost per full interview:

**Gemini 1.5 Flash**
- **With resume**: ~$0.001 per interview
- **Without resume**: ~$0.00085 per interview

**Sarvam TTS**
- ~$0.0001 per 1000 characters
- Average interview: ~$0.0002 per session

**Total per interview**: ~$0.0012

See [docs/GEMINI_COSTS.md](docs/GEMINI_COSTS.md) for detailed breakdown.

## 📁 Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── interviews/
│   │   │   ├── initialize/          # Create new interview
│   │   │   ├── generate-plan/       # Dynamic question generation
│   │   │   ├── transcript/          # Fetch transcript
│   │   │   └── [id]/
│   │   │       ├── orchestrator/    # Main interview flow controller
│   │   │       └── feedback/
│   │   │           └── generate/    # AI feedback generation
│   │   └── parse-resume/            # Resume parsing
│   ├── interview/[id]/              # Interview room page
│   │   ├── page.tsx                 # Main interview UI
│   │   └── lobby/
│   │       └── page.tsx             # Audio setup lobby
│   ├── dashboard/
│   │   └── page.tsx                 # Interview dashboard
│   ├── sign-in/
│   │   └── [[...sign-in]]/
│   │       └── page.tsx             # Sign-in page
│   ├── sign-up/
│   │   └── [[...sign-up]]/
│   │       └── page.tsx             # Sign-up page
│   ├── layout.tsx                   # Root layout
│   └── page.tsx                     # Home page
├── components/
│   └── (removed - PDF upload functionality)
├── db/
│   ├── schema.ts                    # Database schema
│   └── index.ts                     # Database client
├── lib/
│   ├── config.ts                    # Environment validation
│   ├── rate-limit.ts                # Rate limiting logic
│   ├── gemini-embeddings.ts        # Text embeddings
│   └── default-interview-plan.ts    # Fallback questions
└── schemas/
    ├── interview.ts                 # Interview data schemas
    ├── resume.ts                    # Resume parsing schema
    ├── feedback.ts                  # Feedback report schema
    └── chat.ts                      # RAG chat schema
```

## 🛠️ Development

### Database Migrations

```bash
# Push schema changes to database
npm run db:push

# Open Drizzle Studio
npm run db:studio
```

### Environment Validation

The application validates required environment variables on startup and fails loudly if missing.

### Code Style

- TypeScript for type safety
- ESLint for code quality
- Prettier for code formatting
- Conventional commits for version control

## 🌐 Deployment

### Vercel

1. Connect your GitHub repository to Vercel
2. Add environment variables in Vercel dashboard
3. Deploy automatically on push to main branch

### Environment Variables Required

**Database**
- `DATABASE_URL` - PostgreSQL connection string

**AI Services**
- `GEMINI_API_KEY` - Google Gemini API key
- `NEXT_PUBLIC_SARVAM_API_KEY` - Sarvam AI API key (public)

**Authentication**
- `CLERK_SECRET_KEY` - Clerk secret key
- `CLERK_PUBLISHABLE_KEY` - Clerk publishable key
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk publishable key (public)

## 🔧 Troubleshooting

### Common Issues

**TTS Not Working**
- Check NEXT_PUBLIC_SARVAM_API_KEY is set
- Verify API key has sufficient credits
- Check browser console for errors
- Fallback to browser TTS should activate automatically

**Speech Recognition Not Working**
- Ensure microphone permission granted
- Check browser compatibility (Chrome recommended)
- Fallback to text input always available

**Database Connection Issues**
- Verify DATABASE_URL is correct
- Ensure PostgreSQL is running
- Check pgvector extension is installed

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write tests
5. Submit a pull request

## 📝 License

MIT License - feel free to use this project for your own purposes.

## 🙏 Acknowledgments

- **Google** - Gemini AI API
- **Sarvam AI** - Text-to-speech API
- **Clerk** - Authentication solution
- **Vercel** - Deployment platform
- **Next.js Team** - Amazing framework

---

**Built with ❤️ using Next.js, TypeScript, and AI technologies**
