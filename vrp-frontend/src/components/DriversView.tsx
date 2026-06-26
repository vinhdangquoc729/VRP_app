import { useState, useMemo } from 'react';
import { Search, Star, Navigation, ChevronDown, ChevronRight } from 'lucide-react';
import LiveTrackingMap from './LiveTrackingMap';
import driversRaw from '../../../database/drivers/drivers.json';

type DriverRow = {
  id: number; name: string; phone: string; email: string;
  license_type: string; vehicle_type: string; vehicle_plate: string;
  status: string; rating: number; total_deliveries: number;
  join_date: string; district: string;
};

const driverList = (driversRaw as { drivers: DriverRow[] }).drivers;

const ALL_DISTRICTS  = [...new Set(driverList.map(d => d.district))].sort();
const ALL_VEHICLE_TYPES = [...new Set(driverList.map(d => d.vehicle_type))].sort();

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  available: { label: 'Sẵn sàng',     cls: 'bg-emerald-100 text-emerald-700' },
  assigned:  { label: 'Đã phân công', cls: 'bg-violet-100 text-violet-700'   },
  on_route:  { label: 'Đang giao',    cls: 'bg-blue-100 text-blue-700'       },
  off_duty:  { label: 'Nghỉ',         cls: 'bg-slate-100 text-slate-500'     },
};

const TYPE_BADGE: Record<string, string> = {
  'Xe máy':     'bg-green-100 text-green-700',
  'Xe tải Van': 'bg-blue-100 text-blue-700',
  'Xe tải nhỏ': 'bg-orange-100 text-orange-700',
  'Xe tải lớn': 'bg-purple-100 text-purple-700',
};

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5">
      <Star size={11} className="fill-amber-400 text-amber-400" />
      <span className="text-xs font-semibold text-slate-700">{rating.toFixed(1)}</span>
    </span>
  );
}

export default function DriversView() {
  const [search, setSearch]           = useState('');
  const [filterStatus, setFilterStatus]     = useState('');
  const [filterVehicleType, setFilterVehicleType] = useState('');
  const [filterDistrict, setFilterDistrict]   = useState('');
  const [showMap, setShowMap]         = useState(true);

  const counts = useMemo(() => ({
    total:     driverList.length,
    available: driverList.filter(d => d.status === 'available').length,
    assigned:  driverList.filter(d => d.status === 'assigned').length,
    on_route:  driverList.filter(d => d.status === 'on_route').length,
    off_duty:  driverList.filter(d => d.status === 'off_duty').length,
  }), []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return driverList.filter(d => {
      if (filterStatus      && d.status       !== filterStatus)      return false;
      if (filterVehicleType && d.vehicle_type !== filterVehicleType) return false;
      if (filterDistrict    && d.district     !== filterDistrict)    return false;
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        d.phone.includes(q) ||
        d.email.toLowerCase().includes(q) ||
        d.vehicle_plate.toLowerCase().includes(q) ||
        d.district.toLowerCase().includes(q) ||
        String(d.id).includes(q)
      );
    });
  }, [search, filterStatus, filterVehicleType, filterDistrict]);

  return (
    <div className="p-5 space-y-4">
      {/* GPS map panel */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowMap(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Navigation size={14} className="text-indigo-500" />
            Theo dõi GPS trực tiếp
          </div>
          {showMap ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        </button>
        {showMap && (
          <div style={{ height: 320 }}>
            <LiveTrackingMap compact />
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="text-2xl font-bold text-indigo-700">{counts.total}</p>
          <p className="text-xs font-medium text-indigo-600 mt-0.5">Tổng tài xế</p>
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
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-2xl font-bold text-slate-600">{counts.off_duty}</p>
          <p className="text-xs font-medium text-slate-500 mt-0.5">Đang nghỉ</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm tên, SĐT, biển số, phường/xã..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="available">Sẵn sàng</option>
          <option value="assigned">Đã phân công</option>
          <option value="on_route">Đang giao</option>
          <option value="off_duty">Nghỉ</option>
        </select>
        <select
          value={filterVehicleType}
          onChange={e => setFilterVehicleType(e.target.value)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">Tất cả loại xe</option>
          {ALL_VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={filterDistrict}
          onChange={e => setFilterDistrict(e.target.value)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">Tất cả phường/xã</option>
          {ALL_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <p className="text-xs text-slate-400">
        Hiển thị <span className="font-semibold text-slate-600">{filtered.length}</span> / {driverList.length} tài xế
      </p>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Mã TX', 'Họ tên', 'Liên hệ', 'Bằng lái', 'Xe phụ trách', 'Đánh giá', 'Số chuyến', 'Khu vực', 'Trạng thái'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(d => {
                const st      = STATUS_INFO[d.status]      ?? { label: d.status,       cls: 'bg-slate-100 text-slate-600' };
                const typeCls = TYPE_BADGE[d.vehicle_type] ?? 'bg-slate-100 text-slate-600';
                return (
                  <tr key={d.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">#{d.id}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-slate-800">{d.name}</p>
                      <p className="text-sm text-slate-400 mt-0.5">Từ {d.join_date}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-slate-700">{d.phone}</p>
                      <p className="text-sm text-slate-400 mt-0.5">{d.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">{d.license_type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-semibold px-2 py-0.5 rounded-lg ${typeCls}`}>{d.vehicle_type}</span>
                      <p className="font-mono text-sm text-slate-400 mt-0.5">{d.vehicle_plate}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StarRating rating={d.rating} />
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-700 whitespace-nowrap">
                      {d.total_deliveries.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{d.district}</td>
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
          <p className="text-center text-slate-400 text-sm py-12 italic">Không tìm thấy tài xế nào</p>
        )}
      </div>
    </div>
  );
}
