# TelemuneSmartAi — Calendar connection setup

**Version:** 1.0 · 20 Nov 2026 · **For:** the SuperAdmin (server keys) and every user (connecting their own calendar)

With a calendar connected, an agent books meetings straight into the owner's real calendar. It asks the caller for a day
and time, checks that the time is free, books it, and offers other free times when it is taken.

## 1. How it works

1. A user switches on **📅 Calendar** in Agent studio → Tools. The **Connect a calendar** window opens.
2. They pick a provider:
   - **Google Calendar** and **Outlook / Microsoft 365**: **Sign in with Google / Microsoft**. They sign in at Google or Microsoft, allow calendar access, and come straight back to the app.
   - **Yahoo, iCloud, Zoho, Other (CalDAV)**: they type their user name and an **app password**. Yahoo and iCloud fill in the server address; Zoho and Other ask for it.
3. In a call, the agent asks for the day and time, says "one moment, let me check the calendar", and the app checks:
   - the connected calendar's busy times (Google free/busy, Outlook calendar, CalDAV events);
   - meetings the app already booked for this agent;
   - the owner's working days and hours, days off and time zone (Agent studio → Availability).
4. **Free**: the agent books it at once. The meeting goes into the connected calendar and the app's own list (📅 chip "booked in Google Calendar").
5. **Busy or outside hours**: the agent says so and offers up to 3 free times (the next free slots, at least 90 minutes apart, within 14 days). When the caller picks one, it is booked.
6. **"Right now" / "as soon as possible"**: the meeting is booked a set number of minutes from now. That number is set in the Connect a calendar window ("When a caller wants it right now, book it in … minutes"); the default is 5 (app setting `calendar.immediateMinutes`).

Without a connected calendar the same check still runs, on the app's own meetings and the working hours.
Each agent has its own connection, so two agents can book into two people's calendars.

## 2. Google Calendar (SuperAdmin, once per server)

Google needs an "OAuth client" for the app. It takes about 10 minutes.

1. Open **https://console.cloud.google.com** and sign in with the company Google account.
2. Top bar → project picker → **New project** → name it `TelemuneSmartAi` → Create, and select it.
3. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
4. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type: **External** (or Internal if everyone is in your Google Workspace).
   - App name `TelemuneSmartAi`, support email, developer email → Save.
   - **Data access / Scopes** → Add: `openid`, `.../auth/userinfo.email`, `.../auth/calendar.events` → Save. (Busy times are read from the event list, so no other calendar scope is needed.)
   - **Audience / Test users**: while the app is in *Testing*, add the Google accounts that will connect (up to 100).
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**, name `TelemuneSmartAi web`.
   - **Authorised redirect URIs**, add every address people open the app on, each ending in `/api/calendar-oauth/google/callback`:
     - `http://localhost:8323/api/calendar-oauth/google/callback` (on the server itself)
     - `https://smartai.yourcompany.com/api/calendar-oauth/google/callback` (your real address)
   - Create, then copy the **Client ID** and **Client secret**.
6. Put them in `voice_ai_backend/keys.env` (SuperAdmin → 🗄 Server, or edit the file) and restart the backend:

```properties
calendar.google.client-id=1234567890-abc.apps.googleusercontent.com
calendar.google.client-secret=GOCSPX-xxxxxxxxxxxxxxxx
calendar.oauth.redirect-base=https://smartai.yourcompany.com
```

**Notes:**
- Google does not accept a raw IP address (like `https://10.0.0.5:8443`) as a redirect address, only `localhost` or a real domain name. For use from other computers, give the server a domain name with HTTPS.
- While the consent screen is in **Testing**, only the listed test users can connect, and Google shows an "unverified app" notice. For everyone, press **Publish app**. Calendar scopes are "sensitive", so Google asks for a short verification (privacy policy link, a video of the sign-in) before the notice goes away.

### Reusing the older voiceAi project's apps (Telemune, 20 Nov 2026)

The same Google OAuth client (`20377242979-78v4…apps.googleusercontent.com`) and Entra app (`0cca26b2-…`) are used, and their IDs and
secrets are in `keys.env`. The old project's key names (`google.oauth.client-id/-secret`, `outlook.oauth.client-id/-secret/-tenant`) are
read too. Each app only needs this app's return addresses **added** next to the old ones (the old ones stay):

| Console | Add this redirect URI |
|---|---|
| Google Cloud → Credentials → the OAuth client → Authorised redirect URIs | `http://localhost:8323/api/calendar-oauth/google/callback` and `https://<public address>/api/calendar-oauth/google/callback` |
| Entra → App registrations → the app → Authentication → Web → Redirect URIs | `http://localhost:8323/api/calendar-oauth/microsoft/callback` and `https://<public address>/api/calendar-oauth/microsoft/callback` |

