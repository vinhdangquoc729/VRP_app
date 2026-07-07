# TCPVRP API Reference

Base URL: `http://127.0.0.1:8000`  
Interactive docs: `http://127.0.0.1:8000/docs`  
All request/response bodies are JSON (`Content-Type: application/json`).

---

## Order status lifecycle

```
pending → assigned → in_transit → delivered
                               ↘ failed
pending / failed ──────────────→ cancelled
```

Allowed transitions via `PATCH /api/v1/orders/{id}/status`:
`in_transit | delivered | failed | cancelled`  
Cancellation only when current status is `pending` or `failed`.

---

## Routing & Optimisation

### `POST /api/v1/routing/solve`
Run the Genetic Algorithm on a set of vehicles and orders.

**Query params**

| Param | Type | Description |
|-------|------|-------------|
| `session_id` | `string` (optional) | If provided, progress events are streamed to `GET /api/v1/routing/progress/{session_id}` |

**Request body**

```jsonc
{
  "orders": [
    {
      "id": 1,
      "customer_id": 10,
      "lat": 21.03,
      "lon": 105.85,
      "weight": 12.5,        // kg
      "volume": 0.3,         // m³
      "start_time": 28800,   // seconds from midnight (08:00)
      "end_time": 43200,     // seconds from midnight (12:00)
      "service_duration": 10 // minutes
    }
  ],
  "vehicles": [
    {
      "id": 1,
      "operating_cost": 2.5,        // VND/m
      "time_based_cost": 0.05,      // VND/s
      "max_weight": 500,            // kg
      "max_volume": 5.0,            // m³
      "max_travel_distance": 200000,// m (default 200 km)
      "operating_time": 36000       // s (default 10 h)
    }
  ],
  "hard_tw": false,   // if true, time-window violations are infeasible (not penalised)
  "real_route": false // if true, fetch OSRM road geometry for each route
}
```

**Response `200`**

```jsonc
{
  "status": "success",
  "execution_time_seconds": 10.42,
  "total_vehicles_used": 3,
  "matrix": {
    "node_ids": [0, 10, 11],
    "distances_km": [[0, 2.1, 3.4], ...],
    "times_min":    [[0, 5.2, 8.1], ...]
  },
  "costs": {
    "total": 123456.78,
    "operating": 80000.0,
    "time_based": 30000.0,
    "penalty": 13456.78,
    "distance_km": 85.4
  },
  "violations": {
    "capacity": 0,
    "volume": 0,
    "incompatibility": 0,
    "overtime": 1,
    "overdistance": 0,
    "unserved": 0
  },
  "routes": [ /* see route object below */ ]
}
```

---

### `GET /api/v1/routing/progress/{session_id}`
SSE stream of optimisation progress. Connect before calling `POST /solve`.

**Event payload (JSON in `data:` field)**

```jsonc
{ "stage": "matrix", "done": 3, "total": 10, "message": "Đang xây dựng ma trận..." }
{ "stage": "solving", "done": 1, "total": 1, "message": "Đang chạy thuật toán..." }
{ "stage": "done", "message": "complete" }
```

Stream closes when `stage == "done"`.

---

### `POST /api/v1/routing/recalculate`
Recalculate costs and violations for a manually edited solution.

**Request body**

```jsonc
{
  "routes":   [ /* same route objects returned by /solve */ ],
  "orders":   [ /* OrderInput list */ ],
  "vehicles": [ /* VehicleInput list */ ],
  "hard_tw":  false,
  "real_route": false
}
```

**Response** — same shape as `POST /solve`.

---

## Assignments

### `POST /api/v1/assignments/confirm`
Persist the dispatch result (routes → assignments.json, update order/vehicle/driver statuses).

**Request body**

```jsonc
{
  "data": { /* full solution payload returned by /solve */ }
}
```

**Response `200`**

```json
{ "status": "ok" }
```

---

## Authentication

Both login endpoints accept phone + password; the password is stored in plain text in JSON files (demo only).

### `POST /api/v1/drivers/login`

```jsonc
// Request
{ "phone": "0901234567", "password": "abc123" }

// Response 200
{ "driver": { "id": 1, "name": "Nguyễn Văn A", "phone": "...", "status": "available" } }

// Response 401  (wrong credentials)
{ "detail": "Số điện thoại hoặc mật khẩu không đúng" }
```

### `POST /api/v1/customers/login`

```jsonc
// Request
{ "phone": "0912345678", "password": "abc123" }

// Response 200
{ "customer": { "id": 5, "name": "Trần Thị B", "phone": "...", "lat": 21.02, "lon": 105.83 } }
```

---

## Customers

### `GET /api/v1/customers/{customer_id}/orders`
List all orders belonging to a customer, enriched with `arrival_time` from the active assignment.

**Response `200`**

```jsonc
{
  "orders": [
    {
      "id": 101, "customer_id": 5, "product_name": "Laptop Gaming",
      "category": "Điện tử", "weight": 2.5, "volume": 0.1,
      "status": "in_transit", "driver_id": 3,
      "created_at": "2026-06-20", "arrival_time": "14:30"
    }
  ]
}
```

---

