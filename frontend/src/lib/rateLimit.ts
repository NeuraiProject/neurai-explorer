/**
 * Simple in-memory rate limiter for API routes
 * Note: For production with multiple instances, consider Redis-based rate limiting
 */

interface RateLimitRecord {
    count: number;
    resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitRecord>();

// Cleanup old entries periodically to prevent memory leaks
const CLEANUP_INTERVAL = 60000; // 1 minute
let lastCleanup = Date.now();

function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL) return;

    lastCleanup = now;
    for (const [key, record] of rateLimitMap.entries()) {
        if (now > record.resetTime) {
            rateLimitMap.delete(key);
        }
    }
}

/**
 * Check if a request should be rate limited
 * @param ip - Client IP address or identifier
 * @param limit - Maximum requests allowed in the time window
 * @param windowMs - Time window in milliseconds
 * @returns true if request is allowed, false if rate limited
 */
export function rateLimit(ip: string, limit = 100, windowMs = 60000): boolean {
    cleanup();

    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now > record.resetTime) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
        return true;
    }

    if (record.count >= limit) {
        return false;
    }

    record.count++;
    return true;
}

/**
 * Get rate limit headers for response
 * @param ip - Client IP address or identifier
 * @param limit - Maximum requests allowed
 * @returns Headers object with rate limit info
 */
export function getRateLimitHeaders(ip: string, limit = 100): Record<string, string> {
    const record = rateLimitMap.get(ip);
    const remaining = record ? Math.max(0, limit - record.count) : limit;
    const reset = record ? Math.ceil((record.resetTime - Date.now()) / 1000) : 60;

    return {
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': reset.toString(),
    };
}

/**
 * Extract client IP from request headers
 * @param request - Incoming request
 * @returns Client IP address
 */
export function getClientIp(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    const realIp = request.headers.get('x-real-ip');
    if (realIp) {
        return realIp;
    }
    return 'anonymous';
}
