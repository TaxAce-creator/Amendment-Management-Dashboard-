import * as oidc from "openid-client";
import { ENV } from "../_core/env";

let cachedConfiguration: Promise<oidc.Configuration> | null = null;

function requireGoogleConfiguration() {
  const missing = [
    ["AUTH_ISSUER_URL", ENV.authIssuerUrl],
    ["AUTH_CLIENT_ID", ENV.authClientId],
    ["AUTH_CLIENT_SECRET", ENV.authClientSecret],
    ["AUTH_REDIRECT_URI", ENV.authRedirectUri],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing authentication configuration: ${missing.map(([name]) => name).join(", ")}`);
  }
}

export async function getGoogleOidcConfiguration(): Promise<oidc.Configuration> {
  requireGoogleConfiguration();
  if (!cachedConfiguration) {
    cachedConfiguration = oidc.discovery(
      new URL(ENV.authIssuerUrl),
      ENV.authClientId,
      ENV.authClientSecret,
    );
  }
  return cachedConfiguration;
}

export async function createGoogleAuthorizationRequest() {
  const config = await getGoogleOidcConfiguration();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: ENV.authRedirectUri,
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
    hd: ENV.authAllowedDomain,
    prompt: "select_account",
  });

  return { url, codeVerifier, state, nonce };
}

export async function exchangeGoogleAuthorizationCode(input: {
  currentUrl: URL;
  codeVerifier: string;
  expectedState: string;
  expectedNonce: string;
}) {
  const config = await getGoogleOidcConfiguration();
  return oidc.authorizationCodeGrant(config, input.currentUrl, {
    pkceCodeVerifier: input.codeVerifier,
    expectedState: input.expectedState,
    expectedNonce: input.expectedNonce,
    idTokenExpected: true,
  });
}
