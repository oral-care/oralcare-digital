-- The first admin (plan 3.2). Run once in Neon's SQL Editor, connected to the
-- database oralcare_digital. Every other user is invited in the app.
--
-- Before running: replace the three <<...>> placeholders in the editor with
-- your first name, last name and work e-mail in lower case. Never write them
-- into this file: the repo is public and holds no personal data.
--
-- The invitation gives every view and every market, with the role admin. The
-- account is created the first time you sign in with the code from the e-mail.

INSERT INTO auth.invitation (email, first_name, last_name, role, views, markets)
VALUES (
  '<<E-MAIL>>',
  '<<FIRST NAME>>',
  '<<LAST NAME>>',
  'admin',
  ARRAY['availability', 'booking-statistics', 'nps', 'funnel', 'tracking-framework', 'monitoring'],
  ARRAY['se', 'no', 'dk', 'nl']
);
