# Charge Finder Backend

A Node.js + TypeScript REST and WebSocket API for **Charge Finder** — an EV charging-station finder that lets drivers locate stations, run live charging sessions, reserve connector ports, review stations, and plan range-aware road trips.

## About the project

Charge Finder is split across two sibling repositories that live in the same parent folder and are developed together:

- **`Charge_Finder_Backend`** (this repo) — the Express 5 REST + WebSocket API, backed by MongoDB (Mongoose) with Redis-backed sessions and caching.
- **`Charge_Finder_Frontend`** — the React single-page app that consumes this API.

The frontend authenticates against this API using session cookies and subscribes to the charging-progress WebSocket for live session updates. See the `Charge_Finder_Frontend` folder for the client.

## Features

**Auth & accounts**
- Session-cookie authentication over Redis (`connect-redis`), with session regeneration on login/signup to prevent fixation.
- Passwords hashed with bcrypt (12 salt rounds). A JWT is also issued on login/signup for the client to hold, though server-side authorization is session-based.
- Role-based access (`user` / `admin`), with a dedicated admin-only signup and user-management surface.
- Multipart profile-image upload with MIME/size validation; replaced images are cleaned up on disk.

**Stations & charging**
- Public station discovery with geospatial proximity search (`$geoNear` over a 2dsphere index), distance sorting, and Redis-cached reads.
- Full simulated charging lifecycle — request ticket, start, live progress, complete, cancel — with atomic connector-port accounting to prevent overbooking.
- Server-driven progress: a 5-second timer advances each in-progress session, updates vehicle battery, auto-finalizes at 100%, and pushes updates over WebSocket.
- Station reviews (1–5 stars) gated on a completed charging session, with denormalized rating aggregates and admin moderation.

**Reservations, trips & vehicles**
- Connector-port reservations with booking-window rules, capacity/overlap enforcement, and availability lookups.
- Range-aware trip planner: bounded backtracking route search that inserts charging stops based on battery, buffer, detour, connector, and power constraints (stateless plan or saved trip).
- Per-user vehicle garage (max 3) with active-vehicle selection and simulated idle battery drain.
- Charging history as an immutable, denormalized record of every finished session.

**Platform**
- Zod-validated, fail-fast configuration.
- Custom Redis-backed per-route rate limiting (fail-open), with a stricter signup limiter.
- Fail-closed CORS allowlist, hand-rolled security headers (nosniff, frame-deny, HSTS in prod), and 100 kB JSON body cap.
- Idempotent startup seeding (admin bootstrap, 14 mock stations, optional demo data).

## Tech Stack

| Area | Library / Version |
|---|---|
| Runtime | Node.js 20 |
| Language | TypeScript `^5.9.3` |
| Web framework | Express `^5.2.1`, body-parser `^2.2.1` |
| Database | MongoDB via Mongoose `^9.1.1` |
| Sessions & cache | Redis `^5.10.0`, express-session `^1.18.2`, connect-redis `^7.1.1` |
| Realtime | ws `^8.19.0` |
| Auth | jsonwebtoken `^9.0.3`, bcryptjs `^3.0.3` |
| Validation | express-validator `^7.3.1`, zod `^4.4.3` |
| Uploads | multer `^2.0.2`, uuid `^13.0.0` |
| Logging | pino `^10.3.1` |
| Config | dotenv `^17.2.3` |
| Testing | Jest `^30.2.0`, ts-jest `^29.4.6` |
| Tooling | ts-node `^10.9.2`, nodemon `^3.1.11` |

## Architecture

The API follows a layered flow. Requests pass through global middleware (body parsing, security headers, static file serving, session, CORS, rate limiting, auth), then hit thin **routes** that delegate to **controllers**. Controllers validate input and orchestrate **services** that hold the domain logic; services read and write **Mongoose models** against MongoDB. Sessions and rate-limit counters live in Redis, which also fronts station reads via a short-TTL cache.

