from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Tuple, Dict, Optional, Callable, Awaitable, Any
from functools import partial
from pathlib import Path
import asyncio
import json
import uuid
import time
import httpx
from datetime import date as _date

from vrp.core.problem import Problem, Customer, Order, Vehicle, Depot
from vrp.solvers.ga_tcpvrp import GA_TCPVRP_Solver
from vrp.core.eval import evaluate

# Global progress store: session_id -> asyncio.Queue of SSE events
_progress_queues: Dict[str, asyncio.Queue] = {}

# In-memory GPS store: driver_id -> {lat, lon}
_driver_locations: Dict[int, dict] = {}

# Simulated dispatch date (YYYY-MM-DD) — can be changed via admin UI
_sim_date: str = str(_date.today())

# Matrix cache: list of (frozenset_of_node_ids, dist_matrix, time_matrix).
# Keeps only the most recent entry — cleared and replaced on every new solve or
# cache-miss recalculate so memory stays bounded.
_matrix_cache: list = []

def _cached_matrices(node_ids: set):
    """Return (dist_matrix, time_matrix) if all node_ids are covered, else None."""
    for cached_ids, _, dist, time_m in _matrix_cache:
        if node_ids <= cached_ids:
            return dist, time_m
    return None

def _store_matrix_cache(node_coords_list: list, dist: dict, time_m: dict):
    """node_coords_list: [(node_id, lat, lon), ...]"""
    id_to_lonlat = {nid: (lon, lat) for nid, lat, lon in node_coords_list}
    _matrix_cache.clear()
    _matrix_cache.append((frozenset(id_to_lonlat.keys()), id_to_lonlat, dist, time_m))

async def _extend_matrices_with_new_nodes(
    new_node_coords: list,  # [(node_id, lat, lon), ...] NEW nodes only
) -> Tuple[dict, dict]:
    """
    Extend the cached distance/time matrices with one or more new nodes.
    Only fetches 2 small OSRM batches (new→all row, all-old→new column)
    instead of rebuilding the full N² matrix.
    """
    cached_ids, id_to_lonlat, old_dist, old_time = _matrix_cache[0]

    # Merge old + new coordinates
    combined = dict(id_to_lonlat)
    for nid, lat, lon in new_node_coords:
        combined[nid] = (lon, lat)

    all_ids         = list(combined.keys())
    all_osrm_coords = [combined[nid] for nid in all_ids]   # (lon, lat) each
    all_indices     = list(range(len(all_ids)))
    new_indices     = [all_ids.index(nid) for nid, _, _ in new_node_coords]
    old_indices     = [i for i in all_indices if i not in new_indices]

    # Copy existing matrix; fill new cells with fallback values
    new_dist = dict(old_dist)
    new_time = dict(old_time)
    for nid_n in [all_ids[i] for i in new_indices]:
        for nid_a in all_ids:
            new_dist.setdefault((nid_n, nid_a), 0.0 if nid_n == nid_a else 5000.0)
            new_time.setdefault((nid_n, nid_a), 0.0 if nid_n == nid_a else 600.0)
            new_dist.setdefault((nid_a, nid_n), 0.0 if nid_a == nid_n else 5000.0)
            new_time.setdefault((nid_a, nid_n), 0.0 if nid_a == nid_n else 600.0)

    async with httpx.AsyncClient(timeout=60.0) as client:
        # Row: new nodes → all nodes
        dist_r, time_r = await _osrm_table_batch(client, all_osrm_coords, new_indices, all_indices)
        for ri, si in enumerate(new_indices):
            for ci, di in enumerate(all_indices):
                uid, vid = all_ids[si], all_ids[di]
                new_dist[(uid, vid)] = float(dist_r[ri][ci] or 0.0)
                new_time[(uid, vid)] = float(time_r[ri][ci] or 0.0)

        # Column: old nodes → new nodes  (new→new already covered above)
        if old_indices:
            dist_c, time_c = await _osrm_table_batch(client, all_osrm_coords, old_indices, new_indices)
            for ri, si in enumerate(old_indices):
                for ci, di in enumerate(new_indices):
                    uid, vid = all_ids[si], all_ids[di]
                    new_dist[(uid, vid)] = float(dist_c[ri][ci] or 0.0)
                    new_time[(uid, vid)] = float(time_c[ri][ci] or 0.0)

    n_new = len(new_node_coords)
    print(f"[Matrix Cache] Incremental +{n_new} node(s) — 2 OSRM batch(es) instead of full {len(all_ids)}²")
    return new_dist, new_time


app = FastAPI(title="VRP Smart Routing API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Data Models ---
class OrderInput(BaseModel):
    id: int
    customer_id: int
    lat: float
    lon: float
    weight: float
    volume: float
    start_time: float
    end_time: float
    service_duration: float

class VehicleInput(BaseModel):
    id: int
    operating_cost: float
    time_based_cost: float
    max_weight: float
    max_volume: float
    max_travel_distance: float = 200000   # metres, default 200 km
    operating_time: float = 36000         # seconds, default 10 h

class VRPRequest(BaseModel):
    orders: List[OrderInput]
    vehicles: List[VehicleInput]
    hard_tw: bool = False
    real_route: bool = False  # fetch OSRM road geometry; skip to save time

class RecalculateRequest(BaseModel):
    routes: List[dict]
    orders: List[OrderInput]
    vehicles: List[VehicleInput]
    hard_tw: bool
    real_route: bool = False


# --- SSE progress endpoint ---
@app.get("/api/v1/routing/progress/{session_id}")
async def progress_stream(session_id: str):
    """SSE endpoint that streams matrix‑building progress for a given session."""
    queue: asyncio.Queue = asyncio.Queue()
    _progress_queues[session_id] = queue

    async def event_generator():
        try:
            while True:
                event = await asyncio.wait_for(queue.get(), timeout=120)
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("stage") == "done":
                    break
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'stage': 'done', 'message': 'timeout'})}\n\n"
        finally:
            _progress_queues.pop(session_id, None)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _emit_progress(session_id: Optional[str], data: dict):
    """Push a progress event to the SSE queue for this session (if any)."""
    if session_id and session_id in _progress_queues:
        await _progress_queues[session_id].put(data)


