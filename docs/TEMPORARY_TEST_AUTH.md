# Temporary Live-Build Authentication

Google Workspace OAuth is intentionally **paused, not removed** while the standalone TaxAce Amendment Management build is being tested live.

## Current mode

The application currently defaults to:

```text
AUTH_MODE=test
```

In this mode, `/auth/login` shows a temporary TaxAce test-login page instead of redirecting to Google.

The temporary login does **not** create a separate authorization model. It still requires:

1. a single configured `TEST_AUTH_EMAIL` ending in `@taxacebsi.com`;
2. that exact email to already exist as an **active, pre-provisioned TaxAce application user** in MySQL;
3. a secret `TEST_AUTH_ACCESS_CODE` of at least 24 characters supplied outside Git;
4. the normal TaxAce opaque database-backed session and secure cookie flow;
5. normal role/capability enforcement after sign-in.

Recommended live-test configuration:

```text
AUTH_MODE=test
AUTH_ALLOWED_DOMAIN=taxacebsi.com
TEST_AUTH_EMAIL=<pre-provisioned-test-user>@taxacebsi.com
TEST_AUTH_ACCESS_CODE=<long-random-secret>
```

Do not commit the real email/access code pair to a public configuration file, screenshot, issue, or repository history. The access code should be stored in the deployment platform's secret/environment manager.

## What remains disabled in test mode

While `AUTH_MODE=test`:

- `/auth/login` does not start Google OAuth;
- `/auth/callback` rejects Google callbacks;
- Google OAuth Client ID and Client Secret are not required for application startup;
- the Google OIDC implementation remains present in the codebase.

## Re-enable Google Workspace OAuth later

When the Google Cloud / Google Workspace OAuth client is ready, change the deployment configuration to:

```text
AUTH_MODE=oidc
AUTH_ISSUER_URL=https://accounts.google.com
AUTH_CLIENT_ID=<google-client-id>
AUTH_CLIENT_SECRET=<google-client-secret>
AUTH_ALLOWED_DOMAIN=taxacebsi.com
AUTH_REDIRECT_URI=https://YOUR_HOST/auth/callback
```

Then restart/redeploy the application.

No authentication rewrite or migration is required. The same TaxAce users, roles, authorization checks, and database-backed application sessions continue to be used.

## Important boundary

Temporary test mode is intended only to unblock controlled live-build validation before Google OAuth credentials are available. It is not the final TaxAce production authentication method. Before general production rollout, switch back to `AUTH_MODE=oidc` and complete the real Google Workspace browser sign-in acceptance test.
