import { useState } from 'react';

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
  { label: 'Loại xe',                  key: 'type',                    type: 'text',   placeholder: 'VD: Xe tải lớn' },
  { label: 'Tải trọng tối đa (kg)',    key: 'max_weight',              type: 'number' },
  { label: 'Thể tích tối đa (m³)',     key: 'max_volume',              type: 'number' },
  { label: 'Phí vận hành (đ/km)',      key: 'operating_cost',          type: 'number' },
  { label: 'Phí thời gian (đ/giây)',   key: 'time_based_cost',         type: 'number' },
  { label: 'Quãng đường tối đa (km)',  key: 'max_travel_distance_km',  type: 'number' },
] as const;

export default function VehiclePanel({ vehicles, onChange }: Props) {
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingIdx !== null) {
      const updated = [...vehicles];
      updated[editingIdx] = { ...updated[editingIdx], ...form };
      onChange(updated);
      setEditingIdx(null);
    } else {
      const newId = vehicles.length > 0 ? Math.max(...vehicles.map((v: any) => v.id)) + 1 : 1;
      onChange([...vehicles, { id: newId, ...form }]);
    }
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
  };

  const handleRemove = (idx: number) => {
    if (editingIdx === idx) setEditingIdx(null);
    const updated = [...vehicles];
    updated.splice(idx, 1);
    onChange(updated);
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">🚛 Đội xe khả dụng</h2>
        <span className="bg-purple-100 text-purple-800 font-bold px-3 py-1 rounded-full text-sm">
          {vehicles.length}
        </span>
      </div>

      <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
        {vehicles.map((v: any, idx: number) => (
          <div
            key={idx}
            className={`flex justify-between items-center p-2 rounded border text-xs ${editingIdx === idx ? 'bg-purple-50 border-purple-300' : 'bg-gray-50'}`}
          >
            <div>
              <p className="font-bold text-sm text-purple-700">Xe số {v.id}: {v.type}</p>
              <p className="text-gray-500">
                Tải: {v.max_weight}kg | V: {v.max_volume}m³ | Phí: {v.operating_cost}đ/km | {v.max_travel_distance_km}km | {v.operating_time_h}h
              </p>
            </div>
            <div className="flex gap-1">
              <button onClick={() => handleEdit(idx)} className="text-blue-500 hover:text-blue-700 font-bold px-2">✎</button>
              <button onClick={() => handleRemove(idx)} className="text-red-500 hover:text-red-700 font-bold px-2">✕</button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="border-t pt-4 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map(({ label, key, type, placeholder }: any) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
              <input
                type={type}
                value={(form as any)[key]}
                placeholder={placeholder}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    [key]: type === 'number' ? Number(e.target.value) : e.target.value,
                  }))
                }
                className="border p-1 rounded text-sm w-full"
              />
            </div>
          ))}
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-0.5">Thời gian hoạt động tối đa (giờ)</label>
            <input
              type="number"
              step="0.5"
              value={form.operating_time_h}
              onChange={e => setForm(f => ({ ...f, operating_time_h: Number(e.target.value) }))}
              className="border p-1 rounded text-sm w-full"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className={`flex-1 font-bold py-1 px-2 rounded text-sm transition-colors ${editingIdx !== null ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}
          >
            {editingIdx !== null ? '✔ Cập nhật xe' : '+ Thêm xe'}
          </button>
          {editingIdx !== null && (
            <button
              type="button"
              onClick={() => { setEditingIdx(null); setForm({ ...DEFAULT_FORM }); }}
              className="px-3 py-1 rounded text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 font-bold"
            >
              Hủy
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
