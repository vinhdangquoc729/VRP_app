import { useState, lazy, Suspense, useEffect, useMemo } from 'react';
import { type DragEndEvent } from '@dnd-kit/core';
import { timeToSeconds, haversineKm, secondsToTime } from './utils';
import VehiclePanel from './components/VehiclePanel';
import OrderPanel from './components/OrderPanel';
import FleetView from './components/FleetView';
import OrdersView from './components/OrdersView';
import CustomersView from './components/CustomersView';
import DriversView from './components/DriversView';
import LoginPage from './components/LoginPage';
import DriverDashboard from './components/DriverDashboard';
import CustomerDashboard from './components/CustomerDashboard';
import LiveDispatchTab from './components/LiveDispatchTab';
import LiveTrackingMap from './components/LiveTrackingMap';
import SimulationControls from './components/SimulationControls';
import ResultsPanel from './components/ResultsPanel';
import StatsView from './components/StatsView';
import { Truck, Package, Route, Play, Loader2, Database, Users, UserCircle, LogOut, Zap, Navigation, Calendar, BarChart2 } from 'lucide-react';
import routimeLogo from '../assets/ROUTIME-logo.png';
import vehiclesDB from '../../database/vehicles/vehicles.json';
import ordersDB from '../../database/orders/orders.json';
import customersDB from '../../database/customers/customers.json';
import driversDB from '../../database/drivers/drivers.json';
import { Toaster, toast } from 'sonner';

