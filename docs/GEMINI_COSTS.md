# Gemini API Cost Analysis

## Cost Per Interview (Approximate)

Using Gemini 1.5 Flash model (as of 2024):

### Resume Parsing
- Input: ~2-3KB (resume text)
- Output: ~500B (JSON)
- **Cost: ~$0.0001 per resume**

### Dynamic Plan Generation
- Input: ~500B (candidate profile + job role)
- Output: ~1KB (5 questions in JSON)
- **Cost: ~$0.0001 per plan**

### Transcript Embeddings (per message)
- Input: ~200-500B (user response)
- Output: ~768 dimensions vector (internal)
- **Cost: ~$0.00005 per message**
- For 5 questions: ~$0.00025 total

### RAG Chat (per query)
- Input: ~1-2KB (context + query)
- Output: ~200-500B (answer)
- **Cost: ~$0.0001 per query**
- Assuming 2-3 queries: ~$0.0003 total

### Feedback Generation
- Input: ~3-5KB (full transcript)
- Output: ~2-3KB (structured feedback)
- **Cost: ~$0.0003 per feedback**

## Total Cost Per Full Interview

**With resume upload:**
- Resume parsing: $0.0001
- Plan generation: $0.0001
- Transcript embeddings (5 messages): $0.00025
- RAG chat (2-3 queries): $0.0003
- Feedback generation: $0.0003
- **Total: ~$0.00105 per interview (~$0.001)**

**Without resume (generic plan):**
- Plan generation: $0 (uses default)
- Transcript embeddings (5 messages): $0.00025
- RAG chat (2-3 queries): $0.0003
- Feedback generation: $0.0003
- **Total: ~$0.00085 per interview (~$0.001)**

## Cost Scaling

- **100 interviews:** ~$0.10
- **1,000 interviews:** ~$1.00
- **10,000 interviews:** ~$10.00

## Rate Limiting Recommendations

### Basic Guards (Current State)
- No rate limiting implemented
- Relies on Clerk auth for user verification
- Each user could theoretically abuse by creating many interviews

### Recommended Additions
1. **Per-user rate limit**: 5 interviews per hour
2. **Daily cap**: 20 interviews per user per day
3. **Cost monitoring**: Alert if daily spend exceeds $5
4. **Queue system**: For high-volume scenarios

### Implementation Priority
- **High:** Per-user rate limit (prevents abuse)
- **Medium:** Daily cap (limits exposure)
- **Low:** Cost monitoring (operational visibility)

## Free Tier Considerations

Gemini 1.5 Flash has generous free tiers:
- Free requests per day: ~15-60 (varies by region)
- Free input/output: ~1.5M tokens/month

For personal/testing use, free tier should cover dozens of interviews.
For production use, paid tier is recommended at scale.
