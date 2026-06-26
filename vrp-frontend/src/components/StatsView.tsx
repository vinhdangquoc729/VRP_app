import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Package, CheckCircle, Truck, Clock, Users } from 'lucide-react';
import driversDB from '../../../database/drivers/drivers.json';

interface Order {
  id: number;
  customer_id: number;
  product_name: string;
  category: string;
  weight: number;
  status: string;
  driver_id: number | null;
  created_at: string;
}

const STATUS_INFO: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending:    { label: 'Chờ xử lý',            color: 'text-slate-700',   bg: 'bg-slate-50',   border: 'border-slate-200'  },
  assigned:   { label: 'Đã phân công',          color: 'text-violet-700',  bg: 'bg-violet-50',  border: 'border-violet-200' },
  in_transit: { label: 'Đang giao',             color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200' },
  delivered:  { label: 'Đã giao',               color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200'},
  failed:     { label: 'Giao không thành công', color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200'    },
  cancelled:  { label: 'Đã huỷ',               color: 'text-zinc-500',    bg: 'bg-zinc-50',    border: 'border-zinc-200'   },
};

const CAT_COLORS = [
  'bg-indigo-500', 'bg-violet-500', 'bg-cyan-500', 'bg-emerald-500',
  'bg-orange-500', 'bg-pink-500', 'bg-teal-500', 'bg-rose-500',
  'bg-blue-500', 'bg-amber-500', 'bg-purple-500', 'bg-lime-500',
];

const STACK_STATUSES = ['delivered', 'in_transit', 'assigned', 'pending', 'failed', 'cancelled'] as const;
const STACK_COLORS: Record<string, string> = {
  delivered:  'bg-emerald-500',
  in_transit: 'bg-orange-400',
  assigned:   'bg-violet-400',
  pending:    'bg-slate-300',
  failed:     'bg-red-500',
  cancelled:  'bg-zinc-300',
};
const STACK_LABELS: Record<string, string> = {
  delivered:  'Đã giao',
  in_transit: 'Đang giao',
  assigned:   'Đã phân công',
  pending:    'Chờ xử lý',
  failed:     'Giao thất bại',
  cancelled:  'Đã huỷ',
};

const driverList = (driversDB as { drivers: { id: number; name: string }[] }).drivers;
const driverNameMap: Record<number, string> = {};
for (const d of driverList) driverNameMap[d.id] = d.name;

function fmt(d: string) {
  return d.slice(5).replace('-', '/');
}

export default function StatsView() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo]     = useState(today);

  useEffect(() => {
    setLoading(true);
    fetch('http://127.0.0.1:8000/api/v1/admin/orders')
      .then(r => r.json())
      .then(d => { setOrders(d.orders ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() =>
    orders.filter(o => o.created_at >= dateFrom && o.created_at <= dateTo),
  [orders, dateFrom, dateTo]);

  const summary = useMemo(() => {
    const counts: Record<string, number> = { pending: 0, assigned: 0, in_transit: 0, delivered: 0, failed: 0, cancelled: 0 };
    for (const o of filtered) counts[o.status] = (counts[o.status] ?? 0) + 1;
    return counts;
  }, [filtered]);

  const categoryStats = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of filtered) map[o.category] = (map[o.category] ?? 0) + 1;
    const max = Math.max(1, ...Object.values(map));
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count], i) => ({ cat, count, pct: (count / max) * 100, colorCls: CAT_COLORS[i % CAT_COLORS.length] }));
  }, [filtered]);

  const dailyStats = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const o of filtered) {
      if (!map[o.created_at]) map[o.created_at] = {};
      map[o.created_at][o.status] = (map[o.created_at][o.status] ?? 0) + 1;
    }
    const days = Object.keys(map).sort();
    const totals = days.map(d => Object.values(map[d]).reduce((a, b) => a + b, 0));
    const maxTotal = Math.max(1, ...totals);
    return days.map((d, i) => ({
      date: d,
      total: totals[i],
      byStatus: map[d],
      heightPct: (totals[i] / maxTotal) * 100,
    }));
  }, [filtered]);

  const topDrivers = useMemo(() => {
    const map: Record<number, number> = {};
    for (const o of filtered) {
      if (o.driver_id != null && o.status === 'delivered')
        map[o.driver_id] = (map[o.driver_id] ?? 0) + 1;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id: Number(id), name: driverNameMap[Number(id)] ?? `Tài xế #${id}`, count }));
  }, [filtered]);

  return (
    <div className="p-5 space-y-5">

      {/* Header + date range */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-indigo-600" />
          <h1 className="text-lg font-bold text-slate-800">Thống kê đơn hàng</h1>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-500">Từ</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          <span className="text-sm text-slate-500">đến</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          <button
            onClick={() => { setDateFrom(today); setDateTo(today); }}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">
            Hôm nay
          </button>
          <button
            onClick={() => { setDateFrom(thirtyDaysAgo); setDateTo(today); }}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">
            30 ngày
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-20 text-slate-400 text-sm">Đang tải dữ liệu...</div>
      )}

      {!loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
              <p className="text-2xl font-bold text-indigo-700">{filtered.length}</p>
              <p className="text-xs font-medium text-indigo-600 mt-0.5 flex items-center gap-1"><Package size={11} />Tổng đơn</p>
            </div>
            {(['delivered', 'in_transit', 'assigned', 'pending', 'failed', 'cancelled'] as const).map(st => {
              const info = STATUS_INFO[st];
              return (
                <div key={st} className={`rounded-xl border ${info.border} ${info.bg} p-4`}>
                  <p className={`text-2xl font-bold ${info.color}`}>{summary[st] ?? 0}</p>
                  <p className={`text-xs font-medium mt-0.5 ${info.color}`}>{info.label}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Category breakdown */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Package size={14} className="text-indigo-500" /> Theo danh mục
              </h2>
              {categoryStats.length === 0
                ? <p className="text-sm text-slate-400 italic text-center py-6">Không có dữ liệu</p>
                : (
                  <div className="space-y-2.5">
                    {categoryStats.map(({ cat, count, pct, colorCls }) => (
                      <div key={cat} className="flex items-center gap-3">
                        <span className="w-24 text-xs text-right text-slate-600 shrink-0 truncate">{cat}</span>
                        <div className="flex-1 bg-slate-100 rounded-full h-2.5">
                          <div className={`h-2.5 ${colorCls} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-7 text-xs font-bold text-slate-700 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            {/* Top drivers */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Users size={14} className="text-indigo-500" /> Top tài xế (đã giao)
              </h2>
              {topDrivers.length === 0
                ? <p className="text-sm text-slate-400 italic text-center py-6">Chưa có dữ liệu giao hàng</p>
                : (
                  <div className="space-y-2">
                    {topDrivers.map(({ id, name, count }, i) => (
                      <div key={id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                          ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-white' : 'bg-orange-300 text-white'}`}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
                          <p className="text-xs text-slate-400">#{id}</p>
                        </div>
                        <div className="flex items-center gap-1 text-emerald-700 font-bold text-sm">
                          <CheckCircle size={13} className="text-emerald-500" />
                          {count}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>

          {/* Daily trend */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <TrendingUp size={14} className="text-indigo-500" /> Đơn hàng theo ngày
            </h2>
            {dailyStats.length === 0
              ? <p className="text-sm text-slate-400 italic text-center py-6">Không có dữ liệu trong khoảng ngày này</p>
              : (
                <>
                  <div className="overflow-x-auto">
                    <div className="flex items-end gap-1.5" style={{ height: 280 }}>
                      {dailyStats.map(({ date, total, byStatus, heightPct }) => (
                        <div key={date} className="flex flex-col items-center flex-1 min-w-[28px] h-full justify-end">
                          <span className="text-[10px] font-semibold text-slate-500 mb-0.5 leading-none">{total}</span>
                          <div
                            className="w-full flex flex-col-reverse overflow-hidden"
                            style={{ height: `${Math.max(3, heightPct)}%` }}
                          >
                            {STACK_STATUSES.map(st => {
                              const count = byStatus[st] ?? 0;
                              if (count === 0) return null;
                              return (
                                <div
                                  key={st}
                                  className={STACK_COLORS[st]}
                                  style={{ flex: count }}
                                  title={`${STACK_LABELS[st]}: ${count}`}
                                />
                              );
                            })}
                          </div>
                          <span className="text-[9px] text-slate-400 whitespace-nowrap mt-1">{fmt(date)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Legend */}
                  <div className="flex items-center gap-4 flex-wrap mt-3 pt-3 border-t border-slate-100">
                    {STACK_STATUSES.map(st => (
                      <div key={st} className="flex items-center gap-1.5">
                        <div className={`w-3 h-3 ${STACK_COLORS[st]}`} />
                        <span className="text-[11px] text-slate-500">{STACK_LABELS[st]}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
          </div>

          {/* Footer stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
              <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center shrink-0">
                <CheckCircle size={16} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-800">
                  {filtered.length > 0 ? Math.round((summary.delivered ?? 0) / filtered.length * 100) : 0}%
                </p>
                <p className="text-xs text-slate-500">Tỉ lệ giao thành công</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                <Truck size={16} className="text-blue-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-800">{topDrivers.length}</p>
                <p className="text-xs text-slate-500">Tài xế có giao hàng</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
              <div className="w-9 h-9 bg-indigo-100 rounded-lg flex items-center justify-center shrink-0">
                <Clock size={16} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-800">{dailyStats.length}</p>
                <p className="text-xs text-slate-500">Ngày có đơn hàng</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
