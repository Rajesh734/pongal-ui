# Tasks: admin-csv-export

## 1. Access verification

- [x] 1.1 Add `jose` and implement the admin plugin with prefix `/admin` and the JWT `onRequest` hook per design D1-D3
- [x] 1.2 Write a test helper that generates an RSA key pair, serves a local JWKS and signs tokens; add `inject` tests for scenarios "Valid token", "No token", "Token for another application", "Expired token", "Forged token"; verify they pass
- [x] 1.3 Add tests for scenarios "Look-alike path", "Survey without token" and "Not configured"; verify they pass
- [x] 1.4 Add tests for scenarios "Cloudflare rotates keys" (JWKS server switches keys, one refetch) and "Key endpoint unreachable"; verify they pass

## 2. Admin home

- [x] 2.1 Implement `GET /admin` with per-event state, families, people and download link, plus the "Signed in as" banner; add tests for scenarios "During the survey" and "Signed-in banner"; verify they pass

## 3. CSV export

- [x] 3.1 Implement the CSV serializer with BOM, CRLF, quoting and the formula guard per design D4; add unit tests for scenarios "Formula in comments", "Comment with comma, quote and newline", "Comment starting with a dash"; verify they pass
- [x] 3.2 Implement the export query and row mapping (labels from config, mobile `617-555-0123`, ET timestamps, weighted values); add tests for scenarios "Pongal 2027 row", "Day not selected", "Likely on Saturday"; verify they pass
- [x] 3.3 Implement `GET /admin/events/:event/responses.csv` with headers and filename; add tests for scenarios "File name and headers", "Removed responses excluded", "No responses yet", "Unknown event"; verify they pass
- [ ] 3.4 Verify scenario "Tamil name in Excel" manually by opening an exported file with a Tamil test name in Excel (Mac or Windows) by double-click, and record the result in the PR

## 4. Runbook

- [x] 4.1 Add the Cloudflare Access section to `docs/deploy-nas.md` per design D6 (one-time PIN, optional Google, `/admin` path, 24h session, policy, AUD tag and team domain, `.env`, organizer 2-Step Verification, session revocation); verify each dashboard step against the live Zero Trust dashboard while doing task 5.1

## 5. Deploy and verify

- [x] 5.1 Create the Access application and Organizers policy in Zero Trust, then set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` in the NAS `.env` and restart; verify the startup log has no "Admin pages are disabled" warning
- [x] 5.2 From a private browser window, open `https://<host>/admin`; verify Cloudflare asks for an email, a non-listed email gets no code, and a listed organizer gets in and sees "Signed in as <email>"
- [x] 5.3 From a device on the NAS's Docker network (for example `docker compose exec community-site wget -S -O- localhost:3000/admin`), request `/admin` without a token; verify `403` and the text "You don't have access to this page."
- [ ] 5.4 Download the Pongal 2027 CSV after the first real responses arrive; verify it opens in Excel with correct columns, counts matching `/admin`, and no test response present
