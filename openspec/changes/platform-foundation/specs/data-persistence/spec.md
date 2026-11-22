# Spec Delta

## Purpose

Defines how community data is stored so it is kept permanently, audited on every change, and portable between the embedded development database and the production PostgreSQL server.

## ADDED Requirements

### Requirement: Database driver selected by configuration
The system SHALL use the embedded database when `DB_DRIVER=pglite` and a PostgreSQL server when `DB_DRIVER=postgres`, with no code change between them. Any other value MUST stop startup.

#### Scenario: Embedded database with persistent folder
- **GIVEN** `DB_DRIVER=pglite` and `PGLITE_DATA_DIR=/data/pglite`
- **WHEN** the server starts, saves a household, restarts and reads it back
- **THEN** the household saved before the restart is returned

#### Scenario: Embedded in-memory database for tests
- **GIVEN** `DB_DRIVER=pglite` and `PGLITE_DATA_DIR` is not set
- **WHEN** the server starts
- **THEN** it uses an in-memory database and logs "PGlite running in memory - data will not be kept"

#### Scenario: Unsupported driver
- **GIVEN** `DB_DRIVER=mysql`
- **WHEN** the server starts
- **THEN** it exits with code 1 and logs "Unsupported DB_DRIVER 'mysql'. Use 'pglite' or 'postgres'."

#### Scenario: PostgreSQL connection settings
- **GIVEN** `DB_DRIVER=postgres` and `DATABASE_PASSWORD` is not set by variable or file
- **WHEN** the server starts
- **THEN** it exits with code 1 and logs "Missing required setting: DATABASE_PASSWORD (set DATABASE_PASSWORD or DATABASE_PASSWORD_FILE)"

### Requirement: Schema migrations applied at startup
The system SHALL apply all pending schema migrations at startup before serving requests, and applying them again MUST change nothing.

#### Scenario: Fresh database
- **GIVEN** an empty database
- **WHEN** the server starts
- **THEN** all migrations are applied and the tables `households`, `events`, `event_days` and `change_history` exist

#### Scenario: Restart with no new migrations
- **GIVEN** a database where all migrations are already applied
- **WHEN** the server starts again
- **THEN** no migration runs and existing rows are unchanged

#### Scenario: Failed migration
- **WHEN** a migration fails
- **THEN** the server exits with code 1 without serving requests and the database is left at the last fully applied migration

### Requirement: Every data change is recorded in history
Every create, update, soft delete, restore and anonymize of community data MUST write one `change_history` row in the same transaction, holding the entity type, entity ID, action, a JSON snapshot of the row after the change, the actor and a UTC timestamp.

#### Scenario: Household created
- **WHEN** household `priya@example.com` is created by the public survey
- **THEN** `change_history` gains a row with entity type `household`, action `create`, actor `public`, and a snapshot whose `email` is `priya@example.com`

#### Scenario: Change fails
- **WHEN** an update fails after the row was changed but before history was written
- **THEN** neither the row change nor a history row is saved

### Requirement: Respondent data is never hard-deleted
The system MUST NOT physically delete household or response rows. Removal SHALL set `deleted_at`, and removed rows MUST be excluded from normal reads.

#### Scenario: Soft delete
- **WHEN** a response is removed
- **THEN** its row still exists with `deleted_at` set to the current UTC time, and it no longer appears in lists or counts

### Requirement: Emails stored case-insensitively
Emails SHALL be trimmed and stored in lower case, and two emails that differ only in letter case MUST identify the same household.

#### Scenario: Mixed-case email
- **GIVEN** household `priya@example.com` exists
- **WHEN** a lookup is made for `  Priya@Example.COM `
- **THEN** the existing household is found and no second household is created

### Requirement: Timestamps stored in UTC and shown in event time
All timestamps SHALL be stored as UTC instants and displayed in the event's timezone, defaulting to `America/New_York`.

#### Scenario: Display in event timezone
- **GIVEN** a response saved at `2026-11-21T01:30:00Z` for event `pongal-2027` with timezone `America/New_York`
- **WHEN** the time is shown to a user
- **THEN** it reads "Fri, Nov 20, 8:30 PM ET"

### Requirement: Nightly backup of the embedded database
When `DB_DRIVER=pglite` with a data folder, the system SHALL write a compressed backup of the database to `BACKUP_DIR` once a day at 02:00 event time, and SHALL keep only the 14 newest backups.

#### Scenario: Daily backup written
- **GIVEN** `BACKUP_DIR=/data/backups`
- **WHEN** the clock reaches 02:00 America/New_York on Nov 21, 2026
- **THEN** a file `pglite-2026-11-21.tar.gz` appears in `/data/backups`

#### Scenario: Retention
- **GIVEN** 14 backups already exist
- **WHEN** a new backup is written
- **THEN** the oldest backup is removed and 14 remain

#### Scenario: Backup fails
- **WHEN** writing a backup fails because the disk is full
- **THEN** the server keeps serving requests and logs "Nightly backup failed: <reason>" at error level
