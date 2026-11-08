# STRATA Runbook

Operating guide for the owner and whoever runs the stack. Release stage is **TESTNET** (D33). Nothing here starts mainnet; the mainnet steps are marked and need owner approval (D27).

Where things run (D25):

| Piece | Where | How |
|---|---|---|
| Web (`apps/web`) | Vercel project `strata-web` | Git push or `vercel deploy` by the orchestrator |
| API (`apps/api`) | Vercel project `strata-api` | Same |
| Agents, indexer, scorer, Telegram bot | Docker on the owner's Mac | `infra/compose/stack.yml`, `restart: always` |
| Prometheus, Grafana | Docker on the owner's Mac | Same file, always on |
| Database | Neon (production, D26); Timescale in Docker for local dev | `.secrets/neon_url` |

All commands below run from the repo root.

---

## 1. First-time setup

1. Install Docker Desktop and give it at least 4 GB of memory (Settings, Resources).
2. Install the tools: `brew install gitleaks shellcheck` (gitleaks is required by the pre-commit hook).
3. `pnpm install`. This also points git at the repo hooks (`git config core.hooksPath .githooks`).
4. Create the secrets folder: `infra/scripts/init-secrets.sh`. It never overwrites a file. It generates the machine-only secrets (`internal_kill_token`, `grafana_admin_password`, `db_password`) and creates empty placeholders for the ones you supply. An empty file means "not configured", and the services fall back safely: alerts go to logs only, the AI tuner stays in shadow mode.
5. Put the Neon connection string in `.secrets/neon_url` (one line, no quotes). Use your editor, not `echo`, so it never lands in shell history.
6. Generate testnet keys with `@strata/keys` (see `packages/keys`, D16, D28). Each key is an encrypted keystore at `.secrets/keystores/<name>.json` with its passphrase at `.secrets/<name>.pass` (mode 600). Expected names: `strata-test-1`, `strata-test-2`, `strata-test-3`, `strata-options`, `strata-testnet-attestor`.
7. Create a root `.env` (gitignored) with the non-secret settings compose reads:

   ```
   SCORER_API_BASE=https://<strata-api project>.vercel.app
   LOG_LEVEL=info
   KILL_SWITCH=false
   ```

### Secrets inventory

Every secret is a file under `.secrets/` (gitignored, folder mode 700, files mode 600). Compose mounts them read-only at `/run/secrets/<name>`; nothing secret is passed as an env var or baked into an image. Each agent container mounts only its own keystore and passphrase.

| File | Who creates it | Used by |
|---|---|---|
| `neon_url` | Owner (D26) | indexer, scorer, agents (as `database_url`) |
| `local_db_url` | Optional, local dev | same, when `STRATA_DB_URL_SECRET=local_db_url` is in `.env` |
| `db_password` | `init-secrets.sh` | local Timescale container |
| `telegram_bot_token` | Owner (D30), section 4 | all services, Telegram bot |
| `telegram_chat_ids` | Owner (D30), section 4 | all services, Telegram bot |
| `internal_kill_token` | `init-secrets.sh` | Telegram bot and agents (`/internal/kill`) |
| `anthropic_api_key` | Owner (D29), optional | agents (tuner; shadow mode when empty) |
| `grafana_admin_password` | `init-secrets.sh` | Grafana login `admin` |
| `keystores/<name>.json`, `<name>.pass` | `@strata/keys` | the one agent or scorer that owns the key |

---

## 2. Start, stop, inspect

```bash
# Start everything for testnet (builds images on first run)
docker compose -f infra/compose/stack.yml --profile testnet up -d --build

# Status and health
docker compose -f infra/compose/stack.yml --profile testnet ps

# Logs (JSON lines), one service or all
docker compose -f infra/compose/stack.yml logs -f --tail=200 agent-test-1
docker compose -f infra/compose/stack.yml --profile testnet logs -f --since=10m

# Restart one service (for example after changing a secret file)
docker compose -f infra/compose/stack.yml --profile testnet restart telegram-bot

# Stop everything. Agents get SIGTERM, cancel all orders, then exit (90 s grace).
docker compose -f infra/compose/stack.yml --profile testnet down
```

