# Spec Delta

## Purpose

Defines how community events (one per year's celebration) and their survey settings are described in configuration files, validated, stored for history, and used to decide whether a survey is open.

## ADDED Requirements

### Requirement: Events defined in configuration files
The system SHALL load every `config/events/*.yaml` file at startup. Each file MUST define a unique slug, name, timezone, one or more event days, and the survey settings: open and close date-times, closed message, likelihood weights, headcount bands, total-people limit, food options, volunteer roles, cultural options, contribution options and comment length limit.

#### Scenario: Valid event file
- **GIVEN** `config/events/pongal-2027.yaml` with slug `pongal-2027`, timezone `America/New_York`, days `2027-01-16` and `2027-01-17`
- **WHEN** the server starts
- **THEN** event `pongal-2027` is available with two days labelled "Saturday, Jan 16" and "Sunday, Jan 17"

### Requirement: Invalid event files stop startup
The system MUST stop at startup when an event file is invalid, naming the file and the problem.

#### Scenario: Close before open
- **GIVEN** `pongal-2027.yaml` has `survey.opens_at: 2026-11-24T23:59` and `survey.closes_at: 2026-11-20T20:00`
- **WHEN** the server starts
- **THEN** it exits with code 1 and logs "config/events/pongal-2027.yaml: survey.closes_at must be after survey.opens_at"

#### Scenario: Unknown timezone
- **GIVEN** an event file with `timezone: America/Chennai`
- **WHEN** the server starts
- **THEN** it exits with code 1 and logs "config/events/pongal-2027.yaml: timezone 'America/Chennai' is not a valid IANA timezone"

#### Scenario: Duplicate slug
- **GIVEN** two event files both declare slug `pongal-2027`
- **WHEN** the server starts
- **THEN** it exits with code 1 and logs "Duplicate event slug 'pongal-2027' in config/events/a.yaml and config/events/b.yaml"

#### Scenario: Duplicate option code
- **GIVEN** an event file lists volunteer role code `cleanup` twice
- **WHEN** the server starts
- **THEN** it exits with code 1 and logs "config/events/pongal-2027.yaml: duplicate code 'cleanup' in survey.volunteer_roles"

### Requirement: Events seeded and snapshotted in the database
At startup the system SHALL create or update each configured event and its days by slug, and SHALL store a snapshot of the event's configuration with it.

#### Scenario: First start
- **GIVEN** an empty database
- **WHEN** the server starts with `pongal-2027.yaml`
- **THEN** one `events` row with slug `pongal-2027` and two `event_days` rows exist, and `change_history` records action `create` with actor `system`

#### Scenario: Close time extended
- **GIVEN** event `pongal-2027` is stored with close time 2026-11-24 23:59 ET
- **WHEN** `survey.closes_at` is changed to `2026-11-25T23:59` and the server restarts
- **THEN** the stored close time is 2026-11-25 23:59 ET and `change_history` records action `update` with actor `system`

#### Scenario: Unchanged file
- **WHEN** the server restarts with an unchanged event file
- **THEN** no `change_history` row is written for that event

### Requirement: Past events kept when their file is removed
Removing an event file MUST NOT remove or change the stored event, its days or anything linked to it.

#### Scenario: File removed next year
- **GIVEN** event `pongal-2027` is stored and `pongal-2027.yaml` is deleted
- **WHEN** the server restarts
- **THEN** event `pongal-2027` and its responses still exist unchanged

### Requirement: Survey window state from event time
The system SHALL treat the survey as `not_open` before its open time, `open` from the open time until the close time, and `closed` at or after the close time. Times in the file SHALL be read as local times in the event's timezone.

#### Scenario: Before opening
- **GIVEN** `opens_at: 2026-11-20T20:00` in `America/New_York`
- **WHEN** the current time is 2026-11-21T00:59:00Z (7:59 PM ET)
- **THEN** the survey state is `not_open`

#### Scenario: Open
- **WHEN** the current time is 2026-11-21T01:00:00Z (8:00 PM ET)
- **THEN** the survey state is `open`

#### Scenario: Closed at exact close time
- **GIVEN** `closes_at: 2026-11-24T23:59`
- **WHEN** the current time is 2026-11-25T04:59:00Z (11:59 PM ET)
- **THEN** the survey state is `closed`
