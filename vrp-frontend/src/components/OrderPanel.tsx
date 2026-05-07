import { useState } from 'react';
import { timeToSeconds } from '../utils';

const HANOI_BOUNDS = { latMin: 20.9634, latMax: 21.0856, lonMin: 105.7788, lonMax: 105.9038 };
const EMPTY_FORM = {
  name: '', address: '',
  lat: null as number | null,
  lon: null as number | null,
  weight: 10, volume: 1,
  startTime: '08:00', endTime: '12:00',
  serviceDuration: 5,
};
const VEHICLE_PRESETS = [
  { type: 'Xe máy',      max_weight: 30,   max_volume: 0.5, operating_cost: 200,  time_based_cost: 50,  max_travel_distance_km: 80,  operating_time_h: 8  },
  { type: 'Xe tải Van',  max_weight: 800,  max_volume: 5,   operating_cost: 1200, time_based_cost: 250, max_travel_distance_km: 200, operating_time_h: 10 },
  { type: 'Xe tải nhỏ', max_weight: 500,  max_volume: 3,   operating_cost: 800,  time_based_cost: 150, max_travel_distance_km: 150, operating_time_h: 9  },
  { type: 'Xe tải lớn', max_weight: 2000, max_volume: 15,  operating_cost: 1800, time_based_cost: 400, max_travel_distance_km: 300, operating_time_h: 12 },
];
const TIME_WINDOWS = [
  { start: '07:00', end: '10:00' }, { start: '08:00', end: '12:00' },
  { start: '09:00', end: '13:00' }, { start: '13:00', end: '17:00' },
  { start: '14:00', end: '18:00' }, { start: '16:00', end: '20:00' },
];
const DISTRICTS = ['Hoàn Kiếm','Đống Đa','Ba Đình','Hai Bà Trưng','Cầu Giấy','Thanh Xuân','Hoàng Mai','Long Biên','Tây Hồ','Nam Từ Liêm'];

export type OrderFormData = typeof EMPTY_FORM;

interface Props {
  orders: any[];
  customerDB: Record<number, any>;
  vehicles: any[];
  hardTW: boolean;
  loading: boolean;
  progressInfo: { stage: string; done: number; total: number; message: string } | null;
  hasRoutes: boolean;
  onHardTWChange: (v: boolean) => void;
  onRunAlgorithm: () => void;
  onOrdersChange: (orders: any[]) => void;
  onCustomerDBChange: (db: Record<number, any>) => void;
  onVehiclesChange: (vehicles: any[]) => void;
  onInsertOrder: (formData: OrderFormData) => boolean;
}