Never use `docker kill` or `down -t 0` on agents: it skips the cancel-all on shutdown. If you had to, check open orders on the explorer and cancel them by hand.

Dashboards: Grafana at http://127.0.0.1:3001 (user `admin`, password in `.secrets/grafana_admin_password`), folder STRATA, dashboard "STRATA Overview". Prometheus at http://127.0.0.1:9090 (Alerts tab shows rule state). Both bind to localhost only.

What each service exposes on the private compose network, port 9464: `/metrics` (Prometheus), `/healthz` (Docker healthcheck), and for agents `POST /internal/kill` (Telegram bot only). None of these are published to the host.

---

## 3. Keep the Mac awake

The agents only quote while the Mac runs. A sleeping Mac pauses Docker; the agents then miss cycles and stale orders may sit on the book until the next start cancels them.

1. System Settings, Battery (or Energy), Options: turn on "Prevent automatic sleeping on power adapter when the display is off". Keep the Mac on power.
2. System Settings, Lock Screen: set "Turn display off" to any value you like; the display can sleep, the system must not.
3. From a terminal, as a belt and braces measure while the stack runs:

   ```bash
   caffeinate -dimsu &        # prevents display, idle, disk and system sleep until killed
   ```

   Stop it later with `kill %1` or `pkill caffeinate`.
4. For an unattended machine, set it persistently (asks for your password):

   ```bash
   sudo pmset -c sleep 0 disksleep 0 standby 0 autorestart 1 womp 1
   pmset -g          # verify: sleep 0 on AC power
   ```

   `autorestart 1` powers the Mac back on after a power cut.
5. Docker Desktop, Settings, General: turn on "Start Docker Desktop when you sign in". Turn on automatic login for this user (System Settings, Users and Groups) only if the Mac is physically secure.
6. Turn off automatic macOS updates that restart the machine, or schedule them for a time you are around.

## 4. Restore after a reboot or power cut

`restart: always` brings every container back as soon as Docker Desktop is running. After a reboot:

1. Log in (or rely on automatic login) so Docker Desktop starts.
2. Wait about a minute, then check: `docker compose -f infra/compose/stack.yml --profile testnet ps`. All services should be `healthy`.
3. Agents that were killed before the reboot stay killed only if `KILL_SWITCH=true` is in `.env`; a Telegram kill is an in-memory latch and does not survive a container restart (check how the agent treats pending API kill commands before relying on that path). If you killed an agent for a reason that still holds, set `KILL_SWITCH=true` before the Mac comes back, or stop that service.
4. Check Grafana for data lag and that the agents report cycles. Start `caffeinate` again if you use it.

---

## 5. Telegram bot setup (owner, D30)

The bot sends the five alerts from PRD 15.3 (agent HALT, daily loss limit hit, tx failure spike, epoch post failure, data lag over 60 s) and accepts `/kill` from your chat only.

1. **Create the bot.** In Telegram, open a chat with `@BotFather` (check the blue verified tick). Send `/newbot`, pick a display name (for example `STRATA Ops`) and a username ending in `bot` (for example `strata_ops_xyz_bot`). BotFather replies with a token shaped like `123456789:AA...`. Treat it like a password.
2. **Lock it down.** Still in BotFather: `/setjoingroups`, choose your bot, `Disable` (nobody can add it to groups). Optional: `/setcommands` with:

   ```
   kill - cancel all orders and halt: /kill <agent|all> [close]
   status - list agents the bot can reach
   help - show commands
   ```
3. **Save the token.** Open `.secrets/telegram_bot_token` in your editor, paste the token on one line, save. Do not paste it into chat, a terminal command or a ticket.
4. **Get your chat id.** Send any message (for example `/start`) to your new bot. Then, in a terminal:

   ```bash
   curl -s "https://api.telegram.org/bot$(cat .secrets/telegram_bot_token)/getUpdates" | python3 -m json.tool | grep -A2 '"chat"'
   ```

   The `"id"` under `"chat"` is your chat id (a positive number for a private chat). Run this before starting the bot container; once the bot runs it consumes the updates.
