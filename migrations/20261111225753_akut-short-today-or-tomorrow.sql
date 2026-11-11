-- Akut's waiting time is Short when the first slot is today or tomorrow, not
-- only today (plan 5.2, decided 2026-11-11). A new threshold version from now:
-- daily values keep the version they were saved with and are never recalculated.
-- clock_timestamp(), so the version is later than the first one even when every
-- migration runs in one go, as in the tests.
INSERT INTO availability.status_threshold_version (country_id, treatment_web_key, good_min_slots, short_max_days, valid_from)
SELECT id, 'muntra-treatment-23', 11, 1, clock_timestamp() FROM core.country WHERE code = 'se';
