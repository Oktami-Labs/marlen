<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/banner-dark.svg">
  <img src=".github/banner-light.svg" alt="Marlen, a local-first AI email assistant">
</picture>

A local-first AI email assistant. It reads, drafts, and organizes your mail —
Gmail, Outlook / Microsoft 365, and anything else Pipedream can connect — with
scheduled automations and a chat you can ask anything. Everything runs and
stays on your computer.

## Download

Grab the macOS or Windows installer from the
[latest release](https://github.com/Oktami-Labs/marlen/releases/latest).

Builds are not code-signed yet, which shapes both installing and updating:

- **macOS** — allow the app once via System Settings → Privacy & Security →
  "Open Anyway". Updates then have to be **installed by hand**: download the new
  release and replace the app. macOS refuses to swap an unsigned bundle, so the
  in-app updater can find a new version but not install it — when that happens
  the app says so and links to the release.
- **Windows** — SmartScreen warns on first run (More info → Run anyway). Updates
  after that install themselves when a new release is published.

What turns macOS self-updating on: [apps/desktop/README.md → Signing](apps/desktop/README.md#signing).

## Run from source

Requires Node 20+ and pnpm.

```sh
pnpm install
pnpm dev        # server on :3001, web app on :5173
```

Or as a single process: `pnpm build && pnpm start` → http://localhost:3001.

## First-time setup (in the app)

Open **Settings**:

1. **AI** — sign in with a Claude / Copilot / ChatGPT subscription (or an API
   key) and pick a model.
2. **Email** — follow the one-time Pipedream setup shown in the form (free
   account, OAuth client, project URL), then **Connect an account** and sign
   in to your mailbox. Add as many accounts as you like, mixed providers
   included.

## Repo layout

```
apps/
  server/    Fastify API — chat, live email tools, automations, SQLite storage
  web/       Vite/React UI
  desktop/   Electron shell + auto-update (releases: see its README)
packages/
  shared/    Types shared between server and web
```

## Development

```sh
pnpm dev      # server + web with live reload
pnpm check    # lint + conventions + typecheck + tests
```

## License

Source-available, all rights reserved — see [LICENSE](LICENSE). The code is
public for transparency and so official builds can auto-update from this
repo's releases.
