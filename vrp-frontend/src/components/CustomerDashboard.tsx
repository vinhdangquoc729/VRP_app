import { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, LogOut, MapPin, Phone, Mail, Clock, Box, ShoppingCart, ChevronRight, Check, X, Calendar } from 'lucide-react';
import routimeLogo from '../../assets/ROUTIME-logo.png';
import { toast } from 'sonner';

interface Customer {
  id: number; name: string; phone: string; email?: string;
  address: string; district: string; member_since?: string;
}

interface Order {
  id: number; product_name: string; category: string;
  weight: number; volume: number;
  time_window_start: string; time_window_end: string;
  service_duration: number; status: string;
  created_at: string; notes: string;
  arrival_time?: string | null;
}

interface Product {
  id: number; name: string; category: string;
  weight: number; volume: number; price: number; description: string;
}

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  pending:    { label: 'Chờ xử lý',            cls: 'bg-slate-100 text-slate-600'    },
  assigned:   { label: 'Đã phân công',          cls: 'bg-blue-100 text-blue-700'      },
  in_transit: { label: 'Đang giao',             cls: 'bg-orange-100 text-orange-700'  },
  delivered:  { label: 'Đã giao',               cls: 'bg-emerald-100 text-emerald-700'},
  failed:     { label: 'Giao không thành công', cls: 'bg-red-100 text-red-700'        },
  cancelled:  { label: 'Đã huỷ',               cls: 'bg-zinc-100 text-zinc-500'      },
};

const STATUS_STEPS  = ['pending', 'assigned', 'in_transit', 'delivered'];
const STATUS_LABELS = ['Chờ xử lý', 'Đã phân công', 'Đang giao', 'Đã giao'];

const TIME_WINDOWS = [
  { label: '07:00 – 10:00', start: '07:00', end: '10:00' },
  { label: '08:00 – 12:00', start: '08:00', end: '12:00' },
  { label: '09:00 – 13:00', start: '09:00', end: '13:00' },
  { label: '13:00 – 17:00', start: '13:00', end: '17:00' },
  { label: '14:00 – 18:00', start: '14:00', end: '18:00' },
  { label: '16:00 – 20:00', start: '16:00', end: '20:00' },
];


const CAT_COVER: Record<string, { bg: string; emoji: string }> = {
  'Điện tử':    { bg: 'from-cyan-50 to-cyan-200',       emoji: '📱' },
  'Gia dụng':   { bg: 'from-yellow-50 to-yellow-200',   emoji: '🏠' },
  'Thời trang': { bg: 'from-pink-50 to-pink-200',       emoji: '👗' },
  'Thể thao':   { bg: 'from-orange-50 to-orange-200',   emoji: '⚽' },
  'Mỹ phẩm':   { bg: 'from-rose-50 to-rose-200',       emoji: '💄' },
  'Sách':       { bg: 'from-teal-50 to-teal-200',       emoji: '📚' },
  'Y tế':       { bg: 'from-red-50 to-red-200',         emoji: '💊' },
  'Thực phẩm':  { bg: 'from-green-50 to-green-200',     emoji: '🥗' },
};

function fmt(n: number) {
  return n.toLocaleString('vi-VN') + '₫';
}

interface Props { customer: Customer; onLogout: () => void; }

