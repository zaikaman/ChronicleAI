-- Email newsletter / digest subscribers (real users, not env lists)

CREATE TABLE IF NOT EXISTS public.email_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
  receives_digests BOOLEAN NOT NULL DEFAULT TRUE,
  receives_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'api', 'premium', 'import')),
  payer_reference TEXT,
  unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid(),
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_subscribers_email_normalized_unique UNIQUE (email_normalized),
  CONSTRAINT email_subscribers_unsubscribe_token_unique UNIQUE (unsubscribe_token)
);

CREATE INDEX IF NOT EXISTS idx_email_subscribers_active_digests
  ON public.email_subscribers (status, receives_digests)
  WHERE status = 'active' AND receives_digests = TRUE;

CREATE INDEX IF NOT EXISTS idx_email_subscribers_active_alerts
  ON public.email_subscribers (status, receives_alerts)
  WHERE status = 'active' AND receives_alerts = TRUE;

COMMENT ON TABLE public.email_subscribers IS
  'Opt-in email recipients for digests and public alerts. Resolved at send time from DB.';
