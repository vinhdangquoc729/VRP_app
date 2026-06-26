import { useState, useMemo } from 'react';
import { Truck, Pencil, X, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { DriverDetailPopup, type FullDriver } from './DriverDetailPopup';
import driversDB from '../../../database/drivers/drivers.json';

interface Props {
  vehicles: any[];
  onChange: (vehicles: any[]) => void;
}

const DEFAULT_FORM = {
  type: 'Xe tải lớn', max_weight: 1500, max_volume: 10,
  operating_cost: 15000, time_based_cost: 600,
  max_travel_distance_km: 200, operating_time_h: 10,
};

const FIELDS = [
  { label: 'Loại xe',                  key: 'type',                   type: 'text',   placeholder: 'VD: Xe tải lớn' },
  { label: 'Tải trọng tối đa (kg)',    key: 'max_weight',             type: 'number' },
  { label: 'Thể tích tối đa (m³)',     key: 'max_volume',             type: 'number' },
  { label: 'Phí vận hành (đ/km)',      key: 'operating_cost',         type: 'number' },
  { label: 'Phí thời gian (đ/giây)',   key: 'time_based_cost',        type: 'number' },
  { label: 'Quãng đường tối đa (km)',  key: 'max_travel_distance_km', type: 'number' },
] as const;

const inputCls = 'w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow';

export default function VehiclePanel({ vehicles, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [popupDriverId, setPopupDriverId] = useState<number | null>(null);

  const driverMap = useMemo(() => {
    const m: Record<number, FullDriver> = {};
    for (const d of (driversDB as { drivers: FullDriver[] }).drivers) m[d.id] = d;
    return m;
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingIdx === null) return;
    const updated = [...vehicles];
    updated[editingIdx] = { ...updated[editingIdx], ...form };
    onChange(updated);
    setEditingIdx(null);
    setForm({ ...DEFAULT_FORM });
  };

  const handleEdit = (idx: number) => {
    const v = vehicles[idx];
    setForm({
      type: v.type,
      max_weight: v.max_weight,
      max_volume: v.max_volume,
      operating_cost: v.operating_cost,
      time_based_cost: v.time_based_cost,
      max_travel_distance_km: v.max_travel_distance_km ?? 200,
      operating_time_h: v.operating_time_h ?? 10,
    });
    setEditingIdx(idx);
    if (!open) setOpen(true);
  };

  const handleRemove = (idx: number) => {
    if (editingIdx === idx) { setEditingIdx(null); setForm({ ...DEFAULT_FORM }); }
    const updated = [...vehicles];
    updated.splice(idx, 1);
    onChange(updated);
  };

  const popupDriver = popupDriverId != null ? driverMap[popupDriverId] : null;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      {popupDriver && (
        <DriverDetailPopup driver={popupDriver} onClose={() => setPopupDriverId(null)} />
      )}
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center">
            <Truck size={14} className="text-indigo-600" />
          </div>
          <h2 className="font-semibold text-slate-800 text-base">Đội xe khả dụng</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-indigo-600 text-white text-sm font-bold px-2.5 py-0.5 rounded-lg">
            {vehicles.length} xe
          </span>
          {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
        </div>
      </button>

      {/* Vehicle list */}
      {open && (
        <div className="max-h-44 overflow-y-auto divide-y divide-slate-100">
          {vehicles.length === 0 ? (
            <p className="text-slate-400 text-base text-center py-6 italic">Chưa có xe nào</p>
          ) : (
            vehicles.map((v: any, idx: number) => (
              <div
                key={idx}
                className={`flex items-center justify-between px-5 py-2 ${editingIdx === idx ? 'bg-indigo-50' : 'hover:bg-slate-50'} transition-colors`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-semibold text-slate-800 truncate">Xe {v.id} · {v.type}</p>
                    {v.driver_name && (
                      <button
                        onClick={() => setPopupDriverId(v.driver_id)}
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors whitespace-nowrap"
                      >
                        Xem tài xế
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {v.max_weight}kg · {v.max_volume}m³ · {v.max_travel_distance_km}km · {v.operating_time_h}h
                  </p>
                  {v.driver_name && (
                    <p className="text-xs text-indigo-500 font-medium truncate mt-0.5">
                      {v.plate} · {v.driver_name} · {v.driver_phone}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  <button onClick={() => handleEdit(idx)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => handleRemove(idx)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors">
                    <X size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Edit form — only shown when a vehicle is being edited */}
      {open && editingIdx !== null && (
        <form onSubmit={handleSubmit} className="px-5 py-4 border-t border-slate-100 space-y-3 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Chỉnh sửa xe</p>
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map(({ label, key, type, placeholder }: any) => (
              <div key={key} className={key === 'type' ? 'col-span-2' : ''}>
                <label className="block text-xs text-slate-500 mb-1">{label}</label>
                <input
                  type={type}
                  value={(form as any)[key]}
                  placeholder={placeholder}
                  onChange={e => setForm(f => ({ ...f, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
                  className={inputCls}
                />
              </div>
            ))}
            <div className="col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Thời gian hoạt động (giờ)</label>
              <input
                type="number" step="0.5" value={form.operating_time_h}
                onChange={e => setForm(f => ({ ...f, operating_time_h: Number(e.target.value) }))}
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors">
              <Check size={14} /> Cập nhật
            </button>
            <button type="button" onClick={() => { setEditingIdx(null); setForm({ ...DEFAULT_FORM }); }}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors">
              Hủy
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
