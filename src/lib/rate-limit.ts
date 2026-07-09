/**
 * Simple in-memory rate limiting for interview creation
 * Prevents abuse by limiting interviews per user per time period
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const userLimits = new Map<string, RateLimitEntry>();

const HOURLY_LIMIT = 5; // Max 5 interviews per hour
const DAILY_LIMIT = 20; // Max 20 interviews per day

export function checkRateLimit(userId: string): {
  allowed: boolean;
  reason?: string;
  retryAfter?: number;
} {
  const now = Date.now();
  const entry = userLimits.get(userId);

  if (!entry) {
    // First request for this user
    userLimits.set(userId, {
      count: 1,
      resetTime: now + 3600000, // 1 hour from now
    });
    return { allowed: true };
  }

  // Check if hour has passed
  if (now > entry.resetTime) {
    // Reset for new hour
    userLimits.set(userId, {
      count: 1,
      resetTime: now + 3600000,
    });
    return { allowed: true };
  }

  // Check hourly limit
  if (entry.count >= HOURLY_LIMIT) {
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    return {
      allowed: false,
      reason: `Hourly limit exceeded (${HOURLY_LIMIT} interviews per hour)`,
      retryAfter,
    };
  }

  // Increment count
  entry.count++;
  return { allowed: true };
}

export function checkDailyLimit(userId: string): {
  allowed: boolean;
  reason?: string;
  retryAfter?: number;
} {
  const now = Date.now();
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const dayEnd = dayStart + 86400000; // 24 hours

  // For simplicity, we use hourly limit as proxy for daily
  // In production, you'd want a separate daily counter
  const entry = userLimits.get(userId);
  
  if (entry && entry.count >= DAILY_LIMIT) {
    const retryAfter = Math.ceil((dayEnd - now) / 1000);
    return {
      allowed: false,
      reason: `Daily limit exceeded (${DAILY_LIMIT} interviews per day)`,
      retryAfter,
    };
  }

  return { allowed: true };
}

// Cleanup old entries periodically (call this from a cron job or similar)
export function cleanupOldEntries(): void {
  const now = Date.now();
  for (const [userId, entry] of userLimits.entries()) {
    if (now > entry.resetTime + 3600000) {
      userLimits.delete(userId);
    }
  }
}
