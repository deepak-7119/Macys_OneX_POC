# Local launch guide

This package contains the two-application Overlock modernization proof of concept:

- Transaction History
- Associate Communications, including web and POS presentations

All users, transactions, documents, and upstream responses are synthetic. No Macy's enterprise systems, authentication, Apigee instance, payment service, email service, or physical POS are connected.

## Prerequisites

- Node.js 24 LTS
- npm (included with Node.js)
- Approximately 500 MB of free space for installed dependencies

Confirm the tools are available:

```text
node --version
npm --version
```

## Windows PowerShell

Open PowerShell in the extracted `overlock-poc` folder, then run:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd start
```

## macOS or Linux

Open a terminal in the extracted `overlock-poc` folder, then run:

```bash
npm ci
npm run check
npm start
```

When the server reports that it is ready, open:

<http://127.0.0.1:4300/>

The local listeners are:

- `4300`: Bobbin shell, applications, and Binder routes
- `4301`: synthetic legacy upstream

Stop the application with `Ctrl+C`.

## Faster demo launch

The ZIP contains a verified browser build. After `npm ci`, you can start it directly:

```text
npm start
```

Run `npm run check` first when validating the handoff or after changing source code. It runs the automated tests, TypeScript check, production build, and build-artifact checks.

## Development mode

```text
npm run dev
```

Development mode watches server-side TypeScript. After changing browser UI code, run `npm run build`, restart the server, and refresh the browser.

## Optional ports

If ports 4300 or 4301 are already used, select two different local ports before starting.

PowerShell:

```powershell
$env:PORT='4400'
$env:MOCK_PORT='4401'
npm.cmd start
```

macOS or Linux:

```bash
PORT=4400 MOCK_PORT=4401 npm start
```

Then open the selected `PORT`, for example <http://127.0.0.1:4400/>.

## Common problems

- **`npm` or `node` is not recognized:** install Node.js 24 LTS and reopen the terminal.
- **Dependency download fails:** confirm npm registry/network access, then rerun `npm ci`.
- **Address already in use:** stop the process using ports 4300/4301 or use the optional port instructions above.
- **Blank or stale UI after editing:** run `npm run build`, restart `npm start`, and hard-refresh the browser.

For architecture, ownership, limitations, and the Thread/Spool/Binder/Bobbin model, see `README.md` and `HANDOFF.md`.
