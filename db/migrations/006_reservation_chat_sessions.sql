CREATE TABLE reservation_chat_sessions (
  id BIGSERIAL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(messages) = 'array'),
  booking_id BIGINT UNIQUE REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  CHECK (expires_at > created_at)
);

CREATE INDEX reservation_chat_sessions_expires_idx
  ON reservation_chat_sessions (expires_at);