export default function CustomerDashboard({ customer, onLogout }: Props) {
  const [tab, setTab] = useState<'orders' | 'shop'>('orders');

  // --- sim date ---
  const [simDate, setSimDate] = useState('');
  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/v1/config/sim-date')
      .then(r => r.json()).then(d => setSimDate(d.date ?? '')).catch(() => {});
  }, []);

  // --- orders tab ---
  const [orders, setOrders]   = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  const fetchOrders = useCallback((showSpinner = true) => {
    if (showSpinner) setLoadingOrders(true);
    fetch(`http://127.0.0.1:8000/api/v1/customers/${customer.id}/orders`)
      .then(r => r.json())
      .then(data => { setOrders(data.orders ?? []); if (showSpinner) setLoadingOrders(false); })
      .catch(() => { if (showSpinner) setLoadingOrders(false); });
  }, [customer.id]);

  useEffect(() => {
    fetchOrders(true);
    const id = setInterval(() => fetchOrders(false), 10_000);
    return () => clearInterval(id);
  }, [fetchOrders]);

  const counts = {
    total:      orders.length,
    pending:    orders.filter(o => o.status === 'pending').length,
    assigned:   orders.filter(o => o.status === 'assigned').length,
    in_transit: orders.filter(o => o.status === 'in_transit').length,
    delivered:  orders.filter(o => o.status === 'delivered').length,
    cancelled:  orders.filter(o => o.status === 'cancelled').length,
  };

  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const handleCancelOrder = async (orderId: number) => {
    if (!confirm('Huỷ đơn hàng này?')) return;
    setCancellingId(orderId);
    try {
      const res = await fetch(
        `http://127.0.0.1:8000/api/v1/customers/${customer.id}/orders/${orderId}/cancel`,
        { method: 'PATCH' }
      );
      if (res.ok) {
        toast.success('Đã huỷ đơn hàng.');
        fetchOrders(false);
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

  const todayOrders = useMemo(
    () => simDate ? orders.filter(o => o.created_at === simDate) : [],
    [orders, simDate],
  );

  // --- shop tab ---
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected]   = useState<Product[]>([]);
  const [timeWindow, setTimeWindow] = useState(TIME_WINDOWS[1]);
  const [notes, setNotes]           = useState('');
  const [placing, setPlacing]       = useState(false);

  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/v1/products')
      .then(r => r.json())
      .then(data => setProducts(data.products ?? []))
      .catch(() => {});
  }, []);

  const groupedProducts = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category)!.push(p);
    }
    return [...map.entries()].map(([category, items]) => ({ category, items }));
  }, [products]);

  const toggleProduct = (product: Product) => {
    setSelected(prev =>
      prev.some(p => p.id === product.id)
        ? prev.filter(p => p.id !== product.id)
        : [...prev, product]
    );
  };

  const handlePlaceOrder = async () => {
    if (selected.length === 0) return;
    setPlacing(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/v1/customers/${customer.id}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_ids: selected.map(p => p.id),
          time_window_start: timeWindow.start,
          time_window_end: timeWindow.end,
          notes,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Đã đặt ${data.created} đơn hàng thành công!`);
        setSelected([]);
        setNotes('');
        setTab('orders');
        fetchOrders(true);
      } else {
        toast.error('Không thể đặt hàng. Vui lòng thử lại.');
      }
    } catch {
      toast.error('Không thể kết nối đến server.');
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4 shadow-sm">
        <img src={routimeLogo} alt="Routime" className="h-9 w-auto object-contain shrink-0" />
        <div className="flex-1">
          <h1 className="text-base font-bold text-slate-900">Cửa hàng & Theo dõi đơn hàng</h1>
          <p className="text-xs text-slate-400">Xin chào, {customer.name}</p>
        </div>
        {simDate && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-xs font-medium text-indigo-700 shrink-0">
            <Calendar size={13} />
            {simDate}
          </div>
        )}
        <button onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors">
          <LogOut size={14} /> Đăng xuất
        </button>
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-6 flex gap-1">
        {([
          { id: 'orders' as const, label: 'Đơn hàng của tôi', icon: Package },
          { id: 'shop'   as const, label: 'Đặt hàng',         icon: ShoppingCart },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
              ${tab === t.id ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <t.icon size={15} /> {t.label}
            {t.id === 'orders' && counts.total > 0 && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${tab === t.id ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {counts.total}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── ORDERS TAB ── */}
      {tab === 'orders' && (
        <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 space-y-5">

          {/* Customer info */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                <span className="text-xl font-bold text-emerald-700">{customer.name.charAt(0)}</span>
              </div>
              <div className="flex-1 space-y-1">
                <p className="font-semibold text-slate-900">{customer.name}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><Phone size={11} />{customer.phone}</span>
                  {customer.email && <span className="flex items-center gap-1"><Mail size={11} />{customer.email}</span>}
                  <span className="flex items-center gap-1"><MapPin size={11} />{customer.address}</span>
                </div>
                {customer.member_since && <p className="text-xs text-slate-400">Thành viên từ {customer.member_since}</p>}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Tổng đơn',  value: counts.total,      cls: 'border-slate-200 bg-slate-50',     valCls: 'text-slate-700'   },
              { label: 'Đang giao', value: counts.in_transit,  cls: 'border-orange-100 bg-orange-50',   valCls: 'text-orange-700'  },
              { label: 'Đã giao',   value: counts.delivered,   cls: 'border-emerald-100 bg-emerald-50', valCls: 'text-emerald-700' },
              { label: 'Chờ xử lý',value: counts.pending + counts.assigned, cls: 'border-blue-100 bg-blue-50', valCls: 'text-blue-700' },
            ].map(s => (
              <div key={s.label} className={`rounded-xl border p-4 ${s.cls}`}>
                <p className={`text-2xl font-bold ${s.valCls}`}>{s.value}</p>
                <p className="text-xs font-medium text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Today's orders highlight */}
          {simDate && todayOrders.length > 0 && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-indigo-500" />
                <p className="text-sm font-semibold text-indigo-700">Đơn hàng hôm nay ({simDate})</p>
                <span className="ml-auto text-xs font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                  {todayOrders.length} đơn
                </span>
              </div>
              <div className="space-y-1.5">
                {todayOrders.map(o => {
                  const st = STATUS_INFO[o.status] ?? { label: o.status, cls: 'bg-slate-100 text-slate-600' };
                  return (
                    <div key={o.id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2 border border-indigo-100">
                      <span className="font-mono text-xs text-slate-400">#{o.id}</span>
                      <p className="flex-1 text-sm font-medium text-slate-700 truncate">{o.product_name}</p>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${st.cls}`}>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Order list */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 px-1">Lịch sử đơn hàng</h2>

            {loadingOrders && (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 text-sm">Đang tải...</div>
            )}
            {!loadingOrders && orders.length === 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
                <p className="text-slate-400 text-sm italic">Bạn chưa có đơn hàng nào</p>
                <button onClick={() => setTab('shop')}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700">
                  <ShoppingCart size={14} /> Đặt hàng ngay
                </button>
              </div>
            )}

            {!loadingOrders && orders.slice().reverse().map(order => {
              const st = STATUS_INFO[order.status] ?? { label: order.status, cls: 'bg-slate-100 text-slate-600' };
              const stepIdx = STATUS_STEPS.indexOf(order.status);
              return (
                <div key={order.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg">#{order.id}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${st.cls}`}>{st.label}</span>
                      </div>
                      <p className="font-semibold text-slate-800">{order.product_name}</p>
                      <p className="text-xs text-slate-400">{order.category}</p>
                    </div>
                    <p className="text-xs text-slate-400 shrink-0">{order.created_at}</p>
                  </div>

                  {/* Progress */}
                  {order.status === 'failed' ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700 font-medium">
                      <span>✕</span> Giao hàng không thành công
                    </div>
                  ) : (
                    <div className="flex items-center">
                      {STATUS_STEPS.map((step, i) => {
                        const done = i < stepIdx, current = i === stepIdx;
                        return (
                          <div key={step} className="flex items-center flex-1 last:flex-none">
                            <div className="flex flex-col items-center">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2
                                ${done ? 'bg-emerald-500 border-emerald-500 text-white' : current ? 'bg-white border-indigo-500 text-indigo-600' : 'bg-white border-slate-200 text-slate-300'}`}>
                                {done ? '✓' : i + 1}
                              </div>
                              <p className={`text-[10px] mt-1 text-center leading-tight w-14
                                ${done ? 'text-emerald-600' : current ? 'text-indigo-600 font-semibold' : 'text-slate-300'}`}>
                                {STATUS_LABELS[i]}
                              </p>
                            </div>
                            {i < STATUS_STEPS.length - 1 && (
                              <div className={`flex-1 h-0.5 mb-5 mx-1 rounded-full ${i < stepIdx ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {order.status === 'assigned' && order.arrival_time && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 font-medium">
                      <Clock size={13} className="shrink-0" />
                      Dự kiến giao lúc <span className="font-bold">{order.arrival_time}</span>
                    </div>
                  )}

                  {(order.status === 'pending' || order.status === 'failed') && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleCancelOrder(order.id)}
                        disabled={cancellingId === order.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-500 border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {cancellingId === order.id
                          ? <span className="w-3 h-3 border-2 border-zinc-300 border-t-zinc-500 rounded-full animate-spin" />
                          : <X size={12} />}
                        Huỷ đơn
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 border-t border-slate-100 pt-3">
                    <span className="flex items-center gap-1"><Box size={11} />{order.weight} kg · {order.volume} m³</span>
                    <span className="flex items-center gap-1"><Clock size={11} />Khung giờ: {order.time_window_start} – {order.time_window_end}</span>
                    {order.notes && <span className="text-slate-400 italic">"{order.notes}"</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SHOP TAB ── */}
      {tab === 'shop' && (
        <div className="flex-1 flex overflow-hidden">

          {/* Product catalog */}
          <div className={`flex flex-col ${selected.length > 0 ? 'w-[58%]' : 'flex-1'} overflow-hidden transition-all duration-300 border-r border-slate-200`}>

            {/* Top bar */}
            <div className="bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between shrink-0">
              <p className="text-sm font-semibold text-slate-700">
                Danh mục sản phẩm
                <span className="ml-2 text-xs font-normal text-slate-400">{groupedProducts.length} danh mục</span>
              </p>
              {selected.length > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {selected.length} đã chọn
                </span>
              )}
            </div>

            {/* Categories stacked vertically, products scroll horizontally */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-8 bg-slate-50">
              {groupedProducts.map(({ category, items }) => {
                const cover = CAT_COVER[category] ?? { bg: 'from-slate-100 to-slate-200', emoji: '📦' };
                return (
                  <section key={category}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-base">{cover.emoji}</span>
                      <h3 className="font-bold text-slate-800 text-sm">{category}</h3>
                      <span className="text-[11px] text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                        {items.length} sản phẩm
                      </span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
                      {items.map(product => {
                        const isSelected = selected.some(p => p.id === product.id);
                        return (
                          <button
                            key={product.id}
                            onClick={() => toggleProduct(product)}
                            className={`w-44 shrink-0 text-left rounded-2xl border overflow-hidden transition-all
                              ${isSelected
                                ? 'border-emerald-400 ring-2 ring-emerald-300 shadow-md shadow-emerald-100'
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'}`}
                          >
                            {/* Placeholder image */}
                            <div className={`h-28 bg-gradient-to-br ${cover.bg} flex items-center justify-center relative`}>
                              <span className="text-5xl opacity-80">{cover.emoji}</span>
                              {isSelected && (
                                <div className="absolute top-2 right-2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center shadow">
                                  <Check size={13} className="text-white" />
                                </div>
                              )}
                            </div>
                            {/* Card body */}
                            <div className="p-3 bg-white space-y-1.5">
                              <p className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">{product.name}</p>
                              <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{product.description}</p>
                              <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                                <span className="text-xs text-slate-400">{product.weight} kg</span>
                                <span className="text-sm font-bold text-emerald-700">{fmt(product.price)}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          {/* Order form — slides in when at least one product is selected */}
          {selected.length > 0 && (
            <div className="w-[42%] flex flex-col bg-white overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
                <ChevronRight size={16} className="text-slate-400" />
                <h2 className="font-semibold text-slate-800 text-sm">Xác nhận đơn hàng</h2>
                <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {selected.length} sản phẩm
                </span>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                {/* Selected products list */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-600">Sản phẩm đã chọn</p>
                  {selected.map(p => {
                    const c = CAT_COVER[p.category] ?? { bg: 'from-slate-100 to-slate-200', emoji: '📦' };
                    return (
                      <div key={p.id} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${c.bg} flex items-center justify-center shrink-0 text-lg`}>
                          {c.emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                          <p className="text-xs text-slate-400">{p.weight} kg · {fmt(p.price)}</p>
                        </div>
                        <button onClick={() => toggleProduct(p)}
                          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Delivery address (read-only) */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">Địa chỉ giao hàng</label>
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-700">
                    <MapPin size={14} className="text-slate-400 shrink-0" />
                    {customer.address}
                  </div>
                </div>

                {/* Time window */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">Khung giờ giao hàng mong muốn</label>
                  <div className="grid grid-cols-2 gap-2">
                    {TIME_WINDOWS.map(tw => (
                      <button key={tw.label} type="button" onClick={() => setTimeWindow(tw)}
                        className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors
                          ${timeWindow.label === tw.label ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                        {tw.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">Ghi chú (tuỳ chọn)</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                    placeholder="VD: Gọi trước 30 phút, để ở bảo vệ nếu vắng..."
                    className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none placeholder:text-slate-300"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 space-y-2">
                <button onClick={handlePlaceOrder} disabled={placing}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {placing
                    ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <ShoppingCart size={15} />}
                  {placing ? 'Đang đặt hàng...' : `Đặt ${selected.length} đơn hàng`}
                </button>
                <button onClick={() => setSelected([])}
                  className="w-full py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
                  Bỏ chọn tất cả
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