const MapView = lazy(() => import('./MapView'));

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => localStorage.getItem('tcpvrp_auth') === 'admin');
  const [driverSession, setDriverSession] = useState<any | null>(() => {
    const auth = localStorage.getItem('tcpvrp_auth') ?? '';
    if (!auth.startsWith('driver:')) return null;
    try { return JSON.parse(localStorage.getItem('tcpvrp_driver') ?? 'null'); } catch { return null; }
  });

  const [customerSession, setCustomerSession] = useState<any | null>(() => {
    const auth = localStorage.getItem('tcpvrp_auth') ?? '';
    if (!auth.startsWith('customer:')) return null;
    try { return JSON.parse(localStorage.getItem('tcpvrp_customer') ?? 'null'); } catch { return null; }
  });

  const handleLogout = () => {
    localStorage.removeItem('tcpvrp_auth');
    localStorage.removeItem('tcpvrp_driver');
    setIsLoggedIn(false);
  };

  const handleDriverLogout = () => {
    localStorage.removeItem('tcpvrp_auth');
    localStorage.removeItem('tcpvrp_driver');
    setDriverSession(null);
  };

  const handleCustomerLogout = () => {
    localStorage.removeItem('tcpvrp_auth');
    localStorage.removeItem('tcpvrp_customer');
    setCustomerSession(null);
  };

  const [loading, setLoading] = useState(false);
  const [progressInfo, setProgressInfo] = useState<{
    stage: string; done: number; total: number; message: string;
  } | null>(null);
  const [result, setResult] = useState<any>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [hardTW, setHardTW] = useState(false);
  const [showRealRoute, setShowRealRoute] = useState(false);

  const [customerDB, setCustomerDB] = useState<Record<number, { name: string; address: string; time: string }>>({
    0: { name: 'Kho trung tâm', address: 'Bưu điện Hà Nội', time: 'Cả ngày' },
  });
  const [orders, setOrders] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([
    { id: 1, type: 'Xe máy',     operating_cost: 5000,  time_based_cost: 200, max_weight: 100, max_volume: 1.5, max_travel_distance_km: 100, operating_time_h: 8 },
    { id: 2, type: 'Xe tải Van', operating_cost: 12000, time_based_cost: 500, max_weight: 800, max_volume: 5.0, max_travel_distance_km: 200, operating_time_h: 10 },
  ]);

  const [leftTab, setLeftTab] = useState<'vehicles' | 'orders' | 'customers' | 'drivers' | 'dispatch' | 'live' | 'tracking' | 'stats'>('vehicles');

  const [simDate, setSimDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/v1/config/sim-date')
      .then(r => r.json()).then(d => setSimDate(d.date)).catch(() => {});
  }, []);

  const updateSimDate = async (d: string) => {
    setSimDate(d);
    await fetch('http://127.0.0.1:8000/api/v1/config/sim-date', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: d }),
    }).catch(() => {});
  };

  const [recalculating, setRecalculating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [insertingOrder, setInsertingOrder] = useState(false);
  const [prevCosts, setPrevCosts] = useState<{ total: number; distance_km: number; penalty: number; vehicles: number } | null>(null);

  const [simTime, setSimTime] = useState<number | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simSpeed, setSimSpeed] = useState(300);

  const progressPct = progressInfo && progressInfo.total > 0
    ? Math.max(4, (progressInfo.done / progressInfo.total) * 100)
    : 5;

  const simBounds = useMemo(() => {
    if (!result?.routes) return null;
    let minTime = Infinity, maxTime = -Infinity;
    for (const route of result.routes) {
      for (const trip of (route.trips ?? [])) {
        for (const stop of (trip.stops ?? [])) {
          if (stop.arrival_time < minTime) minTime = stop.arrival_time;
          if (stop.departure_time > maxTime) maxTime = stop.departure_time;
        }
      }
    }
    return isFinite(minTime) ? { start: minTime, end: maxTime } : null;
  }, [result]);

  useEffect(() => {
    if (!isSimulating || !simBounds) return;
    const id = setInterval(() => {
      setSimTime(prev => {
        const next = (prev ?? simBounds.start) + simSpeed * 0.1;
        if (next >= simBounds.end) { setIsSimulating(false); return simBounds.end; }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [isSimulating, simBounds, simSpeed]);

  const handleSimToggle = () => {
    if (!simBounds) return;
    if (!isSimulating && simTime === null) setSimTime(simBounds.start);
    setIsSimulating(p => !p);
  };

  const handleSimReset = () => {
    setIsSimulating(false);
    setSimTime(simBounds?.start ?? null);
  };

  // ── DB sync helpers ──────────────────────────────────────────────────────────

  // Pre-built lookups from static JSON (computed once at render, not on every call)
  const dbAvailableVehicles = useMemo(() =>
    (vehiclesDB as { vehicles: any[] }).vehicles.filter(v => v.status === 'available'),
  []);

  const todayStr = new Date().toISOString().slice(0, 10);
  const [dispatchDateFrom, setDispatchDateFrom] = useState(todayStr);
  const [dispatchDateTo,   setDispatchDateTo]   = useState(todayStr);

  const [loadPending, setLoadPending] = useState(true);
  const [loadFailed,  setLoadFailed]  = useState(false);

  const dbOrdersToLoad = useMemo(() =>
    (ordersDB as { orders: any[] }).orders.filter(o =>
      ((loadPending && o.status === 'pending') || (loadFailed && o.status === 'failed')) &&
      o.created_at >= dispatchDateFrom &&
      o.created_at <= dispatchDateTo
    ),
  [dispatchDateFrom, dispatchDateTo, loadPending, loadFailed]);

  // keep dbPendingOrders alias for the simDate badge count (pending only)
  const dbPendingOrders = useMemo(() =>
    (ordersDB as { orders: any[] }).orders.filter(o =>
      o.status === 'pending' &&
      o.created_at >= dispatchDateFrom &&
      o.created_at <= dispatchDateTo
    ),
  [dispatchDateFrom, dispatchDateTo]);

  const dbCustomerMap = useMemo(() => {
    const m = new Map<number, any>();
    for (const c of (customersDB as { customers: any[] }).customers) m.set(c.id, c);
    return m;
  }, []);

  const dbDriverMap = useMemo(() => {
    const m = new Map<number, any>();
    for (const d of (driversDB as { drivers: any[] }).drivers) m.set(d.id, d);
    return m;
  }, []);

  const handleLoadVehiclesFromDB = () => {
    const mapped = dbAvailableVehicles.map((v: any) => {
      const driver = dbDriverMap.get(v.driver_id);
      return {
        id: v.id,
        type: v.type,
        plate: v.plate,
        driver_id: v.driver_id,
        driver_name: driver?.name ?? null,
        driver_phone: driver?.phone ?? null,
        operating_cost: v.operating_cost,
        time_based_cost: v.time_based_cost,
        max_weight: v.max_weight,
        max_volume: v.max_volume,
        max_travel_distance_km: v.max_travel_distance_km,
        operating_time_h: v.operating_time_h,
      };
    });
    setVehicles(mapped);
    setResult(null);
    toast.success(`Đã tải ${mapped.length} xe sẵn sàng từ hệ thống`);
  };

  const handleLoadOrdersFromDB = () => {
    const newOrders: any[] = [];
    const newDB: Record<number, any> = {
      0: { name: 'Kho trung tâm', address: 'Bưu điện Hà Nội', time: 'Cả ngày' },
    };
    for (const o of dbOrdersToLoad) {
      const c = dbCustomerMap.get(o.customer_id);
      if (!c || c.lat == null || c.lon == null) continue;
      newDB[o.customer_id] = {
        name: c.name,
        address: c.address,
        time: `${o.time_window_start} - ${o.time_window_end}`,
        lat: c.lat,
        lon: c.lon,
      };
      newOrders.push({
        id: o.id,
        customer_id: o.customer_id,
        lat: c.lat,
        lon: c.lon,
        weight: o.weight,
        volume: o.volume,
        start_time: timeToSeconds(o.time_window_start),
        end_time: timeToSeconds(o.time_window_end),
        service_duration: o.service_duration,
        created_at: o.created_at,
      });
    }
    setOrders(newOrders);
    setCustomerDB(newDB);
    setResult(null);
    toast.success(`Đã tải ${newOrders.length} đơn hàng chờ xử lý từ hệ thống`);
  };

  const handleRunAlgorithm = async () => {
    if (orders.length === 0) { alert('Hãy thêm ít nhất 1 đơn hàng trước khi chạy thuật toán!'); return; }
    if (vehicles.length === 0) { alert('Cần ít nhất 1 xe để giao hàng!'); return; }

    setLoading(true);
    setProgressInfo({ stage: 'init', done: 0, total: 1, message: 'Đang khởi tạo...' });
    const sessionId = crypto.randomUUID();
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`http://127.0.0.1:8000/api/v1/routing/progress/${sessionId}`);
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.stage === 'done') {
            eventSource?.close();
          } else {
            if (data.stage === 'solving') toast.info('Ma trận khoảng cách đã tải xong, đang chạy GA...');
            setProgressInfo(data);
          }
        } catch { /* ignore */ }
      };
      await new Promise(r => setTimeout(r, 300));

      const payload = {
        vehicles: vehicles.map(({ type, max_travel_distance_km, operating_time_h, ...v }: any) => ({
          ...v,
          max_travel_distance: (max_travel_distance_km ?? 200) * 1000,
          operating_time: (operating_time_h ?? 10) * 3600,
        })),
        orders,
        hard_tw: hardTW,
        real_route: showRealRoute,
      };

      const response = await fetch(`http://127.0.0.1:8000/api/v1/routing/solve?session_id=${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      setResult(data);
      setSelectedVehicleId(null);
      setSimTime(null);
      setIsSimulating(false);
      setPrevCosts(null);
      toast.success(`Hoàn tất! ${data.routes?.length ?? 0} xe · ${data.costs?.distance_km ?? 0} km`);
    } catch {
      alert('Không thể kết nối đến server API! Hãy chắc chắn FastAPI đang chạy.');
    } finally {
      eventSource?.close();
      setLoading(false);
      setProgressInfo(null);
    }
  };

  const handleRecalculate = async () => {
    if (!result?.routes) return;
    setRecalculating(true);
    setPrevCosts({
      total: result.costs?.total ?? 0,
      distance_km: result.costs?.distance_km ?? 0,
      penalty: result.costs?.penalty ?? 0,
      vehicles: result.routes?.length ?? 0,
    });
    try {
      const payload = {
        routes: result.routes,
        orders,
        vehicles: vehicles.map(v => ({
          ...v,
          max_travel_distance: (v.max_travel_distance_km ?? 200) * 1000,
          operating_time: (v.operating_time_h ?? 10) * 3600,
        })),
        hard_tw: hardTW,
        real_route: showRealRoute,
      };
      const response = await fetch('http://127.0.0.1:8000/api/v1/routing/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      setResult((prev: any) => ({ ...prev, ...data, execution_time_seconds: prev.execution_time_seconds }));
      toast.success('Đã cập nhật chỉ số thành công!');
    } catch {
      toast.error('Lỗi khi tính toán lại lộ trình!');
    } finally {
      setRecalculating(false);
    }
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !result) return;
    const parseId = (id: string) => {
      const [v, t, i] = id.split(':');
      return { vId: parseInt(v.slice(1)), tIdx: parseInt(t.slice(1)), iIdx: parseInt(i.slice(1)) };
    };
    const src = parseId(String(active.id));
    const dst = parseId(String(over.id));
    const newResult = JSON.parse(JSON.stringify(result));
    const srcRoute = newResult.routes.find((r: any) => r.vehicle_id === src.vId);
    const dstRoute = newResult.routes.find((r: any) => r.vehicle_id === dst.vId);
    if (!srcRoute || !dstRoute) return;
    const srcSeq: number[] = srcRoute.trips[src.tIdx].sequence;
    if (src.vId === dst.vId && src.tIdx === dst.tIdx) {
      const [removed] = srcSeq.splice(src.iIdx, 1);
      srcSeq.splice(dst.iIdx, 0, removed);
    } else {
      const dstSeq: number[] = dstRoute.trips[dst.tIdx].sequence;
      const [removed] = srcSeq.splice(src.iIdx, 1);
      dstSeq.splice(dst.iIdx, 0, removed);
    }
    setResult(newResult);
  };

  const handleInsertOrder = async (formData: {
    name: string; address: string;
    lat: number | null; lon: number | null;
    weight: number; volume: number;
    startTime: string; endTime: string; serviceDuration: number;
  }): Promise<{ ok: boolean; vehicleId?: number; vehicleType?: string; tripIdx?: number; prevStop?: string; nextStop?: string; costDelta?: number; arrivalTime?: string }> => {
    if (!formData.name || !formData.address) { toast.error('Vui lòng nhập tên và địa chỉ!'); return { ok: false }; }
    if (formData.lat == null || formData.lon == null) { toast.error('Vui lòng chọn vị trí!'); return { ok: false }; }
    if (!result?.routes) { toast.error('Chưa có tuyến đường. Hãy chạy thuật toán trước!'); return { ok: false }; }

    const newPos = { lat: formData.lat, lon: formData.lon };
    const posMap: Record<number, { lat: number; lon: number }> = { 0: { lat: 21.0245, lon: 105.8412 } };
    for (const o of orders) {
      if (o.lat != null && o.lon != null) posMap[o.customer_id] = { lat: o.lat, lon: o.lon };
    }

    const ordersByCustomer: Record<number, { weight: number; volume: number }> = {};
    for (const o of orders) {
      if (!ordersByCustomer[o.customer_id]) ordersByCustomer[o.customer_id] = { weight: 0, volume: 0 };
      ordersByCustomer[o.customer_id].weight += Number(o.weight);
      ordersByCustomer[o.customer_id].volume += Number(o.volume);
    }
    const getTripLoad = (seq: number[]) => seq.reduce(
      (acc, id) => {
        const o = ordersByCustomer[id];
        return o ? { weight: acc.weight + o.weight, volume: acc.volume + o.volume } : acc;
      },
      { weight: 0, volume: 0 }
    );

    const newWeight = Number(formData.weight);
    const newVolume = Number(formData.volume);

    let bestIncrease = Infinity, bestRouteIdx = -1, bestTripIdx = -1, bestInsertPos = -1;
    result.routes.forEach((route: any, rIdx: number) => {
      const vehicle = vehicles.find((v: any) => v.id === route.vehicle_id);
      if (!vehicle) return;
      route.trips?.forEach((trip: any, tIdx: number) => {
        const { weight: tripWeight, volume: tripVolume } = getTripLoad(trip.sequence);
        if (tripWeight + newWeight > vehicle.max_weight) return;
        if (tripVolume + newVolume > vehicle.max_volume) return;
        const seq: number[] = trip.sequence;
        for (let pos = 1; pos < seq.length; pos++) {
          if (simTime !== null && trip.stops) {
            const prevStop = trip.stops[pos - 1];
            const prevDep  = prevStop?.departure_time ?? prevStop?.arrival_time ?? 0;
            if (prevDep < simTime) continue;
          }
          const prev = posMap[seq[pos - 1]];
          const next = posMap[seq[pos]];
          if (!prev || !next) continue;
          const increase = haversineKm(prev.lat, prev.lon, newPos.lat, newPos.lon)
            + haversineKm(newPos.lat, newPos.lon, next.lat, next.lon)
            - haversineKm(prev.lat, prev.lon, next.lat, next.lon);
          if (increase < bestIncrease) {
            bestIncrease = increase;
            bestRouteIdx = rIdx; bestTripIdx = tIdx; bestInsertPos = pos;
          }
        }
      });
    });

    if (bestRouteIdx === -1) {
      toast.error(`Không tìm được tuyến khả thi: ${newWeight} kg, ${newVolume} m³ — không xe nào đủ tải.`);
      return { ok: false };
    }

    const assignedVehicleId = result.routes[bestRouteIdx].vehicle_id;
    const assignedVehicle   = vehicles.find((v: any) => v.id === assignedVehicleId);
    const assignedSeq: number[] = result.routes[bestRouteIdx].trips[bestTripIdx].sequence;
    const prevId  = assignedSeq[bestInsertPos - 1];
    const nextId  = assignedSeq[bestInsertPos];
    const prevStop = prevId === 0 ? 'Kho' : (customerDB[prevId]?.name ?? `KH #${prevId}`);
    const nextStop = nextId === 0 ? 'Kho' : (customerDB[nextId]?.name ?? `KH #${nextId}`);

    const newCustomerId = Math.floor(Math.random() * 90000) + 10000;
    const newOrderId = Math.floor(Math.random() * 900) + 100;
    const newOrderData = {
      id: newOrderId, customer_id: newCustomerId,
      lat: formData.lat!, lon: formData.lon!,
      weight: Number(formData.weight), volume: Number(formData.volume),
      start_time: timeToSeconds(formData.startTime),
      end_time: timeToSeconds(formData.endTime),
      service_duration: Number(formData.serviceDuration) * 60,
    };

    const newResult = JSON.parse(JSON.stringify(result));
    const targetTrip = newResult.routes[bestRouteIdx].trips[bestTripIdx];
    targetTrip.sequence.splice(bestInsertPos, 0, newCustomerId);
    targetTrip.stops = null;
    targetTrip.geometry = null;

    setCustomerDB(prev => ({
      ...prev,
      [newCustomerId]: { name: formData.name, address: formData.address, time: `${formData.startTime} - ${formData.endTime}`, lat: formData.lat, lon: formData.lon },
    }));
    const allOrders = [...orders, newOrderData];
    setOrders(allOrders);

    const costBefore  = result.costs?.total ?? 0;
    let   costDelta:   number | undefined;
    let   arrivalTime: string | undefined;

    const wasSimulating = isSimulating;
    setIsSimulating(false);
    setInsertingOrder(true);
    try {
      const payload = {
        routes: newResult.routes,
        orders: allOrders,
        vehicles: vehicles.map((v: any) => ({
          ...v,
          max_travel_distance: (v.max_travel_distance_km ?? 200) * 1000,
          operating_time: (v.operating_time_h ?? 10) * 3600,
        })),
        hard_tw: hardTW,
        real_route: showRealRoute,
      };
      const response = await fetch('http://127.0.0.1:8000/api/v1/routing/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      costDelta = (data.costs?.total ?? 0) - costBefore;
      const insertedStop = (data.routes as any[])
        ?.find((r: any) => r.vehicle_id === assignedVehicleId)
        ?.trips?.[bestTripIdx]?.stops?.[bestInsertPos];
      if (insertedStop?.arrival_time != null) {
        arrivalTime = secondsToTime(Math.round(insertedStop.arrival_time));
      }
      setResult((prev: any) => ({ ...prev, ...data, execution_time_seconds: prev.execution_time_seconds }));
      if (wasSimulating) setIsSimulating(true);
    } catch {
      setResult(newResult);
      toast.error('Đã chèn đơn hàng nhưng không thể cập nhật thời gian di chuyển!');
    } finally {
      setInsertingOrder(false);
    }

    return { ok: true, vehicleId: assignedVehicleId, vehicleType: assignedVehicle?.type, tripIdx: bestTripIdx + 1, prevStop, nextStop, costDelta, arrivalTime };
  };

  const handleConfirm = async () => {
    if (!result?.routes) return;
    setConfirming(true);
    try {
      const assignment = {
        confirmed_at: new Date().toISOString(),
        costs: result.costs,
        vehicles: result.routes.map((route: any) => {
          const vehicle = vehicles.find((v: any) => v.id === route.vehicle_id);
          return {
            vehicle_id: route.vehicle_id,
            type: vehicle?.type ?? null,
            max_weight: vehicle?.max_weight ?? null,
            max_volume: vehicle?.max_volume ?? null,
            total_distance_km: route.total_distance_km,
            trips: route.trips.map((trip: any, tIdx: number) => ({
              trip_index: tIdx + 1,
              geometry: trip.geometry ?? null,
              customers: trip.sequence
                .filter((nodeId: number) => nodeId !== 0)
                .map((customerId: number, pos: number) => {
                  const seqIdx = trip.sequence.indexOf(customerId);
                  const stop = trip.stops?.[seqIdx];
                  const info = customerDB[customerId];
                  const customerOrders = orders.filter((o: any) => o.customer_id === customerId);
                  return {
                    customer_id: customerId,
                    name: info?.name ?? null,
                    address: info?.address ?? null,
                    lat: (info as any)?.lat ?? null,
                    lon: (info as any)?.lon ?? null,
                    time_window: info?.time ?? null,
                    stop_index: pos + 1,
                    arrival_time: stop?.arrival_time != null ? secondsToTime(stop.arrival_time) : null,
                    departure_time: stop?.departure_time != null ? secondsToTime(stop.departure_time) : null,
                    orders: customerOrders.map((o: any) => ({
                      order_id: o.id,
                      weight: o.weight,
                      volume: o.volume,
                      service_duration_min: Math.round(o.service_duration / 60),
                    })),
                  };
                }),
            })),
          };
        }),
      };

      const res = await fetch('http://127.0.0.1:8000/api/v1/assignments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: assignment }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Đã xác nhận và lưu phân công vào hệ thống');
    } catch {
      toast.error('Không thể lưu phân công. Kiểm tra kết nối đến server.');
    } finally {
      setConfirming(false);
    }
  };

  if (!isLoggedIn && !driverSession && !customerSession) return (
    <LoginPage
      onAdminLogin={() => setIsLoggedIn(true)}
      onDriverLogin={(driver) => setDriverSession(driver)}
      onCustomerLogin={(customer) => setCustomerSession(customer)}
    />
  );
  if (driverSession) return <DriverDashboard driver={driverSession} onLogout={handleDriverLogout} />;
  if (customerSession) return <CustomerDashboard customer={customerSession} onLogout={handleCustomerLogout} />;

  return (
    <div className="h-screen bg-slate-50 font-sans flex flex-col overflow-hidden">
      <Toaster
        position="top-right"
        richColors
        expand
        gap={10}
        toastOptions={{
          style: {
            fontSize: '14px',
            fontWeight: '600',
            padding: '14px 18px',
            minWidth: '320px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          },
        }}
      />

      {/* App Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 z-40 shrink-0">
        <div className="flex items-center gap-3">
          <img src={routimeLogo} alt="Routime" className="h-12 w-auto object-contain" />
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-900 leading-tight">ROUTIME - Hệ thống điều phối giao hàng</h1>
            <p className="text-sm text-slate-400">Điều phối thông minh, giao hàng đúng hẹn</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">admin</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <LogOut size={14} />
              Đăng xuất
            </button>
          </div>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT SIDEBAR — navigation */}
        <aside className="w-52 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
          <nav className="p-3 pt-4 space-y-1">
            {([
              { id: 'vehicles'  as const, label: 'Đội xe',      Icon: Truck,       count: (vehiclesDB  as { vehicles:  unknown[] }).vehicles.length  },
              { id: 'drivers'   as const, label: 'Tài xế',      Icon: UserCircle,  count: (driversDB   as { drivers:   unknown[] }).drivers.length   },
              { id: 'orders'    as const, label: 'Đơn hàng',    Icon: Package,     count: (ordersDB    as { orders:    unknown[] }).orders.length     },
              { id: 'customers' as const, label: 'Khách hàng',  Icon: Users,       count: (customersDB as { customers: unknown[] }).customers.length  },
              { id: 'dispatch'  as const, label: 'Điều phối',   Icon: Route,       count: null                                                       },
              { id: 'live'      as const, label: 'Đơn hàng động', Icon: Zap,        count: null                                                       },
              { id: 'tracking'  as const, label: 'Theo dõi GPS',  Icon: Navigation, count: null                                                       },
              { id: 'stats'     as const, label: 'Thống kê',      Icon: BarChart2,  count: null                                                       },
            ]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setLeftTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors
                  ${leftTab === tab.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
              >
                <tab.Icon size={16} className="shrink-0" />
                <span className="flex-1 text-left">{tab.label}</span>
                {tab.count !== null && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full
                    ${leftTab === tab.id ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* MAIN CONTENT — changes per tab */}
        <main className="flex-1 overflow-y-auto">

          {leftTab === 'vehicles'  && <FleetView dispatchVehicles={vehicles} onDispatchVehiclesChange={setVehicles} />}
          {leftTab === 'drivers'   && <DriversView />}
          {leftTab === 'tracking'  && <div className="h-full flex flex-col"><LiveTrackingMap /></div>}
          {leftTab === 'stats'     && <div className="h-full overflow-y-auto"><StatsView /></div>}
          {leftTab === 'orders'    && <OrdersView dispatchOrders={orders} dispatchCustomerDB={customerDB} onDispatchOrdersChange={setOrders} onDispatchCustomerDBChange={setCustomerDB} />}
          {leftTab === 'customers' && <CustomersView />}

          {leftTab === 'live' && (
            <LiveDispatchTab
              result={result}
              orders={orders}
              simTime={simTime}
              simBounds={simBounds}
              isSimulating={isSimulating}
              simSpeed={simSpeed}
              insertingOrder={insertingOrder}
              selectedVehicleId={selectedVehicleId}
              customerDB={customerDB}
              setSimSpeed={setSimSpeed}
              onSimToggle={handleSimToggle}
              onSimReset={handleSimReset}
              onSimTimeChange={(t: number) => { setIsSimulating(false); setSimTime(t); }}
              handleInsertOrder={handleInsertOrder}
            />
          )}

          {/* Dispatch tab */}
          {leftTab === 'dispatch' && (
            <div className="p-5">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

                {/* Algorithm controls + vehicle/order config */}
                <div className="lg:col-span-4 space-y-4">

                  {/* DB sync card */}
                  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
                      <div className="w-7 h-7 bg-teal-100 rounded-lg flex items-center justify-center">
                        <Database size={16} className="text-teal-600" />
                      </div>
                      <h2 className="font-semibold text-slate-800 text-base">Đồng bộ từ hệ thống</h2>
                    </div>
                    <div className="px-5 py-4 space-y-3">
                      {/* Date range filter */}
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                          <Calendar size={11} /> Lọc đơn theo ngày
                        </p>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date" value={dispatchDateFrom}
                            onChange={e => setDispatchDateFrom(e.target.value)}
                            className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                          <span className="text-xs text-slate-400 shrink-0">–</span>
                          <input
                            type="date" value={dispatchDateTo}
                            onChange={e => setDispatchDateTo(e.target.value)}
                            className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                        </div>
                      </div>

                      {/* Status checkboxes */}
                      <div className="flex flex-col gap-1.5">
                        <p className="text-xs font-medium text-slate-500">Loại đơn cần tải</p>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox" checked={loadPending}
                            onChange={e => setLoadPending(e.target.checked)}
                            className="w-4 h-4 accent-blue-500 rounded"
                          />
                          <span className="text-sm text-slate-700">Chờ xử lý</span>
                          <span className="ml-auto text-xs font-semibold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                            {(ordersDB as { orders: any[] }).orders.filter(o => o.status === 'pending' && o.created_at >= dispatchDateFrom && o.created_at <= dispatchDateTo).length}
                          </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox" checked={loadFailed}
                            onChange={e => setLoadFailed(e.target.checked)}
                            className="w-4 h-4 accent-blue-500 rounded"
                          />
                          <span className="text-sm text-slate-700">Giao không thành công</span>
                          <span className="ml-auto text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">
                            {(ordersDB as { orders: any[] }).orders.filter(o => o.status === 'failed' && o.created_at >= dispatchDateFrom && o.created_at <= dispatchDateTo).length}
                          </span>
                        </label>
                      </div>

                      <div className="flex items-center gap-4 px-3 py-2.5 bg-slate-50 rounded-sm text-xs text-slate-600">
                        <span className="flex items-center gap-1.5 text-sm">
                          <Truck size={14} className="text-indigo-500" />
                          <span className="font-semibold text-slate-800">{dbAvailableVehicles.length}</span> xe sẵn sàng
                        </span>
                        <div className="w-px h-4 bg-slate-200" />
                        <span className="flex items-center gap-1.5 text-sm">
                          <Package size={14} className="text-orange-500" />
                          <span className="font-semibold text-orange-600">{dbOrdersToLoad.length}</span> đơn sẽ tải
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={handleLoadVehiclesFromDB}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors"
                        >
                          <Truck size={14} />
                          Tải đội xe ({dbAvailableVehicles.length})
                        </button>
                        <button
                          onClick={handleLoadOrdersFromDB}
                          disabled={dbOrdersToLoad.length === 0 || (!loadPending && !loadFailed)}
                          className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold bg-orange-50 hover:bg-orange-100 text-orange-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Package size={14} />
                          Tải đơn hàng ({dbOrdersToLoad.length})
                        </button>
                      </div>
                      <p className="text-[13px] text-slate-400 text-center">
                        Tải xe sẵn sàng &amp; đơn hàng từ CSDL để bắt đầu điều phối
                      </p>
                    </div>
                  </div>

                  <VehiclePanel vehicles={vehicles} onChange={setVehicles} />
                  <OrderPanel
                    orders={orders}
                    customerDB={customerDB}
                    onOrdersChange={setOrders}
                    onCustomerDBChange={setCustomerDB}
                  />
                  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
                      <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center">
                        <Route size={14} className="text-indigo-600" />
                      </div>
                      <h2 className="font-semibold text-slate-800 text-base">Điều phối lộ trình</h2>
                    </div>
                    <div className="px-5 py-4 space-y-4">

                      {/* Data summary */}
                      <div className="flex items-center gap-4 px-3 py-2.5 bg-slate-50 rounded-sm text-xs text-slate-600">
                        <span className="flex items-center gap-1.5 text-sm">
                          <Truck size={14} className="text-indigo-500" />
                          <span className="font-semibold text-slate-800">{vehicles.length}</span> xe
                        </span>
                        <div className="w-px h-4 bg-slate-200" />
                        <span className="flex items-center gap-1.5 text-sm">
                          <Package size={14} className="text-orange-500" />
                          <span className="font-semibold text-slate-800">{orders.length}</span> đơn hàng
                        </span>
                      </div>

                      {/* Hard time-window toggle */}
                      <label className="flex items-center gap-3 cursor-pointer select-none">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={hardTW}
                          onClick={() => setHardTW(!hardTW)}
                          className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${hardTW ? 'bg-rose-500' : 'bg-slate-300'}`}
                        >
                          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${hardTW ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                        <span className="text-sm text-slate-700">
                          Ràng buộc thời gian cứng
                          <span className={`ml-1.5 text-xs font-bold ${hardTW ? 'text-rose-500' : 'text-slate-400'}`}>
                            {hardTW ? 'BẬT' : 'TẮT'}
                          </span>
                        </span>
                      </label>

                      {/* Run button */}
                      <button
                        onClick={handleRunAlgorithm}
                        disabled={loading || orders.length === 0}
                        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loading
                          ? <><Loader2 size={15} className="animate-spin" /> Đang xử lý...</>
                          : <><Play size={15} /> Bắt đầu chia tuyến</>
                        }
                      </button>

                      {/* Progress bar */}
                      {loading && progressInfo && (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-medium text-slate-600">
                              {progressInfo.stage === 'init'    && 'Khởi tạo...'}
                              {progressInfo.stage === 'matrix'  && 'Tải ma trận khoảng cách'}
                              {progressInfo.stage === 'solving' && 'Đang chạy thuật toán GA'}
                            </span>
                            {progressInfo.total > 1 && (
                              <span className="text-xs font-bold text-indigo-600">{progressInfo.done}/{progressInfo.total}</span>
                            )}
                          </div>
                          <div className="relative w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${progressPct}%`,
                                background: progressInfo.stage === 'solving'
                                  ? 'linear-gradient(90deg,#6366f1,#8b5cf6)'
                                  : 'linear-gradient(90deg,#3b82f6,#06b6d4)',
                              }}
                            />
                            <div className="absolute inset-0 rounded-full overflow-hidden">
                              <div
                                className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                                style={{ animation: 'shimmer 1.5s infinite' }}
                              />
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-500 text-center">{progressInfo.message}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Map + simulation + results */}
                <div className="lg:col-span-8 space-y-5">

                  {/* Dispatch date picker */}
                  <div className="bg-white rounded-lg border border-slate-200 px-5 py-3 flex items-center gap-3 flex-wrap">
                    <Calendar size={15} className="text-indigo-500 shrink-0" />
                    <span className="text-sm font-semibold text-slate-700">Ngày điều phối:</span>
                    <input
                      type="date"
                      value={simDate}
                      onChange={e => updateSimDate(e.target.value)}
                      className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <button
                      onClick={() => updateSimDate(new Date().toISOString().slice(0, 10))}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                    >
                      Hôm nay
                    </button>
                    <span className="ml-auto text-xs text-slate-400">
                      <span className="font-semibold text-slate-600">{dbPendingOrders.length}</span> đơn chờ xử lý
                    </span>
                  </div>

                  {result && (
                    <SimulationControls
                      simTime={simTime}
                      simBounds={simBounds}
                      isSimulating={isSimulating}
                      simSpeed={simSpeed}
                      onToggle={handleSimToggle}
                      onReset={handleSimReset}
                      onSpeedChange={setSimSpeed}
                      onTimeChange={(t) => { setIsSimulating(false); setSimTime(t); }}
                    />
                  )}

                  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden" style={{ height: '420px' }}>
                    <Suspense fallback={
                      <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                        Đang tải bản đồ...
                      </div>
                    }>
                      <MapView
                        customerDB={customerDB}
                        orders={orders}
                        result={result}
                        selectedVehicleId={selectedVehicleId}
                        simTime={simTime}
                      />
                    </Suspense>
                  </div>

                  <ResultsPanel
                    result={result}
                    vehicles={vehicles}
                    customerDB={customerDB}
                    prevCosts={prevCosts}
                    recalculating={recalculating}
                    confirming={confirming}
                    showRealRoute={showRealRoute}
                    onShowRealRouteChange={setShowRealRoute}
                    onRecalculate={handleRecalculate}
                    onConfirm={handleConfirm}
                    onDragEnd={onDragEnd}
                  />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
