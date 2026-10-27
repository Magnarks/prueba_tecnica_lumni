ALTER TABLE booking_email_jobs
  DROP CONSTRAINT booking_email_jobs_attempts_check;

ALTER TABLE booking_email_jobs
  ADD CONSTRAINT booking_email_jobs_attempts_check
  CHECK (attempts BETWEEN 0 AND 6);