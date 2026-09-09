# Assumptions and Approved Decisions

This file records build decisions that affect implementation. It must not contain credentials or client data.

## Approved decisions

- The application is standalone and must not depend on the legacy application platform at runtime or build time.
- Roles remain exactly: `Admin`, `EA Reviewer`, `Preparer`, and `Viewer`.
- `Admin`, `EA Reviewer`, and `Preparer` retain the same full capability set; `Viewer` remains view/export only.
- Corporate authentication will use Google Workspace and only verified `@taxacebsi.com` accounts may be authorized.
- The database starts empty of operational data. Existing schema/domain work is retained where correct and refined in later slices.
- Real Canopy task exports are the source contract for imported operational source data.
- Canopy task status remains separate from TaxAce Workflow Status.
- Launch Amendment Audit Pro is an active, human-driven internal review workflow; it is not an AI integration.
- Production storage is private S3-compatible object storage; local development may use MinIO.

## Unresolved implementation values

The following are deployment configuration, not product assumptions:

- Production MySQL hostname/provider and credentials.
- Production S3 bucket/provider and credentials.
- Google Workspace OAuth client ID and client secret.

## Phase 3 Slice 2 - Google Workspace authentication

- Google Workspace is the approved identity provider.
- Only verified Google identities whose signed `hd` claim is exactly `taxacebsi.com` are accepted.
- A valid Workspace identity is not sufficient by itself: a matching active user must already be provisioned in the application database.
- The immutable Google `sub` plus issuer are bound to that pre-provisioned user on first successful sign-in.
- Application sessions use random opaque bearer tokens; only SHA-256 hashes are persisted in MySQL.
- OIDC authorization requests use PKCE, state, and nonce. Temporary state is persisted server-side and consumed exactly once.
