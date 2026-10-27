INSERT INTO rooms (name, size, hourly_rate)
VALUES
  ('Sala pequeña 1', 'small', 40000),
  ('Sala mediana 1', 'medium', 70000),
  ('Sala grande 1', 'large', 120000)
ON CONFLICT (name) DO UPDATE
SET size = EXCLUDED.size,
    hourly_rate = EXCLUDED.hourly_rate;