5. **Save the chat id.** Put it in `.secrets/telegram_chat_ids`. Several owners: one id per line or comma separated. Every id on the list receives alerts and may send commands.
6. **Restart** so services pick up the files:

   ```bash
   docker compose -f infra/compose/stack.yml --profile testnet up -d --force-recreate
   docker compose -f infra/compose/stack.yml logs --tail=20 telegram-bot   # expect "telegram bot started"
   ```
7. **Test.** Send `/status` to the bot. It answers with the health of each agent. Send `/help` for the command list.

### How `/kill` works

- You send `/kill strata-test-1` or `/kill all`. Add `close` (`/kill all close`) to also close positions with reduce-only IOC orders.
- The bot (`packages/alerts`, container `telegram-bot`) is the only process that reads the bot's updates. It accepts a message only when both the chat id and the sender id are on `telegram_chat_ids`; anything else is ignored without a reply and logged.
- For each target it calls `POST http://<agent>:9464/internal/kill` on the private Docker network with `Authorization: Bearer <internal_kill_token>`. The agent cancels every order, optionally closes positions, records a guard event with reason `kill_switch_telegram`, and stays halted.
- The bot replies with `OK` or `FAIL` per agent. On any `FAIL`, use the env flag (section 6.3).
- There is no Telegram resume. Resuming means restarting the agent at the Mac, which is deliberate.

If the bot token leaks: in BotFather send `/revoke`, choose the bot, put the new token in `.secrets/telegram_bot_token`, restart the stack.

---

## 6. Kill switch procedures

Three independent paths (PRD 9.6). Use the fastest one you have; use more than one if unsure.

### 6.1 Telegram (fastest, from your phone)

`/kill all` (or `/kill <agent>`, optionally `close`). See section 5.

### 6.2 Signed API call (from anywhere with the owner wallet)

`POST https://<strata-api>/v1/admin/kill` with the `KillRequest` body from `packages/sdk/src/api.ts`: `target` (`"all"` or an agent id), `closePositions`, `network`, a random `nonce` (16 to 128 URL-safe chars), `expiresAt` (ms, at most 10 minutes ahead) and `signature`, an EIP-191 personal signature by `STRATA_OWNER_ADDRESS` over the exact message built by `killMessage` in `apps/api/src/admin/kill.ts`. The API verifies signer, expiry and single-use nonce, and records a kill command that agents pick up. Admin routes are off when `STRATA_OWNER_ADDRESS` is not set on the API project.

### 6.3 Env flag (at the Mac, works with no network to Telegram or the API)

```bash
# In the root .env
KILL_SWITCH=true
KILL_SWITCH_CLOSE=false     # true to also close positions reduce-only

docker compose -f infra/compose/stack.yml --profile testnet up -d --force-recreate agent-test-1 agent-test-2 agent-test-3 agent-options
```

Agents start, see the flag, cancel everything and stay halted. To resume later set `KILL_SWITCH=false` and recreate the agents.

### 6.4 Last resort

