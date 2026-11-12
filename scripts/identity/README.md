Current approval packet: [TWO-STAGE-RELEASE.md](../../docs/identity/TWO-STAGE-RELEASE.md). Stage 2 uses prepare-stage2.py and test-privacy-release.py with a separate synthetic PostgreSQL fixture. No aliases are created; the legacy script name test-alias-api.py now tests email-input rejection.

# Isolated identity release gates

These scripts never select a production connection. Test scripts use the managed local Docker socket, fixed `freeupper-identity-postgres` container and `freeupper_gates` database; HTTP targets are localhost only. They create synthetic users and fault-inject defaults **only in that disposable database**. Do not adapt them to production.

The protected production catalog snapshot and migration-history snapshot are outside Git at `/workspace/freeupper-validation/release-gates/`. They include no application rows. Use a fresh authoritative schema capture when repeating the work; stale staging is not a baseline.

Run order after provisioning disposable PostgreSQL/Auth with generated local-only credentials:

1. Initialize GoTrue's empty Auth schema.
2. `restore-production-schema.py <catalog-snapshot.json> --output <restore.sql>`; apply the output only to the disposable database. It restores application DDL and source grants/defaults, not production rows or managed service credentials.
3. `test-release-gates.py`: requires the empty pre-identity application restore; tests real Auth and applies the new schema migration locally. Reset only the disposable database before rerunning.
4. Start localhost PostgREST with public as its only exposed schema and the local Auth JWT secret. Run `test-alias-api.py`.
5. Run `test-collision-race.py` to observe real lock contention and retries. Its fault injector is removed in `finally`; it is not an application ID system.
6. Configure local Auth to require confirmation with local Mailpit SMTP, then run `test-email-confirmation.py`. It never sends mail externally and never prints tokens.
7. `prepare-release.py <history-snapshot.json> --output <release.sql>` only writes a guarded artifact; it never executes SQL. Execution requires separate explicit release approval.

The release artifact is tested separately against a second empty local restore and a copy of the **history metadata**, not production rows. Official Supabase linter SELECT queries are run locally; the production Supabase adviser tool is read-only. Full evidence and version limitations are in `docs/identity/RELEASE-READINESS.md`.
