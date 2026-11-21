I want to explore the scope and plan for the first release of my community website, which needs
to go live TODAY. Please read the project context in openspec/config.yml first.

WHAT I'M BUILDING TODAY: Pongal 2027 Interest Survey
- Purpose: non-binding interest and headcount survey so organizers can decide whether to run the
  event and size the venue, catering and contribution fee. No payment is collected.
- Candidate days: Saturday Jan 16, 2027 and Sunday Jan 17, 2027
- Survey has a configurable open and close date/time; after closing it shows a friendly message
- Fields:
  1. Name (required)
  2. Email (required, identifies the family)
  3. Mobile (optional, US 10 digits)
  4. Days they can attend: checkboxes Sat / Sun, at least one required
  5. How likely they are to attend: Definitely / Likely / Maybe
  6. Headcount: adults (min 1), kids 5-12, kids under 5
  7. Food preference, one per family: Veg / Non-veg / Either is fine
  8. Volunteer roles (optional checkboxes): Culturals, Food Serving, Stage Setup, Hosting,
     Decoration, Registration Desk, Photography, Cleanup
  9. Interested in a cultural performance: Yes / Maybe / No
  10. Comfortable contribution per adult: $15 / $20 / $25 / Flexible (configurable)
  11. Comments (optional, max 500 chars)
  12. Consent to be contacted (required)

PROBLEMS WITH LAST YEAR'S GOOGLE FORM I MUST FIX
- It accepted invalid data (bad emails and phone numbers, nonsense counts)
- Error messages were generic and not helpful
- The same family submitted duplicates
So I want: specific friendly error messages next to each field, validation in the browser AND
on the server, one response per family per event (resubmitting with the same email updates it),
a private edit link, a confirmation summary, and a form that is easy to finish on a phone.

ADMIN NEEDS (also today)
- Admin pages protected by Cloudflare Access
- Decision report: total families/people, weighted headcount by likelihood, Saturday vs Sunday
  split, food split, volunteers per role with contact details, cultural interest, contribution
  distribution, responses per day
- Export to Excel and CSV
- Remove test or duplicate entries (soft delete) and restore them
- Past years' events stay viewable for history

PLATFORM NEEDS
- Data is kept forever, and the same family is recognized across years
- PostgreSQL on the NAS (separate stack) is not ready yet, so I develop with PGlite and switch by config
- Event details (dates, days, roles, contribution options, limits) come from a config file, not code

LATER (NOT TODAY, but don't design it out)
- Registration page: pre-filled from the survey, final headcount, cultural entries
  (max 2 per family, configurable per event), confirmation email
- More small community apps reusing the same households and events

PLEASE HELP ME THINK THROUGH
1. How to split this into OpenSpec changes, and in what order
2. Gaps, edge cases and validation rules I'm missing
3. Abuse/spam protection and privacy for a public form
4. A data model that supports many events/years and shared households
5. The minimum scope that is safe to release today vs what to defer
Ask me clarifying questions one group at a time before giving recommendations.
