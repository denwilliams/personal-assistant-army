# Heroku Deployment Guide

This guide walks you through deploying Personal Assistant Army to Heroku.

## Prerequisites

- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) installed
- A Heroku account
- Google OAuth credentials (see [GOOGLE_OAUTH.md](./GOOGLE_OAUTH.md))
- Git repository initialized

## Quick Deploy

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

Click the button above to deploy directly to Heroku. You'll be prompted to configure all required environment variables.

## Manual Deployment

### 1. Create Heroku App

```bash
# Login to Heroku
heroku login

# Create a new app (or use existing)
heroku create your-app-name

# Add PostgreSQL addon
heroku addons:create heroku-postgresql:essential-0
```

### 2. Configure Environment Variables

```bash
# Google OAuth (required)
heroku config:set GOOGLE_CLIENT_ID="your_google_client_id"
heroku config:set GOOGLE_CLIENT_SECRET="your_google_client_secret"
heroku config:set GOOGLE_REDIRECT_URI="https://your-app-name.herokuapp.com/api/auth/callback"

# Frontend URL
heroku config:set FRONTEND_URL="https://your-app-name.herokuapp.com"

# Security secrets (generate these!)
heroku config:set ENCRYPTION_SECRET="$(openssl rand -hex 32)"
heroku config:set SESSION_SECRET="$(openssl rand -hex 32)"

# Production mode
heroku config:set NODE_ENV="production"

# Optional: Custom PostgreSQL schema
heroku config:set POSTGRES_SCHEMA="your_schema_name"
```

### 3. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project or create a new one
3. Navigate to **APIs & Services > Credentials**
4. Add your Heroku app's redirect URI:
   - `https://your-app-name.herokuapp.com/api/auth/callback`
5. Also add authorized JavaScript origins:
   - `https://your-app-name.herokuapp.com`

See [GOOGLE_OAUTH.md](./GOOGLE_OAUTH.md) for detailed OAuth setup instructions.

### 4. Deploy

```bash
# Commit your changes
git add .
git commit -m "Prepare for Heroku deployment"

# Push to Heroku
git push heroku main

# Or if using a different branch:
git push heroku your-branch:main
```

### 5. Run Database Migrations

Migrations run automatically on app startup! No manual steps needed.

### 6. Open Your App

```bash
heroku open
```

## Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection (auto-set by Heroku) | `postgres://...` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `123456...` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | `https://yourapp.herokuapp.com/api/auth/callback` |
| `FRONTEND_URL` | Your app's frontend URL | `https://yourapp.herokuapp.com` |
| `ENCRYPTION_SECRET` | 32-byte hex for encrypting API keys | Generate with `openssl rand -hex 32` |
| `SESSION_SECRET` | Random string for sessions | Generate with `openssl rand -hex 32` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port (auto-set by Heroku) | `3000` |
| `NODE_ENV` | Environment mode | `production` |
| `POSTGRES_SCHEMA` | PostgreSQL schema name | `public` |

## Using Custom PostgreSQL Schema

If you need to share a database with multiple apps or want to use a custom schema:

```bash
# Set the schema name
heroku config:set POSTGRES_SCHEMA="myapp"

# Create the schema in your database
heroku pg:psql
CREATE SCHEMA IF NOT EXISTS myapp;
\q
```

The app will automatically use this schema for all tables.

## Monitoring & Logs

```bash
# View logs
heroku logs --tail

# Check dyno status
heroku ps

# View database info
heroku pg:info

# Connect to database
heroku pg:psql
```

## Scaling

```bash
# Scale web dynos
heroku ps:scale web=1

# Upgrade database plan
heroku addons:upgrade heroku-postgresql:standard-0
```

## Troubleshooting

### Migration Issues

If migrations fail, check the logs:
```bash
heroku logs --tail | grep migration
```

Migrations run automatically on startup. If they fail, the app won't start.

### OAuth Errors

- Verify redirect URI matches exactly in Google Cloud Console
- Check that authorized JavaScript origins are configured
- Ensure FRONTEND_URL and GOOGLE_REDIRECT_URI are set correctly

### Database Connection Issues

```bash
# Check database status
heroku pg:info

# Verify DATABASE_URL is set
heroku config:get DATABASE_URL

# Test connection
heroku pg:psql
```

### Session/Cookie Issues

- Ensure `SESSION_SECRET` is set
- Check that your app is using HTTPS (Heroku provides this automatically)
- Verify cookies are being set correctly in browser DevTools

## Updating the App

```bash
# Make your changes
git add .
git commit -m "Your update message"

# Deploy
git push heroku main

# Restart if needed
heroku restart
```

## Backup & Restore

```bash
# Create manual backup
heroku pg:backups:capture

# List backups
heroku pg:backups

# Download backup
heroku pg:backups:download

# Restore from backup
heroku pg:backups:restore <backup-id>
```

## Security Best Practices

1. **Use strong secrets**: Always generate `ENCRYPTION_SECRET` and `SESSION_SECRET` with `openssl rand -hex 32`
2. **Rotate secrets regularly**: Update secrets periodically for enhanced security
3. **Monitor access logs**: Check Heroku logs for suspicious activity
4. **Keep dependencies updated**: Run `bun update` regularly
5. **Use Heroku SSL**: Heroku provides free SSL/TLS certificates

## Cost Optimization

- **Eco Dynos**: For low-traffic apps ($5/month)
- **Basic Dynos**: For production apps ($7/month)
- **Essential PostgreSQL**: Includes daily backups ($5/month)
- **Standard PostgreSQL**: For higher traffic ($50/month)

See [Heroku Pricing](https://www.heroku.com/pricing) for details.

## Custom Domain

```bash
# Add custom domain
heroku domains:add www.yourdomain.com

# Configure SSL
heroku certs:auto:enable

# Update Google OAuth with new domain
```

Don't forget to update `GOOGLE_REDIRECT_URI` and `FRONTEND_URL` and add the new domain to Google Cloud Console!

## Support

- [Heroku Dev Center](https://devcenter.heroku.com/)
- [Heroku Support](https://help.heroku.com/)
- [Project Issues](https://github.com/yourusername/personal-assistant-army/issues)