export default function OrderPanel({
  orders, customerDB, vehicles, hardTW, loading, progressInfo,
  hasRoutes, onHardTWChange, onRunAlgorithm,
  onOrdersChange, onCustomerDBChange, onVehiclesChange, onInsertOrder,
}: Props) {
  const [formData, setFormData] = useState<OrderFormData>({ ...EMPTY_FORM });
  const [editingOrderIdx, setEditingOrderIdx] = useState<number | null>(null);
  const [autoGenCount, setAutoGenCount] = useState({ orders: 5, vehicles: 2 });

  const randomLocation = () => {
    const rand = (min: number, max: number) => +(Math.random() * (max - min) + min).toFixed(6);
    setFormData(f => ({ ...f, lat: rand(HANOI_BOUNDS.latMin, HANOI_BOUNDS.latMax), lon: rand(HANOI_BOUNDS.lonMin, HANOI_BOUNDS.lonMax) }));
  };

  const handleAutoGenerate = () => {
    const rand = (min: number, max: number) => Math.random() * (max - min) + min;

    if (autoGenCount.vehicles > 0) {
      const base = vehicles.length > 0 ? Math.max(...vehicles.map((v: any) => v.id)) : 0;
      const newVehicles = Array.from({ length: autoGenCount.vehicles }, (_, i) => ({
        id: base + i + 1,
        ...VEHICLE_PRESETS[Math.floor(Math.random() * VEHICLE_PRESETS.length)],
      }));
      onVehiclesChange([...vehicles, ...newVehicles]);
    }

    if (autoGenCount.orders > 0) {
      const newOrders: any[] = [];
      const newDB: Record<number, any> = {};
      for (let i = 0; i < autoGenCount.orders; i++) {
        const cid = Math.floor(Math.random() * 90000) + 10000;
        const oid = Math.floor(Math.random() * 900) + 100;
        const lat = +rand(HANOI_BOUNDS.latMin, HANOI_BOUNDS.latMax).toFixed(6);
        const lon = +rand(HANOI_BOUNDS.lonMin, HANOI_BOUNDS.lonMax).toFixed(6);
        const tw = TIME_WINDOWS[Math.floor(Math.random() * TIME_WINDOWS.length)];
        const district = DISTRICTS[Math.floor(Math.random() * DISTRICTS.length)];
        newDB[cid] = { name: `Khách hàng ${orders.length + i + 1}`, address: `Quận ${district}, Hà Nội`, time: `${tw.start} - ${tw.end}`, lat, lon };
        newOrders.push({
          id: oid, customer_id: cid, lat, lon,
          weight: +rand(1, 40).toFixed(1), volume: +rand(0.1, 2).toFixed(2),
          start_time: timeToSeconds(tw.start), end_time: timeToSeconds(tw.end),
          service_duration: Math.floor(rand(5, 20)) * 60,
        });
      }
      onCustomerDBChange({ ...customerDB, ...newDB });
      onOrdersChange([...orders, ...newOrders]);
    }
  };

  const handleAddOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.address) { alert('Vui lòng nhập tên và địa chỉ!'); return; }
    if (formData.lat == null || formData.lon == null) { alert("Vui lòng chọn vị trí!"); return; }

    if (editingOrderIdx !== null) {
      const existing = orders[editingOrderIdx];
      onCustomerDBChange({ ...customerDB, [existing.customer_id]: { name: formData.name, address: formData.address, time: `${formData.startTime} - ${formData.endTime}`, lat: formData.lat, lon: formData.lon } });
      const updated = [...orders];
      updated[editingOrderIdx] = { ...existing, lat: formData.lat, lon: formData.lon, weight: Number(formData.weight), volume: Number(formData.volume), start_time: timeToSeconds(formData.startTime), end_time: timeToSeconds(formData.endTime), service_duration: Number(formData.serviceDuration) * 60 };
      onOrdersChange(updated);
      setEditingOrderIdx(null);
      setFormData({ ...EMPTY_FORM });
      return;
    }

    const newCustomerId = Math.floor(Math.random() * 90000) + 10000;
    const newOrderId = Math.floor(Math.random() * 900) + 100;
    onCustomerDBChange({ ...customerDB, [newCustomerId]: { name: formData.name, address: formData.address, time: `${formData.startTime} - ${formData.endTime}`, lat: formData.lat, lon: formData.lon } });
    onOrdersChange([...orders, { id: newOrderId, customer_id: newCustomerId, lat: formData.lat, lon: formData.lon, weight: Number(formData.weight), volume: Number(formData.volume), start_time: timeToSeconds(formData.startTime), end_time: timeToSeconds(formData.endTime), service_duration: Number(formData.serviceDuration) * 60 }]);
    setFormData({ ...EMPTY_FORM });
  };

  const handleEditOrder = (idx: number) => {
    const o = orders[idx];
    const info = customerDB[o.customer_id];
    const [startTime, endTime] = info.time.split(' - ');
    setFormData({ name: info.name, address: info.address, lat: o.lat ?? null, lon: o.lon ?? null, weight: o.weight, volume: o.volume, startTime, endTime, serviceDuration: Math.round(o.service_duration / 60) });
    setEditingOrderIdx(idx);
  };

  const handleRemoveOrder = (idx: number) => {
    if (editingOrderIdx === idx) { setEditingOrderIdx(null); setFormData({ ...EMPTY_FORM }); }
    const updated = [...orders];
    updated.splice(idx, 1);
    onOrdersChange(updated);
  };

  const handleInsertClick = () => {
    if (!formData.name || !formData.address) { alert('Vui lòng nhập tên và địa chỉ!'); return; }
    if (formData.lat == null || formData.lon == null) { alert('Vui lòng chọn vị trí!'); return; }
    const ok = onInsertOrder(formData);
    if (ok) setFormData({ ...EMPTY_FORM });
  };

  return (
    <div className="space-y-6">
      {/* Auto-generate */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
        <h2 className="text-sm font-bold mb-3 text-gray-700">⚡ Tạo dữ liệu ngẫu nhiên</h2>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Số đơn hàng</label>
            <input type="number" min="0" max="50" value={autoGenCount.orders} onChange={e => setAutoGenCount(c => ({ ...c, orders: Number(e.target.value) }))} className="border p-1.5 rounded text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Số xe</label>
            <input type="number" min="0" max="20" value={autoGenCount.vehicles} onChange={e => setAutoGenCount(c => ({ ...c, vehicles: Number(e.target.value) }))} className="border p-1.5 rounded text-sm w-full" />
          </div>
        </div>
        <button type="button" onClick={handleAutoGenerate} className="w-full bg-teal-500 hover:bg-teal-600 text-white font-bold py-1.5 px-3 rounded-lg text-sm transition-colors">
          🎲 Tạo ngẫu nhiên
        </button>
      </div>

      {/* Order form */}
      <form onSubmit={handleAddOrder} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <h2 className="text-lg font-bold mb-4">{editingOrderIdx !== null ? '✎ Chỉnh sửa đơn hàng' : '📦 Thêm đơn hàng mới'}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Tên người nhận</label>
            <input type="text" value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))} className="w-full border border-gray-300 rounded-lg p-2" placeholder="VD: Nguyễn Văn A" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Địa chỉ giao hàng</label>
            <input type="text" value={formData.address} onChange={e => setFormData(f => ({ ...f, address: e.target.value }))} className="w-full border border-gray-300 rounded-lg p-2" placeholder="VD: Số 1 Đại Cồ Việt" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Toạ độ giao hàng</label>
            <div className="flex gap-2 items-center">
              <input type="number" step="0.000001" placeholder="Vĩ độ (lat)" value={formData.lat ?? ''} onChange={e => setFormData(f => ({ ...f, lat: e.target.value ? Number(e.target.value) : null }))} className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              <input type="number" step="0.000001" placeholder="Kinh độ (lon)" value={formData.lon ?? ''} onChange={e => setFormData(f => ({ ...f, lon: e.target.value ? Number(e.target.value) : null }))} className="w-full border border-gray-300 rounded-lg p-2 text-sm" />
              <button type="button" onClick={randomLocation} className="shrink-0 bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold px-3 py-2 rounded-lg whitespace-nowrap">🎲 Ngẫu nhiên</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Cân nặng (kg)</label>
              <input type="number" step="0.1" value={formData.weight} onChange={e => setFormData(f => ({ ...f, weight: Number(e.target.value) }))} className="w-full border border-gray-300 rounded-lg p-2" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Thể tích (m³)</label>
              <input type="number" step="0.1" value={formData.volume} onChange={e => setFormData(f => ({ ...f, volume: Number(e.target.value) }))} className="w-full border border-gray-300 rounded-lg p-2" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Giao từ giờ</label>
              <input type="time" value={formData.startTime} onChange={e => setFormData(f => ({ ...f, startTime: e.target.value }))} className="w-full border border-gray-300 rounded-lg p-2" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Đến trước giờ</label>
              <input type="time" value={formData.endTime} onChange={e => setFormData(f => ({ ...f, endTime: e.target.value }))} className="w-full border border-gray-300 rounded-lg p-2" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Thời gian phục vụ (phút)</label>
            <input type="number" min="1" value={formData.serviceDuration} onChange={e => setFormData(f => ({ ...f, serviceDuration: Number(e.target.value) }))} className="w-full border border-gray-300 rounded-lg p-2" />
            <p className="text-xs text-gray-400 mt-1">Thời gian cần để giao hàng tại điểm này</p>
          </div>
          <div className="flex gap-2 mt-2">
            <button type="submit" className={`flex-1 text-white font-bold py-2 px-4 rounded-lg transition-colors ${editingOrderIdx !== null ? 'bg-blue-500 hover:bg-blue-600' : 'bg-orange-500 hover:bg-orange-600'}`}>
              {editingOrderIdx !== null ? '✔ Cập nhật đơn hàng' : '+ Đưa vào danh sách chờ'}
            </button>
            {hasRoutes && editingOrderIdx === null && (
              <button type="button" onClick={handleInsertClick} className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition-colors" title="Chèn thẳng vào tuyến tốt nhất (thuật toán tăng tối thiểu tổng bình phương)">
                ⚡ Chèn vào tuyến
              </button>
            )}
            {editingOrderIdx !== null && (
              <button type="button" onClick={() => { setEditingOrderIdx(null); setFormData({ ...EMPTY_FORM }); }} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-bold">
                Hủy
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Order list + run */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">📋 Đơn hàng chờ xử lý</h2>
          <span className="bg-blue-100 text-blue-800 font-bold px-3 py-1 rounded-full text-sm">{orders.length}</span>
        </div>
        <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
          {orders.length === 0 ? (
            <p className="text-gray-400 text-center italic py-4">Chưa có đơn hàng nào</p>
          ) : (
            orders.map((o: any, idx: number) => {
              const info = customerDB[o.customer_id];
              return (
                <div key={idx} className={`flex justify-between items-center p-3 rounded border text-sm ${editingOrderIdx === idx ? 'bg-blue-50 border-blue-300' : 'bg-gray-50'}`}>
                  <div>
                    <p className="font-bold">{info?.name}</p>
                    <p className="text-gray-500">{info?.time} | {o.weight}kg | {o.volume}m³</p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => handleEditOrder(idx)} className="text-blue-500 hover:text-blue-700 font-bold p-2">✎</button>
                    <button onClick={() => handleRemoveOrder(idx)} className="text-red-500 hover:text-red-700 font-bold p-2">✕</button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <label className="flex items-center gap-3 mt-6 cursor-pointer select-none">
          <div onClick={() => onHardTWChange(!hardTW)} className={`relative w-10 h-6 rounded-full transition-colors ${hardTW ? 'bg-red-500' : 'bg-gray-300'}`}>
            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${hardTW ? 'translate-x-5' : 'translate-x-1'}`} />
          </div>
          <span className="text-sm font-medium text-gray-700">
            Ràng buộc cửa sổ thời gian cứng
            <span className={`ml-2 text-xs font-bold ${hardTW ? 'text-red-500' : 'text-gray-400'}`}>{hardTW ? 'BẬT' : 'TẮT'}</span>
          </span>
        </label>

        <button onClick={onRunAlgorithm} disabled={loading || orders.length === 0} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg mt-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? '⏳ Đang xử lý...' : '🚀 BẮT ĐẦU CHIA TUYẾN'}
        </button>

        {loading && progressInfo && (
          <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
            <div className="flex justify-between items-center text-xs font-bold text-gray-600">
              <span>
                {progressInfo.stage === 'init' && '🔄 Khởi tạo...'}
                {progressInfo.stage === 'matrix' && '📡 Tải ma trận khoảng cách'}
                {progressInfo.stage === 'solving' && '🧠 Đang chạy thuật toán GA'}
              </span>
              <span className="text-blue-600">{progressInfo.total > 1 ? `${progressInfo.done}/${progressInfo.total} batch` : ''}</span>
            </div>
            <div className="relative w-full h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${progressInfo.total > 0 ? Math.max(3, (progressInfo.done / progressInfo.total) * 100) : 5}%`,
                  background: progressInfo.stage === 'solving' ? 'linear-gradient(90deg,#6366f1,#8b5cf6)' : 'linear-gradient(90deg,#3b82f6,#06b6d4)',
                }}
              />
              <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.3) 50%,transparent 100%)', animation: 'shimmer 1.5s infinite' }} />
            </div>
            <p className="text-[11px] text-gray-500 text-center">{progressInfo.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}
