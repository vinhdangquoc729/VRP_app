import { useEffect } from 'react';
import { Phone, Mail, MapPin, Truck, Star, Award, User, ShieldCheck } from 'lucide-react';

export interface FullDriver {
  id: number;
  name: string;
  phone: string;
  email: string;
  license_type: string;
  vehicle_type: string;
  vehicle_plate: string;
  status: string;
  rating: number;
  total_deliveries: number;
  join_date: string;
  district: string;
}

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  available: { label: 'Sẵn sàng',     cls: 'bg-emerald-100 text-emerald-700' },
  assigned:  { label: 'Đã phân công', cls: 'bg-violet-100 text-violet-700'   },
  on_route:  { label: 'Đang giao',    cls: 'bg-blue-100 text-blue-700'       },
  off_duty:  { label: 'Nghỉ',         cls: 'bg-slate-100 text-slate-500'     },
};

export function DriverDetailPopup({
  driver, onClose,
}: {
  driver: FullDriver;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const status = STATUS_INFO[driver.status] ?? { label: driver.status, cls: 'bg-slate-100 text-slate-500' };

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
              <span className="text-[11px] font-mono text-slate-400">#{driver.id}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
                {driver.district}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${status.cls}`}>
                {status.label}
              </span>
            </div>
            <p className="text-base font-bold text-slate-800">{driver.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors shrink-0 mt-0.5">✕</button>
        </div>

        {/* Contact */}
        <div className="px-5 py-3 space-y-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Phone size={13} className="text-slate-400 shrink-0" />
            <a href={`tel:${driver.phone}`} className="hover:text-indigo-600">{driver.phone}</a>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Mail size={13} className="text-slate-400 shrink-0" />
            <a href={`mailto:${driver.email}`} className="hover:text-indigo-600 truncate">{driver.email}</a>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <MapPin size={13} className="text-slate-400 shrink-0" />
            {driver.district}
          </div>
        </div>

        {/* Vehicle & License */}
        <div className="px-5 py-3 space-y-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Truck size={13} className="text-slate-400 shrink-0" />
            <span>{driver.vehicle_type}</span>
            <span className="font-mono text-slate-800 font-medium">{driver.vehicle_plate}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <ShieldCheck size={13} className="text-slate-400 shrink-0" />
            Bằng lái: <span className="font-medium text-slate-800">{driver.license_type}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="px-5 py-3 grid grid-cols-2 gap-3 border-b border-slate-100">
          <div className="flex flex-col items-center justify-center bg-amber-50 rounded-lg py-2.5 gap-0.5">
            <div className="flex items-center gap-1">
              <Star size={13} className="text-amber-400" />
              <span className="text-base font-bold text-amber-600">{driver.rating}</span>
            </div>
            <span className="text-[11px] text-slate-400">Đánh giá / 5.0</span>
          </div>
          <div className="flex flex-col items-center justify-center bg-indigo-50 rounded-lg py-2.5 gap-0.5">
            <div className="flex items-center gap-1">
              <Award size={13} className="text-indigo-400" />
              <span className="text-base font-bold text-indigo-600">{driver.total_deliveries}</span>
            </div>
            <span className="text-[11px] text-slate-400">Tổng chuyến</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><User size={11} />Tham gia từ {driver.join_date}</span>
        </div>
      </div>
    </div>
  );
}
