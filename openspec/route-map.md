# Route Map

Source of truth: `src/modules/*/routes.js`, `src/core/health.js`, `src/server.js`. Every state-changing form carries a CSRF token. Admin routes live under `/admin` behind Cloudflare Access (local development may use `ADMIN_DEV_EMAIL`).

## Public
| Method | Path | Purpose | Capability |
|---|---|---|---|
| GET | `/` , `/about` | Home and about pages | community-portal |
| GET | `/healthz` | Liveness and database check | platform-runtime |
| GET | `/robots.txt` | Crawler rules | platform-runtime |
| GET, POST | `/s/:event` | Interest survey form and submit | interest-survey, form-abuse-protection |
| GET, POST | `/s/:event/edit/:token` | Edit a survey response from the emailed link | survey-edit-link |

## Accounts
| Method | Path | Purpose | Capability |
|---|---|---|---|
| GET | `/signup`, `/login` | Sign-up and sign-in pages | household-authentication |
| POST | `/api/auth/signup`, `/api/auth/login`, `/api/auth/google`, `/api/auth/logout` | Authentication | household-authentication |
| GET | `/auth/verify/:token` | Verify email | household-authentication |
| GET, POST | `/account/profile`, `/api/auth/profile` | View and update household profile | household-authentication |
| GET | `/account/registrations` | List own registrations | event-registration |

## Registration
| Method | Path | Purpose | Capability |
|---|---|---|---|
| GET, POST | `/register` | Registration form and submit | event-registration |
| GET | `/register/access/:token` | Registration status, payment instructions, QR pass | event-registration |
| POST | `/register/access/:token/payment` | Mark the Zelle payment as sent | event-registration |
| GET, POST | `/register/edit/:token` | Edit a registration | event-registration |

## Check-in (signed-in volunteer with permission)
| Method | Path | Purpose | Capability |
|---|---|---|---|
| GET | `/check-in` | Scan page | event-check-in |
| POST | `/check-in/preview`, `/check-in/confirm` | Validate a pass, then confirm entry | event-check-in |

## Admin (`/admin`)
| Method | Path | Purpose | Capability |
|---|---|---|---|
| GET | `/admin` | Dashboard | organizer-operations |
| GET | `/admin/registrations`, `/admin/registrations.csv` | Registration list and attendee-level CSV export (`?event=&status=`) | organizer-operations |
| GET | `/admin/payments` | Pending payments | organizer-operations |
| POST | `/admin/payments/:registrationId/confirm` | Confirm payment and issue pass | organizer-operations |
| GET | `/admin/volunteers` | Volunteer roster | organizer-operations |
| GET | `/admin/check-in-access` | Who may scan passes | organizer-operations |
| POST | `/admin/check-in-access/grant`, `/admin/check-in-access/:permissionId/revoke` | Grant or revoke scan access (grant also accepts `from=volunteers`, used by the Volunteers page buttons) | organizer-operations |
| GET | `/admin/events/:event/responses.csv` | Survey CSV export (active responses, oldest first) | survey-csv-export, admin-access |

Static assets: `/public/*`, `/shared/*` (Zod schemas shared with the browser), `/vendor/*`.
