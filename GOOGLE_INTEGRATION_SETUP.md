# Google Calendar + Gmail Integration Setup Guide

## Overview

This implementation adds Google Calendar and Gmail integration to pepaOS, allowing the AI agent to:
- Check calendar availability
- Suggest meeting times
- Draft emails with Gmail API
- Send emails when explicitly requested
- Optionally create calendar events

## Prerequisites

- Google Cloud Project with OAuth 2.0 credentials (Web Application type)
- Access to Supabase database
- Environment variables configured in `.env.local`

## Step 1: Create Google OAuth Credentials

### 1.1 Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing one)
3. Enable these APIs:
   - Google Calendar API
   - Gmail API

### 1.2 Create OAuth 2.0 Credentials
1. Go to "Credentials" in the left sidebar
2. Click "Create Credentials" → "OAuth Client ID"
3. Select "Web application"
4. Add Authorized redirect URIs:
   ```
   http://localhost:3000/api/google/callback
   https://yourdomain.com/api/google/callback (production)
   ```
5. Click "Create"
6. Download the credentials JSON - you'll need:
   - Client ID
   - Client Secret

## Step 2: Configure Environment Variables

Update your `.env.local` file:

```bash
# Existing variables
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
OPENAI_API_KEY=your_openai_api_key

# New Google OAuth variables
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback

# User ID for testing (optional, defaults to random UUID)
SESSION_USER_ID=test-user-123
```

## Step 3: Run Database Migrations

### 3.1 Apply Schema Changes to Supabase

Run the migration to create required tables:

```sql
-- Connected accounts table for OAuth integrations (e.g., Google)
CREATE TABLE connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  provider_user_id TEXT,
  provider_email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry TIMESTAMP WITH TIME ZONE,
  scopes TEXT[],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Audit logs table for tracking all actions with Google integrations
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  provider TEXT,
  status TEXT,
  metadata JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX idx_connected_accounts_user_id ON connected_accounts(user_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

You can run this in the Supabase SQL Editor.

## Step 4: Start the Application

```bash
npm run dev
```

Navigate to http://localhost:3000/dashboard and click on the "Agent" tab.

## Step 5: Test the Integration

### Test 1: Connect Google Account
1. In the Agent tab, you should see "Google Not Connected" status
2. Click "Connect Google" button
3. Follow the OAuth flow to authorize the app
4. You should be redirected back with connection confirmed

### Test 2: Check Calendar Availability (FLOW A)
With Google connected, try in the chat:
```
Najdi mi volné termíny zítra odpoledne a navrhni 3 možnosti schůzky.
```

The agent should:
- Call `get_calendar_availability` tool
- Return free slots and suggested meeting times

### Test 3: Draft Email (FLOW B)
Try in chat:
```
Napiš email Janě Novákové, že se s ní můžu sejít zítra v 15:00.
```

The agent should:
- Generate an appropriate email
- Call `draft_email` tool
- Return success with draft ID and preview

### Test 4: Email with Meeting Slots (FLOW C)
Try in chat:
```
Napiš klientovi email s návrhem termínu podle mé dostupnosti příští týden.
```

The agent should:
- Call `draft_viewing_email_from_availability` tool
- Generate email with 2-3 suggested time slots
- Create a Gmail draft
- Return preview in chat

### Test 5: Send Email (FLOW D)
Try in chat:
```
Pošli klientovi Petrovi Horákovi email, že potvrzuji schůzku zítra v 15:00.
```

The agent should:
- Generate appropriate email
- Call `send_email` (only because "pošli" = send)
- Return confirmation

**Note:** Default behavior is to create drafts. Only use `send_email` if user explicitly says "send", "pošli", "odesli", etc.

### Test 6: Create Calendar Event (FLOW E)
After email creation or separately:
```
Vytvořit mi v kalendáři event "Schůzka s Petrem" zítra v 15:00 na 30 minut.
```

The agent should call `create_calendar_event` and confirm.

## Architecture Overview

### New Files Created

**OAuth & Service Wrappers:**
- `src/lib/google/oauth.ts` - OAuth configuration and token management
- `src/lib/google/calendar.ts` - Google Calendar API wrapper
- `src/lib/google/gmail.ts` - Gmail API wrapper
- `src/lib/google-tools.ts` - High-level tools for agent integration

**API Routes:**
- `src/app/api/google/connect/route.ts` - Initiates OAuth flow
- `src/app/api/google/callback/route.ts` - Handles OAuth callback
- `src/app/api/google/status/route.ts` - Checks/manages connection status

**Database:**
- Migration file: `supabase/migrations/001_add_connected_accounts.sql`
- New tables: `connected_accounts`, `audit_logs`

### Modified Files

- `src/app/api/chat/route.ts` - Added Google tool definitions and execution logic
- `src/app/dashboard/page.tsx` - Added Google Connect UI and connection status
- `.env.local.example` - Added Google OAuth environment variables
- `supabase/schema.sql` - Added new tables

### Tool Definitions

Available tools in the chat:

1. **get_calendar_availability** - Check free slots in a time range
2. **suggest_meeting_slots** - Get top suggested meeting times
3. **draft_email** - Create Gmail draft (no send)
4. **send_email** - Send email (only if user explicitly requests)
5. **create_calendar_event** - Add event to Google Calendar
6. **draft_viewing_email_from_availability** - High-level: find availability + draft email with time slots

## Security Considerations

✅ **Implemented:**
- Access tokens stored securely in Supabase (never exposed to client)
- Refresh tokens managed server-side
- Automatic token refresh on expiry
- All Google API calls server-side only
- Action logging in `audit_logs` table
- Email send requires explicit user intent (not auto-sent)

## Troubleshooting

### "Google OAuth environment variables not configured"
- Verify `.env.local` has `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- Restart development server after changing env vars

### "Google account not connected" error in chat
- Click "Connect Google" button in agent tab
- Confirm OAuth redirect and authorization
- Connection status should update

### Email draft not created
- Check that Google account is connected
- Verify Gmail API is enabled in Google Cloud
- Check browser console for detailed error messages

### Calendar availability returns empty
- Ensure calendar events exist in Google Calendar
- Verify the time range requested is valid
- Check that user's calendar is accessible via OAuth scopes

## Production Deployment Notes

1. Add production redirect URI to Google OAuth credentials:
   ```
   https://yourdomain.com/api/google/callback
   ```

2. Update `.env` on production with actual credentials

3. Consider implementing:
   - Multi-user support (use proper user IDs from auth library)
   - Token expiry refresh strategy
   - Rate limiting on Google API calls
   - Enhanced error handling and user feedback

4. Test thoroughly before enabling for all users

## Next Steps

- Implement user authentication system (NextAuth, Clerk, etc.)
- Add draft email preview UI with "Send Now" button
- Implement email thread tracking
- Add calendar event syncing with local UI
- Create settings page for managing integrations

## Support

For issues with:
- Google API: Check [Google Workspace APIs documentation](https://developers.google.com/workspace/apis)
- Supabase: Check [Supabase documentation](https://supabase.com/docs)
- The integration: Review implementation in `src/lib/google/` directory
