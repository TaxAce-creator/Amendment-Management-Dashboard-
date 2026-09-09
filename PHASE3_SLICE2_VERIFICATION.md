# Phase 3 Slice 2 Verification — Google Workspace Authentication

## Scope

This slice replaces the temporary fail-closed authentication boundary with a standalone Google Workspace OpenID Connect implementation and database-backed application sessions.

## Implemented controls

- Google OpenID Connect discovery through `openid-client`.
- Authorization Code flow with PKCE S256, state, and nonce.
- Server-side one-time login-state persistence and expiration.
- Signed Google Workspace hosted-domain (`hd`) validation for `taxacebsi.com`.
- Verified email requirement.
- Pre-provisioned active application user requirement.
- Immutable Google issuer/subject binding on first successful sign-in.
- Random opaque application sessions; only SHA-256 token hashes are persisted.
- Session expiration and revocation.
- Secure/HttpOnly/SameSite=Lax session cookie behavior; production cookies are always Secure.
- Logout revokes the current server-side session.
- Deactivating a user makes the session unusable immediately and revokes stored sessions.
- Unsafe tRPC browser requests with a mismatched `Origin` are rejected.
- Settings UI can provision users with the original four approved roles.
- First Admin can be provisioned with `pnpm user:bootstrap`.

## Role contract

The role model remains exactly:

- Admin — full capability set
- EA Reviewer — same full capability set as Admin
- Preparer — same full capability set as Admin
- Viewer — view/export only

## Static checks completed in the build environment

- Parsed all TypeScript/TSX source files with the available TypeScript compiler parser: zero syntax diagnostics.
- Checked local TypeScript import targets: zero missing local imports.
- Parsed `package.json` and `pnpm-lock.yaml`.
- Confirmed `package.json` dependency specifiers match the root importer in `pnpm-lock.yaml`.
- Confirmed no active Manus OAuth/runtime/Forge identifiers or endpoints remain in application source.
- Confirmed no real `CanopyTasks_*` exports are present in the repository.
- Confirmed no live credential patterns were introduced.

## Full command verification still required in a network-capable development/CI environment

The current build container cannot download the repository dependency graph from the npm registry, so the following commands have **not** been represented as passing here:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

These commands are the required CI/local verification gate once the repository is running in GitHub Actions, Codespaces, or another network-capable environment.

## Configuration required before interactive Google sign-in

A TaxAce administrator must create/configure a Google OAuth Web client and provide:

- `AUTH_CLIENT_ID`
- `AUTH_CLIENT_SECRET`
- production `APP_ORIGIN`
- production `AUTH_REDIRECT_URI`

The redirect URI registered with Google must exactly match the application's configured callback URI.
