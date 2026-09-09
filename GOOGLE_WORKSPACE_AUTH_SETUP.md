# Google Workspace Authentication Setup

This application uses Google as the OpenID Connect identity provider but does **not** treat every Google account as authorized. Application access requires both an approved `taxacebsi.com` Google Workspace identity and a pre-provisioned TaxAce user record.

## 1. Create or select a Google Cloud project

Use a TaxAce-controlled Google Cloud project that can be administered by the appropriate TaxAce Workspace administrators.

## 2. Configure the OAuth consent screen

Configure the application identity for internal TaxAce use. Use the TaxAce organization/application name and approved support/contact details.

Do not add broad Google API scopes. The application only requests:

```text
openid email profile
```

## 3. Create an OAuth client

Create a **Web application** OAuth client.

For local development, register this redirect URI exactly:

```text
http://localhost:3000/auth/callback
```

For production, register the exact HTTPS callback URL for the deployed application, for example:

```text
https://YOUR-PRODUCTION-HOST/auth/callback
```

The value configured in Google must exactly match `AUTH_REDIRECT_URI`.

## 4. Configure the application environment

Set these values in `.env` locally and in the production secret/configuration service when deployed:

```text
APP_ORIGIN=http://localhost:3000
AUTH_ISSUER_URL=https://accounts.google.com
AUTH_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com
AUTH_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
AUTH_ALLOWED_DOMAIN=taxacebsi.com
AUTH_REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_TTL_HOURS=12
```

Never commit the real client secret.

## 5. Apply database migrations

```bash
pnpm db:migrate
```

## 6. Bootstrap the first Admin

The first user must already exist in the TaxAce Google Workspace and must use the approved domain.

```bash
pnpm user:bootstrap admin@taxacebsi.com "Admin Name"
```

This creates the TaxAce application user. It does **not** store the user's Google password and does not create a Google account.

## 7. First sign-in

1. Start the application.
2. Open the configured `APP_ORIGIN`.
3. Click **Sign in to TaxAce**.
4. Sign in with the provisioned TaxAce Google Workspace account.
5. Google returns the user to `/auth/callback`.
6. The application validates the signed identity, binds the immutable Google issuer/subject to the pre-provisioned user, creates a server-side session, and returns the user to the application.

## 8. Provision additional team members

After signing in as Admin, EA Reviewer, or Preparer:

1. Open **Settings**.
2. Open **Users**.
3. Enter the team member's name and `@taxacebsi.com` email.
4. Select the role: Admin, EA Reviewer, Preparer, or Viewer.
5. Click **Add User**.

The user can then sign in with the matching Google Workspace account.

## Security behavior

- A Gmail/consumer Google account is rejected.
- A Google Workspace account from another hosted domain is rejected.
- An unverified email is rejected.
- A valid `taxacebsi.com` Workspace identity with no active application user is rejected.
- Deactivating a user revokes active application sessions.
- Logout revokes the current server-side session.
- The application stores no Google passwords.
- The application does not auto-provision users merely because they belong to the Workspace.
