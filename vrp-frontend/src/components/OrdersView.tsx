import { useState, useMemo } from 'react';
import { Search, Plus, Shuffle, Check, RotateCcw, Calendar, X } from 'lucide-react';
import { toast } from 'sonner';
import { timeToSeconds } from '../utils';
import ordersRaw from '../../../database/orders/orders.json';
import customersRaw from '../../../database/customers/customers.json';
import driversRaw from '../../../database/drivers/drivers.json';

type OrderRow = {
  id: number; customer_id: number; product_name: string; category: string;
  weight: number; volume: number;
  time_window_start: string; time_window_end: string; service_duration: number;
  status: string; driver_id: number | null; created_at: string; notes: string;
};

type CustomerRow = { id: number; name: string; district: string; address: string };
type DriverRow   = { id: number; name: string; phone: string };

const orderList   = (ordersRaw   as { orders:    OrderRow[]    }).orders;
const customerMap = new Map<number, CustomerRow>(
  (customersRaw as { customers: CustomerRow[] }).customers.map(c => [c.id, c])
);
const driverMap = new Map<number, DriverRow>(
  (driversRaw as { drivers: DriverRow[] }).drivers.map(d => [d.id, d])
);

const ALL_CATEGORIES = [...new Set(orderList.map(o => o.category))].sort();

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  pending:    { label: 'Chờ xử lý',             cls: 'bg-slate-100 text-slate-600'    },
  assigned:   { label: 'Đã phân công',           cls: 'bg-blue-100 text-blue-700'      },
  in_transit: { label: 'Đang giao',              cls: 'bg-orange-100 text-orange-700'  },
  delivered:  { label: 'Đã giao',                cls: 'bg-emerald-100 text-emerald-700'},
  failed:     { label: 'Giao không thành công',  cls: 'bg-red-100 text-red-700'        },
  cancelled:  { label: 'Đã huỷ',                cls: 'bg-zinc-100 text-zinc-500'      },
};

const CAT_CLS: Record<string, string> = {
  'Điện tử':   'bg-cyan-100 text-cyan-700',
  'Gia dụng':  'bg-yellow-100 text-yellow-700',
  'Thời trang':'bg-pink-100 text-pink-700',
  'Điện máy':  'bg-sky-100 text-sky-700',
  'Thực phẩm': 'bg-green-100 text-green-700',
  'Nội thất':  'bg-amber-100 text-amber-700',
  'Y tế':      'bg-red-100 text-red-700',
  'Thể thao':  'bg-orange-100 text-orange-700',
  'Trang trí': 'bg-violet-100 text-violet-700',
  'Mỹ phẩm':  'bg-rose-100 text-rose-700',
  'Trẻ em':   'bg-indigo-100 text-indigo-700',
  'Âm nhạc':  'bg-purple-100 text-purple-700',
  'Đồ chơi':  'bg-fuchsia-100 text-fuchsia-700',
  'Xe cộ':    'bg-slate-100 text-slate-600',
  'Sách':     'bg-teal-100 text-teal-700',
};


const EMPTY_FORM = {
  name: '', address: '',
  lat: null as number | null,
  lon: null as number | null,
  weight: 10, volume: 1,
  startTime: '08:00', endTime: '12:00',
  serviceDuration: 5,
};

const inputCls = 'w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow';
const labelCls = 'block text-xs text-slate-500 mb-1';

interface Props {
  dispatchOrders: any[];
  dispatchCustomerDB: Record<number, any>;
  onDispatchOrdersChange: (orders: any[]) => void;
  onDispatchCustomerDBChange: (db: Record<number, any>) => void;
}

