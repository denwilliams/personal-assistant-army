import type { GoogleOAuthService } from "../auth/google-oauth";
import type { UserRepository } from "../repositories/UserRepository";
import type { SessionRepository } from "../repositories/SessionRepository";
import type { BunRequest } from "bun";

interface AuthHandlerDependencies {
  googleOAuth: GoogleOAuthService;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  frontendUrl: string;
  isProduction: boolean;
}

/**
 * Factory function to create authentication handlers
 */
export function createAuthHandlers(deps: AuthHandlerDependencies) {
  /**
   * Initiate Google OAuth login
   */
  const login = async (req: BunRequest): Promise<Response> => {
    // Generate a random state for CSRF protection
    const state = crypto.randomUUID();
    const authUrl = deps.googleOAuth.getAuthorizationUrl(state);

    // Store state in a cookie for verification in callback
    req.cookies.set("oauth_state", state, {
      httpOnly: true,
      secure: deps.isProduction,
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });

    return Response.redirect(authUrl, 302);
  };

  /**
   * Handle Google OAuth callback
   */
  const callback = async (req: BunRequest): Promise<Response> => {
    try {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return new Response("Missing code or state", { status: 400 });
      }

      // Verify state matches (CSRF protection)
      const savedState = req.cookies.get("oauth_state");
      if (savedState !== state) {
        return new Response("Invalid state parameter", { status: 400 });
      }

      // Exchange code for token
      const tokenResponse = await deps.googleOAuth.exchangeCodeForToken(code);

      // Get user info from Google
      const googleUser = await deps.googleOAuth.getUserInfo(tokenResponse.access_token);

      // Find or create user
      let user = await deps.userRepository.findByGoogleId(googleUser.id);
      if (!user) {
        user = await deps.userRepository.create({
          google_id: googleUser.id,
          email: googleUser.email,
          name: googleUser.name,
          avatar_url: googleUser.picture,
        });
      }

      // Create session (expires in 30 days)
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const session = await deps.sessionRepository.create(user.id, expiresAt);

      // Set session cookie
      req.cookies.set("session_id", session.id, {
        httpOnly: true,
        secure: deps.isProduction,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60, // 30 days
        path: "/",
      });

      // Clear state cookie
      req.cookies.delete("oauth_state");

      return Response.redirect(deps.frontendUrl, 302);
    } catch (error) {
      console.error("OAuth callback error:", error);
      return new Response("Authentication failed", { status: 500 });
    }
  };

  /**
   * Logout and destroy session
   */
  const logout = async (req: BunRequest): Promise<Response> => {
    const sessionId = req.cookies.get("session_id");

    if (sessionId) {
      await deps.sessionRepository.delete(sessionId);
    }

    // Clear session cookie
    req.cookies.delete("session_id");

    return Response.json({ success: true });
  };

  return { login, callback, logout };
}