# --- OSRM helper ---
OSRM_BATCH_SIZE = 50  # max coordinates per batch (public server limit ~100)

async def _osrm_table_batch(
    client: httpx.AsyncClient,
    all_coords: List[Tuple[float, float]],  # (lon, lat) for every node
    src_indices: List[int],
    dst_indices: List[int],
) -> Tuple[List[List[float]], List[List[float]]]:
    """
    Query OSRM Table API for a subset of sources × destinations.
    Builds a coordinate string that includes the union of src and dst indices,
    and uses OSRM's `sources` / `destinations` query params so each request
    stays small even when the full matrix is large.

    Returns (distances_submatrix, durations_submatrix) where each is
    len(src_indices) × len(dst_indices).
    """
    # Build the union of indices we need to send to OSRM
    needed = list(dict.fromkeys(src_indices + dst_indices))  # preserves order, dedupes
    idx_map = {orig: pos for pos, orig in enumerate(needed)}

    coords_str = ";".join(
        f"{all_coords[i][0]},{all_coords[i][1]}" for i in needed
    )
    sources_param = ";".join(str(idx_map[i]) for i in src_indices)
    dests_param   = ";".join(str(idx_map[i]) for i in dst_indices)

    url = (
        f"http://router.project-osrm.org/table/v1/driving/{coords_str}"
        f"?annotations=distance,duration"
        f"&sources={sources_param}&destinations={dests_param}"
    )

    resp = await client.get(url)
    resp.raise_for_status()
    data = resp.json()
    return data["distances"], data["durations"]


async def build_matrices_osrm(
    nodes: List[Tuple[int, float, float]],  # (node_id, lat, lon)
    session_id: Optional[str] = None,
) -> Tuple[Dict, Dict]:
    """
    Call the OSRM Table API to get real road distances (m) and travel times (s)
    for every pair of nodes.  When the number of nodes exceeds OSRM_BATCH_SIZE
    the requests are split into smaller source×destination batches and stitched
    together.  Falls back to 5000 m / 600 s for any cell whose batch fails.
    OSRM expects coordinates as lon,lat (longitude first).
    """
    n = len(nodes)
    # Pre-compute lon,lat list (OSRM order) and id list
    all_coords = [(lon, lat) for _, lat, lon in nodes]
    node_ids   = [nid for nid, _, _ in nodes]

    # Initialise matrices with fallback values
    dist_matrix: Dict = {}
    time_matrix: Dict = {}
    for uid in node_ids:
        for vid in node_ids:
            dist_matrix[(uid, vid)] = 0.0 if uid == vid else 5000.0
            time_matrix[(uid, vid)] = 0.0 if uid == vid else 600.0

    # Split index range into batches
    def _chunks(lst, size):
        for start in range(0, len(lst), size):
            yield lst[start : start + size]

    all_indices = list(range(n))
    src_batches = list(_chunks(all_indices, OSRM_BATCH_SIZE))
    dst_batches = list(_chunks(all_indices, OSRM_BATCH_SIZE))

    total_batch_pairs = len(src_batches) * len(dst_batches)
    print(
        f"[OSRM] Building {n}×{n} matrix in {total_batch_pairs} batch(es) "
        f"(batch size={OSRM_BATCH_SIZE})"
    )
    await _emit_progress(session_id, {
        "stage": "matrix",
        "done": 0,
        "total": total_batch_pairs,
        "message": f"Bắt đầu tải ma trận {n}×{n} ({total_batch_pairs} batch)",
    })

    async with httpx.AsyncClient(timeout=60.0) as client:
        done = 0
        for src_chunk in src_batches:
            for dst_chunk in dst_batches:
                done += 1
                try:
                    distances, durations = await _osrm_table_batch(
                        client, all_coords, src_chunk, dst_chunk
                    )
                    # Write results into the full matrix dicts
                    for ri, si in enumerate(src_chunk):
                        for ci, di in enumerate(dst_chunk):
                            uid, vid = node_ids[si], node_ids[di]
                            dist_matrix[(uid, vid)] = float(distances[ri][ci] or 0.0)
                            time_matrix[(uid, vid)] = float(durations[ri][ci] or 0.0)
                    print(
                        f"[OSRM]   ✓ batch {done}/{total_batch_pairs} — "
                        f"sources {src_chunk[0]}‑{src_chunk[-1]}, "
                        f"dests {dst_chunk[0]}‑{dst_chunk[-1]}"
                    )
                    await _emit_progress(session_id, {
                        "stage": "matrix",
                        "done": done,
                        "total": total_batch_pairs,
                        "message": f"Batch {done}/{total_batch_pairs} ✓",
                    })
                except httpx.TimeoutException:
                    print(
                        f"[OSRM]   ✗ batch {done}/{total_batch_pairs} TIMEOUT "
                        f"(sources {src_chunk[0]}‑{src_chunk[-1]}, "
                        f"dests {dst_chunk[0]}‑{dst_chunk[-1]}) — using fallback"
                    )
                except httpx.HTTPStatusError as e:
                    print(
                        f"[OSRM]   ✗ batch {done}/{total_batch_pairs} HTTP {e.response.status_code} "
                        f"(sources {src_chunk[0]}‑{src_chunk[-1]}, "
                        f"dests {dst_chunk[0]}‑{dst_chunk[-1]}) — using fallback"
                    )
                except Exception as e:
                    print(
                        f"[OSRM]   ✗ batch {done}/{total_batch_pairs} {type(e).__name__}: {e} "
                        f"— using fallback"
                    )
                # Small delay between batches to be polite to the public server
                await asyncio.sleep(0.3)

    print(f"[OSRM] Matrix complete ({n}×{n})")
    await _emit_progress(session_id, {
        "stage": "solving",
        "done": total_batch_pairs,
        "total": total_batch_pairs,
        "message": "Ma trận hoàn tất — đang chạy thuật toán...",
    })
    return dist_matrix, time_matrix


