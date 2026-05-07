# TCPVRP — Time-Constrained Pickup-Delivery Vehicle Routing Problem Solver

A web-based logistics route optimization system that solves the Vehicle Routing Problem with time windows, pickup-delivery constraints, and real road network data. The system uses a Genetic Algorithm backend exposed via a FastAPI server and a React/TypeScript frontend for interactive order and vehicle management.

---

## Features

- **Genetic Algorithm solver** — optimizes multi-vehicle, multi-trip delivery routes under weight, volume, time window, incompatible-goods, and distance constraints
- **Real road routing** — fetches live travel times and distances from an OSRM instance; falls back to straight-line estimates when unavailable
- **Interactive map UI** — add/edit orders and vehicles, visualize routes on a Leaflet map
- **Drag-and-drop route editing** — manually rearrange stops and recalculate costs on the fly
- **Live progress streaming** — Server-Sent Events push optimization progress to the browser in real time
- **Route simulation** — time-slider playback to animate deliveries throughout the day

---

## Project Structure

```
TCPVRP/
├── vrp_project/          # Python backend
│   ├── main.py           # FastAPI application & API routes
│   ├── schemas.py        # Pydantic request/response models
│   ├── requirements.txt  # Python dependencies
│   └── vrp/
│       ├── core/         # Problem definition, solution, and cost evaluation
│       ├── solvers/      # GA_TCPVRP and alternative solvers
│       ├── data/         # Data loaders
│       ├── utils/        # Visualization helpers
│       └── experiments/  # Batch experiment runners
│
└── vrp-frontend/         # React + TypeScript frontend
    ├── src/
    │   ├── App.tsx        # Root component and state management
    │   ├── MapView.tsx    # Leaflet map with route/order layers
    │   └── components/   # VehiclePanel, OrderPanel, ResultsPanel, SimulationControls
    ├── package.json
    └── vite.config.ts
```

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Python | 3.10+ | Backend |
| Node.js | 18+ | Frontend |
| npm | 9+ | Frontend package manager |
| OSRM | any | Optional — provides real travel times/distances. The backend falls back to straight-line estimates if unavailable. |

---

## Getting Started

### 1. Backend

```powershell
cd vrp_project

# Create and activate a virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1   # Windows PowerShell
# source .venv/bin/activate    # macOS / Linux

# Install dependencies
pip install -r requirements.txt

# Start the API server
python main.py
```

The server starts at **http://127.0.0.1:8000**.

To run with auto-reload during development:

```powershell
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

---

### 2. Frontend

```powershell
cd vrp-frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app opens at **http://localhost:5173**.

---

### 3. OSRM (optional)

The backend calls an OSRM Table API at `http://router.project-osrm.org` by default. For offline or production use, run a local OSRM instance and update the `OSRM_BASE_URL` variable in [vrp_project/main.py](vrp_project/main.py).

---

## Usage

1. Open **http://localhost:5173** in a browser.
2. **Add vehicles** in the Vehicle panel — set capacity, cost per km, overtime rate, and operating hours.
3. **Add orders** by clicking on the map or using the Order panel — specify pickup/delivery coordinates, time windows, weight, volume, and goods type.
4. Click **"Chạy thuật toán"** (Run Algorithm) to start optimization.
   - The progress bar streams live updates while the GA runs (10-second time limit by default).
   - Results appear as colored routes on the map and a turn-by-turn table in the Results panel.
5. **Drag stops** within a route to reorder them, then click **"Tính toán lại"** (Recalculate) to update costs.
6. Use the **simulation slider** to animate vehicle movement through the delivery schedule.

---

## API Reference

All endpoints are served by the FastAPI backend at `http://127.0.0.1:8000`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/routing/solve` | Submit orders and vehicles; returns optimized routes |
| `GET` | `/api/v1/routing/progress/{session_id}` | SSE stream of optimization progress |
| `POST` | `/api/v1/routing/recalculate` | Recalculate costs for a manually edited solution |

Interactive API docs (Swagger UI) are available at **http://127.0.0.1:8000/docs**.

---

## Algorithm Overview

The core solver (`vrp/solvers/ga_tcpvrp.py`) is a Genetic Algorithm tailored for multi-trip pickup-delivery VRP:

- **Chromosome structure** — encodes route priority, stops per route, and order-to-vehicle assignments
- **Greedy initialization** — nearest-neighbour insertion seeded with constraint-feasible assignments
- **Fitness function** — minimizes total cost (distance × rate) plus penalty terms for time window violations, overload, and overtime
- **Parameters** — population 100, up to 500 generations, 10-second wall-clock time limit

Default depot: Hanoi Central Post Office (21.0245°N, 105.8412°E).

---

## Development

```powershell
# Lint the frontend
cd vrp-frontend
npm run lint

# Production build
npm run build

# Preview production build locally
npm run preview
```

---
