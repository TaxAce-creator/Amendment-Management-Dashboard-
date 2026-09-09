import type { Express, Request, Response } from "express";
import { COOKIE_NAME } from "../../shared/const";
import { isAuthorizedTaxAceEmail } from "../authorization";
import { bindGoogleIdentityToProvisionedUser, getUserByEmail } from "../db";
import { authRateLimit } from "../httpSecurity";
import { ENV } from "../_core/env";
import { getSessionCookieOptions } from "../_core/cookies";
import { validateGoogleWorkspaceClaims } from "./claims";
import {
  createGoogleAuthorizationRequest,
  exchangeGoogleAuthorizationCode,
} from "./google";
import { consumeLoginState, createLoginState, createUserSession } from "./sessionStore";
import { safeReturnTo, secureStringEqual } from "./security";

function callbackUrl(req: Request): URL {
  return new URL(req.originalUrl, ENV.appOrigin);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function authError(res: Response, status: number, message: string) {
  res.status(status).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TaxAce Sign-in</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:64px auto;padding:0 24px;color:#1a1f2e">
<h1>TaxAce sign-in could not be completed</h1><p>${escapeHtml(message)}</p>
<p><a href="/auth/login">Try signing in again</a></p></body></html>`);
}

function testLoginPage(res: Response, returnTo: string, message?: string) {
  const alert = message
    ? `<div style="margin:0 0 20px;padding:12px 14px;border:1px solid #f0b4b4;background:#fff5f5;border-radius:8px;color:#8a1c1c">${escapeHtml(message)}</div>`
    : "";

  res.status(message ? 403 : 200).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TaxAce Test Sign-in</title></head>
<body style="font-family:system-ui,sans-serif;background:#f5f7f9;margin:0;color:#1a1f2e">
<main style="max-width:520px;margin:8vh auto;padding:0 24px">
<section style="background:#fff;border:1px solid #e1e6eb;border-radius:12px;padding:28px;box-shadow:0 8px 30px rgba(15,23,42,.06)">
<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#008f7b">Temporary test mode</div>
<h1 style="margin:8px 0 10px;font-size:28px">TaxAce Amendment Management</h1>
<p style="line-height:1.55;color:#56616f">Google Workspace sign-in is temporarily paused for live build testing. This mode signs in only the single pre-provisioned TaxAce test account configured by the application administrator.</p>
${alert}
<form method="post" action="/auth/test-login" style="display:grid;gap:12px;margin-top:22px">
<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
<label for="accessCode" style="font-weight:600">Test access code</label>
<input id="accessCode" name="accessCode" type="password" autocomplete="current-password" required autofocus style="font:inherit;padding:11px 12px;border:1px solid #cbd5df;border-radius:8px" />
<button type="submit" style="font:inherit;font-weight:700;padding:11px 14px;border:0;border-radius:8px;background:#00aa91;color:#fff;cursor:pointer">Enter test build</button>
</form>
<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#768190">Google OAuth remains in the codebase and can be restored by changing AUTH_MODE to oidc after Google Cloud credentials are configured.</p>
</section></main></body></html>`);
}

function setSessionCookie(req: Request, res: Response, token: string, expiresAt: Date) {
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, token, {
    ...cookieOptions,
    expires: expiresAt,
  });
}

export function registerAuthRoutes(app: Express) {
  app.get("/auth/login", authRateLimit, async (req, res) => {
    const returnTo = safeReturnTo(req.query.returnTo);

    if (ENV.authMode === "test") {
      testLoginPage(res, returnTo);
      return;
    }

    try {
      const request = await createGoogleAuthorizationRequest();
      await createLoginState({
        state: request.state,
        codeVerifier: request.codeVerifier,
        nonce: request.nonce,
        returnTo,
      });
      res.redirect(request.url.href);
    } catch (error) {
      console.error("[Auth] Failed to start Google Workspace sign-in", error);
      authError(res, 503, "Google Workspace authentication is not configured or is temporarily unavailable.");
    }
  });

  app.post("/auth/test-login", authRateLimit, async (req, res) => {
    const returnTo = safeReturnTo(req.body?.returnTo);

    if (ENV.authMode !== "test") {
      authError(res, 404, "Temporary test sign-in is disabled.");
      return;
    }

    const accessCode = typeof req.body?.accessCode === "string" ? req.body.accessCode : "";
    if (!accessCode || !secureStringEqual(accessCode, ENV.testAuthAccessCode)) {
      testLoginPage(res, returnTo, "The test access code is not valid.");
      return;
    }

    if (!isAuthorizedTaxAceEmail(ENV.testAuthEmail)) {
      authError(res, 403, `Access is restricted to @${ENV.authAllowedDomain} accounts.`);
      return;
    }

    try {
      const provisionedUser = await getUserByEmail(ENV.testAuthEmail);
      if (!provisionedUser || !provisionedUser.active) {
        authError(res, 403, "The configured test account has not been provisioned in TaxAce or is inactive.");
        return;
      }

      const session = await createUserSession(provisionedUser.id);
      setSessionCookie(req, res, session.token, session.expiresAt);
      res.redirect(returnTo);
    } catch (error) {
      console.error("[Auth] Temporary test sign-in failed", error);
      authError(res, 503, "Temporary test sign-in could not create an application session.");
    }
  });

  app.get("/auth/callback", authRateLimit, async (req, res) => {
    if (ENV.authMode !== "oidc") {
      authError(res, 404, "Google Workspace authentication is temporarily disabled for this deployment.");
      return;
    }

    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!state) {
      authError(res, 400, "The Google sign-in response did not include the expected state value.");
      return;
    }

    try {
      const loginState = await consumeLoginState(state);
      if (!loginState) {
        authError(res, 400, "The sign-in request expired or has already been used. Please start again.");
        return;
      }

      const tokens = await exchangeGoogleAuthorizationCode({
        currentUrl: callbackUrl(req),
        codeVerifier: loginState.codeVerifier,
        expectedState: state,
        expectedNonce: loginState.nonce,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error("Google did not return OpenID Connect claims.");

      const identity = validateGoogleWorkspaceClaims(claims);
      if (!isAuthorizedTaxAceEmail(identity.email)) {
        authError(res, 403, `Access is restricted to @${ENV.authAllowedDomain} accounts.`);
        return;
      }

      const provisionedUser = await getUserByEmail(identity.email);
      if (!provisionedUser || !provisionedUser.active) {
        authError(res, 403, "Your Google account is valid, but this TaxAce application account has not been provisioned or is inactive.");
        return;
      }

      const user = await bindGoogleIdentityToProvisionedUser({
        userId: provisionedUser.id,
        issuer: identity.issuer,
        subject: identity.subject,
      });
      const session = await createUserSession(user.id);
      setSessionCookie(req, res, session.token, session.expiresAt);
      res.redirect(loginState.returnTo);
    } catch (error) {
      console.error("[Auth] Google Workspace callback failed", error);
      authError(res, 403, "The Google Workspace identity could not be authorized for this TaxAce application.");
    }
  });
}
