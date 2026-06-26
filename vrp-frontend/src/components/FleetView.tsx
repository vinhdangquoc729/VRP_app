import { useState, useMemo } from 'react';
import { Search, Plus, Shuffle, Check } from 'lucide-react';
import { toast } from 'sonner';
import vehiclesRaw from '../../../database/vehicles/vehicles.json';
import driversRaw from '../../../database/drivers/drivers.json';

type VehicleRow = {
  id: number; driver_id: number; plate: string; type: string;
  brand: string; model: string; year: number; color: string; fuel_type: string;
  max_weight: number; max_volume: number;
  max_travel_distance_km: number; operating_time_h: number;
  status: string; mileage_km: number; last_maintenance: string;
};

type DriverRow = {
  id: number; name: string; phone: string; district: string; rating: number;
};

const vehicleList = (vehiclesRaw as { vehicles: VehicleRow[] }).vehicles;
const driverMap = new Map<number, DriverRow>(
  (driversRaw as { drivers: DriverRow[] }).drivers.map(d => [d.id, d])
);

const TYPE_BADGE: Record<string, string> = {
  'Xe máy':     'bg-green-100 text-green-700 border-green-200',
  'Xe tải Van': 'bg-blue-100 text-blue-700 border-blue-200',
  'Xe tải nhỏ': 'bg-orange-100 text-orange-700 border-orange-200',
  'Xe tải lớn': 'bg-purple-100 text-purple-700 border-purple-200',
};

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  available:   { label: 'Sẵn sàng',     cls: 'bg-emerald-100 text-emerald-700' },
  assigned:    { label: 'Đã phân công', cls: 'bg-violet-100 text-violet-700'   },
  on_route:    { label: 'Đang giao',    cls: 'bg-blue-100 text-blue-700'       },
  maintenance: { label: 'Bảo dưỡng',   cls: 'bg-amber-100 text-amber-700'     },
};

const VEHICLE_PRESETS = [
  { type: 'Xe máy',      max_weight: 30,   max_volume: 0.5, operating_cost: 200,  time_based_cost: 50,  max_travel_distance_km: 80,  operating_time_h: 8  },
  { type: 'Xe tải Van',  max_weight: 800,  max_volume: 5,   operating_cost: 1200, time_based_cost: 250, max_travel_distance_km: 200, operating_time_h: 10 },
  { type: 'Xe tải nhỏ', max_weight: 500,  max_volume: 3,   operating_cost: 800,  time_based_cost: 150, max_travel_distance_km: 150, operating_time_h: 9  },
  { type: 'Xe tải lớn', max_weight: 2000, max_volume: 15,  operating_cost: 1800, time_based_cost: 400, max_travel_distance_km: 300, operating_time_h: 12 },
];

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

interface Props {
  dispatchVehicles: any[];
  onDispatchVehiclesChange: (v: any[]) => void;
}

