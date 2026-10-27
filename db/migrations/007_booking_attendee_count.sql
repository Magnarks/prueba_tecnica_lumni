ALTER TABLE bookings
  ADD COLUMN attendee_count SMALLINT
    CHECK (attendee_count BETWEEN 1 AND 100);