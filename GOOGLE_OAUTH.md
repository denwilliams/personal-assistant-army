# Google OAuth Setup Guide

This guide will help you set up Google OAuth authentication for the Personal Assistant Army application.

## Prerequisites

- A Google account
- Access to the [Google Cloud Console](https://console.cloud.google.com/)

## Step 1: Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown at the top of the page
3. Click "New Project"
4. Enter a project name (e.g., "Personal Assistant Army")
5. Click "Create"

## Step 2: Enable Google+ API

1. In the Google Cloud Console, select your project
2. Navigate to "APIs & Services" > "Library"
3. Search for "Google+ API"
4. Click on it and click "Enable"

Alternatively, you can also enable:
- "Google People API" (recommended for better user profile access)

## Step 3: Configure OAuth Consent Screen

1. Navigate to "APIs & Services" > "OAuth consent screen"
2. Select "External" user type (unless you have a Google Workspace)
3. Click "Create"
4. Fill in the required fields:
   - **App name**: Personal Assistant Army
   - **User support email**: Your email address
   - **Developer contact email**: Your email address
5. Click "Save and Continue"
6. On the "Scopes" page, click "Add or Remove Scopes"
7. Add the following scopes:
   - `openid`
   - `email`
   - `profile`
8. Click "Save and Continue"
9. On the "Test users" page (if in testing mode), add your email address
10. Click "Save and Continue"
11. Review and click "Back to Dashboard"

## Step 4: Create OAuth Credentials

1. Navigate to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Select "Web application" as the application type
4. Enter a name (e.g., "Personal Assistant Army Web Client")
5. Under "Authorized JavaScript origins", add:
   - `http://localhost:3000` (for local development)
   - Your production URL (when deployed to Heroku)
6. Under "Authorized redirect URIs", add:
   - `http://localhost:3000/api/auth/callback` (for local development)
   - `https://your-app.herokuapp.com/api/auth/callback` (for production)
7. Click "Create"
8. A dialog will appear with your **Client ID** and **Client Secret**
9. **Important**: Copy these values - you'll need them for your `.env` file

## Step 5: Configure Environment Variables

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Google OAuth credentials:
   ```env
   # Google OAuth
   GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_client_secret_here
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/callback
   ```

3. For production (Heroku), set the environment variables:
   ```bash
   heroku config:set GOOGLE_CLIENT_ID=your_client_id
   heroku config:set GOOGLE_CLIENT_SECRET=your_client_secret
   heroku config:set GOOGLE_REDIRECT_URI=https://your-app.herokuapp.com/api/auth/callback
   ```

## Step 6: Generate Session Secret

You also need a secure session secret for signing cookies:

```bash
# Generate a random secret (32+ characters recommended)
openssl rand -base64 32
```

Add this to your `.env` file:
```env
SESSION_SECRET=your_generated_secret_here
```

## Step 7: Test Authentication

1. Start your development server:
   ```bash
   bun run dev
   ```

2. Navigate to `http://localhost:3000`

3. Click the "Login with Google" button

4. You should be redirected to Google's OAuth consent screen

5. After granting permissions, you'll be redirected back to your app

## Troubleshooting

### "redirect_uri_mismatch" Error

This means the redirect URI in your request doesn't match the ones configured in Google Cloud Console.

**Solution**:
- Check that `GOOGLE_REDIRECT_URI` in `.env` exactly matches one of the authorized redirect URIs in Google Cloud Console
- Make sure there are no trailing slashes or typos

### "Access blocked: This app's request is invalid"

This usually means the OAuth consent screen is not properly configured.

**Solution**:
- Go back to the OAuth consent screen in Google Cloud Console
- Ensure all required fields are filled in
- Make sure you've added the correct scopes (openid, email, profile)

### "This app is blocked"

This happens when the app is in testing mode and you're not a test user.

**Solution**:
- Add your email as a test user in the OAuth consent screen
- OR publish your app (moves it out of testing mode)

### "invalid_client" Error

This means your client ID or client secret is incorrect.

**Solution**:
- Double-check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`
- Make sure you copied them correctly from Google Cloud Console
- Ensure there are no extra spaces or quotes

## Security Notes

- **Never commit `.env` to version control** - it contains sensitive credentials
- Use strong, unique session secrets in production
- In production, always use HTTPS for redirect URIs
- Consider rotating your OAuth credentials periodically
- Keep your client secret secure and never expose it in client-side code

## Additional Resources

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes)
- [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) - Test your OAuth flow
