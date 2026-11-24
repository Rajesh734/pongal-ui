# Tasks

## 1. Theme setting and site identity

- [x] 1.1 Add optional `theme` (enum `pongal`) to the event config schema and set `theme: pongal` in `config/events/pongal-2027.yaml`; add tests for scenarios "Event without a theme" (config without `theme` loads) and "Invalid theme in config" (error names the file and `theme`); verify they pass
- [x] 1.2 Add `src/core/site.js` (site name, location, logo lookup per design D3) and a shared site header partial used by the survey layout; add tests for scenarios "No logo yet", "Logo added" and "Both formats present" (temporary logo files in a test image folder); verify they pass
- [x] 1.3 Move the organizers' original logo to `assets/logo-original.png` and serve a 168 px tall copy per design D3; add a test for scenario "Logo is light" (served file ≤ 50 KB, height ≤ 168 px); verify it passes

## 2. Realistic Pongal hero

- [x] 2.1 Derive two optimized artwork-only WebP assets from the supplied banner, `pongal-hero-desktop.webp` and `pongal-hero-mobile.webp`, under `src/public/img/`; verify each is at most 250 KB and the page does not load the original large PNG
- [x] 2.2 Replace the hand-drawn SVG banner with a `<picture>` hero and accessible HTML overlay for the greeting and event name; add tests for scenarios "Pongal 2027 hero" and "Screen reader"; verify they pass
- [x] 2.3 Add responsive source switching and cropping with the pot and sugarcane visible at 360, 768 and 1440 px; verify no overlap or distortion in browser screenshots
- [x] 2.4 Remove the visible SVG motif composition and its motion from the hero path; keep reduced-motion coverage for any remaining decorative motion; verify no running hero animations under reduced motion

## 3. Layout and sections

- [x] 3.1 Group the form into the four bilingual section cards per design D4 with heading texts in `survey-messages.js`; add a test for scenario "Section headings" and keep the existing "Pongal 2027 form" field-order test passing unchanged for scenario "Field order unchanged"; verify all tests pass
- [x] 3.2 Rewrite `site.css` with the palette and breakpoints per design D5; verify scenarios "Laptop", "Tablet" and "Small phone" with a browser script at 360, 768, 1440 and 1920 px (no horizontal scroll, content ≤ 960 px, roles in ≥ 2 columns at 1440, tap targets ≥ 44 px), and verify palette text pairs reach 4.5:1 with a contrast calculation recorded in the PR
- [x] 3.3 Apply the theme to the confirmation, edit and message pages; add tests for scenarios "Confirmation page themed" and "Closed page themed", and check the 404 page still renders without the theme; verify they pass
- [x] 3.4 Verify scenario "No outside requests" in a browser with Turnstile unset (network log shows only same-origin requests), and take screenshots at 360 px and 1440 px for the organizers to review the look and the Tamil wording
- [x] 3.5 Update `.github/workflows/build.yml` so the Build summary prints the full `IMAGE_REF=ghcr.io/...:sha-<7-char-commit>` and copyable `image_tag=sha-<7-char-commit>`; verify both values match the pushed image and the manual Deploy input

## Workflow follow-up

- [x] Replace the raster hero with a compact inline-SVG Pongal banner and add a subtle transparent logo watermark without obscuring content.
- Organizers review the screenshots and Tamil text before merge.
- Archive after `pongal-2027-interest-survey` is archived.
