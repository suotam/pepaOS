# Google Calendar + Gmail Integration - Implementation Summary

## Implementation Complete ✅

Google Calendar + Gmail integration has been successfully implemented into pepaOS. The AI agent can now:

- ✅ Check calendar availability and suggest meeting times
- ✅ Draft emails through Gmail API
- ✅ Send emails when explicitly requested
- ✅ Create calendar events
- ✅ Generate emails with suggested meeting times based on availability

---

## New API Routes

All routes are prefixed with `/api/google/`:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/google/connect` | GET | Initiates OAuth flow, returns authorization URL |
| `/api/google/callback` | GET | OAuth callback handler, exchanges code for tokens |
| `/api/google/status` | GET | Checks Google connection status and connected email |
| `/api/google/status` | POST | Disconnects Google account (action: "disconnect") |

---

## New Files Created

### Google Service Wrappers
- **`src/lib/google/oauth.ts`** (280 lines)
  - OAuth 2.0 configuration and token management
  - Functions: `getOAuthClient()`, `getAuthorizationUrl()`, `exchangeCodeForToken()`, `getAuthenticatedGoogleClient()`, `getConnectionStatus()`, `disconnectGoogle()`
  - Token refresh handling with Supabase storage

- **`src/lib/google/calendar.ts`** (230 lines)
  - Google Calendar API wrapper with availability checking
  - Functions: `getCalendarAvailability()`, `suggestMeetingSlots()`, `createCalendarEvent()`
  - Business hours filtering (9 AM - 6 PM)
  - Free slot calculation and meeting slot suggestions

- **`src/lib/google/gmail.ts`** (160 lines)
  - Gmail API wrapper for drafts and sending
  - Functions: `createDraftEmail()`, `sendEmail()`, `getDraftMessage()`, `sendDraft()`, `deleteDraft()`
  - RFC 2822 MIME email formatting

- **`src/lib/google-tools.ts`** (260 lines)
  - High-level tool functions for agent integration
  - Functions:
    - `get_calendar_availability()` - Check availability
    - `suggest_meeting_slots()` - Get suggestions  
    - `draft_email()` - Create draft
    - `send_email()` - Send email
    - `create_calendar_event()` - Add to calendar
    - `draft_viewing_email_from_availability()` - Composite tool

### API Route Handlers
- **`src/app/api/google/connect/route.ts`** (12 lines)
  - GET endpoint to generate authorization URL

- **`src/app/api/google/callback/route.ts`** (50 lines)
  - GET endpoint to handle OAuth callback
  - Exchanges authorization code for tokens
  - Logs connection action to audit_logs

- **`src/app/api/google/status/route.ts`** (35 lines)
  - GET endpoint for connection status
  - POST endpoint for disconnecting

### Database Migration
- **`supabase/migrations/001_add_connected_accounts.sql`**
  - Creates `connected_accounts` table
  - Creates `audit_logs` table
  - Creates indexes for performance

### Documentation
- **`GOOGLE_INTEGRATION_SETUP.md`** (Setup and testing guide)

---

## Modified Files

### `src/app/api/chat/route.ts`
- **Changes:** Added 6 new tool definitions + execution logic + updated system prompt
- **Added tools:** 
  - `get_calendar_availability`
  - `suggest_meeting_slots`
  - `draft_email`
  - `send_email`
  - `create_calendar_event`
  - `draft_viewing_email_from_availability`
- **Lines added:** ~150
- **Import:** Added `{ get_calendar_availability, suggest_meeting_slots, draft_email, send_email, create_calendar_event, draft_viewing_email_from_availability } from '../../../lib/google-tools'`

### `src/app/dashboard/page.tsx`
- **Changes:** Added Google Connect status UI, connection check, and management functions
- **Added state:** `googleConnected`, `googleEmail`, `googleConnecting`
- **Added functions:** `checkGoogleConnection()`, `handleGoogleConnect()`, `handleGoogleDisconnect()`
- **Added UI:** Google connection status card with Connect/Disconnect button
- **Updated:** Chat placeholder text changes based on connection status
- **Lines added:** ~80

### `.env.local.example`
- **Added:**
  ```
  GOOGLE_CLIENT_ID=your_google_client_id
  GOOGLE_CLIENT_SECRET=your_google_client_secret
  GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
  SESSION_USER_ID=test-user-123
  ```

### `supabase/schema.sql`
- **Added:** `connected_accounts` table, `audit_logs` table, and related indexes

### `package.json`
- **Added:** `googleapis` package (24 packages added total)

---

## Database Schema Changes

### New Table: `connected_accounts`
```sql
- id (UUID, PK)
- user_id (TEXT, UNIQUE) - links to session user
- provider (TEXT) - "google"
- provider_user_id (TEXT)
- provider_email (TEXT) - user's Google email
- access_token (TEXT) - encrypted on Supabase
- refresh_token (TEXT) - for long-term access
- token_expiry (TIMESTAMP) - when token expires
- scopes (TEXT[]) - requested OAuth scopes
- metadata (JSONB) - additional data
- created_at / updated_at (TIMESTAMP)
```

### New Table: `audit_logs`
```sql
- id (UUID, PK)
- user_id (TEXT) - who performed action
- action_type (TEXT) - e.g. "calendar_availability_lookup", "draft_email", "send_email"
- provider (TEXT) - "google"
- status (TEXT) - "success", "failed"
- metadata (JSONB) - action details
- error_message (TEXT) - if failed
- created_at (TIMESTAMP)
```

---

## Tool Definitions for Chat

The agent now has access to these tools:

### 1. `get_calendar_availability`
```typescript
Input:
- start: string (ISO datetime)
- end: string (ISO datetime)  
- durationMinutes?: number (default: 30)