`docker compose -f infra/compose/stack.yml --profile testnet stop agent-test-1` sends SIGTERM, which runs cancel-all before exit. Then confirm on the explorer (testnet: https://testnet.blockscout.injective.network/) that no orders remain.

After any kill: check Grafana (Agents halted, Guard halts), read the agent logs, write what happened in `docs/STATUS.md`.

---

## 7. Rotating keys and secrets

General rule: write the new value to the file in `.secrets/`, then recreate the services that mount it. Never commit, paste or log a secret.

| What | How |
|---|---|
| Telegram bot token | BotFather `/revoke`, update `.secrets/telegram_bot_token`, `up -d --force-recreate` |
| Internal kill token | `rm .secrets/internal_kill_token && infra/scripts/init-secrets.sh`, then recreate agents and `telegram-bot` together |
| Grafana password | Change in Grafana (Profile, Change password) and update `.secrets/grafana_admin_password`; the file only applies to a fresh `grafana-data` volume |
| Neon URL | Reset the role password in the Neon console, update `.secrets/neon_url` and the API's `DATABASE_URL` on Vercel (`infra/vercel/push-env.sh`), recreate services |
| Anthropic key | Replace `.secrets/anthropic_api_key`, recreate agents |
| Agent trading key | Create a new keystore with `@strata/keys` under a new name, fund it, update the agent's mapping, recreate the agent, then move remaining funds out of the old address and delete its keystore and `.pass` file |
| Attestor key | Requires the arena owner to change `StrataArena.attestor()` (D21). Testnet: create a new keystore, set it on the arena, recreate the scorer. Mainnet: owner only |

If a secret may have leaked, rotate first and investigate after. If a trading key leaked, kill that agent (section 6), then move funds out with the owner wallet.

---

## 8. Secret scanning

- Pre-commit hook (`.githooks/pre-commit`) runs `gitleaks git --pre-commit --staged` and `scripts/check-copy.sh --staged`. Enabled by `pnpm install`. If it says gitleaks is missing: `brew install gitleaks`.
- CI (`.github/workflows/ci.yml`) scans the full git history with gitleaks on every push and PR.
- Allowed false positives live in `.gitleaks.toml` (public EVM addresses and vendored skill docs). Do not widen the allowlist to get a commit through; remove the secret instead.
- Commit messages with an em dash are rejected by `.githooks/commit-msg`.

---

## 9. Vercel (configs only; the orchestrator links and deploys)

Two projects from this monorepo:

| Project | Root Directory | Config | Env var list |
|---|---|---|---|
| `strata-web` | `apps/web` | `apps/web/vercel.json` | `infra/vercel/web.env.example` |
| `strata-api` | `apps/api` | `apps/api/vercel.json` (W6) | `infra/vercel/api.env.example` |

Security headers: the web app sets CSP with a per-request nonce in `apps/web/proxy.ts` and the static headers (HSTS, nosniff, frame deny, referrer, permissions, COOP) in `apps/web/next.config.ts`. The API sets headers with `@fastify/helmet`.

Secret values go in with `infra/vercel/push-env.sh` (reads `.secrets/` files, never shell arguments). Preview deployments must not get the production `DATABASE_URL`; use a Neon branch.

---

## 10. Mainnet (blocked, owner approval required)

Mainnet capital is $0 (D27) and the release stage is TESTNET (D33). Do not run any of this without the owner's written go-ahead and a passing Section 16 checklist.

When approved: create and fund `strata-atlas`, `strata-meridian` and `strata-mainnet-attestor` keys (owner funds, D7), fill `infra/prometheus/targets/mainnet.yml`, set `STRATA_MAINNET_APPROVED=true` in `.env`, add the mainnet agents to `STRATA_AGENT_ENDPOINTS`, and start with `--profile testnet --profile mainnet`.

---

## 11. Moving the workers to a cloud VM later

Everything that runs on the Mac is one compose file, so moving is a copy, not a rewrite.

1. Any Linux VM with Docker Engine and the compose plugin, 2 vCPU and 4 GB RAM minimum. Open no inbound ports except SSH (key only). Prometheus and Grafana stay bound to 127.0.0.1; reach them with `ssh -L 3001:127.0.0.1:3001 vm`.
2. Copy the repo (git clone) and the `.secrets/` folder (`scp -r`, then `chmod 700 .secrets && chmod 600 .secrets/* .secrets/keystores/*`).
3. On Linux, bind-mounted files keep host ownership: make the secrets readable by the container user (`sudo chown -R 1000:1000 .secrets`), since containers run as `node` (uid 1000).
4. Stop the stack on the Mac first (`down`, so agents cancel orders), then `up -d --build` on the VM. Never run two copies of an agent at once: both would quote the same subaccount.
5. Docker Engine on Linux starts on boot with `sudo systemctl enable docker`; `restart: always` handles the containers. Section 3 no longer applies.
6. Record the move in `docs/DECISIONS.md` (host choice is the owner's, D4).