OSRM_ROUTE_WAYPOINT_LIMIT = 25  # max waypoints per /route/v1/ request


async def _osrm_route_segment(
    client: httpx.AsyncClient,
    coords: List[Tuple[float, float]],  # (lat, lon)
) -> List[Tuple[float, float]]:
    """Single OSRM Route API call; returns road-snapped geometry as (lat, lon) list."""
    coords_str = ";".join(f"{lon},{lat}" for lat, lon in coords)
    url = (
        f"http://router.project-osrm.org/route/v1/driving/{coords_str}"
        f"?geometries=geojson&overview=full"
    )
    resp = await client.get(url)
    resp.raise_for_status()
    data = resp.json()
    geo = data["routes"][0]["geometry"]["coordinates"]
    return [(lat, lon) for lon, lat in geo]


async def _fetch_trip_geometry(
    client: httpx.AsyncClient,
    coords: List[Tuple[float, float]],
) -> List[Tuple[float, float]]:
    """
    Fetch road geometry for one trip. Splits into overlapping chunks if the
    trip exceeds OSRM_ROUTE_WAYPOINT_LIMIT waypoints and stitches them back.
    """
    if len(coords) < 2:
        return coords

    if len(coords) <= OSRM_ROUTE_WAYPOINT_LIMIT:
        try:
            return await _osrm_route_segment(client, coords)
        except Exception as e:
            print(f"[OSRM Route] Failed: {e}")
            return coords

    full_geo: List[Tuple[float, float]] = []
    step = OSRM_ROUTE_WAYPOINT_LIMIT - 1  # overlap by 1 point at each boundary
    for start in range(0, len(coords) - 1, step):
        chunk = coords[start : start + OSRM_ROUTE_WAYPOINT_LIMIT]
        if len(chunk) < 2:
            break
        try:
            seg = await _osrm_route_segment(client, chunk)
            full_geo.extend(seg if start == 0 else seg[1:])
            await asyncio.sleep(0.1)
        except Exception as e:
            print(f"[OSRM Route] Segment failed: {e}, using direct line for segment")
            full_geo.extend(chunk if start == 0 else chunk[1:])

    return full_geo or coords


async def build_route_geometries(
    routes_response: list,
    customer_positions: Dict[int, Tuple[float, float]],
    depot_lat: float,
    depot_lon: float,
) -> None:
    """
    Fetch real road geometry for every trip and inject a 'geometry' key
    ([[lat, lon], ...]) into each trip dict in-place.
    Up to 5 trips are fetched concurrently; oversized trips are chunked.
    """
    sem = asyncio.Semaphore(5)

    async def _guarded(client, coords):
        async with sem:
            return await _fetch_trip_geometry(client, coords)

    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = []
        trip_refs = []

        for route in routes_response:
            for trip in route.get("trips", []):
                coords: List[Tuple[float, float]] = []
                for node_id in trip["sequence"]:
                    if node_id == 0:
                        coords.append((depot_lat, depot_lon))
                    elif node_id in customer_positions:
                        coords.append(customer_positions[node_id])
                if len(coords) >= 2:
                    tasks.append(_guarded(client, coords))
                    trip_refs.append(trip)

        geometries = await asyncio.gather(*tasks)

        for trip, geo in zip(trip_refs, geometries):
            trip["geometry"] = [[lat, lon] for lat, lon in geo]


def _build_routes_response(solution, schedules: dict, vehicle_stats: dict) -> list:
    """
    Group trips by vehicle. Each entry represents one vehicle and contains
    all its trips as a list. Frontend should iterate trips, not routes.
    """
    grouped: dict = {}
    trip_counter: dict = {}
    for route in solution.routes:
        if len(route.seq) <= 2:
            continue
        vid = route.vehicle_id
        idx = trip_counter.get(vid, 0)
        trip_counter[vid] = idx + 1
        veh_stops = schedules.get(vid, [])
        trip = {
            "sequence": route.seq,
            "stops": veh_stops[idx] if idx < len(veh_stops) else []
        }
        grouped.setdefault(vid, []).append(trip)

    result = []
    for vid, trips in grouped.items():
        stats = vehicle_stats.get(vid, {})
        result.append({
            "vehicle_id": vid,
            "trips": trips,
            "total_distance_km": round(stats.get("distance_m", 0) / 1000, 2),
            "total_duration_min": round(stats.get("duration_s", 0) / 60, 1),
        })
    return result


