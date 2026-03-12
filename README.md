# ChargeFinder — Backend

The REST API and real-time server powering ChargeFinder. Handles station data, user accounts, vehicle profiles, charging sessions, and live progress updates.

---

## What It Does

- **Station Management** — Full CRUD for charging stations with connector types, pricing, availability status, and photos.
- **Authentication** — Email/password signup and login with Redis-backed session storage. Role-based access (user / admin).
- **Charging Tickets** — Ticket lifecycle from request → in-progress → completed. Tracks kWh, duration, and battery percentage.
- **Real-time Updates** — WebSocket server broadcasts live charging progress to connected clients.
- **Vehicle Profiles** — Users can own multiple EVs with battery capacity, connector compatibility, and charge-level tracking.
- **Charging History** — Per-user history of past sessions.
- **Admin Routes** — Create, update, and delete users and stations from a protected admin scope.
- **Startup Seeding** — Auto-seeds mock stations and a demo user on first boot (idempotent).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express 5 + TypeScript |
| Database | MongoDB (Mongoose) |
| Sessions | Redis + express-session |
| Real-time | WebSocket (ws) |
| Validation | express-validator |
| File Uploads | multer |
| Auth | bcryptjs + session |
| Testing | Jest + ts-jest |

---

## Project Structure

```
src/
├── app.ts              # Express entry point, middleware, route registration
├── models/             # Mongoose schemas: User, Vehicle, Station, ChargingTicket
├── routes/             # Route files: auth, stations, vehicles, profile, admin
├── controllers/        # Request handlers for each route group
├── services/           # Business logic: charging tickets, history, battery
├── middleware/         # Auth guards, rate limiting, file upload config
├── realtime/           # WebSocket server for charging progress
├── session/            # Redis connection and express-session setup
├── startup/            # Seeding scripts: stations, admin user, demo data
└── utils/              # Shared utilities
```

### API Routes Overview

| Group | Base Path | What It Covers |
|---|---|---|
| Auth | `/api/auth` | Login, signup, logout, session check |
| Stations | `/api/stations` | List stations, CRUD (admin), charging flow |
| Vehicles | `/api/vehicles` | Add/edit/delete vehicles, set active |
| Profile | `/api/profile` | Get profile, charging history, update details |
| Admin | `/api/admin` | User management (admin only) |

---

## Getting Started

```bash
npm install
npm start          # starts dev server with hot reload (ts-node + nodemon)
```

### Other Commands

```bash
npm test           # run Jest test suite
npm run test:ci    # run tests in CI mode (--ci --runInBand)
```

### Docker (Recommended for Local Dev)

```bash
docker compose up
```

Starts the API server on port `5000` and a Redis instance automatically.

---

## Environment Variables

Copy `.env-template` to `.env` and fill in the values:

```
# MongoDB
MONGODB_USER=
MONGODB_PASSWORD=
MONGODB_HOST=
MONGODB_NAME=

# Redis
REDIS_URL=

# Admin seed account
ADMIN_EMAIL=
ADMIN_PASSWORD=
ADMIN_NAME=
ADMIN_REGION=

# Rate limiting
RATE_LIMIT_WINDOW_MS=
RATE_LIMIT_MAX=

# Feature flags
ENABLE_DEMO_DATA=false
ENABLE_SIGNUP=true
```