### `POST /api/v1/customers/{customer_id}/orders`
Place one or more orders from the product catalogue.

**Request body**

```jsonc
{
  "product_ids": [12, 15],
  "time_window_start": "08:00",
  "time_window_end": "12:00",
  "notes": "Gọi trước khi giao"
}
```

**Response `200`**

```jsonc
{ "status": "ok", "created": 2, "orders": [ /* new order objects */ ] }
```

**Errors**

| Code | Condition |
|------|-----------|
| `400` | `product_ids` is empty |
| `404` | A product ID does not exist |

---

### `PATCH /api/v1/customers/{customer_id}/orders/{order_id}/cancel`
Customer cancels their own order. Only allowed when `status ∈ {pending, failed}`.

**No request body.**

**Response `200`** `{ "status": "ok" }`

**Errors**

| Code | Condition |
|------|-----------|
| `400` | Status not cancellable |
| `404` | Order not found or does not belong to this customer |

---

## Products

### `GET /api/v1/products`
Return the full product catalogue.

**Response `200`**

```jsonc
{
  "products": [
    { "id": 1, "name": "Laptop Gaming", "category": "Điện tử", "weight": 2.5, "volume": 0.1, "price": 25000000 }
  ]
}
```

---

## Drivers

### `GET /api/v1/drivers/{driver_id}/orders`
Return the driver's assigned trips with stop sequence, timing, and live order statuses.

**Response `200`**

```jsonc
{
  "vehicle": { "id": 2, "type": "Van", "plate": "30A-12345", "status": "assigned" },
  "trips": [
    {
      "trip_index": 0,
      "geometry": [[21.03, 105.85], ...],  // null if not yet fetched
      "stops": [
        {
          "stop_index": 1,
          "customer_id": 10,
          "customer_name": "Nguyễn Văn C",
          "customer_address": "123 Trần Duy Hưng",
          "customer_phone": "0901234567",
          "lat": 21.01, "lon": 105.82,
          "time_window": "08:00–12:00",
          "arrival_time": "09:15",
          "departure_time": "09:25",
          "orders": [
            { "id": 101, "product_name": "Laptop", "category": "Điện tử",
              "weight": 2.5, "volume": 0.1, "status": "in_transit" }
          ]
        }
      ]
    }
  ]
}
```

---

### `GET /api/v1/drivers/{driver_id}/route-geometry`
Fetch OSRM road geometry for all trips of a driver and cache it in `assignments.json`.

**Response `200`**

```jsonc
{ "geometries": [ [[21.03, 105.85], [21.02, 105.84], ...], null ] }
```

---

### `POST /api/v1/drivers/{driver_id}/location`
Push the driver's current GPS position (used by GPS simulation).

```jsonc
// Request
{ "lat": 21.015, "lon": 105.831 }

// Response 200
{ "status": "ok" }
```

---

### `GET /api/v1/drivers/locations`
Get the last-known GPS position of all active drivers.

```jsonc
{
  "locations": [
    { "driver_id": 1, "lat": 21.015, "lon": 105.831 },
    { "driver_id": 3, "lat": 21.032, "lon": 105.842 }
  ]
}
```

---

## Orders (Admin)

### `GET /api/v1/admin/orders`
List all orders across all customers.

```jsonc
{ "orders": [ /* full order objects */ ] }
```

---

### `PATCH /api/v1/orders/{order_id}/status`
Update a single order's status (admin).

```jsonc
// Request
{ "status": "delivered" }

// Response 200
{ "status": "ok" }
```

**Allowed values:** `in_transit | delivered | failed | cancelled`  
**Error `400`:** Cancellation attempted when status is not `pending` or `failed`.

---

### `PATCH /api/v1/orders/bulk-status`
Update multiple orders to the same status in one call.

```jsonc
// Request
{ "order_ids": [101, 102, 105], "status": "cancelled" }

// Response 200
{ "status": "ok", "updated": 3 }
```

Orders that fail the cancellation guard are silently skipped (not counted).

---

### `POST /api/v1/orders/generate-random`
Generate `count` random orders using existing customers and write them to `orders.json`.  
`created_at` is set to the current `sim_date`.

**Query params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `count` | `int` | `5` | Number of orders to generate (min 1) |

```jsonc
// Response 200
{ "status": "ok", "created": 5, "orders": [ /* new order objects */ ] }
```

---

### `POST /api/v1/orders/reset-pending`
**Demo helper.** Reset all orders to `pending`, clear all driver/vehicle assignments, and clear `assignments.json`.

```jsonc
// Response 200
{ "status": "ok", "reset": 320 }
```

---

## Config

### `GET /api/v1/config/sim-date`
Return the current global simulated dispatch date.

```json
{ "date": "2026-06-20" }
```

### `POST /api/v1/config/sim-date`
Set the global simulated dispatch date. Affects all subsequent order creation.

```jsonc
// Request
{ "date": "2026-06-25" }

// Response 200
{ "date": "2026-06-25" }
```

---

## Common errors

| Code | Meaning |
|------|---------|
| `400` | Bad request — invalid status, empty payload, constraint violation |
| `401` | Authentication failed |
| `404` | Resource not found |
| `500` | Internal server error (check console output) |
