# Local test database (Windows, no Docker)

A stand-in for the Supabase test project, on this PC only: Postgres + PostgREST + a small fake login server.
First time only: `cd tests/localdb` then `npm install`, then `cd ../..` (PostgREST downloads itself on first start).
1. Start it (leave that terminal open): `node tests/localdb/start.mjs --instances 1` (add `--fresh` to empty the databases)
2. Point the tests at instance 1: `node tests/localdb/env.mjs 1` (writes `.env.testdb.local`; `env.mjs 2 <folder>` for another copy)
3. Run the tests: `npm run test:chat`
4. Stop it: Ctrl+C in that terminal, or `node tests/localdb/stop.mjs`
Each instance has its own database, so several test runs can go at once (instance n is at http://127.0.0.1:(25400 + n)).
Logs are in `tests/localdb/.data/`. Keys and passwords in `config.mjs` are made up and only work here.
