type SentryEnv = {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
};

function parseSampleRate(value: string | undefined) {
  if (!value) {
    return 0.1;
  }

  const sampleRate = Number.parseFloat(value);
  if (!Number.isFinite(sampleRate)) {
    return 0.1;
  }

  return Math.max(0, Math.min(1, sampleRate));
}

/**
 * Builds Cloudflare Sentry options from Worker env, keeping local dev disabled
 * when no DSN is configured and normalizing trace sampling.
 */
export function getSentryOptions(env: SentryEnv = {}) {
  const dsn = env.SENTRY_DSN?.trim();

  return {
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    environment: env.SENTRY_ENVIRONMENT || undefined,
    release: env.SENTRY_RELEASE || undefined,
    tracesSampleRate: parseSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
    enableLogs: Boolean(dsn),
    enableRpcTracePropagation: true,
  };
}

export type { SentryEnv };