export default function OrdersView({
  dispatchOrders, dispatchCustomerDB,
  onDispatchOrdersChange, onDispatchCustomerDBChange,
}: Props) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const [resetting, setResetting] = useState(false);

  const handleResetPending = async () => {
    if (!confirm('Đặt lại tất cả đơn hàng về "Chờ xử lý"?\nXe và tài xế cũng sẽ trở về trạng thái sẵn sàng.')) return;
    setResetting(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/v1/orders/reset-pending', { method: 'POST' });
      if (res.ok) {
        toast.success('Đã reset tất cả về trạng thái chờ xử lý');
        setTimeout(() => window.location.reload(), 800);
      } else {
        toast.error('Lỗi khi reset dữ liệu');
        setResetting(false);
      }
    } catch {
      toast.error('Không thể kết nối đến server');
      setResetting(false);
    }
  };

  // Add order form
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [openAddForm, setOpenAddForm] = useState(false);
  const [openRandom, setOpenRandom] = useState(false);
  const [orderCount, setOrderCount] = useState(5);

  // Local status overrides — applied on top of static JSON so no page reload needed
  const [statusOverrides, setStatusOverrides] = useState<Record<number, string>>({});
  const statusOf = (o: OrderRow) => statusOverrides[o.id] ?? o.status;

  const counts = useMemo(() => ({
    total:      orderList.length,
    pending:    orderList.filter(o => statusOf(o) === 'pending').length,
    assigned:   orderList.filter(o => statusOf(o) === 'assigned').length,
    in_transit: orderList.filter(o => statusOf(o) === 'in_transit').length,
    delivered:  orderList.filter(o => statusOf(o) === 'delivered').length,
    failed:     orderList.filter(o => statusOf(o) === 'failed').length,
    cancelled:  orderList.filter(o => statusOf(o) === 'cancelled').length,
  }), [statusOverrides]);

  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const handleCancelOrder = async (orderId: number) => {
    if (!confirm('Huỷ đơn hàng #' + orderId + '?')) return;
    setCancellingId(orderId);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      if (res.ok) {
        toast.success('Đã huỷ đơn hàng #' + orderId);
        setStatusOverrides(prev => ({ ...prev, [orderId]: 'cancelled' }));
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.detail ?? 'Không thể huỷ đơn hàng.');
      }
    } catch {
      toast.error('Lỗi kết nối server.');
    } finally {
      setCancellingId(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orderList.filter(o => {
      const st = statusOf(o);
      if (filterStatus   && st            !== filterStatus)   return false;
      if (filterCategory && o.category    !== filterCategory) return false;
      if (filterDateFrom && o.created_at  <  filterDateFrom) return false;
      if (filterDateTo   && o.created_at  >  filterDateTo)   return false;
      if (!q) return true;
      const c = customerMap.get(o.customer_id);
      return (
        o.product_name.toLowerCase().includes(q) ||
        String(o.id).includes(q) ||
        (c?.name.toLowerCase().includes(q)     ?? false) ||
        (c?.district.toLowerCase().includes(q) ?? false)
      );
    });
  }, [search, filterStatus, filterCategory, filterDateFrom, filterDateTo]);

  const randomCoords = () => {
    const rand = (min: number, max: number) => +(Math.random() * (max - min) + min).toFixed(6);
    setFormData(f => ({ ...f, lat: rand(HANOI_BOUNDS.latMin, HANOI_BOUNDS.latMax), lon: rand(HANOI_BOUNDS.lonMin, HANOI_BOUNDS.lonMax) }));
  };

  const handleAddOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.address) { alert('Vui lòng nhập tên và địa chỉ!'); return; }
    if (formData.lat == null || formData.lon == null) { alert('Vui lòng nhập toạ độ!'); return; }
    const newCustomerId = Math.floor(Math.random() * 90000) + 10000;
    const newOrderId    = Math.floor(Math.random() * 900) + 100;
    onDispatchCustomerDBChange({
      ...dispatchCustomerDB,
      [newCustomerId]: { name: formData.name, address: formData.address, time: `${formData.startTime} - ${formData.endTime}`, lat: formData.lat, lon: formData.lon },
    });
    onDispatchOrdersChange([...dispatchOrders, {
      id: newOrderId, customer_id: newCustomerId,
      lat: formData.lat, lon: formData.lon,
      weight: Number(formData.weight), volume: Number(formData.volume),
      start_time: timeToSeconds(formData.startTime),
      end_time: timeToSeconds(formData.endTime),
      service_duration: Number(formData.serviceDuration) * 60,
    }]);
    setFormData({ ...EMPTY_FORM });
    toast.success('Đã thêm đơn hàng vào hàng đợi điều phối');
  };

  const [generatingRandom, setGeneratingRandom] = useState(false);

  const handleAutoGenerate = async () => {
    if (orderCount <= 0) return;
    setGeneratingRandom(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/orders/generate-random?count=${orderCount}`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Đã tạo ${data.created} đơn hàng ngẫu nhiên vào CSDL`);
        setTimeout(() => window.location.reload(), 800);
      } else {
        toast.error('Lỗi khi tạo đơn hàng');
        setGeneratingRandom(false);
      }
    } catch {
      toast.error('Không thể kết nối đến server');
      setGeneratingRandom(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-7 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-2xl font-bold text-slate-700">{counts.total}</p>
          <p className="text-xs font-medium text-slate-500 mt-0.5">Tổng đơn hàng</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-2xl font-bold text-slate-600">{counts.pending}</p>
          <p className="text-xs font-medium text-slate-500 mt-0.5">Chờ xử lý</p>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-2xl font-bold text-blue-700">{counts.assigned}</p>
          <p className="text-xs font-medium text-blue-600 mt-0.5">Đã phân công</p>
        </div>
        <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
          <p className="text-2xl font-bold text-orange-700">{counts.in_transit}</p>
          <p className="text-xs font-medium text-orange-600 mt-0.5">Đang giao</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-2xl font-bold text-emerald-700">{counts.delivered}</p>
          <p className="text-xs font-medium text-emerald-600 mt-0.5">Đã giao xong</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-4">
          <p className="text-2xl font-bold text-red-700">{counts.failed}</p>
          <p className="text-xs font-medium text-red-600 mt-0.5">Giao thất bại</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-2xl font-bold text-zinc-500">{counts.cancelled}</p>
          <p className="text-xs font-medium text-zinc-400 mt-0.5">Đã huỷ</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm mã đơn, sản phẩm, tên khách, quận..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Calendar size={14} className="text-slate-400" />
          <input
            type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <span className="text-sm text-slate-400">–</span>
          <input
            type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {(filterDateFrom || filterDateTo) && (
            <button
              type="button"
              onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }}
              className="text-xs text-slate-400 hover:text-slate-600 px-1.5 py-1 rounded-lg hover:bg-slate-100 transition-colors"
              title="Xóa bộ lọc ngày"
            >✕</button>
          )}
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Tất cả trạng thái</option>
          <option value="pending">Chờ xử lý</option>
          <option value="assigned">Đã phân công</option>
          <option value="in_transit">Đang giao</option>
          <option value="delivered">Đã giao</option>
          <option value="failed">Giao không thành công</option>
          <option value="cancelled">Đã huỷ</option>
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
          <option value="">Tất cả danh mục</option>
          {ALL_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
        </select>
        <button
          type="button"
          onClick={handleResetPending}
          disabled={resetting}
          title="Đặt lại tất cả về Chờ xử lý (demo)"
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-rose-600 border border-rose-200 bg-rose-50 hover:bg-rose-100 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <RotateCcw size={14} className={resetting ? 'animate-spin' : ''} />
          Reset demo
        </button>
      </div>

      <p className="text-xs text-slate-400">
        Hiển thị <span className="font-semibold text-slate-600">{filtered.length}</span> / {orderList.length} đơn hàng
      </p>

      {/* Add order + random — 2-col grid */}
      <div className="grid grid-cols-2 gap-4">

        {/* Thêm đơn hàng mới */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button type="button" onClick={() => setOpenAddForm(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-orange-100 rounded-lg flex items-center justify-center">
                <Plus size={13} className="text-orange-600" />
              </div>
              <span className="font-semibold text-slate-800 text-sm">Thêm đơn hàng mới</span>
            </div>
            <span className="text-xs text-slate-400">{openAddForm ? '▲' : '▼'}</span>
          </button>
          {openAddForm && (
            <form onSubmit={handleAddOrder} className="px-4 pb-4 pt-1 space-y-2.5 border-t border-slate-100 bg-slate-50">
              <div>
                <label className={labelCls}>Tên người nhận</label>
                <input type="text" value={formData.name} placeholder="VD: Nguyễn Văn A"
                  onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Địa chỉ giao hàng</label>
                <input type="text" value={formData.address} placeholder="VD: 15 Phố Huế, Hai Bà Trưng"
                  onChange={e => setFormData(f => ({ ...f, address: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Toạ độ</label>
                <div className="flex gap-1.5">
                  <input type="number" step="0.000001" placeholder="Vĩ độ"
                    value={formData.lat ?? ''}
                    onChange={e => setFormData(f => ({ ...f, lat: e.target.value ? Number(e.target.value) : null }))}
                    className={inputCls} />
                  <input type="number" step="0.000001" placeholder="Kinh độ"
                    value={formData.lon ?? ''}
                    onChange={e => setFormData(f => ({ ...f, lon: e.target.value ? Number(e.target.value) : null }))}
                    className={inputCls} />
                  <button type="button" onClick={randomCoords}
                    className="shrink-0 flex items-center justify-center w-9 h-[30px] bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-lg transition-colors"
                    title="Ngẫu nhiên">
                    <Shuffle size={12} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Cân nặng (kg)</label>
                  <input type="number" step="0.1" value={formData.weight}
                    onChange={e => setFormData(f => ({ ...f, weight: Number(e.target.value) }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Thể tích (m³)</label>
                  <input type="number" step="0.1" value={formData.volume}
                    onChange={e => setFormData(f => ({ ...f, volume: Number(e.target.value) }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Từ giờ</label>
                  <input type="time" value={formData.startTime}
                    onChange={e => setFormData(f => ({ ...f, startTime: e.target.value }))}
                    className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Đến giờ</label>
                  <input type="time" value={formData.endTime}
                    onChange={e => setFormData(f => ({ ...f, endTime: e.target.value }))}
                    className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Thời gian phục vụ (phút)</label>
                  <input type="number" min="1" value={formData.serviceDuration}
                    onChange={e => setFormData(f => ({ ...f, serviceDuration: Number(e.target.value) }))}
                    className={inputCls} />
                </div>
              </div>
              <button type="submit"
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white transition-colors">
                <Check size={13} /> Thêm vào hàng đợi
              </button>
            </form>
          )}
        </div>

        {/* Tạo đơn hàng ngẫu nhiên */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <button type="button" onClick={() => setOpenRandom(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-teal-100 rounded-lg flex items-center justify-center">
                <Shuffle size={13} className="text-teal-600" />
              </div>
              <span className="font-semibold text-slate-800 text-sm">Tạo đơn ngẫu nhiên</span>
            </div>
            <span className="text-xs text-slate-400">{openRandom ? '▲' : '▼'}</span>
          </button>
          {openRandom && (
            <div className="px-4 pb-4 pt-3 space-y-3 border-t border-slate-100 bg-slate-50">
              <div>
                <label className={labelCls}>Số đơn hàng</label>
                <input type="number" min="1" value={orderCount}
                  onChange={e => setOrderCount(Number(e.target.value))}
                  className={inputCls} />
              </div>
              <button type="button" onClick={handleAutoGenerate} disabled={generatingRandom}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-teal-500 hover:bg-teal-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {generatingRandom
                  ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Shuffle size={13} />}
                {generatingRandom ? 'Đang tạo...' : `Tạo ${orderCount} đơn`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1120px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Mã đơn', 'Ngày tạo', 'Sản phẩm', 'Khách hàng', 'Hàng hóa', 'Khung giờ giao', 'Tài xế', 'Trạng thái', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(o => {
                const cust = customerMap.get(o.customer_id);
                const drv  = o.driver_id != null ? driverMap.get(o.driver_id) : undefined;
                const curStatus = statusOf(o);
                const st   = STATUS_INFO[curStatus] ?? { label: curStatus, cls: 'bg-slate-100 text-slate-600' };
                const catCls = CAT_CLS[o.category] ?? 'bg-slate-100 text-slate-600';
                return (
                  <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">#{o.id}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                      {o.created_at ?? '–'}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-slate-800">{o.product_name}</p>
                      <span className={`text-sm font-medium px-1.5 py-0.5 rounded-lg mt-0.5 inline-block ${catCls}`}>{o.category}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-slate-800">{cust?.name ?? '–'}</p>
                      <p className="text-sm text-slate-400 mt-0.5">{cust?.district}</p>
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      <span className="font-semibold text-slate-800">{o.weight}</span>
                      <span className="text-slate-400"> kg · </span>
                      <span className="text-slate-600">{o.volume} m³</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                      {o.time_window_start} – {o.time_window_end}
                    </td>
                    <td className="px-4 py-3">
                      {drv
                        ? <p className="text-sm font-medium text-slate-700">{drv.name}</p>
                        : <span className="text-sm text-slate-400 italic">–</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-semibold px-2 py-0.5 rounded-lg ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-3 py-3">
                      {(curStatus === 'pending' || curStatus === 'failed') && (
                        <button
                          onClick={() => handleCancelOrder(o.id)}
                          disabled={cancellingId === o.id}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-zinc-500 border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {cancellingId === o.id
                            ? <span className="w-3 h-3 border border-zinc-300 border-t-zinc-500 rounded-full animate-spin" />
                            : <X size={11} />}
                          Huỷ
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-12 italic">Không tìm thấy đơn hàng nào</p>
        )}
      </div>
    </div>
  );
}
