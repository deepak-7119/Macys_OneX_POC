# Overlock POC — local launch instructions

This package contains the Transaction History and Associate Communications modernization POC.

All users, transactions, documents, and backend responses are synthetic. The POC does not connect to Macy's authentication, Apigee, payment, email, enterprise backend, or physical POS systems.

## 1. Prerequisites

Install:

- Node.js 24 LTS
- npm, which is included with Node.js
- Approximately 500 MB of free space for dependencies

Confirm the installation:

```text
node --version
npm --version
```

## 2. Extract the package

Extract the ZIP and open a terminal inside the extracted `overlock-poc` folder—the folder containing `package.json`.

## 3. Install dependencies

Windows PowerShell:

```powershell
npm.cmd ci
```

macOS or Linux:

```bash
npm ci
```

Dependencies are installed from the committed `package-lock.json` file.

## 4. Run verification

Windows PowerShell:

```powershell
npm.cmd run check
```

macOS or Linux:

```bash
npm run check
```

This runs the automated tests, TypeScript validation, production build, and build-artifact checks.

## 5. Start the application

Windows PowerShell:

```powershell
npm.cmd start
```

macOS or Linux:

```bash
npm start
```

Open the application at:

<http://127.0.0.1:4300/>

The local services use:

- Port `4300`: Bobbin shell, application UI, and Binder routes
- Port `4301`: synthetic legacy upstream

Stop both services with `Ctrl+C` in the terminal running the application.

## Faster demonstration launch

The ZIP includes a verified production browser build. For a quick demonstration, run only:

```text
npm ci
npm start
```

Run `npm run check` for handoff verification or after changing source code.

## Development mode

```text
npm run dev
```

Development mode watches server-side TypeScript. After changing browser UI code, run `npm run build`, restart the server, and refresh the browser.

## Using different ports

If ports 4300 or 4301 are occupied, choose two unused ports.

Windows PowerShell:

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

## Troubleshooting

- **`node` or `npm` is not recognized:** install Node.js 24 LTS and reopen the terminal.
- **Dependency installation fails:** verify npm registry and network access, then rerun `npm ci`.
- **Address already in use:** stop the process using ports 4300/4301 or configure different ports.
- **Blank or stale UI after editing:** run `npm run build`, restart `npm start`, and hard-refresh the browser.
- **Application does not start:** confirm that the terminal is in the folder containing `package.json`.

For architecture, ownership, security boundaries, and the Thread/Spool/Binder/Bobbin model, see the main `README.md` and `HANDOFF.md` files.
