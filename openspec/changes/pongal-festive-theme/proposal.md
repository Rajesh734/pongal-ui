# Proposal

## Why

The survey pages work but look plain, and on a laptop they show one narrow column in a large empty page, with every option stacked in a long list. Families open the link from WhatsApp invitations for a festival; the page should feel like Pongal and should look deliberate on phones and laptops alike, while the survey is still open (closes Tue, Nov 24).

## What Changes

- **Add** a site header with the organization name "Eastcoast Tamil Community", the location "New Hampshire, USA", and the organization's logo once the organizers add the logo file (transparent PNG or SVG).
- **Add** two optimized artwork-only Pongal hero images derived from the supplied realistic banner: a desktop hero and a portrait mobile hero. The page renders the correct Tamil greeting and year as HTML over the images.
- **Add** subtle motion (steam and the pot boiling over) that stops when the visitor's device asks for reduced motion.
- **Change** the survey form into four section cards with bilingual headings (Tamil and English): About you, Attending, Food & helping, Finish.
- **Change** the layout for wider screens: a wider centred page, section cards, and option lists in two to four columns, without losing the phone layout.
- Apply the theme to the survey form, edit form, confirmation page and survey messages (not open, closed, invalid link).
- **Change** the Build workflow summary to print the full GHCR image reference and the exact `image_tag=sha-<commit>` value required by the manual Deploy workflow.

## Capabilities

### New Capabilities

- `site-theme`: How public pages look: the site header and logo slot, per-event festive theme and artwork, bilingual section headings, responsive layout from phone to laptop, motion and accessibility limits of the decoration.

### Modified Capabilities

_None._ The survey's fields, messages and validation do not change. Phone usability stays as required by `interest-survey` (change `pongal-2027-interest-survey`, not yet archived).

## Impact

- Survey views (`src/modules/survey/views/`), new artwork partials, `src/public/css/site.css`.
- Event config gets an optional `theme` setting; `config/events/pongal-2027.yaml` sets `theme: pongal`.
- No runtime image-generation dependency, no external image URLs, no database changes, no CSP changes. The supplied artwork is optimized offline and checked into `src/public/img/`.
- Depends on change `pongal-2027-interest-survey`.

## Out of Scope

- Other photos, web fonts, dark mode, a theme editor, and runtime calls to an image-generation API.
- Admin pages (change `admin-csv-export`).
- Changing any survey question, message or validation rule.
- The logo file itself (added later by the organizers).
