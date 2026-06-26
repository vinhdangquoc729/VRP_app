import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { Truck, Package, CheckCircle, Clock, LogOut, RefreshCw, ArrowRight, MapPin, Phone, User, Navigation, List, Map, Route, Star, Award, Calendar } from 'lucide-react';
import routimeLogo from '../../assets/ROUTIME-logo.png';
import { Toaster, toast } from 'sonner';

const DriverMap = lazy(() => import('./DriverMap'));

interface OrderItem {
  id: number;
  product_name: string;
  category: string;
  weight: number;
  volume: number;
  service_duration_min: number;
  notes: string;
  status: string;
}

interface Stop {
  stop_index: number;
  customer_id: number;
  customer_name?: string;
  customer_address?: string;
  customer_phone?: string;
  time_window?: string;
  arrival_time?: string;
  departure_time?: string;
  lat?: number;
  lon?: number;
  orders: OrderItem[];
}

interface Trip {
  trip_index: number;
  stops: Stop[];
  geometry?: [number, number][] | null;
}

interface Vehicle {
  id: number;
  type: string;
  plate: string;
  status: string;
}

interface Driver {
  id: number;
  name: string;
  phone: string;
  vehicle_type: string;
  vehicle_plate: string;
  status: string;
  district: string;
  rating: number;
  total_deliveries: number;
}

interface Props {
  driver: Driver;
  onLogout: () => void;
}

const ORDER_STATUS_INFO: Record<string, { label: string; cls: string }> = {
  assigned:   { label: 'Chờ giao',  cls: 'bg-violet-100 text-violet-700'   },
  in_transit: { label: 'Đang giao', cls: 'bg-blue-100 text-blue-700'       },
  delivered:  { label: 'Đã giao',   cls: 'bg-emerald-100 text-emerald-700' },
  failed:     { label: 'Thất bại',  cls: 'bg-red-100 text-red-700'         },
  cancelled:  { label: 'Đã huỷ',   cls: 'bg-zinc-100 text-zinc-500'       },
};

const DRIVER_STATUS_INFO: Record<string, { label: string; cls: string }> = {
  available: { label: 'Sẵn sàng',     cls: 'bg-emerald-100 text-emerald-700' },
  assigned:  { label: 'Đã phân công', cls: 'bg-violet-100 text-violet-700'   },
  on_route:  { label: 'Đang giao',    cls: 'bg-blue-100 text-blue-700'       },
  off_duty:  { label: 'Nghỉ',         cls: 'bg-slate-100 text-slate-500'     },
};

function getStopStatus(stop: Stop): string {
  const s = stop.orders.map(o => o.status);
  if (s.length === 0) return 'assigned';
  if (s.every(x => x === 'delivered')) return 'delivered';
  if (s.every(x => x === 'failed')) return 'failed';
  if (s.some(x => x === 'in_transit' || x === 'delivered' || x === 'failed')) return 'in_transit';
  return 'assigned';
}

