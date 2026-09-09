-- W14b · Repair contact names that were never people
--
-- CONTEXT
-- The intent parser used to slice sentence fragments out of transcripts and
-- save them as contacts. PR #89 stopped it happening again; this repairs the
-- rows it already produced.
--
-- SCOPE: 13 rows, hand-classified against the transcript that produced each
-- one. Every row is listed individually with the sentence the user actually
-- said, so each decision can be checked rather than trusted.
--
-- NOTHING IS DELETED. No row is removed. Only the `contact_name` field is
-- corrected - either to the name the user really said, or to NULL where they
-- named nobody. The keeps themselves (reminders, expenses, tasks) are
-- untouched and keep working.
--
-- REVERSIBLE. The exact previous value of every field is recorded in the
-- rollback block at the bottom. Run that block to restore the old state
-- byte-for-byte.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste -> Run.
--   Read the DRY RUN block first; it shows exactly which rows will change.

-- ─────────────────────────────────────────────────────────────────────────
-- DRY RUN - run this alone first. It changes nothing.
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT id, contact_name AS current_value, COALESCE(voice_text, content) AS user_said
-- FROM keeps
-- WHERE id IN (
--   '3a3de09f-4167-4f6d-a14d-73a999fff84b','9821dd32-346c-4084-9327-7da73ff1da39',
--   'b4d0abb0-bea4-4c57-9483-c5ea26a303e4','2c58ef1f-ca17-4f7f-a0d0-dc996a23331a',
--   'ab9a59de-ed6c-4344-9c19-180e87a88023','04508c39-10d4-4fca-a5b8-d016a6086868',
--   '92720d09-9b61-494f-9511-2e16e4382aba','3b8c88f6-c2d7-489d-a902-e52c082ee69a',
--   '0a5eb932-44cd-4eaa-8275-19e0c2084e63','9b4a059f-b354-4f42-a5c3-3a0792d4cbb5',
--   '2b248369-4dde-4038-9085-667622a03a1c','e5abc411-ead7-4eac-ad11-7242af8bf9ea',
--   'a9e855ba-a445-445f-a2b3-e2f6357fac59'
-- ) ORDER BY contact_name;

BEGIN;

-- ── A · Wrong name captured. Correct it to the person actually named. ─────

-- "Gautam ki call cheyali safe Seva"  →  the Telugu verb was captured
UPDATE keeps SET contact_name = 'Gautam'
WHERE id = '3a3de09f-4167-4f6d-a14d-73a999fff84b' AND contact_name = 'Cheyali Safe';

-- "call Gautam tomorrow at 9:00 p.m."  →  date word swallowed into the name
UPDATE keeps SET contact_name = 'Gautam'
WHERE id = '9821dd32-346c-4084-9327-7da73ff1da39' AND contact_name = 'Gautam Tomorrow';

-- "Call Ravi about the plumber for the kitchen tap"
UPDATE keeps SET contact_name = 'Ravi'
WHERE id = '3b8c88f6-c2d7-489d-a902-e52c082ee69a' AND contact_name = 'Ravi About';

-- "Call Ravi at 5 p.m."
UPDATE keeps SET contact_name = 'Ravi'
WHERE id = '0a5eb932-44cd-4eaa-8275-19e0c2084e63' AND contact_name = 'Ravi At';

-- "call sambaraju India"  →  trailing word swallowed
UPDATE keeps SET contact_name = 'Sambaraju'
WHERE id = '2b248369-4dde-4038-9085-667622a03a1c' AND contact_name = 'Sambaraju India';

-- "when I go to Himayatnagar remind to call Gautam"
UPDATE keeps SET contact_name = 'Gautam'
WHERE id = 'a9e855ba-a445-445f-a2b3-e2f6357fac59' AND contact_name = 'To Call';

-- ── B · No person was named at all. Clear the field. ──────────────────────

-- "hi Arya can you please remind me to buy milk tomorrow"
UPDATE keeps SET contact_name = NULL
WHERE id = 'b4d0abb0-bea4-4c57-9483-c5ea26a303e4' AND contact_name = 'Me To';