```
                         ┌─────────────────────────────────────────────┐
  HTTP / WS  ───────────▶│  Express app (src/app.ts)                    │
                         │  bodyParser → security headers → static      │
                         │  /uploads → session → CORS → rate limit      │
                         │  → auth/admin middleware                     │
                         └───────────────┬─────────────────────────────┘
                                         │
                Routes ──▶ Controllers ──▶ Services ──▶ Mongoose Models ──▶ MongoDB
              (src/routes)  (src/controllers) (src/services)  (src/models)
                                         │                         ▲
                                         │  sessions, rate-limit,  │
                                         └──────────  cache  ──────┘
                                                    Redis
                                         │
  ws(s)://…/ws/charging-progress ────────┘
  (src/realtime/charging-progress.ts) — session-authenticated;
  5s timer advances sessions + broadcasts progress/completed/cancelled
```

Authentication is **session-cookie based** (cookie name `sid`), and the WebSocket upgrade is authenticated by running the same session middleware against the upgrade request. Business invariants that MongoDB cannot express as constraints — reservation overlap/capacity, review eligibility, connector-port accounting, GeoJSON `location` sync — are enforced in controllers/services.

## Project Structure

```
src/
├── app.ts                 # Entry point: middleware wiring, route mounting, startup sequence
├── config.ts              # Zod-validated, fail-fast configuration loader
├── routes/                # Express routers (auth, admin, profile, vehicle, station, reservation, trip)
├── controllers/           # Request handlers
│   ├── station/           # Station reads, admin CRUD, reviews …
│   │   └── charging/      # request / start / progress / complete / cancel
│   └── vehicle/           # Vehicle read + mutations
├── services/              # Domain logic
│   ├── charging-ticket/   # Lifecycle, battery/duration/cost math, port accounting, finalize txn
│   ├── trip-planner-service.ts
│   ├── reservation-service.ts
│   ├── station-review-service.ts
│   ├── station-cache.ts
│   ├── vehicle-battery-service.ts
│   └── charging-history-service.ts
├── models/                # Mongoose schemas (Station, User, Vehicle, Reservation,
│                          #   StationReview, ChargingTicket, ChargingHistory, Trip) + HttpError
├── realtime/              # WebSocket charging-progress server + timers
├── middleware/            # auth, rate limiting, error handling, file upload, async wrapper
├── session/               # Redis client + express-session store
├── startup/               # Idempotent seeding (admin, stations, demo data) + seed data
├── scripts/               # One-off backfill migrations
├── utils/                 # geo helpers, mongo-uri builder, image paths
└── types/                 # Ambient type augmentation (session shape, etc.)
```

## Getting Started

### Prerequisites

- Node.js 20
- A MongoDB instance (or Atlas connection string)
- A Redis instance (defaults to `redis://localhost:6379`)

### Environment variables

Copy `.env-template` to `.env` and fill in real values. Generate strong secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Core & security**

| Name | Required? | Description | Default |
|---|---|---|---|
| `NODE_ENV` | No | Runtime mode; `production` enables secure cookies, HSTS, and proxy trust | `development` |
| `PORT` | No | HTTP listen port | `5000` |
| `SECRET_KEY` | **Yes** | JWT signing key | — |
| `SESSION_SECRET` | **Yes** | express-session signing secret | — |

**Database (MongoDB)**

| Name | Required? | Description | Default |
|---|---|---|---|
| `MONGODB_URI` | No | Full connection string; used verbatim if set | — |
| `DB_HOST` | Conditional | Mongo host (required if `MONGODB_URI` is unset) | — |
| `DB_USER` | Conditional | Mongo user (required if `MONGODB_URI` is unset) | — |
| `DB_PASSWORD` | Conditional | Mongo password (required if `MONGODB_URI` is unset) | — |
| `DB_NAME` | Conditional | Mongo database name (required if `MONGODB_URI` is unset) | — |

> If `MONGODB_URI` is not set, all four `DB_*` vars are required or the app throws. A `mongodb+srv://…?retryWrites=true&w=majority&appName=ChargeFinder` URI is built from them.

