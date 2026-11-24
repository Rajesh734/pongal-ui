# entry-pass Specification

## Purpose

Defines the entry pass (QR code) issued when a registration's payment is confirmed: what the code contains, how it is stored, and when it is shown or revoked.

## Requirements

### Requirement: Pass issued on payment confirmation
The system SHALL issue exactly one entry pass per registration when an organizer confirms its payment, and MUST NOT issue a pass for a registration whose payment is pending or whose registration is cancelled.

#### Scenario: Payment confirmed
- **GIVEN** a registration in `payment_pending`
- **WHEN** an organizer confirms the Zelle payment
- **THEN** the registration becomes `confirmed`, one pass is issued, and the registration status page shows the QR code

#### Scenario: Payment still pending
- **WHEN** a household opens a `payment_pending` registration
- **THEN** no QR code is shown

### Requirement: Opaque pass content
The QR code SHALL encode only a random token of 32 bytes (URL-safe base64, 43 characters). It MUST NOT contain names, emails or other personal data.

#### Scenario: Scan content
- **WHEN** a QR code is decoded
- **THEN** the text is a 43-character URL-safe token with no personal data

### Requirement: Protected pass storage
The database SHALL store the SHA-256 hash of the token for lookup, and the token itself only encrypted (AES-256-GCM with a random 12-byte IV, an authentication tag and a key version) so the household can view its QR again. The encryption key MUST come from the environment as 32 bytes of canonical base64, and the application MUST refuse to start when it is missing or malformed.

#### Scenario: Wrong key
- **WHEN** a stored pass is decrypted with a different key or its ciphertext was altered
- **THEN** decryption fails and no QR code is shown

#### Scenario: Unsupported key version
- **WHEN** a stored pass has a key version the application does not support
- **THEN** decryption fails with an "Unsupported QR pass key version" error

### Requirement: Single use and revocation
A pass SHALL admit its household once. A scan of a recognized pass MUST be reported as "already checked in" after the first successful check-in, and a revoked pass MUST be reported as not recognized.

#### Scenario: Second scan
- **GIVEN** a pass already checked in
- **WHEN** a volunteer scans it again
- **THEN** the result reads "This household was already checked in."

#### Scenario: Unknown code
- **WHEN** a volunteer scans an unrecognized code
- **THEN** the result reads "Pass not recognized. Check the QR code or ask an organizer for help."
