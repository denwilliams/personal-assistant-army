import type { GoogleOAuthConfig, GoogleTokenResponse, GoogleUserInfo } from "./types";

/**
 * Google OAuth service for authentication
 * Uses dependency injection for configuration
 */
export class GoogleOAuthService {
  private readonly authUrl = "https://accounts.google.com/o/oauth2/v2/auth";
  private readonly tokenUrl = "https://oauth2.googleapis.com/token";
  private readonly userInfoUrl = "https://www.googleapis.com/oauth2/v2/userinfo";

  constructor(private config: GoogleOAuthConfig) {}

  /**
   * Generate the Google OAuth authorization URL
   * @param state Random state parameter for CSRF protection
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "consent",
    });

    return `${this.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param code Authorization code from OAuth callback
   */
  async exchangeCodeForToken(code: string): Promise<GoogleTokenResponse> {
    const params = new URLSearchParams({
      code,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      grant_type: "authorization_code",
    });

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code for token: ${error}`);
    }

    return await response.json();
  }

  /**
   * Get user info from Google
   * @param accessToken Access token from OAuth
   */
  async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch(this.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    return await response.json();
  }
}