export default function DriverDashboard({ driver, onLogout }: Props) {
  const [simDate, setSimDate] = useState('');
  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/v1/config/sim-date')
      .then(r => r.json()).then(d => setSimDate(d.date ?? '')).catch(() => {});
  }, []);

  const [trips, setTrips]           = useState<Trip[]>([]);
  const [vehicle, setVehicle]       = useState<Vehicle | null>(null);
  const [loading, setLoading]       = useState(true);
  const [updating, setUpdating]     = useState<string | null>(null);
  const [activeTab, setActiveTab]   = useState<'list' | 'map'>('list');
  const [showRealRoute, setShowRealRoute] = useState(false);
  const [loadingGeo, setLoadingGeo] = useState(false);
  const [gpsSimulating, setGpsSimulating] = useState(false);
  const [gpsSegmentIdx, setGpsSegmentIdx] = useState(0);
  const [gpsPosition, setGpsPosition]     = useState<[number, number] | null>(null);
  const gpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpsPointRef    = useRef(0);
  const gpsSegmentsRef = useRef<[number, number][][]>([]);
  const gpsResumeRef   = useRef<(() => void) | null>(null);

  const fetchData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/drivers/${driver.id}/orders`);
      if (res.ok) {
        const data = await res.json();
        setTrips(data.trips ?? []);
        setVehicle(data.vehicle ?? null);
      } else if (showSpinner) {
        toast.error('Không thể tải dữ liệu');
      }
    } catch {
      if (showSpinner) toast.error('Lỗi kết nối server');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [driver.id]);

  useEffect(() => {
    fetchData(true);
    const id = setInterval(() => fetchData(false), 8_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const hasStoredGeometry = trips.length > 0 && trips.some(t => t.geometry && t.geometry.length > 1);

  const handleToggleRealRoute = async () => {
    if (!showRealRoute && !hasStoredGeometry) {
      setLoadingGeo(true);
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/v1/drivers/${driver.id}/route-geometry`);
        if (res.ok) {
          const data = await res.json();
          setTrips(prev => prev.map((trip, ti) => ({
            ...trip,
            geometry: data.geometries[ti] ?? null,
          })));
          setShowRealRoute(true);
        } else {
          toast.error('Không thể tải tuyến thực. Kiểm tra kết nối server.');
        }
      } catch {
        toast.error('Lỗi kết nối server');
      } finally {
        setLoadingGeo(false);
      }
    } else {
      setShowRealRoute(v => !v);
    }
  };

  const handleStopStatusUpdate = async (tripIdx: number, stopIdx: number, stop: Stop, newStatus: string) => {
    const key = `${tripIdx}-${stopIdx}`;
    setUpdating(key);
    const orderIds = stop.orders.map(o => o.id);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/v1/orders/bulk-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_ids: orderIds, status: newStatus }),
      });
      if (res.ok) {
        setTrips(prev => prev.map((trip, ti) =>
          ti !== tripIdx ? trip : {
            ...trip,
            stops: trip.stops.map((s, si) =>
              si !== stopIdx ? s : { ...s, orders: s.orders.map(o => ({ ...o, status: newStatus })) }
            ),
          }
        ));
        if (newStatus === 'delivered' || newStatus === 'failed') gpsResumeRef.current?.();
        toast.success(
          newStatus === 'in_transit' ? 'Bắt đầu giao điểm này!' :
          newStatus === 'failed'     ? 'Đã ghi nhận giao không thành công.' :
                                       'Đã giao thành công!'
        );
      } else {
        toast.error('Không thể cập nhật trạng thái');
      }
    } catch {
      toast.error('Lỗi kết nối server');
    } finally {
      setUpdating(null);
    }
  };

  // First non-delivered stop across all trips (in route order)
  const nextStopInfo = useMemo(() => {
    for (let ti = 0; ti < trips.length; ti++) {
      for (let si = 0; si < trips[ti].stops.length; si++) {
        const st = getStopStatus(trips[ti].stops[si]);
        if (st !== 'delivered' && st !== 'failed') {
          return { trip: trips[ti], stop: trips[ti].stops[si], tripIdx: ti, stopIdx: si };
        }
      }
    }
    return null;
  }, [trips]);

  const allStops = trips.flatMap(t => t.stops);
  const counts = {
    assigned:   allStops.filter(s => getStopStatus(s) === 'assigned').length,
    in_transit: allStops.filter(s => getStopStatus(s) === 'in_transit').length,
    delivered:  allStops.filter(s => getStopStatus(s) === 'delivered').length,
    failed:     allStops.filter(s => getStopStatus(s) === 'failed').length,
  };

  const driverSt = DRIVER_STATUS_INFO[driver.status] ?? { label: driver.status, cls: 'bg-slate-100 text-slate-600' };
  const nextKey = nextStopInfo ? { tripIdx: nextStopInfo.tripIdx, stopIdx: nextStopInfo.stopIdx } : null;

  // ── GPS simulation ──────────────────────────────────────────────────────────

  // Split geometry into one segment per stop (depot→stop0, stop0→stop1, …)
  const buildGpsSegments = useCallback((): [number, number][][] => {
    const DEPOT: [number, number] = [21.0245, 105.8412];
    const segments: [number, number][][] = [];
    for (const trip of trips) {
      const geo = trip.geometry && trip.geometry.length > 1
        ? (trip.geometry as [number, number][]) : null;
      const stopCoords: [number, number][] = trip.stops
        .filter(s => s.lat != null && s.lon != null)
        .map(s => [s.lat!, s.lon!]);

      if (!geo) {
        // Fallback: interpolate 12 points between each waypoint
        const waypoints: [number, number][] = [DEPOT, ...stopCoords, DEPOT];
        for (let i = 0; i < waypoints.length - 1; i++) {
          const [aLat, aLon] = waypoints[i], [bLat, bLon] = waypoints[i + 1];
          segments.push(
            Array.from({ length: 13 }, (_, t) =>
              [aLat + (bLat - aLat) * t / 12, aLon + (bLon - aLon) * t / 12] as [number, number]
            )
          );
        }
        continue;
      }

      // Find the closest geometry point to each stop and slice there
      let prevIdx = 0;
      for (const [sLat, sLon] of stopCoords) {
        let bestIdx = prevIdx, bestDist = Infinity;
        for (let i = prevIdx; i < geo.length; i++) {
          const d = Math.hypot(geo[i][0] - sLat, geo[i][1] - sLon);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        segments.push(geo.slice(prevIdx, bestIdx + 1));
        prevIdx = bestIdx;
      }
      // Return-to-depot leg: remaining geometry after last stop
      if (prevIdx < geo.length - 1) segments.push(geo.slice(prevIdx));
    }
    return segments;
  }, [trips]);

  const stopGpsSimulation = useCallback(() => {
    if (gpsIntervalRef.current) { clearInterval(gpsIntervalRef.current); gpsIntervalRef.current = null; }
    gpsResumeRef.current = null;
    setGpsSimulating(false);
    setGpsSegmentIdx(0);
    setGpsPosition(null);
  }, []);

  const startGpsSimulation = useCallback(() => {
    const segs = buildGpsSegments();
    if (segs.length === 0) { toast.error('Chưa có tuyến đường. Hãy tải tuyến thực trước.'); return; }
    gpsSegmentsRef.current = segs;
    gpsPointRef.current = 0;
    gpsResumeRef.current = null;
    setGpsSegmentIdx(0);
    setGpsSimulating(true);
  }, [buildGpsSegments]);

  // Play the current segment; when done, park at stop and store a resume callback
  useEffect(() => {
    if (!gpsSimulating) return;
    const segs = gpsSegmentsRef.current;
    if (gpsSegmentIdx >= segs.length) { stopGpsSimulation(); return; }

    const seg = segs[gpsSegmentIdx];
    gpsPointRef.current = 0;

    const postLocation = (lat: number, lon: number) => {
      setGpsPosition([lat, lon]);
      fetch(`http://127.0.0.1:8000/api/v1/drivers/${driver.id}/location`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon }),
      }).catch(() => {});
    };

    const id = setInterval(() => {
      const idx = gpsPointRef.current;
      if (idx >= seg.length) {
        clearInterval(id);
        gpsIntervalRef.current = null;
        if (seg.length > 0) postLocation(seg[seg.length - 1][0], seg[seg.length - 1][1]);
        const isLastSeg = gpsSegmentIdx === gpsSegmentsRef.current.length - 1;
        if (isLastSeg) {
          // Returned to depot — simulation complete
          stopGpsSimulation();
        } else {
          // Parked at stop — wait for "Đã giao" to resume
          gpsResumeRef.current = () => {
            gpsResumeRef.current = null;
            setGpsSegmentIdx(prev => prev + 1);
          };
        }
        return;
      }
      postLocation(seg[idx][0], seg[idx][1]);
      gpsPointRef.current = idx + 1;
    }, 300);

    gpsIntervalRef.current = id;
    return () => { clearInterval(id); gpsIntervalRef.current = null; };
  }, [gpsSimulating, gpsSegmentIdx, driver.id, stopGpsSimulation]);

  useEffect(() => () => { if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current); }, []);

  return (
    <div className="h-screen bg-slate-50 font-sans flex flex-col overflow-hidden">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-5 py-2 shrink-0 shadow-sm z-40">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <img src={routimeLogo} alt="Routime" className="h-12 w-auto object-contain shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-slate-900 truncate">ROUTIME - Hệ thống điều phối giao hàng</h1>
            <p className="text-sm text-slate-400 truncate">Điều phối thông minh, giao hàng đúng hẹn</p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${driverSt.cls}`}>
            {driverSt.label}
          </span>
          {simDate && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-xs font-medium text-indigo-700 shrink-0">
              <Calendar size={12} />
              {simDate}
            </div>
          )}
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
          >
            <LogOut size={14} />
            Đăng xuất
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-5 shrink-0 z-30">
        <div className="max-w-2xl mx-auto flex gap-1 pt-2">
          {([
            { id: 'list' as const, label: 'Danh sách đơn hàng', Icon: List },
            { id: 'map'  as const, label: 'Bản đồ',             Icon: Map  },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
                ${activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              <tab.Icon size={14} />
              {tab.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => fetchData(true)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 transition-colors pb-2"
          >
            <RefreshCw size={12} />
            Làm mới
          </button>
        </div>
      </div>

      {/* ── LIST TAB ── */}
      {activeTab === 'list' && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-4 space-y-4">

            {/* Vehicle + driver info */}
            <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-500 uppercase tracking-wide">
                <User size={13} className="text-indigo-400" />
                Thông tin tài xế
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                <div className="flex items-center gap-1.5"><User size={13} className="text-slate-400" /><span className="font-medium text-slate-800">{driver.name}</span></div>
                <div className="flex items-center gap-1.5"><Phone size={13} className="text-slate-400" />{driver.phone}</div>
                <div className="flex items-center gap-1.5"><MapPin size={13} className="text-slate-400" />{driver.district}</div>
                <div className="flex items-center gap-1.5">
                  <Star size={13} className="text-amber-400" />
                  <span className="font-semibold text-amber-600">{driver.rating}</span>
                  <span className="text-slate-400">/ 5.0</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Award size={13} className="text-indigo-400" />
                  <span className="font-semibold text-indigo-600">{driver.total_deliveries}</span>
                  <span className="text-slate-400">chuyến</span>
                </div>
                {vehicle ? (
                  <div className="flex items-center gap-1.5"><Truck size={13} className="text-slate-400" />{vehicle.type} · {vehicle.plate}</div>
                ) : (
                  <div className="flex items-center gap-1.5"><Truck size={13} className="text-slate-400" />{driver.vehicle_type} · {driver.vehicle_plate}</div>
                )}
              </div>
              {vehicle && (
                <span className={`w-fit text-xs px-2.5 py-1 rounded-full font-medium ${DRIVER_STATUS_INFO[vehicle.status]?.cls ?? 'bg-slate-100 text-slate-600'}`}>
                  {DRIVER_STATUS_INFO[vehicle.status]?.label ?? vehicle.status}
                </span>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-lg border border-violet-100 p-4 text-center">
                <p className="text-2xl font-bold text-violet-700">{counts.assigned}</p>
                <p className="text-sm text-violet-600 mt-0.5">Chờ giao</p>
              </div>
              <div className="bg-white rounded-lg border border-blue-100 p-4 text-center">
                <p className="text-2xl font-bold text-blue-700">{counts.in_transit}</p>
                <p className="text-sm text-blue-600 mt-0.5">Đang giao</p>
              </div>
              <div className="bg-white rounded-lg border border-emerald-100 p-4 text-center">
                <p className="text-2xl font-bold text-emerald-700">{counts.delivered}</p>
                <p className="text-sm text-emerald-600 mt-0.5">Đã giao</p>
              </div>
              {counts.failed > 0 && (
                <div className="bg-white rounded-lg border border-red-100 p-4 text-center">
                  <p className="text-2xl font-bold text-red-700">{counts.failed}</p>
                  <p className="text-sm text-red-600 mt-0.5">Thất bại</p>
                </div>
              )}
            </div>

            {/* Trips */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-slate-800">
                  Lộ trình ({trips.length} chuyến · {allStops.length} điểm)
                </h2>
                {simDate && (
                  <span className="flex items-center gap-1 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded-full">
                    <Calendar size={11} /> {simDate}
                  </span>
                )}
              </div>

              {loading && <div className="text-center py-12 text-slate-400 text-sm">Đang tải...</div>}

              {!loading && trips.length === 0 && (
                <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
                  <Package size={32} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">Chưa có lộ trình được phân công</p>
                  <p className="text-xs text-slate-400 mt-1">Liên hệ quản trị viên để xác nhận phân công</p>
                </div>
              )}

              {trips.map((trip, tripIdx) => (
                <div key={trip.trip_index} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-indigo-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                      <Navigation size={11} />
                      Chuyến {trip.trip_index}
                    </div>
                    <span className="text-xs text-slate-400">{trip.stops.length} điểm giao</span>
                  </div>

                  {trip.stops.map((stop, stopIdx) => {
                    const stopStatus = getStopStatus(stop);
                    const isUpdating = updating === `${tripIdx}-${stopIdx}`;
                    const stopSt = ORDER_STATUS_INFO[stopStatus] ?? { label: stopStatus, cls: 'bg-slate-100 text-slate-600' };

                    return (
                      <div key={stop.stop_index} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                        <div className="px-4 pt-4 pb-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
                                {stop.stop_index}
                              </span>
                              <div>
                                <p className="text-sm font-semibold text-slate-800">{stop.customer_name ?? `Khách #${stop.customer_id}`}</p>
                                {stop.customer_phone && <p className="text-xs text-slate-400">{stop.customer_phone}</p>}
                              </div>
                            </div>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${stopSt.cls}`}>
                              {stopSt.label}
                            </span>
                          </div>

                          {stop.customer_address && (
                            <div className="flex items-start gap-1.5 text-xs text-slate-500">
                              <MapPin size={11} className="text-slate-400 shrink-0 mt-0.5" />
                              {stop.customer_address}
                            </div>
                          )}

                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            {stop.time_window && <span className="flex items-center gap-1"><Clock size={11} />TG: {stop.time_window}</span>}
                            {stop.arrival_time && <span className="text-indigo-500 font-medium">Dự kiến: {stop.arrival_time}</span>}
                          </div>
                        </div>

                        <div className="border-t border-slate-100 divide-y divide-slate-50">
                          {stop.orders.map(order => {
                            const ordSt = ORDER_STATUS_INFO[order.status] ?? { label: order.status, cls: 'bg-slate-100 text-slate-600' };
                            return (
                              <div key={order.id} className="px-4 py-2.5 flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <span className="font-mono text-xs text-slate-400">#{order.id}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${ordSt.cls}`}>{ordSt.label}</span>
                                  </div>
                                  <p className="text-xs font-medium text-slate-700 truncate">{order.product_name}</p>
                                  <p className="text-xs text-slate-400">{order.category} · {order.weight} kg · {order.volume} m³</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {stop.orders.some(o => o.notes) && (
                          <div className="px-4 pb-3">
                            {stop.orders.filter(o => o.notes).map(o => (
                              <p key={o.id} className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 mt-1">
                                📋 #{o.id}: {o.notes}
                              </p>
                            ))}
                          </div>
                        )}

                        <div className="px-4 pb-4">
                          {stopStatus === 'assigned' && (
                            <button onClick={() => handleStopStatusUpdate(tripIdx, stopIdx, stop, 'in_transit')} disabled={isUpdating}
                              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
                              {isUpdating ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ArrowRight size={15} />}
                              Bắt đầu giao điểm này
                            </button>
                          )}
                          {stopStatus === 'in_transit' && (
                            <div className="flex gap-2">
                              <button onClick={() => handleStopStatusUpdate(tripIdx, stopIdx, stop, 'delivered')} disabled={isUpdating}
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
                                {isUpdating ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle size={15} />}
                                Đã giao
                              </button>
                              <button onClick={() => handleStopStatusUpdate(tripIdx, stopIdx, stop, 'failed')} disabled={isUpdating}
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
                                <span className="text-base leading-none">✕</span>
                                Giao thất bại
                              </button>
                            </div>
                          )}
                          {stopStatus === 'delivered' && (
                            <div className="flex items-center justify-center gap-1.5 py-2 text-emerald-600 text-sm font-medium">
                              <CheckCircle size={15} />Đã giao thành công
                            </div>
                          )}
                          {stopStatus === 'failed' && (
                            <div className="flex items-center justify-center gap-1.5 py-2 text-red-500 text-sm font-medium">
                              <span>✕</span> Giao không thành công
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── MAP TAB ── */}
      {activeTab === 'map' && (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Next stop card */}
          <div className="bg-white border-b border-slate-200 shrink-0">
            {loading && <p className="px-5 py-4 text-sm text-slate-400">Đang tải...</p>}

            {!loading && !nextStopInfo && (
              <div className="px-5 py-4 flex items-center gap-2 text-emerald-600">
                <CheckCircle size={16} />
                <span className="text-sm font-medium">Tất cả đơn đã giao xong!</span>
              </div>
            )}

            {!loading && nextStopInfo && (() => {
              const { trip, stop, tripIdx, stopIdx } = nextStopInfo;
              const stopStatus = getStopStatus(stop);
              const isUpdating = updating === `${tripIdx}-${stopIdx}`;
              return (
                <div className="px-4 py-3 space-y-2 max-w-2xl mx-auto">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                      📍 Điểm tiếp theo
                    </span>
                    <span className="text-xs text-slate-400">Chuyến {trip.trip_index} · Điểm {stop.stop_index}</span>
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <p className="text-sm font-bold text-slate-800">{stop.customer_name}</p>
                      {stop.customer_phone && (
                        <p className="text-xs text-slate-500 flex items-center gap-1"><Phone size={11} />{stop.customer_phone}</p>
                      )}
                      {stop.customer_address && (
                        <p className="text-xs text-slate-500 flex items-start gap-1"><MapPin size={11} className="mt-0.5 shrink-0" />{stop.customer_address}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-slate-500 pt-0.5">
                        {stop.time_window && <span className="flex items-center gap-1"><Clock size={11} />{stop.time_window}</span>}
                        {stop.arrival_time && <span className="text-indigo-500 font-medium">Dự kiến: {stop.arrival_time}</span>}
                      </div>
                      <p className="text-xs text-slate-400">{stop.orders.length} đơn · {stop.orders.map(o => o.product_name).join(', ')}</p>
                    </div>

                    <div className="shrink-0 flex flex-col gap-1.5">
                      {stopStatus === 'assigned' && (
                        <button onClick={() => handleStopStatusUpdate(tripIdx, stopIdx, stop, 'in_transit')} disabled={isUpdating}
                          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50">
                          {isUpdating ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ArrowRight size={13} />}
                          Bắt đầu giao
                        </button>
                      )}
                      {stopStatus === 'in_transit' && (
                        <>
                          <button onClick={() => handleStopStatusUpdate(tripIdx, stopIdx, stop, 'delivered')} disabled={isUpdating}
                            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50">
                            {isUpdating ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle size={13} />}
                            Đã giao
                          </button>
                          <button onClick={() => handleStopStatusUpdate(tripIdx, stopIdx, stop, 'failed')} disabled={isUpdating}
                            className="flex items-center gap-1.5 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50">
                            <span className="leading-none">✕</span>
                            Giao không thành công
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Map */}
          <div className="flex-1 relative">
            {/* GPS simulation button */}
            <button
              onClick={gpsSimulating ? stopGpsSimulation : startGpsSimulation}
              className={`absolute top-3 right-32 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-md border transition-colors
                ${gpsSimulating
                  ? 'bg-emerald-600 text-white border-emerald-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
            >
              {gpsSimulating
                ? <><span className="w-2 h-2 rounded-full bg-white animate-pulse" />Đang phát GPS</>
                : <><Navigation size={13} />Mô phỏng GPS</>}
            </button>

            {/* Tuyến thực toggle — floats over map */}
            <button
              onClick={handleToggleRealRoute}
              disabled={loadingGeo}
              className={`absolute top-3 right-3 z-[1000] flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-md border transition-colors disabled:opacity-60
                ${showRealRoute
                  ? 'bg-indigo-600 text-white border-indigo-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
            >
              {loadingGeo
                ? <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                : <Route size={13} />}
              Tuyến thực
            </button>

            <Suspense fallback={<div className="h-full flex items-center justify-center text-slate-400 text-sm">Đang tải bản đồ...</div>}>
              <DriverMap trips={trips} nextKey={nextKey} getStopStatus={getStopStatus} showRealRoute={showRealRoute} driverPosition={gpsPosition} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