export default function FleetView({ dispatchVehicles, onDispatchVehiclesChange }: Props) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Add vehicle form
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [openAddForm, setOpenAddForm] = useState(false);
  const [openRandom, setOpenRandom] = useState(false);
  const [randomCount, setRandomCount] = useState(2);

  const counts = useMemo(() => ({
    total: vehicleList.length,
    available: vehicleList.filter(v => v.status === 'available').length,
    assigned: vehicleList.filter(v => v.status === 'assigned').length,
    on_route: vehicleList.filter(v => v.status === 'on_route').length,
    maintenance: vehicleList.filter(v => v.status === 'maintenance').length,
  }), []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return vehicleList.filter(v => {
      if (filterType && v.type !== filterType) return false;
      if (filterStatus && v.status !== filterStatus) return false;
      if (!q) return true;
      const d = driverMap.get(v.driver_id);
      return (
        v.plate.toLowerCase().includes(q) ||
        v.brand.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        (d?.name.toLowerCase().includes(q) ?? false) ||
        (d?.district.toLowerCase().includes(q) ?? false)
      );
    });
  }, [search, filterType, filterStatus]);

  const handleAddVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    const newId = dispatchVehicles.length > 0 ? Math.max(...dispatchVehicles.map(v => v.id)) + 1 : 9001;
    onDispatchVehiclesChange([...dispatchVehicles, { id: newId, ...form }]);
    setForm({ ...DEFAULT_FORM });
    toast.success('Đã thêm xe vào hàng đợi điều phối');
  };

  const handleRandomGen = () => {
    if (randomCount <= 0) return;
    // Start IDs at 9001+ to avoid colliding with real vehicle IDs in vehicles.json
    const base = dispatchVehicles.length > 0 ? Math.max(...dispatchVehicles.map(v => v.id)) : 9000;
    const newVehicles = Array.from({ length: randomCount }, (_, i) => ({
      id: base + i + 1,
      ...VEHICLE_PRESETS[Math.floor(Math.random() * VEHICLE_PRESETS.length)],
    }));
    onDispatchVehiclesChange([...dispatchVehicles, ...newVehicles]);
    toast.success(`Đã tạo ${randomCount} xe ngẫu nhiên vào hàng đợi`);
  };

  return (
    <div className="p-5 space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="text-2xl font-bold text-indigo-700">{counts.total}</p>
          <p className="text-xs font-medium text-indigo-600 mt-0.5">Tổng đội xe</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-2xl font-bold text-emerald-700">{counts.available}</p>
          <p className="text-xs font-medium text-emerald-600 mt-0.5">Sẵn sàng</p>
        </div>
        <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
          <p className="text-2xl font-bold text-violet-700">{counts.assigned}</p>
          <p className="text-xs font-medium text-violet-600 mt-0.5">Đã phân công</p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-2xl font-bold text-blue-700">{counts.on_route}</p>
          <p className="text-xs font-medium text-blue-600 mt-0.5">Đang giao hàng</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-2xl font-bold text-amber-700">{counts.maintenance}</p>
          <p className="text-xs font-medium text-amber-600 mt-0.5">Đang bảo dưỡng</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm biển số, thương hiệu, tên tài xế, quận..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Tất cả loại xe</option>
          <option>Xe máy</option>
          <option>Xe tải Van</option>
          <option>Xe tải nhỏ</option>
          <option>Xe tải lớn</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Tất cả trạng thái</option>
          <option value="available">Sẵn sàng</option>
          <option value="assigned">Đã phân công</option>
          <option value="on_route">Đang giao</option>
          <option value="maintenance">Bảo dưỡng</option>
        </select>
      </div>

      <p className="text-xs text-slate-400">
        Hiển thị <span className="font-semibold text-slate-600">{filtered.length}</span> / {vehicleList.length} xe
      </p>

      {/* Add vehicle + random — 2-col grid */}
      <div className="grid grid-cols-2 gap-4">

        {/* Thêm xe mới */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button type="button" onClick={() => setOpenAddForm(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-indigo-100 rounded-lg flex items-center justify-center">
                <Plus size={13} className="text-indigo-600" />
              </div>
              <span className="font-semibold text-slate-800 text-sm">Thêm xe mới</span>
            </div>
            <span className="text-xs text-slate-400">{openAddForm ? '▲' : '▼'}</span>
          </button>
          {openAddForm && (
            <form onSubmit={handleAddVehicle} className="px-4 pb-4 pt-1 space-y-2.5 border-t border-slate-100 bg-slate-50">
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
                  <input type="number" step="0.5" value={form.operating_time_h}
                    onChange={e => setForm(f => ({ ...f, operating_time_h: Number(e.target.value) }))}
                    className={inputCls} />
                </div>
              </div>
              <button type="submit"
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors">
                <Check size={13} /> Thêm vào hàng đợi
              </button>
            </form>
          )}
        </div>

        {/* Tạo xe ngẫu nhiên */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button type="button" onClick={() => setOpenRandom(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-teal-100 rounded-lg flex items-center justify-center">
                <Shuffle size={13} className="text-teal-600" />
              </div>
              <span className="font-semibold text-slate-800 text-sm">Tạo xe ngẫu nhiên</span>
            </div>
            <span className="text-xs text-slate-400">{openRandom ? '▲' : '▼'}</span>
          </button>
          {openRandom && (
            <div className="px-4 pb-4 pt-3 space-y-3 border-t border-slate-100 bg-slate-50">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Số lượng xe</label>
                <input type="number" min="1" max="20" value={randomCount}
                  onChange={e => setRandomCount(Number(e.target.value))}
                  className={inputCls} />
              </div>
              <button type="button" onClick={handleRandomGen}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium rounded-lg transition-colors">
                <Shuffle size={13} />
                Tạo {randomCount} xe
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Xe', 'Biển số', 'Tài xế', 'Tải trọng', 'Phạm vi', 'Số km', 'Bảo dưỡng', 'Trạng thái'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(v => {
                const d = driverMap.get(v.driver_id);
                const typeCls = TYPE_BADGE[v.type] ?? 'bg-slate-100 text-slate-600 border-slate-200';
                const st = STATUS_INFO[v.status] ?? { label: v.status, cls: 'bg-slate-100 text-slate-600' };
                return (
                  <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg border ${typeCls}`}>{v.type}</span>
                        <span className="text-sm font-medium text-slate-700">{v.brand} {v.model}</span>
                        <span className="text-sm text-slate-400">{v.year} · {v.color}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-lg">{v.plate}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-slate-800">{d?.name ?? '–'}</p>
                      <p className="text-sm text-slate-400 mt-0.5">{d?.phone} · {d?.district}</p>
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      <span className="font-semibold text-slate-800">{v.max_weight.toLocaleString()}</span>
                      <span className="text-slate-400"> kg · </span>
                      <span className="text-slate-600">{v.max_volume} m³</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">
                      {v.max_travel_distance_km} km · {v.operating_time_h}h
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                      {v.mileage_km.toLocaleString()} km
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400 whitespace-nowrap">
                      {v.last_maintenance}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-semibold px-2 py-0.5 rounded-lg ${st.cls}`}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-12 italic">Không tìm thấy xe nào</p>
        )}
      </div>
    </div>
  );
}
