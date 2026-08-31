# @marlen/desktop-tauri

Tauri development preview for Marlene. It opens the Vite app at
`http://127.0.0.1:5173`; Vite proxies `/api` to a separately running Marlen
server at `http://127.0.0.1:3001`.

Run these in separate terminals from the repo root:

```sh
pnpm dev:server
pnpm dev:tauri
```

The preview uses the identifier `email.marlen.desktop.preview`. It does not
package or supervise the Node server, read the Electron production data
directory, provide auto-updates, or participate in `.github/workflows/release.yml`.
The shipping shell remains `apps/desktop`.
