function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type AuthMode = "oidc" | "test";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function parseAuthMode(value: string | undefined): AuthMode {
  const normalized = (value?.trim() || (IS_PRODUCTION ? "oidc" : "test")).toLowerCase();
  if (normalized === "oidc" || normalized === "test") return normalized;
  throw new Error("AUTH_MODE must be either oidc or test.");
}

export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: IS_PRODUCTION,
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:3000",
  authMode: parseAuthMode(process.env.AUTH_MODE),
  authIssuerUrl: (process.env.AUTH_ISSUER_URL ?? "https://accounts.google.com").trim(),
  authClientId: (process.env.AUTH_CLIENT_ID ?? "").trim(),
  authClientSecret: process.env.AUTH_CLIENT_SECRET ?? "",
  authAllowedDomain: (process.env.AUTH_ALLOWED_DOMAIN ?? "taxacebsi.com").trim().toLowerCase(),
  authRedirectUri: (process.env.AUTH_REDIRECT_URI ?? "http://localhost:3000/auth/callback").trim(),
  testAuthEmail: (process.env.TEST_AUTH_EMAIL ?? "").trim().toLowerCase(),
  testAuthAccessCode: process.env.TEST_AUTH_ACCESS_CODE ?? "",
  sessionTtlHours: parsePositiveInteger(process.env.SESSION_TTL_HOURS, 12),
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  s3ForcePathStyle: parseBoolean(process.env.S3_FORCE_PATH_STYLE),
  storageSignedUrlTtlSeconds: parsePositiveInteger(
    process.env.STORAGE_SIGNED_URL_TTL_SECONDS,
    300,
  ),
};

function placeholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized.includes("change_me") || normalized.includes("your_google") || normalized === "replace_me";
}

export function validateRuntimeEnvironment(): void {
  if (!ENV.isProduction) return;

  const problems: string[] = [];
  if (placeholder(ENV.databaseUrl)) problems.push("DATABASE_URL must be configured with production credentials.");
  if (ENV.authAllowedDomain !== "taxacebsi.com") problems.push("AUTH_ALLOWED_DOMAIN must be exactly taxacebsi.com.");
  if (placeholder(ENV.s3Bucket)) problems.push("S3_BUCKET must identify a private production bucket.");
  if (!ENV.s3Region.trim()) problems.push("S3_REGION is required.");
  if (Boolean(ENV.s3AccessKeyId) !== Boolean(ENV.s3SecretAccessKey)) {
    problems.push("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must either both be set or both be omitted for IAM-based credentials.");
  }

  let origin: URL | null = null;
  try {
    origin = new URL(ENV.appOrigin);
    if (origin.protocol !== "https:") problems.push("APP_ORIGIN must use HTTPS in production.");
    if (origin.pathname !== "/" || origin.search || origin.hash) problems.push("APP_ORIGIN must be an origin only, with no path, query, or hash.");
  } catch {
    problems.push("APP_ORIGIN must be a valid absolute URL.");
  }

  if (ENV.authMode === "oidc") {
    if (placeholder(ENV.authClientId)) problems.push("AUTH_CLIENT_ID must contain the Google OAuth client ID when AUTH_MODE=oidc.");
    if (placeholder(ENV.authClientSecret)) problems.push("AUTH_CLIENT_SECRET must contain the Google OAuth client secret when AUTH_MODE=oidc.");

    try {
      const redirect = new URL(ENV.authRedirectUri);
      if (redirect.protocol !== "https:") problems.push("AUTH_REDIRECT_URI must use HTTPS in production when AUTH_MODE=oidc.");
      if (origin && redirect.origin !== origin.origin) problems.push("AUTH_REDIRECT_URI must use the same origin as APP_ORIGIN.");
      if (redirect.pathname !== "/auth/callback") problems.push("AUTH_REDIRECT_URI must end with /auth/callback.");
    } catch {
      problems.push("AUTH_REDIRECT_URI must be a valid absolute URL when AUTH_MODE=oidc.");
    }
  } else {
    if (!ENV.testAuthEmail || !ENV.testAuthEmail.endsWith("@taxacebsi.com")) {
      problems.push("TEST_AUTH_EMAIL must be a pre-provisioned @taxacebsi.com account when AUTH_MODE=test.");
    }
    if (placeholder(ENV.testAuthAccessCode) || ENV.testAuthAccessCode.length < 24) {
      problems.push("TEST_AUTH_ACCESS_CODE must be a non-placeholder secret of at least 24 characters when AUTH_MODE=test.");
    }
  }

  if (problems.length) {
    throw new Error(`Invalid production configuration:\n- ${problems.join("\n- ")}`);
  }
}