**Redis**

| Name | Required? | Description | Default |
|---|---|---|---|
| `REDIS_URL` | No | Redis connection URL (password may be embedded) | `redis://localhost:6379` |
| `REDIS_PASSWORD` | No | Redis password (if not embedded in `REDIS_URL`) | — |

**CORS**

| Name | Required? | Description | Default |
|---|---|---|---|
| `CORS_ORIGINS` | No | Comma-separated allowed origins | — |
| `CORS_ORIGIN` | No | Single additional allowed origin (appended) | — |

> `localhost`/`127.0.0.1` on ports `3000` and `5173` are always allowed for local dev.

**Rate limiting**

| Name | Required? | Description | Default |
|---|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | No | General rate-limit window (ms) | `60000` |
| `RATE_LIMIT_MAX` | No | General max requests per window per route | `60` |
| `SIGNUP_RATE_LIMIT_WINDOW_MS` | No | Signup rate-limit window (ms) | `3600000` |
| `SIGNUP_RATE_LIMIT_MAX` | No | Signup max requests per window | `5` |

**Feature flags & defaults**

| Name | Required? | Description | Default |
|---|---|---|---|
| `DISABLE_SIGNUP` | No | `true` disables public signup (returns 503 before persisting) | `false` |
| `ENABLE_DEMO_DATA` | No | `true` seeds a demo user, vehicles, and history | `false` |
| `BATTERY_CAPACITY_DEFAULT` | No | Default vehicle battery capacity (kWh) for backfills/defaults | — |

**Admin bootstrap** (read directly from the environment at startup)

| Name | Required? | Description | Default |
|---|---|---|---|
| `ADMIN_EMAIL` | For seeding | Bootstrap admin email; required to create/promote an admin | — |
| `ADMIN_PASSWORD` | For seeding | Bootstrap admin password | — |
| `ADMIN_NAME` | No | Admin display name | `Admin` |
| `ADMIN_REGION` | No | Admin region | `""` |

> On startup, if no admin exists and `ADMIN_EMAIL`/`ADMIN_PASSWORD` are set, a matching user is promoted or a new admin is created; otherwise admin seeding is skipped with a warning.

### Install

```bash
npm ci
```

### Run in development

```bash
npm run dev
```

Starts a live-reload server via `nodemon` + `ts-node` (no build step). On boot the app connects to Mongo and Redis, then runs admin bootstrap, station seeding, optional demo data, and vehicle-battery defaults before listening on `PORT`.

### Build & run in production

```bash
npm run build      # tsc → dist/
npm start          # node dist/app.js
```

## API Reference

Base URL: `http://<host>:<port>`. All application routes are under `/api`; uploaded images are served at `/uploads/images/*`.

**Auth legend** — `public`: reachable before auth · `auth`: requires a valid session · `admin`: requires an admin session · `owner`: caller must own the resource (or be admin).

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | public | Liveness probe (no auth, no DB); returns `{ "status": "ok" }` |

### Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | public | Verify credentials, regenerate session, return user + JWT |
| POST | `/api/auth/signup` | public | Register a `user` (multipart, optional `image`); extra signup rate limit; 503 if signup disabled |
| POST | `/api/auth/admin/signup` | admin | Create a new **admin** account (no session/token issued) |
| POST | `/api/auth/logout` | public | Destroy session and clear the `sid` cookie |
| GET | `/api/auth/session` | public | Return `{ sessionId, user, isLoggedIn }` to restore auth state |

