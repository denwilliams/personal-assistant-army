import type { UserRepository } from "../repositories/UserRepository";
import type { User } from "../types/models";
import { encrypt, decrypt } from "../utils/encryption";

interface UserHandlerDependencies {
  userRepository: UserRepository;
  authenticate: (req: Request) => Promise<{ user: User; session: { id: string; userId: number } } | null>;
  encryptionSecret: string;
}

interface UpdateCredentialsRequest {
  openai_api_key?: string;
  google_search_api_key?: string;
  google_search_engine_id?: string;
}

interface UpdateProfileRequest {
  name?: string;
  avatar_url?: string;
}

/**
 * Factory function to create user-related handlers
 */
export function createUserHandlers(deps: UserHandlerDependencies) {
  /**
   * GET /api/user/profile
   * Get current user's profile
   */
  const getProfile = async (req: Request): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Return user profile (without sensitive fields)
    const profile = {
      id: auth.user.id,
      email: auth.user.email,
      name: auth.user.name,
      avatar_url: auth.user.avatar_url,
      has_openai_key: !!auth.user.openai_api_key,
      has_google_search_key: !!auth.user.google_search_api_key,
      google_search_engine_id: auth.user.google_search_engine_id,
      created_at: auth.user.created_at,
      updated_at: auth.user.updated_at,
    };

    return new Response(JSON.stringify(profile), {
      headers: { "Content-Type": "application/json" },
    });
  };

  /**
   * PUT /api/user/profile
   * Update current user's profile
   */
  const updateProfile = async (req: Request): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body: UpdateProfileRequest = await req.json();

      // Validate input
      if (!body.name && !body.avatar_url) {
        return new Response(JSON.stringify({ error: "No fields to update" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Update user
      const updatedUser = await deps.userRepository.update(auth.user.id, {
        name: body.name,
        avatar_url: body.avatar_url,
      });

      return new Response(JSON.stringify({ success: true, user: updatedUser }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error updating profile:", error);
      return new Response(JSON.stringify({ error: "Failed to update profile" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  /**
   * PUT /api/user/credentials
   * Update user's API credentials (encrypted)
   */
  const updateCredentials = async (req: Request): Promise<Response> => {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body: UpdateCredentialsRequest = await req.json();

      // Encrypt API keys before storing
      const encryptedData: any = {};

      if (body.openai_api_key) {
        encryptedData.openai_api_key = await encrypt(
          body.openai_api_key,
          deps.encryptionSecret
        );
      }

      if (body.google_search_api_key) {
        encryptedData.google_search_api_key = await encrypt(
          body.google_search_api_key,
          deps.encryptionSecret
        );
      }

      if (body.google_search_engine_id !== undefined) {
        encryptedData.google_search_engine_id = body.google_search_engine_id;
      }

      // Update credentials
      await deps.userRepository.updateApiKeys(auth.user.id, encryptedData);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Error updating credentials:", error);
      return new Response(JSON.stringify({ error: "Failed to update credentials" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  return { getProfile, updateProfile, updateCredentials };
}
