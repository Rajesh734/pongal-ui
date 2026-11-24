## Context

See proposal.md - Why. All page messages use `<p class="notice">`, which had no CSS. The `role` attribute (`alert` vs `status`) is already used to mark error vs informational messages on some pages.

## Decisions

- **Style by `role`**: `.notice` is the green default; `.notice[role="alert"]` is the red error variant with a warning glyph. No new class names, so existing views that already use `role="alert"` (login, registration form) are fixed without edits. Alternative: an explicit `notice--error` class - rejected as redundant with `role`.
- **Views that mix success and failure** (registration status, check-in, check-in access, payments): the route already renders failures with a 4xx status, so the view receives that status and sets `role="alert"` only when the status is 4xx. Alternative: always `alert` - rejected because it would style confirmations as errors.

## Risks / Trade-offs

- A glyph via CSS `::before` is decorative only; the message text and `role` carry the meaning.
