# TCPVRP — Time-Constrained Pickup-Delivery Vehicle Routing Problem

A full-stack logistics dispatch system that optimises multi-vehicle delivery routes and supports end-to-end order lifecycle management across three user roles: **Admin (Dispatcher)**, **Driver**, and **Customer**.

---

## Features

### Optimisation engine
- **Genetic Algorithm solver** — multi-vehicle, multi-trip routes under weight, volume, time-window, incompatible-goods, and distance constraints
- **Best-Insertion heuristic** — inserts new orders into active routes in O(n) without restarting the GA (Dynamic VRP)
- **Real road routing** — OSRM Table & Route APIs for travel-time matrices and actual road geometry; falls back to Haversine when unavailable
- **Live progress streaming** — Server-Sent Events push GA progress to the browser in real time

### Admin dashboard
- Drag-and-drop route editing with instant cost recalculation
- Route simulation slider (time-axis playback)
- **Live dispatch** — monitor simulated GPS positions of all drivers; insert orders mid-simulation
- **Order management** — multi-filter table (status, category, date range, search), per-order cancel
- **Statistics** — stacked bar chart by day/status, horizontal bar by category, top-driver leaderboard; date-range filter
- **Simulated dispatch date** (`sim_date`) — global server-side date used for all order creation and filtering

### Customer portal
- Browse product catalogue and place orders (date stamped with `sim_date`)
- Track order status in real time with a per-step timeline
- Cancel pending or failed orders

### Driver app
- View assigned route with ordered stop list
- Update each stop: **Start delivery → Delivered / Failed**
- Simulated GPS marker moves along the real OSRM route geometry after each update

### Order lifecycle
```
pending → assigned → in_transit → delivered
                               → failed
pending / failed → cancelled
```

---

## Project Structure

```
TCPVRP/
├── database/
│   ├── orders/orders.json        # Order records
│   ├── drivers/drivers.json      # Driver records
│   ├── customers/customers.json  # Customer records
│   ├── vehicles/vehicles.json    # Vehicle records
│   └── products/products.json   # Product catalogue
│
├── vrp_project/                  # Python backend (FastAPI)
│   ├── main.py                   # API routes, global sim_date, order lifecycle logic
│   ├── requirements.txt
│   └── vrp/
│       ├── core/                 # VRPProblem, Solution, Route, cost evaluation
│       ├── solvers/              # GA_TCPVRP_Solver + alternative solvers
│       ├── data/                 # Data loaders
│       └── utils/
│
└── vrp-frontend/                 # React 19 + TypeScript (Vite)
    └── src/
        ├── App.tsx               # Root state, admin layout, dispatch tab
        ├── MapView.tsx           # Leaflet map with route/order layers
        ├── LoginPage.tsx         # Role selection (Admin / Driver / Customer)
        └── components/
            ├── OrdersView.tsx        # Admin order management table
            ├── StatsView.tsx         # Admin statistics dashboard
            ├── CustomerDashboard.tsx # Customer portal
            ├── DriverDashboard.tsx   # Driver route + GPS simulation
            ├── VehiclePanel.tsx
            ├── OrderPanel.tsx
            ├── ResultsPanel.tsx
            └── SimulationControls.tsx
```

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Python | 3.10+ | Backend |
| Node.js | 18+ | Frontend |
| npm | 9+ | Frontend package manager |
| OSRM | any | Optional — public instance used by default |

---

## Getting Started

### 1. Backend

```powershell
cd vrp_project

python -m venv .venv
.\.venv\Scripts\Activate.ps1      # Windows PowerShell
# source .venv/bin/activate       # macOS / Linux

pip install -r requirements.txt
python main.py
```

Server starts at **http://127.0.0.1:8000**.  
Auto-reload during development: `uvicorn main:app --reload --host 127.0.0.1 --port 8000`

### 2. Frontend

```powershell
cd vrp-frontend
npm install
npm run dev
```

App opens at **http://localhost:5173**.

### 3. OSRM (optional)