-- "remind me when I reach home"  (two occurrences)
UPDATE keeps SET contact_name = NULL
WHERE id = '2c58ef1f-ca17-4f7f-a0d0-dc996a23331a' AND contact_name = 'Me When';
UPDATE keeps SET contact_name = NULL
WHERE id = 'ab9a59de-ed6c-4344-9c19-180e87a88023' AND contact_name = 'Me When';

-- "remind me while going home I need to pick up the clothes"
UPDATE keeps SET contact_name = NULL
WHERE id = '04508c39-10d4-4fca-a5b8-d016a6086868' AND contact_name = 'Me While';

-- "Paid Rs 1,850 for petrol at Shell via UPI"  →  a commodity, not a person
UPDATE keeps SET contact_name = NULL
WHERE id = '92720d09-9b61-494f-9511-2e16e4382aba' AND contact_name = 'Petrol At';

-- "when prominted with voice to set a call reminder to anyone ..."
UPDATE keeps SET contact_name = NULL
WHERE id = '9b4a059f-b354-4f42-a5c3-3a0792d4cbb5' AND contact_name = 'Reminder To';

-- "check for the feasibility if a language speaking or voice talk back mode ..."
UPDATE keeps SET contact_name = NULL
WHERE id = 'e5abc411-ead7-4eac-ad11-7242af8bf9ea' AND contact_name = 'The Feasibility';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- VERIFY - should return zero rows after the migration.
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT id, contact_name FROM keeps WHERE contact_name IN (
--   'Cheyali Safe','Gautam Tomorrow','Me To','Me When','Me While','Petrol At',
--   'Ravi About','Ravi At','Reminder To','Sambaraju India','The Feasibility','To Call');

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK - restores every field to its exact prior value.
-- ─────────────────────────────────────────────────────────────────────────
-- BEGIN;
-- UPDATE keeps SET contact_name='Cheyali Safe'    WHERE id='3a3de09f-4167-4f6d-a14d-73a999fff84b';
-- UPDATE keeps SET contact_name='Gautam Tomorrow' WHERE id='9821dd32-346c-4084-9327-7da73ff1da39';
-- UPDATE keeps SET contact_name='Ravi About'      WHERE id='3b8c88f6-c2d7-489d-a902-e52c082ee69a';
-- UPDATE keeps SET contact_name='Ravi At'         WHERE id='0a5eb932-44cd-4eaa-8275-19e0c2084e63';
-- UPDATE keeps SET contact_name='Sambaraju India' WHERE id='2b248369-4dde-4038-9085-667622a03a1c';
-- UPDATE keeps SET contact_name='To Call'         WHERE id='a9e855ba-a445-445f-a2b3-e2f6357fac59';
-- UPDATE keeps SET contact_name='Me To'           WHERE id='b4d0abb0-bea4-4c57-9483-c5ea26a303e4';
-- UPDATE keeps SET contact_name='Me When'         WHERE id='2c58ef1f-ca17-4f7f-a0d0-dc996a23331a';
-- UPDATE keeps SET contact_name='Me When'         WHERE id='ab9a59de-ed6c-4344-9c19-180e87a88023';
-- UPDATE keeps SET contact_name='Me While'        WHERE id='04508c39-10d4-4fca-a5b8-d016a6086868';
-- UPDATE keeps SET contact_name='Petrol At'       WHERE id='92720d09-9b61-494f-9511-2e16e4382aba';
-- UPDATE keeps SET contact_name='Reminder To'     WHERE id='9b4a059f-b354-4f42-a5c3-3a0792d4cbb5';
-- UPDATE keeps SET contact_name='The Feasibility' WHERE id='e5abc411-ead7-4eac-ad11-7242af8bf9ea';
-- COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- DELIBERATELY NOT TOUCHED - founder decision required
-- ─────────────────────────────────────────────────────────────────────────
-- 1. "Heritage"  (id 73a2c92d, "Milk and curd from Heritage - 2 packets")
--    A dairy brand, saved as a contact on a purchase. Arguably wrong as a
--    *contact*, arguably useful as a merchant. Not my call to make.
--
-- 2. "Surya Reddy" x9, all carrying phone +919876543210.
--    That number is the standard Indian placeholder, and the rows include
--    "[PF1] Call Surya at 3pm" and "[V8-FIX] Call Surya at 3pm" - test
--    fixtures, not user data. They may still be wanted for demos, so they are
--    left alone. Say the word and I will add them to a follow-up.
