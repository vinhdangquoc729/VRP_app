import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import customersRaw from '../../../database/customers/customers.json';
import ordersRaw from '../../../database/orders/orders.json';

type CustomerRow = {
  id: number; name: string; phone: string; email: string;
  address: string; district: string; lat: number; lon: number;
  total_orders: number; member_since: string;
};

type OrderRow = { customer_id: number; status: string };

const customerList = (customersRaw as { customers: CustomerRow[] }).customers;
const orderList    = (ordersRaw   as { orders:    OrderRow[]    }).orders;

const ALL_DISTRICTS = [...new Set(customerList.map(c => c.district))].sort();

const pendingCountMap = new Map<number, number>();
for (const o of orderList) {
  if (o.status === 'pending') pendingCountMap.set(o.customer_id, (pendingCountMap.get(o.customer_id) ?? 0) + 1);
}

export default function CustomersView() {
  const [search, setSearch]         = useState('');
  const [filterDistrict, setFilterDistrict] = useState('');

  const counts = useMemo(() => ({
    total:   customerList.length,
    pending: [...pendingCountMap.values()].reduce((a, b) => a + b, 0),
  }), []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return customerList.filter(c => {
      if (filterDistrict && c.district !== filterDistrict) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.district.toLowerCase().includes(q) ||
        String(c.id).includes(q)
      );
    });
  }, [search, filterDistrict]);

  return (
    <div className="p-5 space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <p className="text-2xl font-bold text-indigo-700">{counts.total}</p>
          <p className="text-xs font-medium text-indigo-600 mt-0.5">Tổng khách hàng</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-2xl font-bold text-slate-700">{ALL_DISTRICTS.length}</p>
          <p className="text-xs font-medium text-slate-500 mt-0.5">Phường / xã</p>
        </div>
        <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
          <p className="text-2xl font-bold text-orange-700">{counts.pending}</p>
          <p className="text-xs font-medium text-orange-600 mt-0.5">Đơn đang chờ giao</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm tên, số điện thoại, email, địa chỉ..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <select
          value={filterDistrict}
          onChange={e => setFilterDistrict(e.target.value)}
          className="text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">Tất cả phường/xã</option>
          {ALL_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <p className="text-sm text-slate-400">
        Hiển thị <span className="font-semibold text-slate-600">{filtered.length}</span> / {customerList.length} khách hàng
      </p>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Mã KH', 'Họ tên', 'Liên hệ', 'Địa chỉ', 'Tọa độ', 'Đơn hàng', 'Ngày tham gia'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(c => {
                const pending = pendingCountMap.get(c.id) ?? 0;
                return (
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">#{c.id}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                      <p className="text-sm text-slate-400 mt-0.5">{c.district}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-slate-700">{c.phone}</p>
                      <p className="text-sm text-slate-400 mt-0.5">{c.email}</p>
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="text-sm text-slate-600 truncate">{c.address}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400 whitespace-nowrap font-mono">
                      {c.lat.toFixed(4)}, {c.lon.toFixed(4)}
                    </td>
                    <td className="px-4 py-3">
                      {/* <p className="text-sm font-semibold text-slate-800">{c.total_orders} tổng</p> */}
                      {pending > 0 && (
                        <span className="text-sm font-medium text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-lg mt-0.5 inline-block">
                          {pending} chờ giao
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400 whitespace-nowrap">
                      {c.member_since}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-12 italic">Không tìm thấy khách hàng nào</p>
        )}
      </div>
    </div>
  );
}
