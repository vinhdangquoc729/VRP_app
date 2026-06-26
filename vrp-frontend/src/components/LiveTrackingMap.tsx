import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import driversDB from '../../../database/drivers/drivers.json';
import vehiclesDB from '../../../database/vehicles/vehicles.json';

interface DriverLocation { driver_id: number; lat: number; lon: number; }

interface DriverInfo { name: string; district: string; }
interface VehicleInfo { plate: string; type: string; }

const DRIVER_COLORS = [
  '#4f46e5', '#0891b2', '#059669', '#d97706',
  '#dc2626', '#7c3aed', '#db2777', '#0284c7',
];

function makeDriverIcon(initial: string, colorIdx: number, active: boolean) {
  const bg = DRIVER_COLORS[colorIdx % DRIVER_COLORS.length];
  const pulse = active
    ? `<span style="position:absolute;inset:-5px;border-radius:50%;background:${bg};opacity:.3;animation:ping 1.2s cubic-bezier(0,0,0.2,1) infinite"></span>`
    : '';
  return L.divIcon({
    className: '',
    html: `<style>@keyframes ping{75%,100%{transform:scale(1.8);opacity:0}}</style>
           <div style="position:relative;width:34px;height:34px">
             ${pulse}
             <div style="position:relative;width:34px;height:34px;background:${bg};border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35)">${initial}</div>
           </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -20],
  });
}

export default function LiveTrackingMap({ compact = false }: { compact?: boolean }) {
  const [locations, setLocations] = useState<DriverLocation[]>([]);

  const driverInfoMap = useMemo(() => {
    const m: Record<number, DriverInfo> = {};
    for (const d of (driversDB as { drivers: any[] }).drivers)
      m[d.id] = { name: d.name, district: d.district };
    return m;
  }, []);

  const vehicleMap = useMemo(() => {
    const m: Record<number, VehicleInfo> = {};
    for (const v of (vehiclesDB as { vehicles: any[] }).vehicles)
      if (v.driver_id) m[v.driver_id] = { plate: v.plate, type: v.type };
    return m;
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('http://127.0.0.1:8000/api/v1/drivers/locations');
        if (res.ok) setLocations((await res.json()).locations ?? []);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const mapContent = (
    <div className="relative h-full">
      <MapContainer
        center={[21.0245, 105.8412]}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        zoomControl={!compact}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
        />
        {locations.map((loc, i) => {
          const info = driverInfoMap[loc.driver_id];
          const veh  = vehicleMap[loc.driver_id];
          const initial = info?.name?.charAt(0).toUpperCase() ?? '?';
          return (
            <Marker
              key={loc.driver_id}
              position={[loc.lat, loc.lon]}
              icon={makeDriverIcon(initial, i, true)}
            >
              <Popup>
                <div className="text-sm leading-5 min-w-[140px]">
                  <p className="font-bold text-slate-800">{info?.name ?? `Tài xế #${loc.driver_id}`}</p>
                  {veh && <p className="text-slate-500 text-xs">{veh.type} · <span className="font-mono">{veh.plate}</span></p>}
                  {info?.district && <p className="text-slate-400 text-xs">{info.district}</p>}
                  <p className="text-[11px] text-slate-300 mt-1">{loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}</p>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Live badge */}
      <div className="absolute top-2 left-2 z-[1000] flex items-center gap-1.5 bg-white/90 backdrop-blur rounded-lg px-2.5 py-1 shadow text-xs font-semibold text-slate-600 border border-slate-200">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        {locations.length} tài xế · Live
      </div>

      {locations.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[500]">
          <div className="bg-white/90 backdrop-blur rounded-xl px-5 py-3 shadow text-sm text-slate-400 border border-slate-200">
            Chưa có tài xế nào đang phát GPS
          </div>
        </div>
      )}
    </div>
  );

  if (compact) return mapContent;

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-2 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Theo dõi GPS tài xế</h2>
          <p className="text-sm text-slate-500">Vị trí cập nhật theo thời gian thực</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </div>
      </div>
      <div className="flex-1" style={{ minHeight: 0 }}>
        {mapContent}
      </div>
    </div>
  );
}
