import { useState, lazy, Suspense, useEffect, useMemo } from 'react';
import { type DropResult } from '@hello-pangea/dnd';
import { timeToSeconds, haversineKm } from './utils';
import VehiclePanel from './components/VehiclePanel';
import OrderPanel from './components/OrderPanel';
import SimulationControls from './components/SimulationControls';
import ResultsPanel from './components/ResultsPanel';

const MapView = lazy(() => import('./MapView'));

export default function App() {
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

  const [recalculating, setRecalculating] = useState(false);
  const [prevCosts, setPrevCosts] = useState<{ total: number; distance_km: number; penalty: number; vehicles: number } | null>(null);

  // --- Simulation ---
  const [simTime, setSimTime] = useState<number | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simSpeed, setSimSpeed] = useState(300);

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

  // --- API calls ---
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
          if (data.stage === 'done') eventSource?.close();
          else setProgressInfo(data);
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
    } catch {
      alert('Lỗi khi tính toán lại lộ trình!');
    } finally {
      setRecalculating(false);
    }
  };

  const onDragEnd = (dropResult: DropResult) => {
    const { source, destination } = dropResult;
    if (!destination || !result) return;
    const newResult = { ...result };
    const parseId = (id: string) => { const p = id.split('-'); return { vId: parseInt(p[1]), tIdx: parseInt(p[3]) }; };
    const src = parseId(source.droppableId);
    const dst = parseId(destination.droppableId);
    const srcVehicle = newResult.routes.find((r: any) => r.vehicle_id === src.vId);
    const dstVehicle = newResult.routes.find((r: any) => r.vehicle_id === dst.vId);
    if (!srcVehicle || !dstVehicle) return;
    const srcSeq = [...srcVehicle.trips[src.tIdx].sequence];
    const [removed] = srcSeq.splice(source.index, 1);
    if (srcVehicle === dstVehicle && src.tIdx === dst.tIdx) {
      srcSeq.splice(destination.index, 0, removed);
      srcVehicle.trips[src.tIdx].sequence = srcSeq;
    } else {
      const dstSeq = [...dstVehicle.trips[dst.tIdx].sequence];
      dstSeq.splice(destination.index, 0, removed);
      srcVehicle.trips[src.tIdx].sequence = srcSeq;
      dstVehicle.trips[dst.tIdx].sequence = dstSeq;
    }
    setResult(newResult);
  };

  // --- Dynamic order insertion ---
  const handleInsertOrder = (formData: {
    name: string; address: string;
    lat: number | null; lon: number | null;
    weight: number; volume: number;
    startTime: string; endTime: string; serviceDuration: number;
  }): boolean => {
    if (!formData.name || !formData.address) { alert('Vui lòng nhập tên và địa chỉ!'); return false; }
    if (formData.lat == null || formData.lon == null) { alert('Vui lòng chọn vị trí!'); return false; }
    if (!result?.routes) { alert('Chưa có tuyến đường. Hãy chạy thuật toán trước!'); return false; }

    const newPos = { lat: formData.lat, lon: formData.lon };
    const posMap: Record<number, { lat: number; lon: number }> = { 0: { lat: 21.0245, lon: 105.8412 } };
    for (const o of orders) {
      if (o.lat != null && o.lon != null) posMap[o.customer_id] = { lat: o.lat, lon: o.lon };
    }

    let bestIncrease = Infinity, bestRouteIdx = -1, bestTripIdx = -1, bestInsertPos = -1;
    result.routes.forEach((route: any, rIdx: number) => {
      route.trips?.forEach((trip: any, tIdx: number) => {
        const seq: number[] = trip.sequence;
        for (let pos = 1; pos < seq.length; pos++) {
          if (simTime !== null && trip.stops) {
            const prevStop = trip.stops[pos - 1];
            if (prevStop?.departure_time != null && prevStop.departure_time < simTime) continue;
          }
          const prev = posMap[seq[pos - 1]];
          const next = posMap[seq[pos]];
          if (!prev || !next) continue;
          const dPN = haversineKm(prev.lat, prev.lon, newPos.lat, newPos.lon);
          const dNX = haversineKm(newPos.lat, newPos.lon, next.lat, next.lon);
          const dPX = haversineKm(prev.lat, prev.lon, next.lat, next.lon);
          const increase = dPN * dPN + dNX * dNX - dPX * dPX;
          if (increase < bestIncrease) { bestIncrease = increase; bestRouteIdx = rIdx; bestTripIdx = tIdx; bestInsertPos = pos; }
        }
      });
    });

    if (bestRouteIdx === -1) { alert('Không tìm được vị trí hợp lệ để chèn đơn hàng!'); return false; }

    const newCustomerId = Math.floor(Math.random() * 90000) + 10000;
    const newOrderId = Math.floor(Math.random() * 900) + 100;
    const newResult = JSON.parse(JSON.stringify(result));
    const targetTrip = newResult.routes[bestRouteIdx].trips[bestTripIdx];
    targetTrip.sequence.splice(bestInsertPos, 0, newCustomerId);
    targetTrip.stops = null;
    targetTrip.geometry = null;

    setCustomerDB(prev => ({
      ...prev,
      [newCustomerId]: { name: formData.name, address: formData.address, time: `${formData.startTime} - ${formData.endTime}`, lat: formData.lat, lon: formData.lon },
    }));
    setOrders(prev => [...prev, {
      id: newOrderId, customer_id: newCustomerId,
      lat: formData.lat, lon: formData.lon,
      weight: Number(formData.weight), volume: Number(formData.volume),
      start_time: timeToSeconds(formData.startTime),
      end_time: timeToSeconds(formData.endTime),
      service_duration: Number(formData.serviceDuration) * 60,
    }]);
    setResult(newResult);
    return true;
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Hệ thống điều phối giao hàng</h1>
          <p className="text-gray-600 mt-2">Tạo đơn hàng thực tế và chia tuyến tự động</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* LEFT COLUMN */}
          <div className="lg:col-span-4 space-y-6">
            <VehiclePanel vehicles={vehicles} onChange={setVehicles} />
            <OrderPanel
              orders={orders}
              customerDB={customerDB}
              vehicles={vehicles}
              hardTW={hardTW}
              loading={loading}
              progressInfo={progressInfo}
              hasRoutes={!!result?.routes}
              onHardTWChange={setHardTW}
              onRunAlgorithm={handleRunAlgorithm}
              onOrdersChange={setOrders}
              onCustomerDBChange={setCustomerDB}
              onVehiclesChange={setVehicles}
              onInsertOrder={handleInsertOrder}
            />
          </div>

          {/* RIGHT COLUMN */}
          <div className="lg:col-span-8 space-y-6">
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

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" style={{ height: '420px' }}>
              <Suspense fallback={<div className="h-full flex items-center justify-center text-gray-400">Đang tải bản đồ...</div>}>
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
              showRealRoute={showRealRoute}
              onShowRealRouteChange={setShowRealRoute}
              onRecalculate={handleRecalculate}
              onDragEnd={onDragEnd}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
