import { useEffect } from 'react';
import { MapPin, Mail, Phone, User, ShoppingBag, Clock } from 'lucide-react';

export interface FullCustomer {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  district: string;
  total_orders: number;
  member_since: string;
}

export interface CustomerOrder {
  id: number;
  product_name: string;
  category: string;
  weight: number;
  volume: number;
  status: string;
  time_window_start: string;
  time_window_end: string;
  notes: string;
}

export function CustomerDetailPopup({
  customer, orders, timeWindow, onClose,
}: {
  customer: FullCustomer;
  orders: CustomerOrder[];
  timeWindow?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onMouseDown={onClose}
      style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.25))' }}
    >
      <div
        className="bg-white rounded-xl border border-slate-200 shadow-xl w-80 overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-mono text-slate-400">#{customer.id}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
                {customer.district}
              </span>
            </div>
            <p className="text-base font-bold text-slate-800">{customer.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors shrink-0 mt-0.5">✕</button>
        </div>

        {/* Info */}
        <div className="px-5 py-3 space-y-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Phone size={13} className="text-slate-400 shrink-0" />
            <a href={`tel:${customer.phone}`} className="hover:text-indigo-600">{customer.phone}</a>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Mail size={13} className="text-slate-400 shrink-0" />
            <a href={`mailto:${customer.email}`} className="hover:text-indigo-600 truncate">{customer.email}</a>
          </div>
          <div className="flex items-start gap-2 text-sm text-slate-600">
            <MapPin size={13} className="text-slate-400 shrink-0 mt-0.5" />
            {customer.address}
          </div>
          {timeWindow && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Clock size={13} className="text-slate-400 shrink-0" />
              Khung giờ: <span className="font-medium text-slate-800">{timeWindow}</span>
            </div>
          )}
        </div>

        {/* Orders */}
        <div className="px-5 py-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <ShoppingBag size={12} />
            Đơn hàng ({orders.length})
          </p>
          {orders.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Không có đơn hàng</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {orders.map(o => (
                <div key={o.id} className="flex items-start gap-2 p-2 bg-slate-50 rounded-lg text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 truncate">{o.product_name}</p>
                    <p className="text-slate-400">{o.category} · {o.weight}kg · {o.volume}m³</p>
                  </div>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded-full font-medium text-[10px] ${
                    o.status === 'pending'   ? 'bg-amber-100 text-amber-700'    :
                    o.status === 'delivered' ? 'bg-emerald-100 text-emerald-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {o.status === 'pending' ? 'Chờ' : o.status === 'delivered' ? 'Đã giao' : 'Đang giao'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><User size={11} />Thành viên từ {customer.member_since}</span>
          <span>{customer.total_orders} đơn tổng cộng</span>
        </div>
      </div>
    </div>
  );
}
