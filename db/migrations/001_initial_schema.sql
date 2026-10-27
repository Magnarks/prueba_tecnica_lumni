CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  size TEXT NOT NULL CHECK (size IN ('small', 'medium', 'large')),
  hourly_rate NUMERIC(14, 2) NOT NULL CHECK (hourly_rate > 0)
);

CREATE TABLE bookings (
  id BIGSERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'completed', 'cancelled')),
  CHECK (ends_at > starts_at)
);

ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_confirmed_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'confirmed');