# --- API Endpoint ---
@app.post("/api/v1/routing/solve")
async def solve_routing(payload: VRPRequest, session_id: Optional[str] = Query(None)):
    start_time_exec = time.time()

    try:
        # Depot: Bưu điện Hà Nội
        DEPOT_LAT, DEPOT_LON = 21.0245, 105.8412
        depot = Depot(id=0, x=DEPOT_LAT, y=DEPOT_LON, start_time=28800, end_time=86400)

        customers_map = {}
        for o in payload.orders:
            order_obj = Order(
                id=o.id,
                good_list=[],
                weight=o.weight,
                volume=o.volume,
                customer_id=o.customer_id,
                service_duration=o.service_duration
            )
            if o.customer_id not in customers_map:
                customers_map[o.customer_id] = Customer(
                    id=o.customer_id,
                    x=o.lat,
                    y=o.lon,
                    start_time=o.start_time,
                    end_time=o.end_time,
                    order_list=[order_obj]
                )
            else:
                customers_map[o.customer_id].order_list.append(order_obj)

        customers = list(customers_map.values())

        vehicles = [
            Vehicle(
                id=v.id,
                operating_cost=v.operating_cost,
                time_based_cost=v.time_based_cost,
                max_weight=v.max_weight,
                max_volume=v.max_volume,
                max_travel_distance=v.max_travel_distance,
                operating_time=v.operating_time,
            )
            for v in payload.vehicles
        ]

        # Build OSRM distance/time matrices
        node_coords = [(0, DEPOT_LAT, DEPOT_LON)] + [
            (c.id, c.x, c.y) for c in customers
        ]
        _needed_ids = {nid for nid, _, _ in node_coords}
        _hit = _cached_matrices(_needed_ids)
        if _hit:
            dist_matrix, time_matrix = _hit
            print(f"[Matrix Cache] Hit ({len(_needed_ids)} nodes) — skipping OSRM")
            await _emit_progress(session_id, {
                "stage": "solving", "done": 1, "total": 1,
                "message": "Ma trận từ cache — đang chạy thuật toán...",
            })
        else:
            dist_matrix, time_matrix = await build_matrices_osrm(node_coords, session_id=session_id)
            _store_matrix_cache(node_coords, dist_matrix, time_matrix)

        prob = Problem(
            vehicles=vehicles, depots=[depot], customers=customers,
            penalty_weight=25,
            distance_matrix=dist_matrix,
            time_matrix=time_matrix,
            incompatible_goods_pairs=set()
        )

        eval_fn = partial(evaluate, hard_tw=payload.hard_tw)
        solver = GA_TCPVRP_Solver(problem=prob, evaluator=eval_fn)
        solution = solver.solve(time_limit_sec=10.0)

        _, details = eval_fn(prob, solution, return_details=True)
        print(details)
        execution_time = time.time() - start_time_exec

        routes = _build_routes_response(solution, details["schedules"], details["vehicle_stats"])
        customer_positions = {c.id: (c.x, c.y) for c in customers}
        if payload.real_route:
            await build_route_geometries(routes, customer_positions, DEPOT_LAT, DEPOT_LON)

        # Build matrix payload for frontend display
        node_ids = [nid for nid, _, _ in node_coords]
        n = len(node_ids)
        matrix_payload = {
            "node_ids": node_ids,
            "distances_km": [
                [round(dist_matrix[(node_ids[i], node_ids[j])] / 1000, 2) for j in range(n)]
                for i in range(n)
            ],
            "times_min": [
                [round(time_matrix[(node_ids[i], node_ids[j])] / 60, 1) for j in range(n)]
                for i in range(n)
            ],
        }

        return {
            "status": "success",
            "execution_time_seconds": round(execution_time, 2),
            "total_vehicles_used": details.get("num_vehicles", 0),
            "matrix": matrix_payload,
            "costs": {
                "total": round(details.get("total_cost", 0), 2),
                "operating": round(details.get("oc", 0), 2),
                "time_based": round(details.get("tc", 0), 2),
                "penalty": round(details.get("pc", 0), 2),
                "distance_km": round(details.get("distance", 0) / 1000, 2),
            },
            "violations": {
                "capacity": details.get("capacity_violations", 0),
                "volume": details.get("volume_violations", 0),
                "incompatibility": details.get("incompatibility_violations", 0),
                "overtime": details.get("overtime_violations", 0),
                "overdistance": details.get("overdistance_violations", 0),
                "unserved": details.get("unserved_customers", 0)
            },
            "routes": routes
        }

    except Exception as e:
        await _emit_progress(session_id, {"stage": "done", "message": f"Error: {e}"})
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await _emit_progress(session_id, {"stage": "done", "message": "complete"})

@app.post("/api/v1/routing/recalculate")
async def recalculate_routing(payload: RecalculateRequest):
    try:
        # 1. Tái tạo cấu trúc Problem (giống như trong solve_routing)
        DEPOT_LAT, DEPOT_LON = 21.0245, 105.8412
        depot = Depot(id=0, x=DEPOT_LAT, y=DEPOT_LON, start_time=28800, end_time=86400)
        
        # Tạo map khách hàng và xe (copy logic từ hàm solve)
        customers_map = {}
        for o in payload.orders:
            order_obj = Order(id=o.id, good_list=[], weight=o.weight, volume=o.volume, 
                             customer_id=o.customer_id, service_duration=o.service_duration)
            if o.customer_id not in customers_map:
                customers_map[o.customer_id] = Customer(id=o.customer_id, x=o.lat, y=o.lon, 
                                                       start_time=o.start_time, end_time=o.end_time, order_list=[order_obj])
            else:
                customers_map[o.customer_id].order_list.append(order_obj)
        
        vehicles_list = [Vehicle(id=v.id, operating_cost=v.operating_cost, time_based_cost=v.time_based_cost,
                                max_weight=v.max_weight, max_volume=v.max_volume,
                                max_travel_distance=v.max_travel_distance, operating_time=v.operating_time) 
                        for v in payload.vehicles]

        node_coords = [(0, DEPOT_LAT, DEPOT_LON)] + [(c.id, c.x, c.y) for c in customers_map.values()]
        _needed_ids = {nid for nid, _, _ in node_coords}
        _hit = _cached_matrices(_needed_ids)
        if _hit:
            dist_matrix, time_matrix = _hit
            print(f"[Matrix Cache] Hit ({len(_needed_ids)} nodes) — skipping OSRM in recalculate")
        elif _matrix_cache:
            # Incremental: only fetch distances for nodes not yet in the cache
            cached_ids = _matrix_cache[0][0]
            new_nodes  = [(nid, lat, lon) for nid, lat, lon in node_coords if nid not in cached_ids]
            print(f"[Matrix Cache] Incremental — {len(new_nodes)} new node(s), skipping full rebuild")
            dist_matrix, time_matrix = await _extend_matrices_with_new_nodes(new_nodes)
            _store_matrix_cache(node_coords, dist_matrix, time_matrix)
        else:
            print(f"[Matrix Cache] Miss — fetching full OSRM for {len(_needed_ids)} nodes")
            dist_matrix, time_matrix = await build_matrices_osrm(node_coords)
            _store_matrix_cache(node_coords, dist_matrix, time_matrix)

        prob = Problem(vehicles=vehicles_list, depots=[depot], customers=list(customers_map.values()),
                      penalty_weight=25, distance_matrix=dist_matrix, time_matrix=time_matrix, 
                      incompatible_goods_pairs=set())

        from vrp.core.solution import Solution, Route
        user_routes = []
        
        for vehicle_data in payload.routes:
            # SỬA TẠI ĐÂY: Lặp qua tất cả các chuyến (trips) của xe đó
            # Thay vì: seq = vehicle_data['trips'][0]['sequence']
            for trip in vehicle_data.get('trips', []):
                seq = trip.get('sequence', [])
                if len(seq) > 0:
                    user_routes.append(Route(vehicle_id=vehicle_data['vehicle_id'], seq=seq))
        
        new_solution = Solution(routes=user_routes)

        # 3. Chạy hàm evaluate để lấy thông số mới
        _, details = evaluate(prob, new_solution, return_details=True, hard_tw=payload.hard_tw)

        routes = _build_routes_response(new_solution, details["schedules"], details["vehicle_stats"])
        customer_positions = {c.id: (c.x, c.y) for c in customers_map.values()}
        if payload.real_route:
            await build_route_geometries(routes, customer_positions, DEPOT_LAT, DEPOT_LON)

        # 4. Trả về kết quả (sử dụng hàm helper _build_routes_response để gộp lại cho Frontend)
        return {
            "status": "success",
            "costs": {
                "total": round(details.get("total_cost", 0), 2),
                "operating": round(details.get("oc", 0), 2),
                "time_based": round(details.get("tc", 0), 2),
                "penalty": round(details.get("pc", 0), 2),
                "distance_km": round(details.get("distance", 0) / 1000, 2),
            },
            "violations": {
                "capacity": details.get("capacity_violations", 0),
                "volume": details.get("volume_violations", 0),
                "incompatibility": details.get("incompatibility_violations", 0),
                "overtime": details.get("overtime_violations", 0),
                "overdistance": details.get("overdistance_violations", 0),
                "unserved": details.get("unserved_customers", 0)
            },
            "routes": routes
        }
    except Exception as e:
        print(f"Error: {e}") # Debug lỗi ra console
        raise HTTPException(status_code=500, detail=str(e))


