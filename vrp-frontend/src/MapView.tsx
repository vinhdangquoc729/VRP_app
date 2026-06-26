import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon broken by Vite's asset bundling
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DEPOT_LAT = 21.0245;
const DEPOT_LON = 105.8412;

const ROUTE_COLORS = [
  '#e67e22', '#2980b9', '#27ae60', '#8e44ad',
  '#c0392b', '#16a085', '#d35400', '#2c3e50',
];

const depotIcon = L.divIcon({
  className: '',
  html: `<div style="background:#1e293b;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)">🏬</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const makeCustomerIcon = (label: string, color: string) => L.divIcon({
  className: '',
  html: `<div style="background:${color};color:#fff;min-width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,0.35);padding:0 4px">${label}</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const makeVehicleIcon = (_vehicleId: number, color: string) => L.divIcon({
  className: '',
  html: `<div style="background:${color};color:#fff;width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;border:3px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,0.55)">🚚</div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

// Find the index in `geom` closest to (lat, lon), searching only from `fromIdx` onward
function closestGeomIndex(geom: [number, number][], lat: number, lon: number, fromIdx = 0): number {
  let best = fromIdx, bestDist = Infinity;
  for (let i = fromIdx; i < geom.length; i++) {
    const d = (geom[i][0] - lat) ** 2 + (geom[i][1] - lon) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// Interpolate a point at fraction `t` along a polyline path
function interpolateAlongPath(path: [number, number][], t: number): [number, number] {
  if (path.length === 1) return path[0];
  const dists = [0];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    dists.push(dists[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const target = t * dists[dists.length - 1];
  for (let i = 1; i < dists.length; i++) {
    if (target <= dists[i]) {
      const seg = (target - dists[i - 1]) / (dists[i] - dists[i - 1]);
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * seg,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * seg,
      ];
    }
  }
  return path[path.length - 1];
}

function computeVehiclePositions(
  result: any,
  customerPositions: { id: number; lat: number; lon: number }[],
  simTime: number
): { vehicleId: number; lat: number; lon: number; color: string }[] {
  const output: { vehicleId: number; lat: number; lon: number; color: string }[] = [];

  const getPos = (nodeId: number): [number, number] | null => {
    if (nodeId === 0) return [DEPOT_LAT, DEPOT_LON];
    const p = customerPositions.find(c => c.id === nodeId);
    return p ? [p.lat, p.lon] : null;
  };

  result.routes?.forEach((route: any, idx: number) => {
    const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
    for (const trip of (route.trips ?? [])) {
      const stops: any[] = trip.stops;
      if (!stops || stops.length < 2) continue;
      const tripStart = stops[0].departure_time ?? stops[0].arrival_time ?? 0;
      const tripEnd = stops[stops.length - 1].arrival_time ?? 0;
      if (simTime < tripStart || simTime > tripEnd) continue;

      // Full trip geometry (real route mode) — array of [lat, lon]
      const geom: [number, number][] | null = trip.geometry ?? null;

      // Pre-compute geometry indices for each stop when geometry is available
      let geomIndices: number[] | null = null;
      if (geom && geom.length >= 2) {
        geomIndices = [];
        let searchFrom = 0;
        for (const s of stops) {
          const pos = getPos(s.node_id);
          if (pos) {
            const gi = closestGeomIndex(geom, pos[0], pos[1], searchFrom);
            geomIndices.push(gi);
            searchFrom = gi;
          } else {
            geomIndices.push(searchFrom);
          }
        }
      }

      let placed = false;
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        const arrT = s.arrival_time ?? 0;
        const depT = s.departure_time ?? arrT;

        // Vehicle is at a stop (loading/unloading)
        if (simTime >= arrT && simTime <= depT) {
          const pos = getPos(s.node_id);
          if (pos) output.push({ vehicleId: route.vehicle_id, lat: pos[0], lon: pos[1], color });
          placed = true;
          break;
        }

        // Vehicle is travelling from stop i to stop i+1
        if (i < stops.length - 1) {
          const ns = stops[i + 1];
          const nsArr = ns.arrival_time ?? 0;
          if (simTime > depT && simTime < nsArr) {
            const dur = nsArr - depT;
            const t = dur > 0 ? (simTime - depT) / dur : 0;

            if (geom && geomIndices) {
              // Interpolate along the road geometry sub-segment
              const gi0 = geomIndices[i];
              const gi1 = geomIndices[i + 1];
              const subPath = gi1 > gi0 ? geom.slice(gi0, gi1 + 1) : geom.slice(gi0, gi0 + 1);
              const [lat, lon] = interpolateAlongPath(subPath.length >= 2 ? subPath : [geom[gi0], geom[Math.min(gi1, geom.length - 1)]], t);
              output.push({ vehicleId: route.vehicle_id, lat, lon, color });
            } else {
              // Fallback: straight-line interpolation
              const fromPos = getPos(s.node_id);
              const toPos = getPos(ns.node_id);
              if (fromPos && toPos) {
                output.push({
                  vehicleId: route.vehicle_id,
                  lat: fromPos[0] + (toPos[0] - fromPos[0]) * t,
                  lon: fromPos[1] + (toPos[1] - fromPos[1]) * t,
                  color,
                });
              }
            }
            placed = true;
            break;
          }
        }
      }

      if (!placed) {
        const lastStop = stops[stops.length - 1];
        if (simTime >= (lastStop.arrival_time ?? 0)) {
          const pos = getPos(lastStop.node_id);
          if (pos) output.push({ vehicleId: route.vehicle_id, lat: pos[0], lon: pos[1], color });
        }
      }
    }
  });

  return output;
}

// Returns the untraversed portion of a trip's geometry from the current simTime position
function buildRemainingCoords(
  trip: any,
  simTime: number,
  customerPositions: { id: number; lat: number; lon: number }[]
): [number, number][] {
  const stops: any[] = trip.stops ?? [];
  if (stops.length < 2) return [];

  const getPos = (nodeId: number): [number, number] | null => {
    if (nodeId === 0) return [DEPOT_LAT, DEPOT_LON];
    const p = customerPositions.find(c => c.id === nodeId);
    return p ? [p.lat, p.lon] : null;
  };

  const tripStart = stops[0].departure_time ?? stops[0].arrival_time ?? 0;
  const tripEnd   = stops[stops.length - 1].arrival_time ?? 0;

  if (simTime < tripStart) {
    const geom: [number, number][] | null = trip.geometry ?? null;
    if (geom) return geom;
    return stops.map((s: any) => getPos(s.node_id)).filter(Boolean) as [number, number][];
  }
  if (simTime >= tripEnd) return [];

  let fromStopIdx = 0;
  for (let i = 0; i < stops.length; i++) {
    const depT = stops[i].departure_time ?? stops[i].arrival_time ?? 0;
    if (simTime >= depT) fromStopIdx = i;
    else break;
  }

  const geom: [number, number][] | null = trip.geometry ?? null;
  if (geom && geom.length >= 2) {
    let searchFrom = 0, startGeomIdx = 0;
    for (let i = 0; i <= fromStopIdx; i++) {
      const pos = getPos(stops[i].node_id);
      if (pos) {
        const gi = closestGeomIndex(geom, pos[0], pos[1], searchFrom);
        if (i === fromStopIdx) startGeomIdx = gi;
        searchFrom = gi;
      }
    }
    return geom.slice(startGeomIdx);
  }

  const coords: [number, number][] = [];
  for (let i = fromStopIdx; i < stops.length; i++) {
    const p = getPos(stops[i].node_id);
    if (p) coords.push(p);
  }
  return coords;
}

// Fit bounds once on first load only
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const hasFit = useRef(false);
  useEffect(() => {
    if (!hasFit.current && positions.length > 1) {
      map.fitBounds(L.latLngBounds(positions), { padding: [40, 40] });
      hasFit.current = true;
    }
  }, [map, positions]);
  return null;
}


interface Props {
  customerDB: Record<number, { name: string; address: string; time: string; lat?: number | null; lon?: number | null }>;
  orders: any[];
  result: any;
  selectedVehicleId: number | null;
  simTime?: number | null;
}

export default function MapView({ customerDB, orders, result, simTime }: Props) {
  const HANOI_CENTER: [number, number] = [21.02, 105.83];
  const [mapVehicleFilter, setMapVehicleFilter] = useState<number | string>('all');
  const [showUnvisitedOnly, setShowUnvisitedOnly] = useState(false);
  const [showUntraversedOnly, setShowUntraversedOnly] = useState(false);

  // Build list of all positioned nodes
  const customerPositions: { id: number; lat: number; lon: number; name: string; address: string; time: string }[] = [];
  for (const o of orders) {
    const info = customerDB[o.customer_id];
    if (o.lat != null && o.lon != null && !customerPositions.find(p => p.id === o.customer_id)) {
      customerPositions.push({ id: o.customer_id, lat: o.lat, lon: o.lon, name: info?.name ?? `#${o.customer_id}`, address: info?.address ?? '', time: info?.time ?? '' });
    }
  }


  // Build route polylines from result — one line per trip, grouped by vehicle
  const routeLines: { vehicleId: number; color: string; coords: [number, number][]; key: string }[] = [];
  if (result?.routes) {
    result.routes.forEach((route: any, idx: number) => {
      const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
      route.trips?.forEach((trip: any, tripIdx: number) => {
        const key = `route-${route.vehicle_id}-trip-${tripIdx}`;
        const coords: [number, number][] = (showUntraversedOnly && simTime != null)
          ? buildRemainingCoords(trip, simTime, customerPositions)
          : (trip.geometry || trip.sequence.map((nodeId: number) => {
              if (nodeId === 0) return [DEPOT_LAT, DEPOT_LON] as [number, number];
              const p = customerPositions.find(c => c.id === nodeId);
              return p ? [p.lat, p.lon] as [number, number] : null;
            }).filter(Boolean));

        if (coords.length > 1) routeLines.push({ vehicleId: route.vehicle_id, color, coords, key });
      });
    });
  }

  const visibleRoutes = mapVehicleFilter === 'all'
    ? routeLines
    : routeLines.filter(r => r.vehicleId === mapVehicleFilter);

  // Get unique vehicle IDs from result
  const vehicleIds = result?.routes?.map((r: any) => r.vehicle_id) ?? [];
  const uniqueVehicleIds = Array.from(new Set(vehicleIds)) as number[];

  // Assign a color to each customer based on which vehicle visits it
  const customerColor: Record<number, string> = {};
  if (result?.routes) {
    result.routes.forEach((route: any, idx: number) => {
      const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
      route.trips?.forEach((trip: any) => {
        trip.sequence.forEach((nodeId: number) => {
          if (nodeId !== 0) customerColor[nodeId] = color;
        });
      });
    });
  }

  const vehiclePositions = (simTime != null && result?.routes)
    ? computeVehiclePositions(result, customerPositions, simTime)
    : [];

  // Build vehicle → customer-id set for marker filtering
  const vehicleCustomers: Record<number, Set<number>> = {};
  if (result?.routes) {
    result.routes.forEach((route: any) => {
      const vid = route.vehicle_id;
      if (!vehicleCustomers[vid]) vehicleCustomers[vid] = new Set();
      route.trips?.forEach((trip: any) => {
        trip.sequence.forEach((nodeId: number) => {
          if (nodeId !== 0) vehicleCustomers[vid].add(nodeId);
        });
      });
    });
  }

  const visitedCustomerIds = new Set<number>();
  if (simTime != null && result?.routes) {
    result.routes.forEach((route: any) => {
      route.trips?.forEach((trip: any) => {
        trip.stops?.forEach((stop: any) => {
          if (stop.node_id !== 0 && simTime >= (stop.arrival_time ?? Infinity)) {
            visitedCustomerIds.add(stop.node_id);
          }
        });
      });
    });
  }

  let visibleCustomers = mapVehicleFilter === 'all'
    ? customerPositions
    : customerPositions.filter(p => (vehicleCustomers[mapVehicleFilter as number] ?? new Set()).has(p.id));
  if (showUnvisitedOnly && simTime != null) {
    visibleCustomers = visibleCustomers.filter(p => !visitedCustomerIds.has(p.id));
  }

  const visibleVehiclePositions = mapVehicleFilter === 'all'
    ? vehiclePositions
    : vehiclePositions.filter(vp => vp.vehicleId === (mapVehicleFilter as number));

  const fitPositions: [number, number][] = [
    [DEPOT_LAT, DEPOT_LON],
    ...visibleCustomers.map(p => [p.lat, p.lon] as [number, number]),
  ];

  // Bounds covering greater Hanoi — prevents zooming/panning to disputed South China Sea islands
  const HANOI_MAX_BOUNDS: [[number, number], [number, number]] = [[20.7, 105.4], [21.5, 106.4]];

  return (
    <MapContainer
      center={HANOI_CENTER}
      zoom={11}
      minZoom={10}
      maxBounds={HANOI_MAX_BOUNDS}
      maxBoundsViscosity={1.0}
      style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds positions={fitPositions} />

      {/* Depot */}
      <Marker position={[DEPOT_LAT, DEPOT_LON]} icon={depotIcon}>
        <Popup>
          <strong>Kho trung tâm</strong><br />
          Bưu điện Hà Nội
        </Popup>
      </Marker>

      {/* Customer markers */}
      {visibleCustomers.map((p, idx) => {
        const color = customerColor[p.id] ?? '#64748b';
        return (
          <Marker key={p.id} position={[p.lat, p.lon]} icon={makeCustomerIcon(String(idx + 1), color)}>
            <Popup>
              <strong>{p.name}</strong><br />
              📍 {p.address}<br />
              ⏰ {p.time}
            </Popup>
          </Marker>
        );
      })}

      {/* Route polylines */}
      {visibleRoutes.map(r => (
        <Polyline
          key={r.key}
          positions={r.coords}
          pathOptions={{ color: r.color, weight: 7, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
        />
      ))}

      {/* Simulated vehicle positions */}
      {visibleVehiclePositions.map(vp => (
        <Marker
          key={`vsim-${vp.vehicleId}`}
          position={[vp.lat, vp.lon]}
          icon={makeVehicleIcon(vp.vehicleId, vp.color)}
        >
          <Popup>🚚 Xe {vp.vehicleId} đang di chuyển</Popup>
        </Marker>
      ))}

      {/* Map overlay controls */}
      {result?.routes && uniqueVehicleIds.length > 0 && (
        <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
          <select
            value={mapVehicleFilter}
            onChange={(e) => setMapVehicleFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
            style={{
              padding: '6px 10px',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              backgroundColor: '#ffffff',
              color: '#334155',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              boxShadow: '0 1px 6px rgba(0,0,0,0.12)',
              outline: 'none',
            }}
          >
            <option value="all">Tất cả xe ({uniqueVehicleIds.length})</option>
            {uniqueVehicleIds.map((vid: number) => (
              <option key={vid} value={vid}>Xe {vid}</option>
            ))}
          </select>

          {simTime != null && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '5px 10px',
              backgroundColor: showUnvisitedOnly ? '#eef2ff' : '#ffffff',
              border: showUnvisitedOnly ? '1px solid #818cf8' : '1px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: '500',
              color: showUnvisitedOnly ? '#4338ca' : '#475569',
              cursor: 'pointer',
              boxShadow: '0 1px 6px rgba(0,0,0,0.12)',
              userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={showUnvisitedOnly}
                onChange={e => setShowUnvisitedOnly(e.target.checked)}
                style={{ accentColor: '#6366f1', cursor: 'pointer', width: 13, height: 13 }}
              />
              Chỉ điểm chưa thăm
            </label>
          )}

          {simTime != null && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '5px 10px',
              backgroundColor: showUntraversedOnly ? '#fff7ed' : '#ffffff',
              border: showUntraversedOnly ? '1px solid #fb923c' : '1px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: '500',
              color: showUntraversedOnly ? '#c2410c' : '#475569',
              cursor: 'pointer',
              boxShadow: '0 1px 6px rgba(0,0,0,0.12)',
              userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={showUntraversedOnly}
                onChange={e => setShowUntraversedOnly(e.target.checked)}
                style={{ accentColor: '#f97316', cursor: 'pointer', width: 13, height: 13 }}
              />
              Chỉ đường chưa đi
            </label>
          )}
        </div>
      )}
    </MapContainer>
  );
}
