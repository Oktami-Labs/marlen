<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/banner-dark.svg">
  <img src=".github/banner-light.svg" alt="Marlen, a local-first AI email assistant">
</picture>

A local-first AI email assistant. It reads, drafts, and organizes mail from
Gmail, Outlook / Microsoft 365, and anything else Pipedream can connect. It has
scheduled automations and a general-purpose chat. Everything runs and stays on
your computer.

This repo carries the releases, the [marlen.email](https://marlen.email)
download site (its `gh-pages` branch) and the issue tracker. The source is not
public.

## Download

Grab the macOS or Windows installer from the
[latest release](https://github.com/Oktami-Labs/marlen/releases/latest), or from
[marlen.email](https://marlen.email), which always points at it.

Builds are not code-signed yet, which shapes both installing and updating:

- **macOS.** Allow the app once via System Settings → Privacy & Security →
  "Open Anyway". Updates then have to be **installed by hand**: download the new
  release and replace the app. macOS refuses to swap an unsigned bundle, so the
  in-app updater can find a new version but not install it. When that happens,
  the app says so and links to the release.
- **Windows.** SmartScreen warns on first run (More info → Run anyway). Updates
  after that install themselves when a new release is published.

## Problems and requests

Open an [issue](https://github.com/Oktami-Labs/marlen/issues). Include the
version from Settings → About, which also has "Check for updates".

## License

Free to download, install and run for personal or internal business use. All
other rights reserved: see [LICENSE](LICENSE).