# --- Assignments ---
DB_DIR           = Path(__file__).parent.parent / "database"
ASSIGNMENTS_PATH = DB_DIR / "assignments" / "assignments.json"
VEHICLES_PATH    = DB_DIR / "vehicles"    / "vehicles.json"
DRIVERS_PATH     = DB_DIR / "drivers"     / "drivers.json"
ORDERS_PATH      = DB_DIR / "orders"      / "orders.json"
CUSTOMERS_PATH   = DB_DIR / "customers"   / "customers.json"
PRODUCTS_PATH    = DB_DIR / "products"    / "products.json"

class AssignmentConfirmRequest(BaseModel):
    data: Any

@app.post("/api/v1/assignments/confirm")
async def confirm_assignment(payload: AssignmentConfirmRequest):
    try:
        data = payload.data

        # Load vehicles first to build vehicle_id → driver_id map
        vehicles_db = json.loads(VEHICLES_PATH.read_text(encoding="utf-8"))
        vehicle_to_driver = {v["id"]: v.get("driver_id") for v in vehicles_db["vehicles"]}

        # Collect vehicle_ids and order_id → driver_id mapping
        vehicle_ids: set = set()
        order_driver_map: dict = {}  # order_id → driver_id
        for v in data.get("vehicles", []):
            vid = v["vehicle_id"]
            vehicle_ids.add(vid)
            driver_id = vehicle_to_driver.get(vid)
            for trip in v.get("trips", []):
                for customer in trip.get("customers", []):
                    for order in customer.get("orders", []):
                        order_driver_map[order["order_id"]] = driver_id

        driver_ids = {did for did in order_driver_map.values() if did is not None}

        # Archive previous assignment before overwriting
        ASSIGNMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        history_dir = ASSIGNMENTS_PATH.parent / "history"
        history_dir.mkdir(exist_ok=True)
        if ASSIGNMENTS_PATH.exists():
            prev = ASSIGNMENTS_PATH.read_text(encoding="utf-8").strip()
            if prev and prev != "null":
                import datetime as _dt
                ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
                (history_dir / f"assignments_{ts}.json").write_text(prev, encoding="utf-8")

        # Write new assignment
        ASSIGNMENTS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        # Update vehicles.json (already loaded)
        for v in vehicles_db["vehicles"]:
            if v["id"] in vehicle_ids:
                v["status"] = "assigned"
        VEHICLES_PATH.write_text(json.dumps(vehicles_db, ensure_ascii=False, indent=2), encoding="utf-8")

        # Update drivers.json
        drivers_db = json.loads(DRIVERS_PATH.read_text(encoding="utf-8"))
        for d in drivers_db["drivers"]:
            if d["id"] in driver_ids:
                d["status"] = "assigned"
        DRIVERS_PATH.write_text(json.dumps(drivers_db, ensure_ascii=False, indent=2), encoding="utf-8")

        # Update orders.json — set status AND driver_id
        orders_db = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
        for o in orders_db["orders"]:
            if o["id"] in order_driver_map:
                o["status"] = "assigned"
                o["driver_id"] = order_driver_map[o["id"]]
        ORDERS_PATH.write_text(json.dumps(orders_db, ensure_ascii=False, indent=2), encoding="utf-8")

        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Driver & Customer auth ---

class DriverLoginRequest(BaseModel):
    phone: str
    password: str

@app.post("/api/v1/drivers/login")
async def driver_login(payload: DriverLoginRequest):
    drivers_db = json.loads(DRIVERS_PATH.read_text(encoding="utf-8"))
    for d in drivers_db["drivers"]:
        if d.get("phone") == payload.phone and d.get("password") == payload.password:
            return {"driver": {k: v for k, v in d.items() if k != "password"}}
    raise HTTPException(status_code=401, detail="Số điện thoại hoặc mật khẩu không đúng")


@app.post("/api/v1/customers/login")
async def customer_login(payload: DriverLoginRequest):
    customers_db = json.loads(CUSTOMERS_PATH.read_text(encoding="utf-8"))
    for c in customers_db["customers"]:
        if c.get("phone") == payload.phone and c.get("password") == payload.password:
            return {"customer": {k: v for k, v in c.items() if k != "password"}}
    raise HTTPException(status_code=401, detail="Số điện thoại hoặc mật khẩu không đúng")


