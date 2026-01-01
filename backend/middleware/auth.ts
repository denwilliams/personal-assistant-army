import type { SessionRepository } from "../repositories/SessionRepository";
import type { UserRepository } from "../repositories/UserRepository";
import type { User } from "../types/models";

export interface AuthenticatedRequest extends Request {
  user?: User;
  session?: { id: string; userId: number };
}

interface AuthMiddlewareDependencies {
  sessionRepository: SessionRepository;
  userRepository: UserRepository;
}

/**
 * Parse cookies from Cookie header
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split("=");
    if (name && rest.length > 0) {
      cookies[name] = rest.join("=");
    }
  });

  return cookies;
}

/**
 * Factory function to create authentication middleware
 */
export function createAuthMiddleware(deps: AuthMiddlewareDependencies) {
  /**
   * Middleware to authenticate requests
   * Adds user and session to request if authenticated
   */
  return async (req: Request): Promise<{ user: User; session: { id: string; userId: number } } | null> => {
    const cookies = parseCookies(req.headers.get("Cookie") || "");
    const sessionId = cookies.session_id;

    if (!sessionId) {
      return null;
    }

    // Verify session exists and is not expired
    const session = await deps.sessionRepository.findById(sessionId);
    if (!session) {
      return null;
    }

    // Get user
    const user = await deps.userRepository.findById(session.userId);
    if (!user) {
      // Session exists but user doesn't - clean up
      await deps.sessionRepository.delete(sessionId);
      return null;
    }

    return {
      user,
      session: { id: session.id, userId: session.userId },
    };
  };
}

/**
 * Helper to create a 401 Unauthorized response
 */
export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
