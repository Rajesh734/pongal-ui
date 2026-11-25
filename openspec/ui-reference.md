# UI Reference

Complements `route-map.md` (routes) and `architecture.md` (palette, header, assets). All strings are English keys passed through `t()` and translated from `src/shared/i18n/catalogs/`. Layout template: `src/modules/survey/views/layout.eta` (shared by every module).

## Page shell (every page)
1. `<html lang>` = active locale; viewport meta; favicon `/public/img/favicon.svg`; stylesheet `/public/css/site.css`.
2. Header (`partials/site-header.eta`): hamburger menu (`<details>`), brand block (logo, site name, location, logo again decorative), account menu (`<details>`, person icon). A desktop nav row repeats the menu links.
   - Public links: Home `/`, About `/about`, Register `/register`.
   - Admin links (when under `/admin`): Dashboard, Registrations, Payments, Volunteers, Check-in Access, Scan Passes `/check-in`, Public site.
   - Account menu signed out: Sign in, Sign up. Signed in: household name, Profile, My Registrations, Scan Passes (only if `canCheckIn`), Log out (POST with CSRF).
3. Language bar (not on admin pages): "Language:" plus links `?lang=en|ta|te|kn|ml`, each in its own language; current one has `aria-current`.
4. Pongal banner (theme `pongal`): inline SVG art composed by `themes/pongal/banner.eta`.
5. `<main class="page">` with a `.card` section; then `navigation.js` and `form-validation.js` modules.

## Common form conventions
- Hidden `_csrf` input on every POST; forms use `novalidate data-validate-on-blur`.
- Field errors: `<p class="field-error" role="alert">` under the field; page-level message: `<p class="notice" role="alert|status">`.
- Fieldsets with `label`s, 44px tap targets, numbered section headings (`.step`).
- Phone entry: country-code select (default +1, with an "other" code input) plus a 10-digit national number; stored as E.164.

## Pages
| Page | Content, in order |
|---|---|
| Home `/` | Event name `h1`; "Celebrate Pongal with the Eastcoast Tamil Community."; "Register once for your household and add the family members who will attend."; primary button "Register your household" to `/register` |
| Registration `/register` | Intro "Register your household for {event}. Payment is completed separately by Zelle." Step 1 Contact details (email, mobile, optional WhatsApp with "same as mobile" checkbox and consent). Step 2 Attendees: first is "Primary contact and attendee 1" (full name, fixed age 11+, price shown); others "Attendee {n}" with name, age group on event date (11+, 5-10, 0-4, each with price or "Free"), "Willing to volunteer" and a role checkbox grid; add and remove attendee buttons via a `<template>`. Later steps cover cultural performances (title, participants, duration, compere introduction) and a live total |
| Registration status `/register/access/:token` | Registration summary (household, attendees with age labels, performances, "Total due: {amount}"). Payment pending: Zelle instruction naming the phone number and family reference, a payment form (payer name, Zelle reference, "I sent this payment", "Submit payment details"), and a "Save registration and pay later" button. After declaring: "Payment marked as sent. Do not pay again." Confirmed: "Payment confirmed. Your Pongal entry pass is ready." and a 240x240 QR image captioned "Show this pass at event check-in." |
| Survey `/s/:event` | Interest form from the event config (days with likelihood, headcount bands, food, cultural, contribution, volunteer roles, comments, consent); closed state shows `closed_message` |
| Sign in / Sign up | Email and password plus Google button when configured; email-verification message pages |
| Profile, My Registrations | Household details form; list of own registrations with status |
| Check-in `/check-in` | Camera scanner (jsQR fallback), preview of the pass, then confirm entry |
| Admin dashboard `/admin` | Banner "Signed in as {email}", "Organizer dashboard" heading, a menu hint paragraph, a collapsed "Legacy interest survey" block with state, family count, people count and "Download CSV" per event |
| Admin Registrations, Payments, Volunteers, Check-in Access | Tables with filters (`?event=&status=`), CSV export, "Confirm payment" and grant/revoke buttons, as in `route-map.md` |
| Error and 404 | `core/views/error.eta`, translated message inside the same shell |

## Responsive behavior
Mobile first. The hamburger menu shows below the desktop breakpoint; the desktop nav row shows above it. The account icon stays top right at every width. Body text is 16px.
