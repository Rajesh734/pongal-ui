# Reset the non-prod database

Use this procedure only when you intentionally want a clean test database. It permanently deletes application data from `samugam_nonprod`; there is no undo unless you separately restore a backup. It does not create a backup.

The database schema and Drizzle migration history are retained. The app reapplies configured event data when it starts. Production uses a separate database named `samugam`; do not run this procedure in the production folder or against that database.

## Reset

Run these commands on the NAS. Stop the non-prod app first so it cannot write while the database is being cleared:

```sh
cd /volume1/platform/docker/non-prod/community-site
sudo docker stop community-site-non-prod
```

Clear every table in the app's `public` schema. The database-name check makes the SQL fail rather than truncate a database with any other name:

```sh
sudo docker exec -i kalanjiyam sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d samugam_nonprod' <<'SQL'
DO $$
BEGIN
  IF current_database() <> 'samugam_nonprod' THEN
    RAISE EXCEPTION 'Refusing to reset unexpected database: %', current_database();
  END IF;
END $$;

DO $$
DECLARE
  public_tables text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
    INTO public_tables
    FROM pg_tables
    WHERE schemaname = 'public';

  IF public_tables IS NULL THEN
    RAISE EXCEPTION 'No public tables found; refusing reset';
  END IF;

  EXECUTE 'TRUNCATE TABLE ' || public_tables || ' RESTART IDENTITY CASCADE';
END $$;
SQL
```

Restart the app after the SQL command finishes, including if it reports an error, so the website is not left offline:

```sh
sudo docker start community-site-non-prod
sleep 5
sudo docker inspect community-site-non-prod \
  --format 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'
curl -i --max-time 10 http://localhost:3101/healthz
```

The container should be running and `/healthz` should return HTTP 200 with `{"status":"ok","db":"ok"}`. If it is stopped or unhealthy, inspect its startup logs on the NAS and follow the [NAS recovery runbook](2026-11-22-turnstile-nas-recovery.md). Review and redact private settings before sharing logs.
