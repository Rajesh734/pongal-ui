## 1. Notice styling

- [x] 1.1 Add `.notice` (success) and `.notice[role="alert"]` (error) styles in `src/public/css/site.css`. Verify: the duplicate-registration message renders as a red bordered callout.

## 2. Error vs success per page

- [ ] 2.1 Pass an `isError` flag (status >= 400) from `renderAccessStatus`, `renderCheckIn`, `checkInAccessPage` and the payments 409 render, and use it for `role` in `status.eta`, `check-in.eta`, `check-in-access.eta`, `payments.eta`. Verify: confirmation messages render green, failures render red.
- [ ] 2.2 Add/extend a route test asserting the duplicate-registration response contains `class="notice" role="alert"`, and a success message contains `role="status"`. Verify: `npm test` passes.
