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
 * Factory function to create authentication middleware
 */
export function createAuthMiddleware(deps: AuthMiddlewareDependencies) {
  /**
   * Middleware to authenticate requests
   * Adds user and session to request if authenticated
   */
  return async (req: BunRequest): Promise<{ user: User; session: { id: string; userId: number } } | null> => {
    const sessionId = req.cookies.get("session_id");

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