Tested on 20 Nov 2026 before adding them: Google answered `redirect_uri_mismatch` and Microsoft answered "redirect_uri is not valid",
which means both apps and the keys are accepted and only the addresses are missing. The Entra app is registered for personal accounts
(`calendar.microsoft.tenant=consumers`: Outlook.com, Hotmail, Live); for work Microsoft 365 accounts its supported account types must be
changed to "any organizational directory and personal accounts" and the tenant set to `common`. When this app runs under a path on the
public server (like the old `/televoiceAi/`), set `calendar.oauth.redirect-base=https://tryai.telemune.com/<path>` and register that.

### Return address: this computer now, the live server later

Google only sends people back to addresses registered for the client. The shared Telemune client already has two, so this
app borrows them through settings in `voice_ai_backend/keys.env` (no console change needed):

| Where | Setting | How the sign-in comes back |
|---|---|---|
| **This computer (now)** | `calendar.google.redirect-uri=https://localhost:8080/voiceAi/voiceApi/calendar/oauth2/callback` | Google → `https://localhost:8080/…` → the web app's **sign-in bridge** (`voice_ai_web/config.json` → `oauthBridge`, port 8080) → `http://localhost:8323/api/calendar-oauth/google/callback` → the backend saves the connection → back to the calendar window |
| **Live server (later)** | `calendar.google.redirect-uri=https://tryai.telemune.com/televoiceAi/voiceApi/calendar/oauth2/callback` | Google → the live address → one routing rule on the live server sends sign-ins whose `state` starts with `tsa-` to this app; all others still go to the old project |

Exact working (this computer):
1. You click **Sign in with Google**. The backend makes a one-time `state` starting with `tsa-` and a PKCE key, and opens Google with the return address above.
2. You sign in and allow calendar access. Google sends your browser to `https://localhost:8080/voiceAi/voiceApi/calendar/oauth2/callback?code=…&state=tsa-…`.
3. The bridge (only listening on this computer) answers with a redirect to `http://localhost:8323/api/calendar-oauth/google/callback?code=…&state=…`.
4. The backend checks the `state` (yours, under 10 minutes, used once), swaps the code for tokens with the same return address and the PKCE key, reads your email, stores the tokens encrypted, and sends you back to `http://localhost:8323/?cal=connected#agents/calendar`.
5. The window shows **✅ Connected · Google Calendar**. From then on the agent checks and books in that calendar.

Limits: works only in a browser on the computer that runs the app (localhost); the first visit shows a certificate warning for
`https://localhost:8080` (Advanced → Proceed); port 8080 must be free (`OAUTH_BRIDGE=off` in `voice_ai_web/.env` turns the bridge off);
the Google account must be a test user while the Google app is in Testing.

Going live: switch the two `calendar.google.redirect-uri` lines in keys.env (the live one is already there, commented out), remove
`oauthBridge` from the live web config, restart, and add this rule on the live server (nginx; ask for other servers):

```nginx
location = /televoiceAi/voiceApi/calendar/oauth2/callback {
    if ($arg_state ~ "^tsa-") { return 302 https://<new app address>/api/calendar-oauth/google/callback?$args; }
    proxy_pass http://<old app, as today>;
}
```

Settings: `calendar.oauth.state-prefix` (default `tsa-`), `calendar.oauth.return-url` (where to land after sign-in; empty = the page
that started it), `calendar.microsoft.redirect-uri` (same idea for Outlook). Old names `google.oauth.redirect-uri` and
`outlook.oauth.redirect-uri` also work.

## 3. Outlook / Microsoft 365 (SuperAdmin, once per server)

1. Open **https://entra.microsoft.com** → **Identity → Applications → App registrations → New registration**.
2. Name `TelemuneSmartAi`. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (works for Microsoft 365 and Outlook.com). For your own company only, choose single tenant and put the tenant ID in `calendar.microsoft.tenant`.
3. Redirect URI: platform **Web**, `https://smartai.yourcompany.com/api/calendar-oauth/microsoft/callback` → Register. Add `http://localhost:8323/api/calendar-oauth/microsoft/callback` under **Authentication** for use on the server itself.
4. Copy the **Application (client) ID** from Overview.
5. **Certificates & secrets → New client secret** → 24 months → copy the **Value**; it is shown only once.
6. **API permissions → Add a permission → Microsoft Graph → Delegated**: `Calendars.ReadWrite`, `User.Read`, `offline_access`, `openid`, `email` → Add. In a company tenant an admin may need to press **Grant admin consent**.
7. `voice_ai_backend/keys.env`, then restart the backend:

```properties
calendar.microsoft.client-id=00000000-0000-0000-0000-000000000000
calendar.microsoft.client-secret=xxxxx~xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
calendar.microsoft.tenant=common    # consumers = personal accounts only; organizations = work only
```

Client secrets expire, so set a reminder to make a new one before the date shown.

## 4. Yahoo, iCloud, Zoho, other (each user, no server keys)

These use CalDAV with an **app password**, a separate password made for one app. The normal password is never used.

| Provider | Make an app password | User name | Address |
|---|---|---|---|
| Yahoo | login.yahoo.com → Account security → Generate app password → "Other app" | Yahoo email | filled in (`https://caldav.calendar.yahoo.com`) |
| iCloud | account.apple.com → Sign-In and Security → App-Specific Passwords | Apple Account email | filled in (`https://caldav.icloud.com`) |
| Zoho | accounts.zoho.com → Security → App Passwords | Zoho email | Zoho Calendar → Settings → Calendars → your calendar → CalDAV URL |
| Other (Fastmail, Nextcloud, Synology…) | in that service's security settings | as the service says | its CalDAV address |

The app finds the first calendar for events at that address and books into it.

## 5. Security

- Google/Microsoft tokens and CalDAV app passwords are stored **encrypted** (AES-256-GCM) in MySQL table `calendar_accounts`. They never reach the browser and are never written to logs.
- The encryption key is `CALENDAR_TOKEN_KEY` in `voice_ai_backend/.env`. It is created automatically on the first start. Back it up with `.env`: without it, every connected calendar must be connected again.
- Sign-in uses PKCE and a one-time `state`. The return link works once, only for the person who started it, and only within 10 minutes.
- Only the owner can connect or disconnect their agent's calendar. An admin viewing a user can't. Disconnecting removes the stored tokens; already booked meetings stay.
- Admins can switch the calendar off per user (✏️ Edit → access → Calendar).

## 6. Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| "Google sign-in isn't set up on this server yet" | No client ID/secret in keys.env | Section 2 or 3, then restart the backend |
| Google: `redirect_uri_mismatch` | The address the app sent isn't in the OAuth client's list | Add `<address you use>/api/calendar-oauth/google/callback` exactly, or set `calendar.oauth.redirect-base` |
| Google: "Access blocked / app not verified" | Consent screen in Testing and the account isn't a test user | Add the account as a test user, or publish and verify the app |
| Microsoft: `AADSTS50011` | Redirect URI mismatch | Add the exact URI under Authentication |
| Microsoft: "Need admin approval" | Company tenant blocks user consent | An admin grants consent in API permissions |
| "The calendar server refused the user name or app password" | Normal password used, or app password mistyped | Make a new app password |
| "⚠ Connected · … sign-in has expired" | The person removed access, or the refresh token expired | Connect it again |
| Wrong times | The owner's time zone | Agent studio → Availability → time zone |
| Agent offers times outside working hours | No working hours set | Set days and hours in Availability (or 24×7) |

## 7. For developers

- API: `GET /api/calendar-accounts` · `POST /api/calendar-accounts/oauth/{google|microsoft}` {origin} → {url} · `GET /api/calendar-oauth/{provider}/callback` · `POST /api/calendar-accounts/caldav` {label, url, username, password} · `DELETE /api/calendar-accounts` · `POST /api/calendar/check` {when: "YYYY-MM-DDTHH:MM" or "NOW", minutes} · `POST /api/calendar` {title, when, durationMin}: 201 booked, 409 busy with `suggestions`.
- Agent tags: `<calendar-check:YYYY-MM-DDTHH:MM|MIN>` or `<calendar-check:NOW|MIN>` → hidden note `[calendar check: FREE …]` / `[calendar check: BUSY … Free options: …]` → `<calendar:TITLE|YYYY-MM-DDTHH:MM|MIN>` → on 409 `[calendar booking failed: …]`.
- Code: `CalendarSyncService` (providers, check, book), `CalendarAccountController`, `SecretBox`, `Prompts.calendarPrompt`; web `app.js` `checkCalendarSlot`, `addCalendarEvent`, `sendCalendarNote`, `renderCalApp`, `calendarReturn`.
- The older project's key names are read as fallbacks: `google.oauth.client-id/-secret`, `outlook.oauth.client-id/-secret/-tenant`. Google scopes: `calendar.google.scopes` (default `openid email …/calendar.events`).
- Provider URLs can be pointed elsewhere for tests: `calendar.google.auth-url / token-url / api-url / userinfo-url`, `calendar.microsoft.auth-url / token-url / graph-url`.
