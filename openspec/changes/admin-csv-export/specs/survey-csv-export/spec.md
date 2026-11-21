# Spec Delta

## Purpose

Lets signed-in organizers see how many families have responded and download an event's active survey responses as a spreadsheet-safe CSV file.

## ADDED Requirements

### Requirement: Admin home lists events with counts
`/admin` SHALL list every stored event, newest first, with its survey state, the number of active responses (families), the total people across them, and a "Download CSV" link.

#### Scenario: During the survey
- **GIVEN** `pongal-2027` has 2 active responses (3 and 4 people) and 1 removed response
- **WHEN** an organizer opens `/admin`
- **THEN** the row for Pongal 2027 shows "Open", "2 families", "7 people" and a "Download CSV" link to `/admin/events/pongal-2027/responses.csv`

### Requirement: CSV download of active responses
`GET /admin/events/<event-slug>/responses.csv` SHALL return one row per active response for that event, oldest first, after a header row, as UTF-8 with a byte-order mark, CRLF line endings, RFC 4180 quoting, `Content-Type: text/csv; charset=utf-8`, `Cache-Control: no-store`, and a download filename `<event-slug>-responses-<YYYY-MM-DD-HHmm>.csv` in event time.

#### Scenario: File name and headers
- **WHEN** an organizer downloads Pongal 2027 responses at 8:15 AM ET on Nov 21, 2026
- **THEN** the response has `Content-Disposition: attachment; filename="pongal-2027-responses-2026-11-21-0815.csv"` and `Cache-Control: no-store`

#### Scenario: Removed responses excluded
- **GIVEN** 2 active and 1 removed response
- **WHEN** the CSV is downloaded
- **THEN** it has a header row and exactly 2 data rows

#### Scenario: No responses yet
- **WHEN** the CSV is downloaded before anyone responded
- **THEN** it contains only the header row

#### Scenario: Unknown event
- **WHEN** an organizer requests `/admin/events/diwali-1999/responses.csv`
- **THEN** the response is `404` with "Sorry, we couldn't find that page."

#### Scenario: Tamil name in Excel
- **GIVEN** a response from `பிரியா Raman`
- **WHEN** the CSV is opened in Excel by double-click
- **THEN** the name shows as `பிரியா Raman`

### Requirement: CSV columns
The header row SHALL be, in order: "Submitted (ET)", "Last updated (ET)", "Name", "Email", "Mobile", one likelihood column per event day labelled with the day label, one column per headcount band labelled with the band label, "Total people", one "Weighted <day label>" column per event day, "Food", "Volunteer roles", "Cultural performance", "Contribution per adult", "Comments". Values MUST use the configured labels, not codes.

#### Scenario: Pongal 2027 row
- **GIVEN** Priya submitted at 9:02 PM ET on Nov 20, 2026 with mobile `+16175550123`, Saturday = Definitely, Sunday = Maybe, 2 adults & kids 11+, 1 kid 5-10, 1 kid under 5, food Veg, roles Food Serving and Cleanup, cultural Yes, contribution $20, no comments
- **WHEN** the CSV is downloaded
- **THEN** her row reads `2026-11-20 21:02,2026-11-20 21:02,Priya Raman,priya@example.com,617-555-0123,Definitely,Maybe,2,1,1,4,4.00,1.60,Veg,Food Serving; Cleanup,Yes,$20,`

#### Scenario: Day not selected
- **WHEN** a family selected only Sunday
- **THEN** its Saturday likelihood cell is empty and its "Weighted Saturday, Jan 16" cell is `0.00`

### Requirement: Weighted headcount per day
For each event day, the weighted value SHALL be total people multiplied by the configured weight of that day's likelihood (Definitely 1.0, Likely 0.75, Maybe 0.4), shown with two decimals, and `0.00` when the day was not selected.

#### Scenario: Likely on Saturday
- **WHEN** a family of 4 chose Saturday = Likely
- **THEN** "Weighted Saturday, Jan 16" is `3.00`

### Requirement: Protection against spreadsheet formulas
Any cell value that starts with `=`, `+`, `-`, `@`, a tab or a carriage return MUST be prefixed with a single quote `'` so spreadsheet programs treat it as text.

#### Scenario: Formula in comments
- **GIVEN** a response with comments `=HYPERLINK("http://evil.example","Click")`
- **WHEN** the CSV is downloaded
- **THEN** the comments cell value starts with `'=HYPERLINK(`

#### Scenario: Comment with comma, quote and newline
- **GIVEN** comments `We'll bring "kolam" supplies,\nthanks`
- **WHEN** the CSV is downloaded
- **THEN** the cell is quoted as `"We'll bring ""kolam"" supplies,\nthanks"` and the row count is unchanged

#### Scenario: Comment starting with a dash
- **GIVEN** comments `- veg only please`
- **WHEN** the CSV is downloaded
- **THEN** the cell value is `'- veg only please`