The backend calls `http://router.project-osrm.org` by default. For offline use, run a local instance and update `OSRM_BASE_URL` in `vrp_project/main.py`.

---

## Usage

### Admin (Dispatcher)

1. Log in as **Admin**, select a dispatcher ID.
2. Set the **simulated dispatch date** in the Dispatch tab.
3. Sync vehicles and orders from the database (filter by pending / failed).
4. Click **"Chạy thuật toán"** to run the GA (10-second limit, live progress bar).
5. Review routes on the map; drag stops to reorder, then click **"Tính toán lại"** to recalculate costs.
6. Switch to the **Live** tab to monitor driver GPS positions and insert new orders dynamically.
7. View daily trends and top drivers in the **Thống kê** tab.

### Customer

1. Log in as **Khách hàng**, select a customer ID.
2. Browse the product catalogue in **"Đặt hàng"** and confirm an order.
3. Track status in **"Đơn hàng"** — a timeline shows each stage.
4. Cancel pending or failed orders with the **"Huỷ đơn"** button.

### Driver

1. Log in as **Tài xế**, select a driver ID and the dispatch date.
2. View the ordered stop list in the route panel.
3. Tap **"Bắt đầu giao"** to mark a stop in-transit, then **"Đã giao"** or **"Giao không thành công"** to close it.
4. The GPS marker animates to the next stop automatically.

---

## API Reference

Interactive docs (Swagger UI): **http://127.0.0.1:8000/docs**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/routing/solve` | Submit vehicles + orders; returns optimised routes |
| `GET`  | `/api/v1/routing/progress/{session_id}` | SSE stream of GA progress |
| `POST` | `/api/v1/routing/recalculate` | Recalculate costs for a manually edited solution |
| `GET`  | `/api/v1/config/sim-date` | Get current simulated dispatch date |
| `POST` | `/api/v1/config/sim-date` | Set simulated dispatch date (global) |
| `GET`  | `/api/v1/admin/orders` | List all orders (admin) |
| `PATCH`| `/api/v1/orders/{id}/status` | Update order status (admin) |
| `POST` | `/api/v1/orders/bulk-status` | Bulk update order statuses |
| `POST` | `/api/v1/orders/generate-random` | Generate random orders for testing |
| `GET`  | `/api/v1/customers/{id}/orders` | List orders for a customer |
| `POST` | `/api/v1/customers/{id}/orders` | Create order for a customer |
| `PATCH`| `/api/v1/customers/{cid}/orders/{id}/cancel` | Customer cancels their own order |
| `GET`  | `/api/v1/drivers/{id}/trips` | Get assigned trips for a driver |
| `PATCH`| `/api/v1/drivers/{id}/trips/{t}/stops/{s}/status` | Driver updates stop status |
| `POST` | `/api/v1/dispatch/insert-order` | Insert an order into an active route (Best-Insertion) |

---

## Algorithm Overview

### Genetic Algorithm (`vrp/solvers/ga_tcpvrp.py`)

- **Chromosome** — three-part encoding: route priority / stops-per-route (head), visit order (core), order-to-vehicle assignment (tail)
- **Initialisation** — nearest-neighbour greedy seeding + random fill
- **Fitness** — total travel cost + penalties for time-window violations, weight/volume overload, and overtime
- **Operators** — Order Crossover (OX) on the core segment; swap/reverse-segment mutation
- **Parameters** — population 100, up to 500 generations, 10-second wall-clock limit

### Best-Insertion (dynamic dispatch)

When a new order arrives mid-simulation, the heuristic evaluates every feasible insertion position (i → new → j) in the target vehicle's remaining route and selects the position with minimum extra cost Δc = d(i,o) + d(o,j) − d(i,j), subject to capacity constraints. Runs in O(n) per vehicle.

Default depot: Hanoi Central Post Office (21.0245°N, 105.8412°E).

---

## Development

```powershell
# Lint frontend
cd vrp-frontend && npm run lint

# Production build
npm run build

# Preview production build
npm run preview
```