### Stations — `/api/stations`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/stations` | public | List stations; with `lat`+`lng` uses proximity sort + `distanceKm`; adds `isChargingHere` when a session is present |
| GET | `/api/stations/:stationId` | public | Station detail (cached); session-aware |
| GET | `/api/stations/:stationId/reviews` | public | Paginated reviews + summary (`limit`, `offset`) |
| POST | `/api/stations/add-station` | admin | Create a station |
| PATCH | `/api/stations/update-station` | admin | Update a station |
| DELETE | `/api/stations/delete-station` | admin | Delete a station |
| POST | `/api/stations/request-ticket` | auth | Create a `REQUESTED` charging ticket |
| POST | `/api/stations/start-charging` | auth | Start charging on a ticket; atomically reserves a port; broadcasts `started` |
| PATCH | `/api/stations/charging-progress` | auth | Recompute progress; auto-finalizes at 100%; broadcasts `progress`/`completed` |
| POST | `/api/stations/complete-charging` | auth | Finalize as `COMPLETED` (or cancel if `cancel:true`); broadcasts `completed` |
| POST | `/api/stations/cancel-charging` | auth | Cancel the active session; releases port; broadcasts `cancelled` |
| GET | `/api/stations/:stationId/active-ticket` | auth | Caller's current ticket for the station (or null) |
| POST | `/api/stations/:stationId/reviews` | auth + eligible | Create/update caller's review (must have a completed session here); 201 create / 200 update |
| GET | `/api/stations/:stationId/reviews/me` | auth | Caller's own review for the station |
| DELETE | `/api/stations/:stationId/reviews` | auth | Delete caller's own review |
| DELETE | `/api/stations/:stationId/reviews/:reviewId` | admin | Moderate: delete any review and recompute rating |

### Reservations — `/api/reservations`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/reservations/` | auth | Book a connector-port slot for a time window (201) |
| GET | `/api/reservations/availability` | auth | Remaining capacity `{ stationId, connectorType, startTime, endTime, ports, reserved, available }` for station+connector+window |
| GET | `/api/reservations/` | auth | Caller's reservations (`status?`, `upcoming?`) |
| GET | `/api/reservations/station/:stationId` | admin | All reservations for a station, including slot holders |
| GET | `/api/reservations/:reservationId` | owner | A single reservation |
| DELETE | `/api/reservations/:reservationId` | owner | Cancel a reservation (idempotent; frees the slot) |

### Trips — `/api/trips`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/trips/plan` | auth | Compute a range-aware charging-stop plan (stateless) |
| POST | `/api/trips/` | auth | Compute and **save** a plan (feasible plans only; 201) |
| GET | `/api/trips/` | auth | Caller's saved trips, newest first |
| GET | `/api/trips/:tripId` | owner | A single saved trip |
| DELETE | `/api/trips/:tripId` | owner | Delete a saved trip |

### Vehicles — `/api/vehicles`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/vehicles/add-vehicle` | auth | Register a vehicle (max 3 per user; 201) |
| PATCH | `/api/vehicles/update-vehicle` | owner | Update owned vehicle fields |
| PATCH | `/api/vehicles/set-active-vehicle` | owner | Set the active vehicle (deactivates others) |
| DELETE | `/api/vehicles/delete-vehicle` | owner | Delete an owned vehicle |
| GET | `/api/vehicles/:vehicleId` | owner | A single owned vehicle (battery refreshed) |
| GET | `/api/vehicles/` | auth | All vehicles owned by the caller (battery refreshed) |

### Profile — `/api/profile`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/profile/` | auth | Current user's profile (password excluded) |
| GET | `/api/profile/charging-history` | auth | Caller's charging sessions from the last 3 days |
| PATCH | `/api/profile/update-password` | auth | Change password after verifying the current one |
| PATCH | `/api/profile/update-profile` | auth | Update name/region/image (multipart) |

### Admin (users) — `/api/admin`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/users` | admin | List all users (passwords excluded) |
| POST | `/api/admin/users` | admin | Create a user with a specified role (201) |
| PATCH | `/api/admin/users/:userId` | admin | Update a user (multipart; email uniqueness enforced) |
| DELETE | `/api/admin/users/:userId` | admin | Delete a user and cascade-delete vehicles + tickets |

### WebSocket — charging progress

**Endpoint:** `ws(s)://<host>/ws/charging-progress?stationId=<id>`

