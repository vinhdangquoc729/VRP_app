import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DEPOT_LAT = 21.0245;
const DEPOT_LON = 105.8412;

const TRIP_COLORS = ['#e67e22', '#2980b9', '#27ae60', '#8e44ad', '#c0392b', '#16a085'];

const depotIcon = L.divIcon({
  className: '',
  html: `<div style="background:#1e293b;color:#fff;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.45)">🏬</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

function makeStopIcon(label: string, status: string, isNext: boolean) {
  let bg: string;
  let border = '#fff';
  if (isNext)                    { bg = '#f97316'; border = '#fff'; }
  else if (status === 'delivered') bg = '#22c55e';
  else if (status === 'in_transit') bg = '#3b82f6';
  else                             bg = '#94a3b8';

  const inner = status === 'delivered'
    ? `<span style="font-size:13px">✓</span>`
    : `<span style="font-size:11px;font-weight:700">${label}</span>`;

  const pulse = isNext
    ? `<span style="position:absolute;inset:-5px;border-radius:50%;background:${bg};opacity:.35;animation:ping 1.2s cubic-bezier(0,0,0.2,1) infinite"></span>`
    : '';

  return L.divIcon({
    className: '',
    html: `<style>@keyframes ping{75%,100%{transform:scale(1.8);opacity:0}}</style>
           <div style="position:relative;display:inline-flex">
             ${pulse}
             <div style="position:relative;background:${bg};color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid ${border};box-shadow:0 2px 6px rgba(0,0,0,.4)">${inner}</div>
           </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

interface OrderItem { id: number; product_name: string; status: string; }
interface Stop {
  stop_index: number;
  customer_id: number;
  customer_name?: string;
  customer_address?: string;
  time_window?: string;
  arrival_time?: string;
  lat?: number;
  lon?: number;
  orders: OrderItem[];
}
interface Trip { trip_index: number; stops: Stop[]; geometry?: [number, number][] | null; }

interface Props {
  trips: Trip[];
  nextKey: { tripIdx: number; stopIdx: number } | null;
  getStopStatus: (stop: Stop) => string;
  showRealRoute?: boolean;
  driverPosition?: [number, number] | null;
}

const driverIcon = L.divIcon({
  className: '',
  html: `<style>@keyframes ping{75%,100%{transform:scale(1.8);opacity:0}}</style>
         <div style="position:relative;width:36px;height:36px">
           <span style="position:absolute;inset:-5px;border-radius:50%;background:#4f46e5;opacity:.3;animation:ping 1s cubic-bezier(0,0,0.2,1) infinite"></span>
           <div style="position:relative;width:36px;height:36px;background:#4f46e5;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4)">🚚</div>
         </div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -22],
});

function getStopStatusLocal(stop: Stop): string {
  const s = stop.orders.map(o => o.status);
  if (s.length === 0) return 'assigned';
  if (s.every(x => x === 'delivered')) return 'delivered';
  if (s.some(x => x === 'in_transit' || x === 'delivered')) return 'in_transit';
  return 'assigned';
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const hasFit = useRef(false);
  useEffect(() => {
    if (!hasFit.current && positions.length > 1) {
      map.fitBounds(L.latLngBounds(positions), { padding: [40, 40], maxZoom: 14 });
      hasFit.current = true;
    }
  }, [map, positions]);
  return null;
}

export default function DriverMap({ trips, nextKey, showRealRoute = false, driverPosition }: Props) {
  // Build per-trip polylines — use stored geometry (real road) or straight line fallback
  const polylines: { coords: [number, number][]; color: string; dashed: boolean }[] = trips.map((trip, ti) => {
    const color = TRIP_COLORS[ti % TRIP_COLORS.length];
    if (showRealRoute && trip.geometry && trip.geometry.length > 1) {
      return { coords: trip.geometry as [number, number][], color, dashed: false };
    }
    const coords: [number, number][] = [[DEPOT_LAT, DEPOT_LON]];
    for (const stop of trip.stops) {
      if (stop.lat != null && stop.lon != null) coords.push([stop.lat, stop.lon]);
    }
    coords.push([DEPOT_LAT, DEPOT_LON]);
    return { coords, color, dashed: true };
  });

  // Collect all valid stop positions for bounds fitting
  const allPositions: [number, number][] = [[DEPOT_LAT, DEPOT_LON]];
  for (const trip of trips) {
    for (const stop of trip.stops) {
      if (stop.lat != null && stop.lon != null) allPositions.push([stop.lat, stop.lon]);
    }
  }

  // Count global stop index for label
  let globalIdx = 0;

  return (
    <MapContainer
      center={[DEPOT_LAT, DEPOT_LON]}
      zoom={12}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds positions={allPositions} />

      {/* Driver current position */}
      {driverPosition && (
        <Marker position={driverPosition} icon={driverIcon}>
          <Popup><strong>📍 Vị trí hiện tại của bạn</strong></Popup>
        </Marker>
      )}

      {/* Depot */}
      <Marker position={[DEPOT_LAT, DEPOT_LON]} icon={depotIcon}>
        <Popup><strong>🏬 Kho trung tâm</strong><br />Bưu điện Hà Nội</Popup>
      </Marker>

      {/* Trip polylines */}
      {polylines.map((pl, i) => (
        pl.coords.length > 1 && (
          <Polyline
            key={i}
            positions={pl.coords}
            pathOptions={{
              color: pl.color,
              weight: 7,
              opacity: 0.9,
              lineCap: 'round',
              lineJoin: 'round',
              dashArray: pl.dashed ? '10 6' : undefined,
            }}
          />
        )
      ))}

      {/* Stop markers */}
      {trips.map((trip, tripIdx) =>
        trip.stops.map((stop, stopIdx) => {
          if (stop.lat == null || stop.lon == null) return null;
          const isNext = nextKey?.tripIdx === tripIdx && nextKey?.stopIdx === stopIdx;
          const status = getStopStatusLocal(stop);
          const label = String(++globalIdx);
          const icon = makeStopIcon(label, status, isNext);
          return (
            <Marker key={`${tripIdx}-${stopIdx}`} position={[stop.lat, stop.lon]} icon={icon}>
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <p style={{ fontWeight: 700, marginBottom: 4 }}>
                    {isNext ? '📍 Điểm tiếp theo · ' : ''}Chuyến {trip.trip_index} · Điểm {stop.stop_index}
                  </p>
                  <p style={{ margin: '2px 0' }}>{stop.customer_name}</p>
                  {stop.customer_address && <p style={{ margin: '2px 0', fontSize: 12, color: '#666' }}>{stop.customer_address}</p>}
                  {stop.time_window && <p style={{ margin: '2px 0', fontSize: 12 }}>⏰ {stop.time_window}</p>}
                  {stop.arrival_time && <p style={{ margin: '2px 0', fontSize: 12 }}>🕐 Dự kiến: {stop.arrival_time}</p>}
                  <p style={{ marginTop: 4, fontSize: 12 }}>
                    {stop.orders.length} đơn · {status === 'delivered' ? '✅ Đã giao' : status === 'in_transit' ? '🚚 Đang giao' : '⏳ Chờ giao'}
                  </p>
                </div>
              </Popup>
            </Marker>
          );
        })
      )}
    </MapContainer>
  );
}