Output:
- requestedRange: { start, end }
- freeSlots: TimeSlot[]
- suggestedSlots: TimeSlot[]
```

### 2. `suggest_meeting_slots`
```typescript
Input:
- start: string (ISO datetime)
- end: string (ISO datetime)
- durationMinutes?: number (default: 30)
- maxSuggestions?: number (default: 3)

Output: TimeSlot[]
```

### 3. `draft_email`
```typescript
Input:
- to: string (email)
- subject: string
- body: string

Output:
- draftId: string
- messageId: string
- preview: string
- status: "DRAFT"
```

### 4. `send_email`
```typescript
Input:
- to: string
- subject: string
- body: string

Output:
- messageId: string
- status: "SENT"
- message: string
```

### 5. `create_calendar_event`
```typescript
Input:
- summary: string
- start: string (ISO datetime)
- end: string (ISO datetime)
- description?: string
- attendeeEmails?: string[]

Output:
- eventId: string
- htmlLink: string
```

### 6. `draft_viewing_email_from_availability` (Composite)
```typescript
Input:
- recipientName: string
- recipientEmail: string
- start: string (ISO datetime)
- end: string (ISO datetime)
- durationMinutes?: number
- context?: string

Output:
- draftId: string
- suggestedSlots: TimeSlot[]
- emailPreview: string
- status: "DRAFT"
```

---

## System Prompt Enhancement

The chat system prompt now includes instructions for:
1. Using Google Calendar tools to check availability
2. Using `draft_viewing_email_from_availability` for email+availability workflow
3. Using `draft_email` for regular drafts
4. Only using `send_email` when user explicitly requests sending
5. Responding in the user's language
6. Never hallucinating calendar or email data

---

## Security Features

✅ **Token Management:**
- Tokens stored in Supabase (server-side only)
- Automatic refresh on expiry
- Refresh token preserved across sessions

✅ **Email Safety:**
- Default behavior: draft only (never auto-send)
- Send requires explicit "send", "pošli", "odesli" request
- Draft shown to user before any send operation

✅ **API Security:**
- All Google API calls server-side
- No tokens exposed to frontend
- Audit logs track all actions

✅ **Scopes:**
```
- https://www.googleapis.com/auth/calendar.readonly (read availability)
- https://www.googleapis.com/auth/gmail.compose (draft)
- https://www.googleapis.com/auth/gmail.send (send)
- https://www.googleapis.com/auth/userinfo.email (profile)
- https://www.googleapis.com/auth/userinfo.profile (profile)
```

---

## How to Test

### Quick Test Checklist:

- [ ] Navigate to Dashboard → Agent tab
- [ ] See "Google Not Connected" status
- [ ] Click "Connect Google" button
- [ ] Complete OAuth authorization flow
- [ ] See "✓ Google Connected" with email displayed
- [ ] Ask agent: "Najdi mi volné termíny zítra odpoledne"
- [ ] See calendar availability and suggested times returned
- [ ] Ask agent: "Napiš email Janě s návrhem schůzky"
- [ ] See draft created with preview
- [ ] Ask agent: "Pošli email" (note: uses send because of "pošli")
- [ ] Verify email sent successfully

See `GOOGLE_INTEGRATION_SETUP.md` for detailed 5-flow testing guide.

---

## Configuration Checklist

Before running in production:

- [ ] Create Google OAuth credentials in Google Cloud Console
- [ ] Enable Calendar API and Gmail API
- [ ] Add redirect URIs (localhost for dev, domain for prod)
- [ ] Copy Client ID and Client Secret to `.env.local`
- [ ] Run database migrations on Supabase
- [ ] Test all flows locally
- [ ] Implement proper user authentication (NextAuth, etc.)
- [ ] Update production environment variables
- [ ] Test on staging environment
- [ ] Deploy to production

---

## Total Implementation Stats

| Metric | Count |
|--------|-------|
| New files created | 7 |
| Files modified | 4 |
| New lines of code | ~1000 |
| Google tools available | 6 |
| New API routes | 3 |
| New database tables | 2 |
| New npm packages | 1 (googleapis) |

---

## Known Limitations & Future Enhancements

**Current Limitations:**
- Single user support (use `SESSION_USER_ID` env var)
- No email thread history tracking
- Calendar events don't check attendee availability
- Meetings must be 30/45/60 minutes only

**Recommended Enhancements:**
- [ ] Multi-user support with proper authentication
- [ ] Email thread tracking and reply handling
- [ ] Calendar event sync UI component
- [ ] Attendee availability checking
- [ ] Custom meeting duration suggestions
- [ ] Timezone support
- [ ] Meeting reminder notifications
- [ ] Calendar sharing integration
- [ ] Admin panel for integration management

---

## Support & Debugging

**If Google tools aren't appearing in chat:**
1. Check `.env.local` has Google credentials
2. Rebuild app: `npm run build`
3. Restart dev server: `npm run dev`

**If OAuth fails:**
1. Verify redirect URI matches exactly in Google Cloud Console
2. Check Client ID and Secret are correct
3. Review browser console and server logs for details

**If calendar shows no availability:**
1. Create some calendar events in Google Calendar
2. Request availability for correct date range
3. Check it's requesting business hours (9-18)

**For detailed logs:**
- Check `audit_logs` table in Supabase for action history
- Review browser console for client-side errors
- Check server logs for API errors
