# Charge Finder — Project Documentation

**Live Site:** https://charge-finder-project.vercel.app
**License:** Apache 2.0
**Last Updated:** March 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Frontend Documentation](#3-frontend-documentation)
4. [Backend Documentation](#4-backend-documentation)
5. [Getting Started — Local Setup](#5-getting-started--local-setup)
6. [Testing](#6-testing)

---

## 1. Project Overview

**Charge Finder** is a full-stack web application that helps electric vehicle (EV) owners locate the nearest EV charging stations. Built as a production-ready portfolio project using the MERN stack (MongoDB, Express, React, Node.js), it features real-time charging progress tracking, role-based access control, and an interactive map-based interface.

### Key Capabilities

- **Station Discovery** — Browse charging stations on an interactive map with live availability status
- **Filtering & Distance** — Find stations by location, connector type, and charging speed
- **Charging Sessions** — Request, start, monitor, and complete EV charging sessions
- **Vehicle Management** — Register multiple EVs with connector types, battery capacity, and charging status
- **Charging History** — Track past sessions with duration, cost, and energy data
- **Admin Console** — Full station and user management for administrators
- **Real-time Updates** — WebSocket-based live charging progress every 5 seconds

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Browser                           │
│                                                                 │
│  React 19 + TypeScript + Vite                                   │
│  Redux Toolkit (State) │ MUI (UI) │ Leaflet (Maps)             │
│                        │                                        │
│          HTTP/REST API │ WebSocket (charging progress)          │
└────────────────────────┼────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                    Backend (Node.js / Express 5)                │
│                    Port 5000                                    │
│                                                                 │
│  Routes → Controllers → Services → Models                      │
│  Middleware: Auth (session) │ Rate Limiting │ File Upload       │
│                                                                 │
│  Session Store: Redis        JWT: for signup responses          │
└───────────┬─────────────────────────────────┬───────────────────┘
            │                                 │
┌───────────▼──────────┐         ┌───────────▼──────────┐
│   MongoDB Atlas      │         │   Redis               │
│   (Primary DB)       │         │   (Sessions & Rate    │
│   Collections:       │         │    Limiting)          │
│   - users            │         └──────────────────────┘
│   - vehicles         │
│   - stations         │
│   - chargingtickets  │
│   - charginghistories│
└──────────────────────┘
```

### Deployment

| Layer     | Platform   | Notes                              |
|-----------|------------|------------------------------------|
| Frontend  | Vercel     | Auto-deploy from main branch       |
| Backend   | Self-hosted | Docker + docker-compose, port 5000 |
| Database  | MongoDB Atlas | Cloud-hosted                    |
| Cache     | Redis      | Docker container in compose stack  |

---

## 3. Frontend Documentation

**Repository:** `senafathoni2998/Charge-Finder-Frontend`
**Primary Language:** TypeScript (99.5%)

### 3.1 Tech Stack

| Category           | Technology                        | Version  |
|--------------------|-----------------------------------|----------|
| UI Framework       | React                             | 19.2.0   |
| Language           | TypeScript                        | 5.9.3    |
| Build Tool         | Vite                              | 7.2.4    |
| Routing            | React Router                      | 7.11.0   |
| State Management   | Redux Toolkit + React Redux       | 2.11.2 / 9.2.0 |
| UI Components      | Material-UI (MUI)                 | 7.3.6    |
| Styling            | Emotion (CSS-in-JS)               | 11.14.0+ |
| Maps               | Leaflet + React Leaflet           | 1.9.4 / 5.0.0 |
| Geocoding          | OpenStreetMap Nominatim           | —        |
| Analytics          | Vercel Analytics + Speed Insights | 1.6.1 / 1.3.1 |
| Testing            | Vitest + Testing Library React    | 4.0.18 / 16.3.2 |
| Linting            | ESLint + TypeScript ESLint        | 9.39.1+  |

### 3.2 Directory Structure

```
Charge-Finder-Frontend/
├── .github/
│   └── workflows/
│       └── unit-tests.yml        # CI pipeline
├── public/
│   ├── app-logo.svg
│   ├── manifest.json             # PWA manifest
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── api/                      # Backend API integration layer
│   │   ├── adminStations.ts      # Admin station CRUD
│   │   ├── charging.ts           # Charging session operations
│   │   ├── chargingHistory.ts    # Historical charging data
│   │   ├── geocode.ts            # OpenStreetMap reverse geocoding
│   │   ├── stations.ts           # Station retrieval & location
│   │   ├── tickets.ts            # Charging ticket management
│   │   ├── users.ts              # User management (admin)
│   │   └── __tests__/
│   ├── app/
│   │   ├── hooks.ts              # Custom Redux hooks
│   │   └── store.ts              # Redux store configuration
│   ├── components/
│   │   ├── Map/
│   │   │   ├── MapCanvas.tsx     # Interactive map rendering
│   │   │   ├── MapGrid.tsx       # Grid overlay
│   │   │   ├── LegendRow.tsx     # Map legend
│   │   │   ├── MarkedDot.tsx     # Station markers
│   │   │   └── utils/
│   │   ├── SEO.tsx               # SEO metadata
│   │   └── __tests__/
│   ├── features/
│   │   ├── app/
│   │   │   └── appSlice.ts       # UI & navigation state
│   │   └── auth/
│   │       └── authSlice.ts      # Authentication state
│   ├── layout/
│   │   └── RootLayout.tsx        # Main app layout with AppBar
│   ├── models/
│   │   └── model.ts              # TypeScript interfaces
│   ├── pages/
│   │   ├── MainPage/             # Home — interactive map
│   │   ├── StationDetail/        # Station details view
│   │   ├── Login/                # User login
│   │   ├── Signup/               # User registration
│   │   ├── Profile/              # User profile & car management
│   │   ├── AddCar/               # Add new EV
│   │   ├── EditCar/              # Edit EV details
│   │   ├── Admin/                # Admin dashboard
│   │   ├── AddStation/           # Add charging station (admin)
│   │   ├── EditStation/          # Edit station (admin)
│   │   ├── AddUser/              # Create user (admin)
│   │   ├── RouteError/           # Route error handler
│   │   └── NotFound/             # 404 page
│   ├── router/
│   │   ├── route.ts              # Route definitions (lazy loaded)
│   │   ├── guards.tsx            # Auth & admin route guards
│   │   └── __tests__/
│   ├── theme/
│   │   └── theme.ts              # MUI custom theme
│   ├── utils/
│   │   ├── distance.ts           # Distance calculations
│   │   ├── map.ts                # Map helper utilities
│   │   ├── session.ts            # Session management
│   │   ├── time.ts               # Time formatting
│   │   ├── validate.ts           # Form validation
│   │   └── __tests__/
│   ├── main.tsx                  # React entry point
│   └── index.css                 # Global styles
├── index.html                    # HTML entry point
├── vite.config.ts
├── tsconfig.json
├── vercel.json                   # Vercel SPA + API proxy config
└── package.json
```

### 3.3 Pages & Features

| Page           | Route                              | Auth Required | Description                              |
|----------------|------------------------------------|---------------|------------------------------------------|
| MainPage       | `/`                                | No            | Interactive Leaflet map with all stations |
| StationDetail  | `/station/:id`                     | No            | Station info, connectors, pricing, reviews |
| Login          | `/login`                           | No (redirect if authed) | Email/password login         |
| Signup         | `/signup`                          | No (redirect if authed) | New user registration        |
| Profile        | `/profile`                         | Yes           | User info, EV list, charging history     |
| AddCar         | `/profile/cars/new`                | Yes           | Add a new EV to profile                  |
| EditCar        | `/profile/cars/:carId/edit`        | Yes           | Edit existing EV details                 |
| Admin          | `/admin`                           | Admin only    | Station & user management dashboard      |
| AddStation     | `/admin/stations/new`              | Admin only    | Create a new charging station            |
| EditStation    | `/admin/stations/:stationId/edit`  | Admin only    | Modify station details                   |
| AddUser        | `/admin/users/new`                 | Admin only    | Create a new user account                |
| NotFound       | `*`                                | No            | 404 error page                           |

### 3.4 State Management (Redux)

**App Slice (`src/features/app/appSlice.ts`)**

Manages global UI state:
- Sidebar visibility
- Responsive breakpoint mode
- Navigation state
- Theme settings

**Auth Slice (`src/features/auth/authSlice.ts`)**

Manages authentication state:
- Authentication status (logged in / out)
- User information (id, email, name, region, role)
- Vehicle list and active vehicle selection
- Connector compatibility for the active EV
- Charging session status

### 3.5 Routing & Guards

The application uses React Router v7 with lazy-loaded routes for performance.

**Route Guards:**

| Guard          | File                         | Purpose                                          |
|----------------|------------------------------|--------------------------------------------------|
| `RequireAuth`  | `src/router/guards.tsx`      | Redirects to `/login` if user is not authenticated |
| `RequireAdmin` | `src/router/guards.tsx`      | Redirects to `/` if user does not have admin role |
| `RedirectIfAuth` | `src/router/guards.tsx`   | Redirects authenticated users away from login/signup |

### 3.6 API Integration Layer

All backend calls are organized in `src/api/`:

| File                  | Responsibility                         |
|-----------------------|----------------------------------------|
| `stations.ts`         | Fetch stations list and details        |
| `adminStations.ts`    | Create, update, delete stations (admin)|
| `charging.ts`         | Start, update, complete, cancel charging |
| `chargingHistory.ts`  | Fetch user's charging history          |
| `tickets.ts`          | Request and manage charging tickets    |
| `users.ts`            | Admin user management                  |
| `geocode.ts`          | Reverse geocoding via OpenStreetMap    |

### 3.7 Data Types

```typescript
// Station
type Station = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  connectors: Connector[];
  status: "AVAILABLE" | "BUSY" | "OFFLINE";
  lastUpdatedISO: string;
  photos: StationPhoto[];
  pricing: StationPricing;
  amenities: string[];
  notes?: string;
  isChargingHere?: boolean;
};

// Connector
type Connector = {
  type: "CCS2" | "Type2" | "CHAdeMO";
  powerKW: number;
  ports: number;
  availablePorts: number;
};

// Charging Speed
type ChargingSpeed = "NORMAL" | "FAST" | "ULTRA_FAST";
```

### 3.8 Environment Variables

Create a `.env` file in the root of the frontend repo:

```env
VITE_APP_BACKEND_URL=http://localhost:5000
```

For production, set this to the deployed backend URL.

### 3.9 Scripts

```bash
npm run dev       # Start Vite dev server on port 3000
npm run build     # Build for production
npm run preview   # Preview production build locally
npm run lint      # Run ESLint checks
npm run test      # Run Vitest unit tests
```

### 3.10 CI/CD Pipeline

GitHub Actions (`.github/workflows/unit-tests.yml`):
- Triggers on: push to `main`, pull requests
- Environment: Node.js 20
- Steps: `npm ci` → `npm test -- --run`

### 3.11 Deployment (Vercel)

The frontend is deployed on Vercel. The `vercel.json` configures:
- **SPA routing** — all unknown paths rewrite to `/index.html`
- **API proxy** — `/api/*` rewrites to the backend server

---

## 4. Backend Documentation

**Repository:** `senafathoni2998/Charge-Finder-Backend`
**Primary Language:** TypeScript

### 4.1 Tech Stack

| Category             | Technology             | Version  |
|----------------------|------------------------|----------|
| Runtime              | Node.js                | 20 (Alpine) |
| Framework            | Express                | 5.2.1    |
| Language             | TypeScript             | 5.9.3    |
| Database ODM         | Mongoose + MongoDB     | 9.1.1    |
| Session Cache        | Redis + Connect-Redis  | 5.10.0 / 7.1.1 |
| Authentication       | JWT + Express-Session  | 9.0.3 / 1.18.2 |
| Password Hashing     | bcryptjs               | 3.0.3    |
| Input Validation     | Express-Validator      | 7.3.1    |
| Real-time            | WebSocket (ws)         | 8.19.0   |
| File Uploads         | Multer                 | 2.0.2    |
| Testing              | Jest + ts-jest         | 30.2.0 / 29.4.6 |
| Dev Server           | Nodemon + ts-node      | 3.1.11 / 10.9.2 |

### 4.2 Directory Structure

```
Charge-Finder-Backend/
├── src/
│   ├── app.ts                         # Express app entry point & server setup
│   ├── controllers/
│   │   ├── auth-controllers.ts        # Login, signup, logout, session
│   │   ├── profile-controllers.ts     # Profile view & updates
│   │   ├── vehicle-controllers.ts     # Vehicle management (re-exports)
│   │   ├── admin-controllers.ts       # Admin user operations
│   │   ├── station-controllers.ts     # Station operations (re-exports)
│   │   ├── station/
│   │   │   ├── station-charging.ts    # Charging request & progress
│   │   │   ├── station-admin.ts       # Admin station CRUD
│   │   │   ├── station-read.ts        # Station listing & details
│   │   │   └── station-charging-helpers.ts
│   │   ├── vehicle/
│   │   │   ├── vehicle-read.ts        # Vehicle listing
│   │   │   └── vehicle-mutations.ts   # Vehicle create/update
│   │   └── __tests__/
│   ├── models/
│   │   ├── user.ts                    # User schema
│   │   ├── vehicle.ts                 # Vehicle schema
│   │   ├── station.ts                 # Station schema
│   │   ├── charging-history.ts        # Historical sessions schema
│   │   ├── charging-ticket.ts         # Active session schema
│   │   └── http-error.ts              # Custom error class
│   ├── routes/
│   │   ├── auth-routes.ts             # /api/auth
│   │   ├── profile-routes.ts          # /api/profile
│   │   ├── vehicle-routes.ts          # /api/vehicles
│   │   ├── station-routes.ts          # /api/stations
│   │   ├── admin-routes.ts            # /api/admin
│   │   └── __tests__/
│   ├── middleware/
│   │   ├── authMiddleware.ts          # Session validation & RBAC
│   │   ├── rateLimit.ts               # Redis-backed rate limiting
│   │   └── fileUpload.ts              # Multer configuration
│   ├── services/
│   │   ├── charging-ticket-service.ts # Core charging logic (exports)
│   │   ├── charging-ticket/
│   │   │   ├── calculations.ts        # Duration & progress calculations
│   │   │   ├── battery.ts             # Battery % updates
│   │   │   ├── persistence.ts         # DB persistence helpers
│   │   │   ├── duration.ts            # Charging time estimation
│   │   │   ├── payload.ts             # Ticket data formatting
│   │   │   ├── snapshot.ts            # Charging state snapshots
│   │   │   └── constants.ts           # Speed constants (kW per speed)
│   │   ├── charging-history-service.ts
│   │   ├── vehicle-battery-service.ts
│   │   └── __tests__/
│   ├── realtime/
│   │   ├── charging-progress.ts       # WebSocket broadcast system
│   │   └── __tests__/
│   ├── session/
│   │   ├── session.ts                 # Express-session configuration
│   │   └── redis.ts                   # Redis client initialization
│   ├── startup/
│   │   ├── ensure-admin.ts            # Create default admin user
│   │   ├── ensure-stations.ts         # Seed charging stations
│   │   ├── ensure-demo-data.ts        # Optional demo data
│   │   └── data/
│   │       ├── stations.ts            # Pre-defined station data
│   │       └── demo-data.ts           # Demo user & vehicle data
│   ├── types/
│   │   ├── express.d.ts               # Custom Express Request types
│   │   └── express-session.d.ts       # Session type augmentation
│   └── utils/
│       └── image-paths.ts             # Profile image path management
├── Dockerfile
├── docker-compose.yml                 # Local dev (MongoDB + Redis + App)
├── docker-compose.prod.yml            # Production deployment
├── .env-template                      # Environment variable template
├── jest.config.js
├── nodemon.json
├── tsconfig.json
└── package.json
```

### 4.3 API Endpoints Reference

All endpoints are prefixed with the backend base URL (default: `http://localhost:5000`).

#### Authentication — `/api/auth`

| Method | Endpoint          | Auth     | Description                             |
|--------|-------------------|----------|-----------------------------------------|
| POST   | `/api/auth/login` | No       | Login with email and password           |
| POST   | `/api/auth/signup`| No*      | Register a new user account             |
| POST   | `/api/auth/admin/signup` | Admin | Create an admin user                |
| POST   | `/api/auth/logout`| Yes      | Terminate the current session           |
| GET    | `/api/auth/session`| Yes    | Retrieve the current session info       |

*Signup is rate-limited: 5 requests per hour by default.

**Login**
```
POST /api/auth/login
Body: { "email": string, "password": string }
Response: { id, name, email, role, token, image? }
```

**Signup**
```
POST /api/auth/signup
Content-Type: multipart/form-data
Body: { name, email, password, region?, image? }
Response: User object + JWT token
```

**Session Check**
```
GET /api/auth/session
Response: {
  user: { id, email, name, region, role, vehicles, tickets, image? }
}
```

---

#### Profile — `/api/profile` (Requires Authentication)

| Method | Endpoint                        | Description                              |
|--------|---------------------------------|------------------------------------------|
| GET    | `/api/profile`                  | Get the current authenticated user's profile |
| GET    | `/api/profile/charging-history` | Get user's charging history records      |
| PATCH  | `/api/profile/update-password`  | Change password (requires current password) |
| PATCH  | `/api/profile/update-profile`   | Update name, region, or profile image    |

**Update Profile**
```
PATCH /api/profile/update-profile
Content-Type: multipart/form-data
Body: { userId, name?, region?, image? }
```

**Charging History Response**
```json
[{
  "stationName": "string",
  "stationAddress": "string",
  "vehicleName": "string",
  "connectorType": "CCS2 | Type2 | CHAdeMO",
  "chargingSpeed": "NORMAL | FAST | ULTRA_FAST",
  "ticketKwh": "number",
  "startedAt": "ISO8601",
  "endedAt": "ISO8601",
  "outcome": "COMPLETED | CANCELLED",
  "progressPercent": "number",
  "startingBatteryPercent": "number",
  "batteryPercentage": "number",
  "chargingDurationMs": "number"
}]
```

---

#### Vehicles — `/api/vehicles` (Requires Authentication)

| Method | Endpoint                     | Description                        |
|--------|------------------------------|------------------------------------|
| GET    | `/api/vehicles`              | List all user's registered vehicles |
| GET    | `/api/vehicles/:vehicleId`   | Get a specific vehicle's details   |
| POST   | `/api/vehicles/add-vehicle`  | Add a new EV to user profile       |
| PATCH  | `/api/vehicles/update-vehicle` | Update vehicle specifications    |
| PATCH  | `/api/vehicles/set-active-vehicle` | Set a vehicle as active for charging |
| DELETE | `/api/vehicles/delete-vehicle` | Remove a vehicle from user account |

**Vehicle Object**
```json
{
  "name": "string",
  "connector_type": ["CCS2", "Type2", "CHAdeMO"],
  "min_power": "number (kW)",
  "batteryCapacity": "number (kWh)",
  "batteryPercent": "0–100",
  "batteryStatus": "FULL | HIGH | MEDIUM | LOW | CRITICAL",
  "chargingStatus": "IDLE | CHARGING",
  "active": "boolean"
}
```

---

#### Stations — `/api/stations`

**Public Endpoints (No Auth Required)**

| Method | Endpoint               | Description                          |
|--------|------------------------|--------------------------------------|
| GET    | `/api/stations`        | List all charging stations           |
| GET    | `/api/stations?lat=X&lng=Y&radiusKm=Z` | List nearby stations  |
| GET    | `/api/stations/:stationId` | Get a single station's details   |

**Protected Endpoints (User Auth Required)**

| Method | Endpoint                             | Description                       |
|--------|--------------------------------------|-----------------------------------|
| POST   | `/api/stations/request-ticket`       | Create a charging ticket request  |
| POST   | `/api/stations/start-charging`       | Begin an active charging session  |
| PATCH  | `/api/stations/charging-progress`    | Update charging progress %        |
| POST   | `/api/stations/complete-charging`    | Finish charging & record history  |
| POST   | `/api/stations/cancel-charging`      | Cancel an active charging session |
| GET    | `/api/stations/:stationId/active-ticket` | Get active ticket for a station |

**Admin-Only Endpoints**

| Method | Endpoint                     | Description                     |
|--------|------------------------------|---------------------------------|
| POST   | `/api/stations/add-station`  | Create a new charging station   |
| PATCH  | `/api/stations/update-station` | Modify station properties     |
| DELETE | `/api/stations/delete-station` | Remove a station from system  |

**Station Object**
```json
{
  "name": "string",
  "lat": "number",
  "lng": "number",
  "address": "string",
  "connectors": [{
    "type": "CCS2 | Type2 | CHAdeMO",
    "powerKW": "number",
    "ports": "number",
    "availablePorts": "number"
  }],
  "status": "AVAILABLE | BUSY | OFFLINE",
  "lastUpdatedISO": "ISO8601",
  "photos": [{ "label": "string", "gradient": "string" }],
  "pricing": {
    "currency": "string",
    "perKwh": "number",
    "fastPerKwh": "number (optional)",
    "ultraFastPerKwh": "number (optional)",
    "perMinute": "number (optional)",
    "parkingFee": "string (optional)"
  },
  "amenities": ["string"],
  "notes": "string (optional)"
}
```

---

#### Admin — `/api/admin` (Admin Role Required)

| Method | Endpoint                    | Description                            |
|--------|-----------------------------|----------------------------------------|
| GET    | `/api/admin/users`          | List all system users                  |
| POST   | `/api/admin/users`          | Create a new user account              |
| PATCH  | `/api/admin/users/:userId`  | Update user details (name, email, role, password) |
| DELETE | `/api/admin/users/:userId`  | Delete a user and all associated data  |

**Create User**
```
POST /api/admin/users
Body: { name, email, password, region?, role? }
// role: "admin" | "user" (default: "user")
```

---

### 4.4 Database Models

#### User
```typescript
{
  _id: ObjectId,
  name: string,
  email: string,           // unique
  password: string,        // bcrypt hashed (12 rounds)
  region: string,
  role: "admin" | "user",
  vehicles: ObjectId[],    // ref: Vehicle
  tickets: ObjectId[],     // ref: ChargingTicket
  image: string            // file path (optional)
}
```

#### Vehicle
```typescript
{
  _id: ObjectId,
  name: string,
  connector_type: string[],
  min_power: number,
  batteryCapacity: number,           // kWh
  batteryPercent: number,            // 0–100
  batteryStatus: "FULL" | "HIGH" | "MEDIUM" | "LOW" | "CRITICAL",
  chargingStatus: "IDLE" | "CHARGING",
  active: boolean,
  lastBatteryUpdatedAt: Date,
  owner: ObjectId                    // ref: User (required)
}
```

#### Station
```typescript
{
  _id: ObjectId,
  name: string,
  lat: number,
  lng: number,
  address: string,
  connectors: [{
    type: "CCS2" | "Type2" | "CHAdeMO",
    powerKW: number,
    ports: number,
    availablePorts: number
  }],
  status: "AVAILABLE" | "BUSY" | "OFFLINE",
  lastUpdatedISO: string,
  photos: [{ label: string, gradient: string }],
  pricing: {
    currency: string,
    perKwh: number,
    fastPerKwh?: number,
    ultraFastPerKwh?: number,
    perMinute?: number,
    parkingFee?: string
  },
  amenities: string[],
  notes?: string
}
```

#### ChargingTicket
```typescript
{
  _id: ObjectId,
  user: ObjectId,                    // ref: User
  station: ObjectId,                 // ref: Station
  vehicle: ObjectId,                 // ref: Vehicle
  connectorType: "CCS2" | "Type2" | "CHAdeMO",
  chargingSpeed: "NORMAL" | "FAST" | "ULTRA_FAST",
  ticketKwh: number,
  targetBatteryPercent: number,      // 0–100
  status: "REQUESTED" | "PAID" | "CANCELLED",
  chargingStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED",
  progressPercent: number,           // 0–100
  startingBatteryPercent: number,
  chargingDurationMs: number,
  startedAt: Date,
  completedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

#### ChargingHistory
```typescript
{
  _id: ObjectId,
  user: ObjectId,                    // ref: User
  ticketId: ObjectId,                // ref: ChargingTicket (unique)
  station: ObjectId,                 // ref: Station
  stationName: string,
  stationAddress: string,
  vehicle: ObjectId,                 // ref: Vehicle
  vehicleName: string,
  connectorType: "CCS2" | "Type2" | "CHAdeMO",
  chargingSpeed: "NORMAL" | "FAST" | "ULTRA_FAST",
  ticketKwh: number,
  startedAt: Date,
  endedAt: Date,
  outcome: "COMPLETED" | "CANCELLED",
  progressPercent: number,
  startingBatteryPercent: number,
  batteryPercentage: number,         // final battery %
  chargingDurationMs: number,
  createdAt: Date,
  updatedAt: Date
}
```

### 4.5 Authentication & Authorization

**Authentication Method:** Session-based (primary) + JWT (for signup response)

- Sessions stored in **Redis** via `connect-redis`
- Session cookie: `httpOnly: true`, `secure: true` (production), `sameSite: "lax"`
- Session expiry: **24 hours**
- JWT secret configured via `SECRET_KEY` environment variable
- Passwords hashed with **bcrypt** (12 salt rounds)

**Roles:**

| Role  | Permissions                                                        |
|-------|--------------------------------------------------------------------|
| user  | View stations, manage own vehicles, start/track charging sessions  |
| admin | All user permissions + manage stations, manage all users           |

**Auth Middleware (`src/middleware/authMiddleware.ts`):**
- Validates session on every protected request
- Attaches `req.user` with id, email, name, role
- Returns `401 Unauthorized` if no valid session
- Returns `403 Forbidden` if role check fails

### 4.6 Real-time Charging Progress (WebSocket)

The backend uses the `ws` library to broadcast live charging updates.

- **Update interval:** every 5 seconds
- **Broadcast:** charging progress percentage, battery level, ETA
- **File:** `src/realtime/charging-progress.ts`
- Clients connect to the WebSocket server on the same port (5000)
- Updates stop automatically when charging completes or is cancelled

### 4.7 Rate Limiting

Redis-backed rate limiting applied at the middleware level:

| Endpoint     | Default Limit             | Config Variable                                       |
|--------------|---------------------------|-------------------------------------------------------|
| All routes   | 60 requests per minute    | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`              |
| Signup       | 5 requests per hour       | `SIGNUP_RATE_LIMIT_WINDOW_MS`, `SIGNUP_RATE_LIMIT_MAX`|

### 4.8 Environment Variables

Create a `.env` file in the backend root using `.env-template` as reference:

**Required:**
```env
DB_HOST=<mongodb_atlas_host>
DB_USER=<mongodb_username>
DB_PASSWORD=<mongodb_password>
DB_NAME=ChargeFinder
SESSION_SECRET=<random_secret_key_minimum_32_chars>
SECRET_KEY=<jwt_secret_key>
REDIS_URL=redis://localhost:6379
```

**Optional:**
```env
REDIS_PASSWORD=<redis_auth_password>
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-in-production
ADMIN_NAME=Admin
ADMIN_REGION=Jakarta
BATTERY_CAPACITY_DEFAULT=75
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=60
SIGNUP_RATE_LIMIT_WINDOW_MS=3600000
SIGNUP_RATE_LIMIT_MAX=5
CORS_ORIGINS=https://your-frontend.vercel.app
DISABLE_SIGNUP=false
ENABLE_DEMO_DATA=false
NODE_ENV=development
```

### 4.9 Scripts

```bash
npm start              # Start with Nodemon (hot-reload via ts-node)
npm test               # Run Jest unit tests (watch mode)
npm run test:ci        # Run tests in CI mode (sequential, no watch)
npm run backfill:battery-capacity  # Data migration script
```

**Docker:**
```bash
# Local development (MongoDB + Redis + App)
docker-compose up -d

# Production deployment
docker-compose -f docker-compose.prod.yml up -d
```

---

## 5. Getting Started — Local Setup

### Prerequisites

- **Node.js** v20+
- **npm** v10+
- **Docker & Docker Compose** (for backend infrastructure)
- **Git**

### Step 1 — Clone Both Repositories

```bash
git clone https://github.com/senafathoni2998/Charge-Finder-Backend.git
git clone https://github.com/senafathoni2998/Charge-Finder-Frontend.git
```

### Step 2 — Backend Setup

```bash
cd Charge-Finder-Backend

# Copy environment template and fill in values
cp .env-template .env
# Edit .env with your MongoDB Atlas credentials, Redis URL, secrets

# Start MongoDB and Redis via Docker Compose
docker-compose up -d

# Install dependencies
npm install

# Start the development server (port 5000)
npm start
```

The backend will automatically:
- Connect to MongoDB and create collections
- Seed the default admin user (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`)
- Seed sample charging stations
- (Optional) Create demo user and vehicles if `ENABLE_DEMO_DATA=true`

### Step 3 — Frontend Setup

```bash
cd Charge-Finder-Frontend

# Create environment file
echo "VITE_APP_BACKEND_URL=http://localhost:5000" > .env

# Install dependencies
npm install

# Start the development server (port 3000)
npm run dev
```

Open http://localhost:3000 in your browser.

### Default Admin Credentials

Use the values from your backend `.env`:
- **Email:** value of `ADMIN_EMAIL` (default: `admin@example.com`)
- **Password:** value of `ADMIN_PASSWORD`

---

## 6. Testing

### Frontend Tests

**Framework:** Vitest + Testing Library React + jsdom

```bash
cd Charge-Finder-Frontend
npm run test
```

Test files are co-located with source files in `__tests__/` directories:
- `src/api/__tests__/` — API integration tests
- `src/components/__tests__/` — Component unit tests
- `src/router/__tests__/` — Router and guard tests
- `src/utils/__tests__/` — Utility function tests

**CI:** GitHub Actions runs tests automatically on push and pull requests to `main`.

### Backend Tests

**Framework:** Jest + ts-jest

```bash
cd Charge-Finder-Backend

# Development (watch mode)
npm test

# CI mode (sequential, no watch)
npm run test:ci
```

Test files follow the same convention in `__tests__/` directories:
- `src/controllers/__tests__/` — Controller unit tests
- `src/routes/__tests__/` — Route integration tests
- `src/services/__tests__/` — Service logic tests
- `src/realtime/__tests__/` — WebSocket tests
- `src/startup/__tests__/` — Seeding/startup tests

---

*Documentation generated from source code analysis of the Charge Finder repositories.*
