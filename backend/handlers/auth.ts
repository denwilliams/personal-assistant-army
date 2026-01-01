import type { GoogleOAuthService } from "../auth/google-oauth";
import type { UserRepository } from "../repositories/UserRepository";
import type { SessionRepository } from "../repositories/SessionRepository";

interface AuthHandlerDependencies {
  googleOAuth: GoogleOAuthService;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  frontendUrl: string;
}

/**
 * Factory function to create authentication handlers
 */
export function createAuthHandlers(deps: AuthHandlerDependencies) {
  /**
   * Initiate Google OAuth login
   */
  const login = async (req: Request): Promise<Response> => {
    // Generate a random state for CSRF protection
    const state = crypto.randomUUID();
    const authUrl = deps.googleOAuth.getAuthorizationUrl(state);

    // Store state in a cookie for verification in callback
    const headers = new Headers({
      Location: authUrl,
      "Set-Cookie": `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
    });

    return new Response(null, {
      status: 302,
      headers,
    });
  };

  /**
   * Handle Google OAuth callback
   */
  const callback = async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return new Response("Missing code or state", { status: 400 });
      }

      // Verify state matches (CSRF protection)
      const cookies = parseCookies(req.headers.get("Cookie") || "");
      if (cookies.oauth_state !== state) {
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

      // Set session cookie and redirect to frontend
      const headers = new Headers({
        Location: deps.frontendUrl,
        "Set-Cookie": [
          `session_id=${session.id}; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}; Path=/`,
          "oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/", // Clear state cookie
        ].join(", "),
      });

      return new Response(null, {
        status: 302,
        headers,
      });
    } catch (error) {
      console.error("OAuth callback error:", error);
      return new Response("Authentication failed", { status: 500 });
    }
  };

  /**
   * Logout and destroy session
   */
  const logout = async (req: Request): Promise<Response> => {
    const cookies = parseCookies(req.headers.get("Cookie") || "");
    const sessionId = cookies.session_id;

    if (sessionId) {
      await deps.sessionRepository.delete(sessionId);
    }

    // Clear session cookie
    const headers = new Headers({
      "Set-Cookie": "session_id=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/",
      "Content-Type": "application/json",
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers,
    });
  };

  return { login, callback, logout };
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
