from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Tuple, Dict, Optional, Callable, Awaitable
from functools import partial
import asyncio
import json
import uuid
import time
import httpx

from vrp.core.problem import Problem, Customer, Order, Vehicle, Depot
from vrp.solvers.ga_tcpvrp import GA_TCPVRP_Solver
from vrp.core.eval import evaluate

# Global progress store: session_id -> asyncio.Queue of SSE events
_progress_queues: Dict[str, asyncio.Queue] = {}

# Matrix cache: list of (frozenset_of_node_ids, dist_matrix, time_matrix).
# Keeps only the most recent entry — cleared and replaced on every new solve or
# cache-miss recalculate so memory stays bounded.
_matrix_cache: list = []

def _cached_matrices(node_ids: set):
    """Return (dist_matrix, time_matrix) if all node_ids are covered, else None."""
    for cached_ids, dist, time_m in _matrix_cache:
        if node_ids <= cached_ids:
            return dist, time_m
    return None

def _store_matrix_cache(node_ids: set, dist: dict, time_m: dict):
    _matrix_cache.clear()
    _matrix_cache.append((frozenset(node_ids), dist, time_m))

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
            _store_matrix_cache(_needed_ids, dist_matrix, time_matrix)

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
        else:
            print(f"[Matrix Cache] Miss — fetching OSRM for {len(_needed_ids)} nodes")
            dist_matrix, time_matrix = await build_matrices_osrm(node_coords)
            _store_matrix_cache(_needed_ids, dist_matrix, time_matrix)

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