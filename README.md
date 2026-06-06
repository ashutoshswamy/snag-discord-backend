# Snag — Discord Giveaway Bot

A focused Discord giveaway bot with a web dashboard for managing giveaways and instant drops.

---

## Commands Reference

### Giveaways & Drops

| Command    | Description                                                                  | Permission                   |
| ---------- | ---------------------------------------------------------------------------- | ---------------------------- |
| `/gstart`  | Start a timed giveaway — opens a modal for prize, duration, and winner count | Manager role or Manage Guild |
| `/gdrop`   | Launch an instant drop — first to click wins immediately                     | Manager role or Manage Guild |
| `/gend`    | End an active giveaway early and pick winners immediately                    | Manager role or Manage Guild |
| `/greroll` | Pick new winner(s) for a completed giveaway or drop                          | Manager role or Manage Guild |
| `/glist`   | Browse all active giveaways and drops in the server                          | Anyone                       |

**Duration format for `/gstart`:** `30m`, `1h`, `2d`, `1w`

**Winner count for `/gstart`:** 1–20

---

## Web Dashboard

React SPA connecting to the Express API via Discord OAuth2.

| Tab           | Features                                                                |
| ------------- | ----------------------------------------------------------------------- |
| **Giveaways** | View all active and ended giveaways, launch new ones, end early, reroll |
| **Settings**  | Manager role, logs channel, embed color, telemetry toggle               |

---

## Configuration

Settings per server (configurable via dashboard or Supabase):

| Setting       | Default             | Description                              |
| ------------- | ------------------- | ---------------------------------------- |
| `managerRole` | `@Giveaway Manager` | Role allowed to run giveaway commands    |
| `logsChannel` | `#giveaways`        | Channel where giveaway events are logged |
| `embedColor`  | `#8827e5`           | Embed accent color                       |
| `telemetry`   | `true`              | Track entry counts per giveaway          |

Server owner and members with **Manage Guild** always have manager access regardless of role setting.

---

## Deployment

- **Bot + API:** Railway or any VPS — `npm start` (port configured via `PORT` env)
