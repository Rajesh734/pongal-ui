## Why

Page-level messages such as "An active registration already exists for this household and event." render as plain, unstyled text. Visitors cannot tell that their action failed. Success and failure messages also look identical.

## What Changes

- Page-level messages get a visible callout style: red with a warning marker for errors, green for confirmations.
- Pages that can show a failure message (registration status, check-in, check-in access, payments) mark it as an error, so a failed action is never styled as a success.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `site-theme`: adds a requirement for distinguishable error and success message callouts.

## Impact

- `src/public/css/site.css` (new `.notice` styles)
- Views: `registration/status.eta`, `registration/check-in.eta`, `admin/check-in-access.eta`, `admin/payments.eta`
- Routes that render failures with a 4xx status pass that status through so views can pick the error style
