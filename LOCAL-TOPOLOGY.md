# Local one-Hub micro-frontend topology

This topology demonstrates the latest client direction without pretending that the unresolved
Enterprise Architecture services already exist.

## Runtime flow

1. The browser opens the OneX Hub at `http://127.0.0.1:4300`.
2. The Hub retrieves a capability-filtered Spool manifest catalog.
3. The single-spa root config registers Transaction History and Associate Communications.
4. When a card is selected, the browser fetches only that MFE from the storage simulation on port
   `4310` and mounts it into the same Hub page.
5. The MFE calls same-origin typed API routes. Bobbin currently supplies this session/API boundary
   as a fallback until the enterprise replacement is documented and proven.
6. The POC adapter calls the Apigee mock, which calls the synthetic legacy backend.

There are no Transaction History or Associate Communications UI containers.

## Services

| Service                   | Port | Responsibility                                                        |
| ------------------------- | ---: | --------------------------------------------------------------------- |
| OneX Hub                  | 4300 | single-spa root config, Hub UI and temporary Bobbin fallback boundary |
| MFE storage simulation    | 4310 | static TH/AC modules and immutable shared chunks; no session or APIs  |
| Shared session simulation | 4340 | synthetic stand-in for the unresolved enterprise IDM/session service  |
| Apigee mock               | 4350 | simulated enterprise API policy boundary                              |
| Legacy backend            | 4360 | synthetic source-shaped transaction and document endpoints            |

## Launch without Docker

```powershell
npm.cmd run build
npm.cmd run start:topology
```

Open <http://127.0.0.1:4300/> and choose **See how it works**.

The bootstrap response proves the separation. Each manifest entry points to port `4310`, while API
operations remain on the Hub origin:

```powershell
(Invoke-WebRequest http://127.0.0.1:4300/api/bootstrap -UseBasicParsing).Content
```

## Launch with containers

```powershell
docker compose up --build
```

The Compose topology uses the same five boundaries. Hub and storage are the only browser-visible
ports.

```powershell
docker compose ps
docker compose logs -f one-x-hub mfe-storage
```

Stop only this POC with:

```powershell
docker compose down
```

## Decision boundary

Thread and Spool remain required in either production option. Only the hosting edge is unsettled:

- **Bobbin fallback:** Node/Fastify hosts the Hub and supplies ForgeRock/session/API proxy
  integration.
- **Enterprise target:** GCP Storage hosts the Hub/MFEs and approved enterprise services replace
  every server-side Bobbin responsibility.

The POC keeps the Bobbin fallback active while making the MFE asset boundary independently
replaceable. No real ForgeRock, Apigee, GCP or production data connection is present.