Authenticated during the HTTP upgrade using the same session middleware; requires a valid session user **and** a `stationId` query param, otherwise the handshake is rejected (`401` / close code `1008`). Each client is subscribed on the key `"<userId>:<stationId>"` and only receives its own ticket's updates for that station. The server does not act on inbound messages.

**Server → client messages** (JSON):

| `type` | Payload | Meaning |
|---|---|---|
| `initial` | `{ ticket }` | Sent on connect (`ticket` may be `null`) |
| `started` | `{ ticket }` | Charging began |
| `progress` | `{ ticket }` | Progress tick (includes `progressPercent`, `batteryPercentage`) |
| `completed` | `{ ticket: null, completedTicket }` | Session finalized |
| `cancelled` | `{ ticket: null, cancelledTicket }` | Session cancelled |

A server-side 5-second timer advances each in-progress ticket, persists progress, updates vehicle battery, and auto-finalizes at 100% — pushing updates even without further client action.

### Conventions

- **Connector types:** `CCS2`, `Type2`, `CHAdeMO`
- **Station status:** `AVAILABLE`, `BUSY`, `OFFLINE`
- **Charging speed:** `NORMAL`, `FAST`, `ULTRA_FAST`
- **Reservation status:** `ACTIVE`, `CANCELLED`
- **Validation errors** return `422` with `"Invalid inputs passed, please check your data."`; duplicate keys → `409`; invalid ids → `400`.

## Testing

Tests run on **Jest** with **ts-jest** (`testEnvironment: node`), executing TypeScript directly. There are **47** test files under `src/**/__tests__/`, spanning services (including `charging-ticket/`), controllers, routes, middleware, models, utils, startup, and realtime.

```bash
npm test          # run the full suite
npm run test:ci   # CI mode (--ci --runInBand, serial)
```

## Scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `nodemon --exec ts-node --files src/app.ts` | Live-reload dev server (no build step) |
| `build` | `tsc -p tsconfig.build.json` | Compile TypeScript to `dist/` |
| `start` | `node dist/app.js` | Run compiled output (production) |
| `typecheck` | `tsc --noEmit` | Type-check only |
| `test` | `jest` | Run the test suite |
| `test:ci` | `jest --ci --runInBand` | CI mode, serial execution |
| `backfill:battery-capacity` | `ts-node --files src/scripts/backfill-battery-capacity.ts` | One-off: set default vehicle battery capacity (arg or `BATTERY_CAPACITY_DEFAULT`; accepts a number or `'null'`) |
| `backfill:station-location` | `ts-node --files src/scripts/backfill-station-location.ts` | One-off: populate GeoJSON `location` on stations and sync the 2dsphere index |

## Deployment

The service ships as a multi-stage Docker image (`node:20-alpine`). The runtime stage sets `NODE_ENV=production` (secure cookies, HSTS, strict CORS), installs production dependencies only, runs the compiled output, exposes port `5000`, and defines a `/health` HEALTHCHECK.

**Build & run the image directly:**

```bash
docker build -t charge-finder-backend .
docker run --env-file .env -p 5000:5000 charge-finder-backend
```

**Local stack with Redis (dev):** `docker-compose.yml` builds the backend from source, loads `.env`, points `REDIS_URL` at the bundled `redis:7-alpine`, and maps `5000:5000`.

```bash
docker compose up --build
```

**Production stack:** `docker-compose.prod.yml` runs a prebuilt image instead of building (defaults to `charge-finder-backend:latest`, overridable via `DOCKER_IMAGE`).

```bash
DOCKER_IMAGE=<your-image>:<tag> docker compose -f docker-compose.prod.yml up -d
```

### CI/CD

GitHub Actions provides two workflows:

- **Unit tests** — on pull requests and pushes to `main`: `npm ci` → `typecheck` → `build` → `test:ci` (Node 20).
- **Build & Push Docker Image** — on tags matching `v*`: builds and pushes `${DOCKERHUB_USERNAME}/charge-finder-backend` to Docker Hub (tagged with the release tag and `latest`) using Buildx with GitHub Actions layer caching.

## License

ISC.
