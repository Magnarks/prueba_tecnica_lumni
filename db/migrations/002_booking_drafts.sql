CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  company TEXT
);

ALTER TABLE bookings
  ADD COLUMN customer_id INTEGER REFERENCES customers(id),
  ADD COLUMN draft_token_hash TEXT,
  ADD COLUMN current_step SMALLINT NOT NULL DEFAULT 1
    CHECK (current_step BETWEEN 1 AND 3),
  ADD COLUMN projector BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN coffee_people SMALLINT NOT NULL DEFAULT 0
    CHECK (coffee_people BETWEEN 0 AND 30);

CREATE UNIQUE INDEX bookings_draft_token_hash_key
  ON bookings (draft_token_hash)
  WHERE draft_token_hash IS NOT NULL;

CREATE TABLE booking_lines (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  concept TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL
);