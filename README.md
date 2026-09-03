<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/banner-dark.svg">
  <img src=".github/banner-light.svg" alt="Marlen, a local-first AI email assistant">
</picture>

A local-first AI email assistant. It reads, drafts, and organizes mail from
Gmail, Outlook / Microsoft 365, and anything else Pipedream can connect. It has
scheduled automations and a general-purpose chat. Everything runs and
stays on your computer.

## Download

Grab the macOS or Windows installer from the
[latest release](https://github.com/Oktami-Labs/marlen/releases/latest).
That repo is this one: it carries the source, the releases, the download site
([marlen.email](https://marlen.email), its `gh-pages` branch) and the issue
tracker. Installed apps update from its releases, which `release.yml` builds
when a `v*` tag lands
([apps/desktop/README.md → Cutting a release](apps/desktop/README.md#cutting-a-release)).

Builds are not code-signed yet, which shapes both installing and updating:

- **macOS.** Allow the app once via System Settings → Privacy & Security →
  "Open Anyway". Updates then have to be **installed by hand**: download the new
  release and replace the app. macOS refuses to swap an unsigned bundle, so the
  in-app updater can find a new version but not install it. When that happens,
  the app says so and links to the release.
- **Windows.** SmartScreen warns on first run (More info → Run anyway). Updates
  after that install themselves when a new release is published.

What turns macOS self-updating on: [apps/desktop/README.md → Signing](apps/desktop/README.md#signing).

## Run from source

Requires Node 20+ and pnpm.

```sh
pnpm install
pnpm dev        # server on :3001, web app on :5173
```

Or as a single process:

```sh
pnpm --filter @marlen/web build
pnpm start
```

Then open http://localhost:3001.

## First-time setup (in the app)

Open **Settings**:

1. **AI.** Sign in with a Claude / Copilot / ChatGPT subscription (or an API
   key) and pick a model.
2. **Email.** Follow the one-time Pipedream setup shown in the form (free
   account, OAuth client, project URL), then **Connect an account** and sign
   in to your mailbox. Add as many accounts as you like, mixed providers
   included.

## Repo layout

```
apps/
  server/          Fastify API: chat, live tools, automations, SQLite storage
  web/             Vite/React UI
  desktop/         Shipping Electron shell + auto-update
  desktop-tauri/   Tauri preview shell, not used for releases
  e2e/             Playwright against an isolated server, database, and SPA
packages/
  shared/          Types shared between server and web
```

## Development

```sh
pnpm dev      # server + web with live reload
pnpm check    # lint + conventions + typecheck + tests
pnpm test:e2e # build the web app and run Playwright
```

The released desktop app still uses Electron. To run the Tauri preview, start
`pnpm dev:server`, then run `pnpm dev:tauri` in another terminal.

## License

Proprietary, all rights reserved. See [LICENSE](LICENSE). It grants the
right to install and run the official builds, nothing about the source.
