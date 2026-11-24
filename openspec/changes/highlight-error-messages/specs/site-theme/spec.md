# Spec Delta

## ADDED Requirements

### Requirement: Highlighted page messages
Every page-level message SHALL appear in a bordered, tinted callout. A message reporting a failed or rejected action MUST be styled as an error (red tones plus a warning marker, so it does not rely on color alone) and announced to assistive technology as an alert. A confirmation or informational message MUST be styled distinctly (green tones) and MUST NOT use the error style.

#### Scenario: Duplicate registration is rejected
- **GIVEN** a household already has an active registration for the event
- **WHEN** it submits another registration
- **THEN** the message "An active registration already exists for this household and event." is shown in the error callout at the top of the page

#### Scenario: Confirmation message
- **GIVEN** an organizer confirms a payment
- **WHEN** the payments page reloads
- **THEN** "Payment confirmed and entry pass issued." is shown in the success callout, not the error callout
