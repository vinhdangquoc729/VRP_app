import { useState, useMemo } from 'react';
import { timeToSeconds } from '../utils';
import { Package, ClipboardList, Pencil, X, Check, Shuffle, ChevronDown, ChevronRight } from 'lucide-react';
import { CustomerDetailPopup, type FullCustomer, type CustomerOrder } from './CustomerDetailPopup';
import customersDB from '../../../database/customers/customers.json';
import ordersDB from '../../../database/orders/orders.json';

const EMPTY_FORM = {
  name: '', address: '',
  lat: null as number | null,
  lon: null as number | null,
  weight: 10, volume: 1,
  startTime: '08:00', endTime: '12:00',
  serviceDuration: 5,
};

export type OrderFormData = typeof EMPTY_FORM;

interface Props {
  orders: any[];
  customerDB: Record<number, any>;
  onOrdersChange: (orders: any[]) => void;
  onCustomerDBChange: (db: Record<number, any>) => void;
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow';
const labelCls = 'block text-xs font-medium text-slate-600 mb-1';

export default function OrderPanel({ orders, customerDB, onOrdersChange, onCustomerDBChange }: Props) {
  const [openList, setOpenList] = useState(true);
  const [formData, setFormData] = useState<OrderFormData>({ ...EMPTY_FORM });
  const [editingOrderIdx, setEditingOrderIdx] = useState<number | null>(null);
  const [popupCustomerId, setPopupCustomerId] = useState<number | null>(null);

  const customerMap = useMemo(() => {
    const m: Record<number, FullCustomer> = {};
    for (const c of (customersDB as { customers: FullCustomer[] }).customers) m[c.id] = c;
    return m;
  }, []);

  const ordersByCustomer = useMemo(() => {
    const m: Record<number, CustomerOrder[]> = {};
    for (const o of (ordersDB as { orders: any[] }).orders) {
      if (!m[o.customer_id]) m[o.customer_id] = [];
      m[o.customer_id].push(o as CustomerOrder);
    }
    return m;
  }, []);

  const handleEditOrder = (idx: number) => {
    const o = orders[idx];
    const info = customerDB[o.customer_id];
    const [startTime, endTime] = info.time.split(' - ');
    setFormData({
      name: info.name, address: info.address,
      lat: o.lat ?? null, lon: o.lon ?? null,
      weight: o.weight, volume: o.volume,
      startTime, endTime,
      serviceDuration: Math.round(o.service_duration / 60),
    });
    setEditingOrderIdx(idx);
  };

  const handleUpdateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingOrderIdx === null) return;
    const existing = orders[editingOrderIdx];
    onCustomerDBChange({
      ...customerDB,
      [existing.customer_id]: {
        name: formData.name, address: formData.address,
        time: `${formData.startTime} - ${formData.endTime}`,
        lat: formData.lat, lon: formData.lon,
      },
    });
    const updated = [...orders];
    updated[editingOrderIdx] = {
      ...existing,
      lat: formData.lat, lon: formData.lon,
      weight: Number(formData.weight), volume: Number(formData.volume),
      start_time: timeToSeconds(formData.startTime),
      end_time: timeToSeconds(formData.endTime),
      service_duration: Number(formData.serviceDuration) * 60,
    };
    onOrdersChange(updated);
    setEditingOrderIdx(null);
    setFormData({ ...EMPTY_FORM });
  };

  const handleRemoveOrder = (idx: number) => {
    if (editingOrderIdx === idx) { setEditingOrderIdx(null); setFormData({ ...EMPTY_FORM }); }
    const updated = [...orders];
    updated.splice(idx, 1);
    onOrdersChange(updated);
  };

  const popupCustomer = popupCustomerId != null ? customerMap[popupCustomerId] : null;

  return (
    <div className="space-y-4">
      {popupCustomer && (
        <CustomerDetailPopup
          customer={popupCustomer}
          orders={ordersByCustomer[popupCustomerId!] ?? []}
          timeWindow={customerDB[popupCustomerId!]?.time}
          onClose={() => setPopupCustomerId(null)}
        />
      )}

      {/* Order list */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <button type="button" onClick={() => setOpenList(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 hover:bg-slate-50 transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
              <ClipboardList size={14} className="text-blue-600" />
            </div>
            <h2 className="font-semibold text-slate-800 text-base">Đơn hàng chờ xử lý</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-blue-600 text-white text-sm font-bold px-2.5 py-0.5 rounded-lg">{orders.length} đơn hàng</span>
            {openList ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
          </div>
        </button>

        {openList && (
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
            {orders.length === 0 ? (
              <p className="text-slate-400 text-base text-center py-8 italic">Chưa có đơn hàng nào</p>
            ) : (
              orders.map((o: any, idx: number) => {
                const info = customerDB[o.customer_id];
                return (
                  <div key={idx}
                    className={`flex items-center justify-between px-5 py-2 ${editingOrderIdx === idx ? 'bg-orange-50' : 'hover:bg-slate-50'} transition-colors`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-medium text-slate-800 truncate">{info?.name}</p>
                        <button
                          onClick={() => setPopupCustomerId(o.customer_id)}
                          className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors whitespace-nowrap"
                        >
                          Xem thông tin
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {o.created_at && <span className="font-medium text-slate-500">{o.created_at}</span>}
                        {o.created_at && ' · '}
                        {info?.time} · {o.weight}kg · {o.volume}m³
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-3 shrink-0">
                      <button onClick={() => handleEditOrder(idx)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleRemoveOrder(idx)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors">
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Edit form — only shown when an order is being edited */}
      {editingOrderIdx !== null && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
            <div className="w-7 h-7 bg-orange-100 rounded-lg flex items-center justify-center">
              <Package size={14} className="text-orange-600" />
            </div>
            <h2 className="font-semibold text-slate-800 text-base">Chỉnh sửa đơn hàng</h2>
          </div>
          <form onSubmit={handleUpdateOrder} className="px-5 py-4 space-y-3">
            <div>
              <label className={labelCls}>Tên người nhận</label>
              <input type="text" value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Địa chỉ giao hàng</label>
              <input type="text" value={formData.address}
                onChange={e => setFormData(f => ({ ...f, address: e.target.value }))}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Toạ độ giao hàng</label>
              <div className="flex gap-2">
                <input type="number" step="0.000001" placeholder="Vĩ độ (lat)"
                  value={formData.lat ?? ''}
                  onChange={e => setFormData(f => ({ ...f, lat: e.target.value ? Number(e.target.value) : null }))}
                  className={inputCls} />
                <input type="number" step="0.000001" placeholder="Kinh độ (lon)"
                  value={formData.lon ?? ''}
                  onChange={e => setFormData(f => ({ ...f, lon: e.target.value ? Number(e.target.value) : null }))}
                  className={inputCls} />
                <button type="button"
                  onClick={() => {
                    const rand = (min: number, max: number) => +(Math.random() * (max - min) + min).toFixed(6);
                    setFormData(f => ({ ...f, lat: rand(20.9634, 21.0856), lon: rand(105.7788, 105.9038) }));
                  }}
                  className="shrink-0 flex items-center justify-center w-10 h-[38px] bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors"
                  title="Vị trí ngẫu nhiên">
                  <Shuffle size={14} />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
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
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Giao từ giờ</label>
                <input type="time" value={formData.startTime}
                  onChange={e => setFormData(f => ({ ...f, startTime: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Đến trước giờ</label>
                <input type="time" value={formData.endTime}
                  onChange={e => setFormData(f => ({ ...f, endTime: e.target.value }))}
                  className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Thời gian phục vụ (phút)</label>
              <input type="number" min="1" value={formData.serviceDuration}
                onChange={e => setFormData(f => ({ ...f, serviceDuration: Number(e.target.value) }))}
                className={inputCls} />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit"
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors">
                <Check size={14} /> Cập nhật đơn
              </button>
              <button type="button"
                onClick={() => { setEditingOrderIdx(null); setFormData({ ...EMPTY_FORM }); }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors">
                Hủy
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
