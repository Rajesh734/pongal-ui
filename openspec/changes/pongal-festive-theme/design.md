# Design

## Context

See proposal.md for motivation and specs/site-theme/spec.md for behaviour. Current state: survey views (`layout.eta`, `form.eta`, `confirmation.eta`, `message.eta`) render one 40rem column; `site.css` is mobile-first with no wide-screen rules. The CSP allows only same-origin scripts (plus Turnstile) and `style-src 'self' https: 'unsafe-inline'`; `img-src 'self' data:`. There is no image asset yet. The Pongal 2027 survey is live, so changes must not alter field names, values or messages that tests and the server rely on.

## Goals / Non-Goals

**Goals:**
- One theme mechanism that later events (Diwali, Tamil New Year) can reuse by adding artwork and a theme name.
- Realistic artwork that feels like the provided certificate/banner and remains small enough for phones on WhatsApp.

**Non-Goals:**
- A component library, CSS framework or build step.
- Changing form names, values or server validation.

## Decisions

### D1. Theme chosen in event config
Event YAML gets an optional `theme` validated as an enum (`pongal` only for now); `pongal-2027.yaml` sets `theme: pongal`. The layout includes `views/themes/<theme>/banner.eta` when the event has a theme.
- *Theme by date or slug* - rejected: hidden coupling; config is already the source of event settings.
- *Global theme for the whole site* - rejected: the site will host other events.

### D2. Supplied artwork with HTML overlay
Use the supplied realistic banner as the production artwork and derive two optimized assets: `pongal-hero-desktop.webp` and `pongal-hero-mobile.webp`. `banner.eta` uses a `<picture>` element with the portrait source below 768 px and desktop source above it, then places the event greeting and name in an HTML overlay. This keeps Tamil text sharp and avoids baking a stale year into the image.
- *Hand-drawn SVG as the primary hero* - rejected: the browser review showed it looked like children's artwork rather than a realistic celebration.
- *External image URL* - rejected: adds an availability, privacy and CSP dependency.
- *Text baked into the image* - rejected: cannot update the year or remain accessible/selectable.
- *One image for every viewport* - rejected: the tall mobile crop makes the desktop banner huge and the wide desktop crop loses the pot on phones.

### D3. Site identity in one module
`src/core/site.js` exports `SITE_NAME = 'Eastcoast Tamil Community'`, `SITE_LOCATION = 'New Hampshire, USA'` and a `logoPath` resolved once at startup: `/public/img/logo.svg` if it exists under `src/public/img/`, else `/public/img/logo.png` if that exists, else `null`. A shared `views/partials/site-header.eta` renders it; the logo is shown at most 56 px high and is expected on a transparent background.

The organizers' logo arrived as a 1024×1536, 3.6 MB PNG with a yellow background, then as a transparent PNG (477×1029) and an SVG (15 KB, vector paths only). The SVG is served (it wins over the PNG); the fallback `src/public/img/logo.png` is the transparent PNG resized to 168 px tall (3× display height) with `sips`, kept under 50 KB. Originals live in `assets/` (`logo-original.png`, `logo-transparent-original.png`), outside `src/`, so they are not in the Docker image. The black logo sits on a small turmeric rounded badge so it stays visible on the maroon header.
- *Environment variable* - rejected: the name is content, not deployment configuration, and should be in code review.
- *Per-event organizer setting* - rejected: one organization runs the site.

### D4. Bilingual section cards in the form view
`form.eta` wraps fields in four `<section class="card">` elements with `<h2><span lang="ta">…</span> · <span>…</span></h2>`. Heading texts live in `survey-messages.js` so tests use the exact strings. Field markup, names and order are unchanged.

### D5. Responsive CSS with custom properties
`site.css` defines the palette as CSS variables (`--turmeric #f2b705`, `--cane #2f7d32`, `--kumkum #c62828`, `--maroon #6d1b1b`, `--cream #fff8e7`, text `#2b1d0e`), keeps the mobile-first base, and adds:
- `min-width: 40rem`: choice lists become a 2-column grid; headcount fields sit in a row.
- `min-width: 64rem`: page max-width 60rem (960 px), banner shows the full scene, volunteer roles use 4 columns, cards get padding and shadow.
- A kolam-pattern border drawn with an inline SVG data URI in CSS (`img-src data:` is already allowed).
Text on coloured surfaces uses maroon or white pairings checked at ≥ 4.5:1.
- *CSS framework (Tailwind, Bootstrap)* - rejected: build step or large download for one page.

### D6. Motion with CSS only
Steam paths animate with `@keyframes` (opacity and translateY, 4-6 s loops); the pot's boil-over foam bobs slightly. Everything sits inside `@media (prefers-reduced-motion: no-preference)` so reduced-motion devices get static art by default.
- *JS/Lottie animation* - rejected: extra scripts and CSP surface.

### D7. Tamil text rendering
Tamil uses the system font stack (`"Noto Sans Tamil", "Tamil Sangam MN", "Latha", system-ui`), no web font, so no outside requests. Tamil spans carry `lang="ta"`.

## Risks / Trade-offs

- [The supplied image contains baked-in wording] -> Use it only as visual artwork; render the 2027 greeting and event name in HTML over the image.
- [A large realistic image slows WhatsApp visitors] -> Require each optimized same-origin asset to be at most 250 KB and verify dimensions and file size.

### D8. Build summary gives deploy-ready values
The Build workflow writes a Markdown section containing `IMAGE_REF=ghcr.io/rajesh734/pongal-ui/community-site:sha-<7-char-commit>` and `image_tag=sha-<7-char-commit>`. The full reference is for inspection and the exact `image_tag` value is copyable into the manual Deploy workflow; no secrets are printed.
- *Only print the commit SHA* - rejected: the operator must reconstruct the GHCR reference manually.
- *Only print the full image reference* - rejected: the manual workflow input expects the tag without the registry/repository.
- [Tamil wording errors] -> The exact strings are in the spec; organizers proof-read them in review.
- [Older Android without a Tamil font] -> Very rare today; text falls back to the system's Tamil font, and English headings are always present.
- [Live survey disruption] -> Only markup structure around fields and CSS change; the existing page tests must keep passing unchanged.

## Migration Plan

1. Merge and deploy as usual; no data or setting changes are needed besides `theme: pongal` already in the committed YAML.
2. To add the logo: save a transparent `logo.png` (or `logo.svg`) in `src/public/img/`, commit, deploy.
3. Rollback: redeploy the previous image tag.
