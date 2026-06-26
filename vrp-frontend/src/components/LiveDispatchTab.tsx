import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Zap, ZapOff, Plus, Clock, Truck, Package, CheckCircle, XCircle, Activity } from 'lucide-react';
import SimulationControls from './SimulationControls';
import { secondsToTime } from '../utils';
import customersDB from '../../../database/customers/customers.json';

const MapView = lazy(() => import('../MapView'));

interface InsertFormData {
  name: string; address: string;
  lat: number | null; lon: number | null;
  weight: number; volume: number;
  startTime: string; endTime: string; serviceDuration: number;
}

interface InsertResult { ok: boolean; vehicleId?: number; vehicleType?: string; tripIdx?: number; prevStop?: string; nextStop?: string; costDelta?: number; arrivalTime?: string; }

interface FeedEntry {
  id: number;
  simTimeStr: string;
  customerName: string;
  productName: string;
  weight: number;
  volume: number;
  status: 'ok' | 'rejected';
  vehicleId?: number;
  vehicleType?: string;
  tripIdx?: number;
  prevStop?: string;
  nextStop?: string;
  costDelta?: number;
  arrivalTime?: string;
}

interface Props {
  result: any;
  orders: any[];
  simTime: number | null;
  simBounds: { start: number; end: number } | null;
  isSimulating: boolean;
  simSpeed: number;
  insertingOrder: boolean;
  selectedVehicleId: number | null;
  customerDB: Record<number, any>;
  setSimSpeed: (s: number) => void;
  onSimToggle: () => void;
  onSimReset: () => void;
  onSimTimeChange: (t: number) => void;
  handleInsertOrder: (formData: InsertFormData) => Promise<InsertResult>;
}

const TIME_WINDOWS = [
  { start: '07:00', end: '12:00' },
  { start: '08:00', end: '14:00' },
  { start: '09:00', end: '17:00' },
  { start: '12:00', end: '17:00' },
  { start: '13:00', end: '18:00' },
  { start: '08:00', end: '18:00' },
];

const INTERVALS = [
  { label: '3s',  value: 3  },
  { label: '5s',  value: 5  },
  { label: '10s', value: 10 },
  { label: '20s', value: 20 },
];

