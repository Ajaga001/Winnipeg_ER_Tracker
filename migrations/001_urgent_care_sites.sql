-- 001_urgent_care_sites.sql
-- Concordia, Seven Oaks and Victoria are published on WRHA's separate
-- urgent-care page, which the scraper now reads. Concordia and Seven Oaks were
-- seeded as emergency departments, so correct their type. Pan Am Clinic is on
-- neither page (WRHA lists it as a minor injury clinic with no published wait
-- times), so retire it rather than logging empty rows forever.
--
-- Safe to run more than once. No rows are deleted.

UPDATE hospitals
SET type = 'urgent_care'
WHERE name IN ('Concordia Hospital', 'Seven Oaks General Hospital')
  AND type <> 'urgent_care';

UPDATE hospitals
SET is_active = FALSE
WHERE name = 'Pan Am Clinic Urgent Care'
  AND is_active;

-- Retired sites shouldn't appear on the dashboard as "No data" cards.
CREATE OR REPLACE VIEW latest_wait_times AS
SELECT DISTINCT ON (wtl.hospital_id)
    h.id                AS hospital_id,
    h.name              AS hospital_name,
    h.short_name,
    h.type,
    wtl.scraped_at,
    wtl.raw_wait_time,
    wtl.wait_time_minutes,
    wtl.patients_waiting,
    wtl.scrape_status
FROM  wait_times_log wtl
JOIN  hospitals h ON h.id = wtl.hospital_id
WHERE h.is_active
ORDER BY wtl.hospital_id, wtl.scraped_at DESC;