@app.get("/api/v1/customers/{customer_id}/orders")
async def get_customer_orders(customer_id: int):
    orders_db = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
    customer_orders = [o for o in orders_db["orders"] if o["customer_id"] == customer_id]

    # Look up expected arrival time from assignments.json
    arrival_map: dict = {}  # customer_id -> arrival_time string
    try:
        assignments_text = ASSIGNMENTS_PATH.read_text(encoding="utf-8").strip()
        if assignments_text and assignments_text != "null":
            assignments = json.loads(assignments_text)
            for vehicle in assignments.get("vehicles", []):
                for trip in vehicle.get("trips", []):
                    for stop in trip.get("customers", []):
                        cid = stop.get("customer_id")
                        if cid and stop.get("arrival_time"):
                            arrival_map[cid] = stop["arrival_time"]
    except Exception:
        pass

    for o in customer_orders:
        o["arrival_time"] = arrival_map.get(o["customer_id"])

    return {"orders": customer_orders}


@app.get("/api/v1/products")
async def list_products():
    return json.loads(PRODUCTS_PATH.read_text(encoding="utf-8"))


class PlaceOrderRequest(BaseModel):
    product_ids: List[int]
    time_window_start: str
    time_window_end: str
    notes: str = ""

@app.post("/api/v1/customers/{customer_id}/orders")
async def place_customer_orders(customer_id: int, payload: PlaceOrderRequest):
    if not payload.product_ids:
        raise HTTPException(status_code=400, detail="No products selected")

    products_db = json.loads(PRODUCTS_PATH.read_text(encoding="utf-8"))
    product_map = {p["id"]: p for p in products_db["products"]}

    orders_db = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
    next_id = max((o["id"] for o in orders_db["orders"]), default=10000) + 1

    today = _sim_date
    new_orders = []
    for i, pid in enumerate(payload.product_ids):
        product = product_map.get(pid)
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {pid} not found")
        new_orders.append({
            "id":                next_id + i,
            "customer_id":       customer_id,
            "product_name":      product["name"],
            "category":          product["category"],
            "weight":            product["weight"],
            "volume":            product["volume"],
            "time_window_start": payload.time_window_start,
            "time_window_end":   payload.time_window_end,
            "service_duration":  10,
            "status":            "pending",
            "driver_id":         None,
            "created_at":        today,
            "notes":             payload.notes,
        })

    orders_db["orders"].extend(new_orders)
    ORDERS_PATH.write_text(json.dumps(orders_db, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"status": "ok", "created": len(new_orders), "orders": new_orders}


@app.get("/api/v1/drivers/{driver_id}/orders")
async def get_driver_orders(driver_id: int):
    # Find this driver's vehicle
    vehicles_db = json.loads(VEHICLES_PATH.read_text(encoding="utf-8"))
    driver_vehicle = next((v for v in vehicles_db["vehicles"] if v.get("driver_id") == driver_id), None)
    if not driver_vehicle:
        return {"trips": [], "vehicle": None}

    vehicle_id = driver_vehicle["id"]

    # Load assignments for route sequence and timing
    if not ASSIGNMENTS_PATH.exists():
        return {"trips": [], "vehicle": driver_vehicle}
    assignments_text = ASSIGNMENTS_PATH.read_text(encoding="utf-8").strip()
    if not assignments_text or assignments_text in ("", "null"):
        return {"trips": [], "vehicle": driver_vehicle}
    try:
        assignments = json.loads(assignments_text)
    except Exception:
        return {"trips": [], "vehicle": driver_vehicle}

    vehicle_assignment = next(
        (v for v in assignments.get("vehicles", []) if v["vehicle_id"] == vehicle_id), None
    )
    if not vehicle_assignment:
        return {"trips": [], "vehicle": driver_vehicle}

    # Build live order detail map from orders.json (product info + current status)
    orders_db = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
    order_detail_map = {
        o["id"]: {
            "product_name": o.get("product_name", ""),
            "category":     o.get("category", ""),
            "notes":        o.get("notes", ""),
            "status":       o.get("status", "assigned"),
        }
        for o in orders_db["orders"]
    }

    # Build customer info map from customers.json
    customers_db = json.loads(CUSTOMERS_PATH.read_text(encoding="utf-8"))
    customer_info_map = {
        c["id"]: {"phone": c.get("phone"), "lat": c.get("lat"), "lon": c.get("lon")}
        for c in customers_db["customers"]
    }

    # Build trips → stops → orders in assignment sequence
    trips = []
    for trip in vehicle_assignment.get("trips", []):
        stops = []
        for customer in trip.get("customers", []):
            orders_at_stop = []
            for order in customer.get("orders", []):
                oid = order["order_id"]
                detail = order_detail_map.get(oid, {})
                orders_at_stop.append({
                    "id":                   oid,
                    "product_name":         detail.get("product_name", ""),
                    "category":             detail.get("category", ""),
                    "weight":               order["weight"],
                    "volume":               order["volume"],
                    "service_duration_min": order["service_duration_min"],
                    "notes":                detail.get("notes", ""),
                    "status":               detail.get("status", "assigned"),
                })
            cinfo = customer_info_map.get(customer["customer_id"], {})
            stops.append({
                "stop_index":      customer["stop_index"],
                "customer_id":     customer["customer_id"],
                "customer_name":   customer.get("name"),
                "customer_address":customer.get("address"),
                "customer_phone":  cinfo.get("phone"),
                "lat":             customer.get("lat") if customer.get("lat") is not None else cinfo.get("lat"),
                "lon":             customer.get("lon") if customer.get("lon") is not None else cinfo.get("lon"),
                "time_window":     customer.get("time_window"),
                "arrival_time":    customer.get("arrival_time"),
                "departure_time":  customer.get("departure_time"),
                "orders":          orders_at_stop,
            })
        trips.append({
            "trip_index": trip["trip_index"],
            "geometry":   trip.get("geometry"),
            "stops":      stops,
        })

    return {
        "vehicle": {
            "id":     driver_vehicle["id"],
            "type":   driver_vehicle.get("type"),
            "plate":  driver_vehicle.get("plate"),
            "status": driver_vehicle.get("status"),
        },
        "trips": trips,
    }


class OrderStatusUpdate(BaseModel):
    status: str

class BulkOrderStatusUpdate(BaseModel):
    order_ids: List[int]
    status: str

_CANCELLABLE = {"pending", "failed"}

@app.patch("/api/v1/orders/bulk-status")
async def bulk_update_order_status(payload: BulkOrderStatusUpdate):
    if payload.status not in ("in_transit", "delivered", "failed", "cancelled"):
        raise HTTPException(status_code=400, detail="Invalid status")
    id_set = set(payload.order_ids)
    orders_db = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
    updated = 0
    for o in orders_db["orders"]:
        if o["id"] in id_set:
            if payload.status == "cancelled" and o["status"] not in _CANCELLABLE:
                continue
            o["status"] = payload.status
            updated += 1
    ORDERS_PATH.write_text(json.dumps(orders_db, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"status": "ok", "updated": updated}

@app.patch("/api/v1/orders/{order_id}/status")
async def update_order_status(order_id: int, payload: OrderStatusUpdate):
    if payload.status not in ("in_transit", "delivered", "failed", "cancelled"):
        raise HTTPException(status_code=400, detail="Invalid status")
    orders_db = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
    for o in orders_db["orders"]:
        if o["id"] == order_id:
            if payload.status == "cancelled" and o["status"] not in _CANCELLABLE:
                raise HTTPException(status_code=400, detail="Chỉ huỷ được khi đơn đang chờ xử lý hoặc giao thất bại")
            o["status"] = payload.status
            ORDERS_PATH.write_text(json.dumps(orders_db, ensure_ascii=False, indent=2), encoding="utf-8")
            return {"status": "ok"}
    raise HTTPException(status_code=404, detail="Order not found")

@app.patch("/api/v1/customers/{customer_id}/orders/{order_id}/cancel")
async def cancel_customer_order(customer_id: int, order_id: int):
    orders_db = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
    for o in orders_db["orders"]:
        if o["id"] == order_id and o["customer_id"] == customer_id:
            if o["status"] not in _CANCELLABLE:
                raise HTTPException(status_code=400, detail="Chỉ huỷ được khi đơn đang chờ xử lý hoặc giao thất bại")
            o["status"] = "cancelled"
            ORDERS_PATH.write_text(json.dumps(orders_db, ensure_ascii=False, indent=2), encoding="utf-8")
            return {"status": "ok"}
    raise HTTPException(status_code=404, detail="Order not found")


_CATEGORIES = ['Điện tử', 'Gia dụng', 'Thời trang', 'Điện máy', 'Thực phẩm', 'Nội thất', 'Y tế', 'Thể thao', 'Trang trí', 'Mỹ phẩm', 'Trẻ em', 'Âm nhạc', 'Đồ chơi', 'Xe cộ', 'Sách']
_PRODUCT_NAMES = {
    'Điện tử':   ['Laptop Gaming', 'Điện thoại Samsung', 'Tai nghe Bluetooth', 'Máy tính bảng', 'Loa di động'],
    'Gia dụng':  ['Nồi cơm điện', 'Máy xay sinh tố', 'Bàn là hơi nước', 'Quạt điện', 'Ấm đun nước'],
    'Thời trang':['Áo khoác nam', 'Váy dạo phố', 'Giày thể thao', 'Túi xách nữ', 'Đồng hồ đeo tay'],
    'Điện máy':  ['Máy lọc không khí', 'Điều hòa mini', 'Tủ lạnh mini', 'Máy giặt', 'Máy hút bụi'],
    'Thực phẩm': ['Hộp quà tết', 'Thùng bia', 'Giỏ trái cây', 'Hộp bánh kẹo', 'Thùng nước uống'],
    'Nội thất':  ['Ghế văn phòng', 'Kệ sách', 'Đèn bàn', 'Gương trang trí', 'Thảm trải sàn'],
    'Y tế':      ['Máy đo huyết áp', 'Hộp sơ cứu', 'Máy xông hơi', 'Nệm massage', 'Kính mắt'],
    'Thể thao':  ['Vợt cầu lông', 'Bóng đá', 'Thảm yoga', 'Bình nước thể thao', 'Găng tay tập gym'],
    'Trang trí': ['Bình hoa', 'Tranh treo tường', 'Nến thơm', 'Chậu cây cảnh', 'Đèn trang trí'],
    'Mỹ phẩm':  ['Kem dưỡng da', 'Son môi', 'Nước hoa', 'Bộ trang điểm', 'Dầu gội đầu'],
    'Trẻ em':   ['Đồ chơi xếp hình', 'Sách tô màu', 'Balo học sinh', 'Bộ vẽ màu nước', 'Xe đẩy em bé'],
    'Âm nhạc':  ['Đàn ukulele', 'Sáo trúc', 'Micro karaoke', 'Dây đàn guitar', 'Kèn harmonica'],
    'Đồ chơi':  ['Robot lắp ghép', 'Búp bê barbie', 'Xe điều khiển', 'Lego mini', 'Con quay fidget'],
    'Xe cộ':    ['Mũ bảo hiểm', 'Găng tay lái xe', 'Gương chiếu hậu', 'Dụng cụ vá xe', 'Túi đựng xe máy'],
    'Sách':     ['Sách kỹ năng sống', 'Truyện tranh', 'Sách giáo khoa', 'Tiểu thuyết', 'Sách nấu ăn'],
}
_TIME_WINDOWS = [('07:00','10:00'),('08:00','12:00'),('09:00','13:00'),('13:00','17:00'),('14:00','18:00'),('16:00','20:00')]

import random as _random

@app.post("/api/v1/orders/generate-random")
async def generate_random_orders(count: int = 5):
    """Generate random orders from existing customers and write to orders.json."""
    if count < 1:
        raise HTTPException(status_code=400, detail="count must be at least 1")

    customers_db = json.loads(CUSTOMERS_PATH.read_text(encoding="utf-8"))
    customers = customers_db["customers"]
    if not customers:
        raise HTTPException(status_code=400, detail="No customers in database")

    orders_db = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
    existing = orders_db["orders"]
    next_id = max((o["id"] for o in existing), default=10000) + 1

    today = _sim_date
    new_orders = []
    for i in range(count):
        customer = _random.choice(customers)
        category = _random.choice(_CATEGORIES)
        base_name = _random.choice(_PRODUCT_NAMES[category])
        product = f"{base_name} #{next_id + i}"
        tw_start, tw_end = _random.choice(_TIME_WINDOWS)
        new_orders.append({
            "id":               next_id + i,
            "customer_id":      customer["id"],
            "product_name":     product,
            "category":         category,
            "weight":           round(_random.uniform(0.5, 35), 1),
            "volume":           round(_random.uniform(0.05, 2.0), 2),
            "time_window_start": tw_start,
            "time_window_end":   tw_end,
            "service_duration":  _random.choice([5, 10, 15, 20]),
            "status":           "pending",
            "driver_id":        None,
            "created_at":       today,
            "notes":            "",
        })

    orders_db["orders"].extend(new_orders)
    ORDERS_PATH.write_text(json.dumps(orders_db, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"status": "ok", "created": len(new_orders), "orders": new_orders}


@app.post("/api/v1/orders/reset-pending")
async def reset_all_orders_pending():
    """Reset all orders to pending status and clear driver assignments (demo helper)."""
    orders_db = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
    for o in orders_db["orders"]:
        o["status"] = "pending"
        o["driver_id"] = None
    ORDERS_PATH.write_text(json.dumps(orders_db, ensure_ascii=False, indent=2), encoding="utf-8")

    vehicles_db = json.loads(VEHICLES_PATH.read_text(encoding="utf-8"))
    for v in vehicles_db["vehicles"]:
        v["status"] = "available"
    VEHICLES_PATH.write_text(json.dumps(vehicles_db, ensure_ascii=False, indent=2), encoding="utf-8")

    drivers_db = json.loads(DRIVERS_PATH.read_text(encoding="utf-8"))
    for d in drivers_db["drivers"]:
        d["status"] = "available"
    DRIVERS_PATH.write_text(json.dumps(drivers_db, ensure_ascii=False, indent=2), encoding="utf-8")

    ASSIGNMENTS_PATH.write_text(json.dumps(None, ensure_ascii=False), encoding="utf-8")

    total = len(orders_db["orders"])
    return {"status": "ok", "reset": total}


@app.get("/api/v1/drivers/{driver_id}/route-geometry")
async def fetch_driver_route_geometry(driver_id: int):
    """Fetch real road geometry from OSRM for the driver's assignment, cache it back to assignments.json."""
    vehicles_db = json.loads(VEHICLES_PATH.read_text(encoding="utf-8"))
    driver_vehicle = next((v for v in vehicles_db["vehicles"] if v.get("driver_id") == driver_id), None)
    if not driver_vehicle:
        raise HTTPException(status_code=404, detail="Driver vehicle not found")

    vehicle_id = driver_vehicle["id"]
    assignments_text = ASSIGNMENTS_PATH.read_text(encoding="utf-8").strip()
    if not assignments_text or assignments_text in ("", "null"):
        raise HTTPException(status_code=404, detail="No assignment found")
    assignments = json.loads(assignments_text)

    vehicle_assignment = next(
        (v for v in assignments.get("vehicles", []) if v["vehicle_id"] == vehicle_id), None
    )
    if not vehicle_assignment:
        raise HTTPException(status_code=404, detail="Vehicle not in assignment")

    DEPOT_LAT, DEPOT_LON = 21.0245, 105.8412
    customers_db = json.loads(CUSTOMERS_PATH.read_text(encoding="utf-8"))
    customer_coords = {c["id"]: (c["lat"], c["lon"]) for c in customers_db["customers"] if c.get("lat") and c.get("lon")}

    # Build per-trip coordinate lists and fetch geometry
    result_geometries: list = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for trip in vehicle_assignment.get("trips", []):
            coords: list = [(DEPOT_LAT, DEPOT_LON)]
            for customer in trip.get("customers", []):
                pos = customer_coords.get(customer["customer_id"])
                if pos:
                    coords.append(pos)
            coords.append((DEPOT_LAT, DEPOT_LON))
            if len(coords) >= 2:
                geo = await _fetch_trip_geometry(client, coords)
                result_geometries.append([[lat, lon] for lat, lon in geo])
                trip["geometry"] = [[lat, lon] for lat, lon in geo]
            else:
                result_geometries.append(None)

    # Write geometry back to assignments.json for future loads
    ASSIGNMENTS_PATH.write_text(json.dumps(assignments, ensure_ascii=False, indent=2), encoding="utf-8")

    return {"geometries": result_geometries}


# --- GPS Location Tracking ---

class LocationUpdate(BaseModel):
    lat: float
    lon: float

@app.post("/api/v1/drivers/{driver_id}/location")
async def update_driver_location(driver_id: int, payload: LocationUpdate):
    _driver_locations[driver_id] = {"driver_id": driver_id, "lat": payload.lat, "lon": payload.lon}
    return {"status": "ok"}

@app.get("/api/v1/drivers/locations")
async def get_all_driver_locations():
    return {"locations": list(_driver_locations.values())}


# --- Simulated Dispatch Date ---

class SimDatePayload(BaseModel):
    date: str

@app.get("/api/v1/config/sim-date")
def get_sim_date():
    return {"date": _sim_date}

@app.post("/api/v1/config/sim-date")
def set_sim_date(payload: SimDatePayload):
    global _sim_date
    _sim_date = payload.date
    return {"date": _sim_date}


# --- Admin: All Orders ---

@app.get("/api/v1/admin/orders")
def admin_get_all_orders():
    orders_db = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
    return {"orders": orders_db["orders"]}