export default function LiveDispatchTab({
  result, orders, simTime, simBounds, isSimulating,
  simSpeed, insertingOrder, selectedVehicleId, customerDB,
  setSimSpeed, onSimToggle, onSimReset, onSimTimeChange,
  handleInsertOrder,
}: Props) {
  const [products, setProducts] = useState<any[]>([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoInterval, setAutoInterval] = useState(5);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [generating, setGenerating] = useState(false);

  const entryIdRef   = useRef(0);
  const generatingRef = useRef(false);

  const customers = (customersDB as { customers: any[] }).customers.filter(
    c => c.lat != null && c.lon != null,
  );

  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/v1/products')
      .then(r => r.json())
      .then(d => setProducts(d.products ?? []))
      .catch(() => {});
  }, []);

  // Stop auto-gen only when simulation ends for real — not during insertion pauses
  useEffect(() => {
    if (!isSimulating && !insertingOrder) setAutoRunning(false);
  }, [isSimulating, insertingOrder]);

  // Keep a ref that always closes over the latest state/props
  const generateRef = useRef<() => Promise<void>>(async () => {});
  generateRef.current = async () => {
    if (!result?.routes || customers.length === 0 || products.length === 0) return;
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);

    const customer = customers[Math.floor(Math.random() * customers.length)];
    const product  = products[Math.floor(Math.random() * products.length)];
    const tw       = TIME_WINDOWS[Math.floor(Math.random() * TIME_WINDOWS.length)];

    const res = await handleInsertOrder({
      name:            customer.name,
      address:         customer.address ?? customer.name,
      lat:             customer.lat,
      lon:             customer.lon,
      weight:          product.weight,
      volume:          product.volume,
      startTime:       tw.start,
      endTime:         tw.end,
      serviceDuration: 15,
    });

    setFeed(prev => [{
      id:           ++entryIdRef.current,
      simTimeStr:   simTime != null ? secondsToTime(Math.floor(simTime)) : '--:--',
      customerName: customer.name,
      productName:  product.name,
      weight:       product.weight,
      volume:       product.volume,
      status:       (res.ok ? 'ok' : 'rejected') as 'ok' | 'rejected',
      vehicleId:    res.vehicleId,
      vehicleType:  res.vehicleType,
      tripIdx:      res.tripIdx,
      prevStop:     res.prevStop,
      nextStop:     res.nextStop,
      costDelta:    res.costDelta,
      arrivalTime:  res.arrivalTime,
    }, ...prev].slice(0, 60));

    generatingRef.current = false;
    setGenerating(false);
  };

  // Auto-gen interval — only captures the ref, never stale
  useEffect(() => {
    if (!autoRunning || !isSimulating) return;
    const id = setInterval(() => { generateRef.current(); }, autoInterval * 1000);
    return () => clearInterval(id);
  }, [autoRunning, isSimulating, autoInterval]);

  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-center p-10">
        <div className="space-y-3">
          <Activity size={40} className="text-slate-300 mx-auto" />
          <p className="text-slate-600 font-semibold">Chưa có tuyến đường</p>
          <p className="text-sm text-slate-400 max-w-xs">
            Hãy chạy thuật toán trong tab <strong className="text-slate-600">Điều phối</strong>, sau đó quay lại đây để mô phỏng đơn hàng đổ vào theo thời gian thực.
          </p>
        </div>
      </div>
    );
  }

  const okCount       = feed.filter(f => f.status === 'ok').length;
  const rejectedCount = feed.filter(f => f.status === 'rejected').length;

  return (
    <div className="h-full flex gap-5 p-5 overflow-hidden">

      {/* ── Left: map + sim controls ── */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <SimulationControls
          simTime={simTime}
          simBounds={simBounds}
          isSimulating={isSimulating}
          simSpeed={simSpeed}
          insertingOrder={insertingOrder || generating}
          onToggle={onSimToggle}
          onReset={onSimReset}
          onSpeedChange={setSimSpeed}
          onTimeChange={onSimTimeChange}
        />
        <div className="flex-1 min-h-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
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
      </div>

      {/* ── Right: controls + feed ── */}
      <div className="w-80 shrink-0 flex flex-col gap-4 overflow-hidden">

        {/* Auto-gen controls */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-violet-100 rounded-lg flex items-center justify-center">
              <Zap size={14} className="text-violet-600" />
            </div>
            <h3 className="font-semibold text-slate-800 text-sm">Đơn hàng tự động</h3>
          </div>

          <div>
            <label className="text-xs text-slate-500 font-medium mb-1.5 block">Tần suất (giây thực)</label>
            <div className="flex gap-1.5">
              {INTERVALS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => setAutoInterval(value)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    autoInterval === value
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {autoRunning ? (
            <button
              onClick={() => setAutoRunning(false)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors bg-rose-500 hover:bg-rose-600 text-white"
            >
              <ZapOff size={14} /> Dừng tự động
            </button>
          ) : (
            <button
              onClick={() => setAutoRunning(true)}
              disabled={!isSimulating}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap size={14} /> Bật tự động
            </button>
          )}

          {!isSimulating && (
            <p className="text-[11px] text-center text-slate-400">
              Nhấn Chạy mô phỏng để bật chế độ tự động
            </p>
          )}

          <button
            onClick={() => generateRef.current()}
            disabled={generating || insertingOrder}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating
              ? <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
              : <Plus size={14} />}
            Thêm đơn ngay
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 shrink-0">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 text-center">
            <p className="text-2xl font-bold text-emerald-600">{okCount}</p>
            <p className="text-xs text-slate-500 mt-0.5">Chèn thành công</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 text-center">
            <p className="text-2xl font-bold text-rose-500">{rejectedCount}</p>
            <p className="text-xs text-slate-500 mt-0.5">Từ chối</p>
          </div>
        </div>

        {/* Live feed */}
        <div className="flex-1 min-h-0 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">Luồng đơn hàng</span>
            </div>
            <div className="flex items-center gap-2">
              {autoRunning && (
                <span className="flex items-center gap-1 text-xs text-violet-600 font-medium">
                  <span className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-pulse" />
                  LIVE
                </span>
              )}
              {feed.length > 0 && (
                <button
                  onClick={() => setFeed([])}
                  className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Xóa
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {feed.length === 0 ? (
              <p className="text-center text-xs text-slate-400 pt-8">
                Chưa có đơn hàng nào được thêm
              </p>
            ) : (
              feed.map(entry => (
                <div
                  key={entry.id}
                  className={`rounded-xl border p-3 text-xs space-y-1.5 ${
                    entry.status === 'ok'
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-rose-50 border-rose-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {entry.status === 'ok'
                        ? <CheckCircle size={12} className="text-emerald-500 shrink-0" />
                        : <XCircle    size={12} className="text-rose-500 shrink-0" />}
                      <span className={`font-semibold ${entry.status === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {entry.status === 'ok' ? 'Đã chèn' : 'Từ chối'}
                      </span>
                    </div>
                    <span className="font-mono text-slate-400">{entry.simTimeStr}</span>
                  </div>

                  <div className="flex items-center gap-1 text-slate-600">
                    <Package size={10} className="shrink-0" />
                    <span className="truncate">{entry.productName}</span>
                    <span className="text-slate-400 shrink-0">{entry.weight}kg</span>
                  </div>

                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1 text-slate-500 min-w-0">
                      <Clock size={10} className="shrink-0" />
                      <span className="truncate">{entry.customerName}</span>
                    </div>
                    {entry.arrivalTime && (
                      <span className="shrink-0 font-mono font-semibold text-indigo-600 text-[11px]">
                        {entry.arrivalTime}
                      </span>
                    )}
                  </div>

                  {entry.status === 'ok' && entry.vehicleId != null && (
                    <>
                      <div className="flex items-center gap-1 text-slate-500">
                        <Truck size={10} className="shrink-0" />
                        <span>Xe #{entry.vehicleId} · {entry.vehicleType ?? '—'} · chuyến {entry.tripIdx}</span>
                      </div>
                      {entry.prevStop && entry.nextStop && (
                        <div className="text-slate-400 pl-3.5 leading-tight">
                          {entry.prevStop} → <span className="text-emerald-600 font-medium">mới</span> → {entry.nextStop}
                        </div>
                      )}
                      {entry.costDelta != null && (
                        <div className={`pl-3.5 font-semibold text-[11px] ${entry.costDelta >= 0 ? 'text-orange-600' : 'text-emerald-600'}`}>
                          {entry.costDelta >= 0 ? '+' : ''}
                          {entry.costDelta.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ chi phí
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
