import { useState, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { secondsToTime } from '../utils';
import {
  BarChart2, Map as MapIcon, RefreshCw, ChevronRight, ChevronDown, Truck,
  Warehouse, Clock, Loader2, Package, CheckCircle,
} from 'lucide-react';
import customersDB from '../../../database/customers/customers.json';
import ordersDB from '../../../database/orders/orders.json';

interface Props {
  result: any;
  vehicles: any[];
  customerDB: Record<number, { name: string; address: string; time: string }>;
  prevCosts: { total: number; distance_km: number; penalty: number; vehicles: number } | null;
  recalculating: boolean;
  confirming: boolean;
  showRealRoute: boolean;
  onShowRealRouteChange: (val: boolean) => void;
  onRecalculate: () => void;
  onConfirm: () => void;
  onDragEnd: (event: DragEndEvent) => void;
}

function Delta({ delta, unit, lowerIsBetter = true }: { delta: number; unit: string; lowerIsBetter?: boolean }) {
  if (Math.abs(delta) < 0.001) return null;
  const isGood = lowerIsBetter ? delta < 0 : delta > 0;
  const abs = Math.abs(delta);
  const formatted = abs >= 1 ? Math.round(abs).toLocaleString() : abs.toFixed(2);
  return (
    <span className={`text-[10px] font-bold mt-0.5 ${isGood ? 'text-emerald-500' : 'text-rose-500'}`}>
      {delta > 0 ? '▲' : '▼'} {delta > 0 ? '+' : '−'}{formatted}{unit}
    </span>
  );
}

const VIOLATION_LABELS = [
  { key: 'capacity',     label: 'Tải trọng' },
  { key: 'volume',       label: 'Thể tích'  },
  { key: 'overtime',     label: 'Quá giờ'   },
  { key: 'overdistance', label: 'Quá km'    },
  { key: 'unserved',     label: 'Chưa giao' },
];

import { CustomerDetailPopup, type FullCustomer, type CustomerOrder } from './CustomerDetailPopup';
import { DriverDetailPopup, type FullDriver } from './DriverDetailPopup';
import driversDB from '../../../database/drivers/drivers.json';

// ── Compact stop card ─────────────────────────────────────────────────────────

interface StopCardProps {
  nodeId: number;
  sIdx: number;
  isDepot: boolean;
  info: any;
  stop: any;
  fullCustomer?: FullCustomer;
  customerOrders?: CustomerOrder[];
  dragging?: boolean;
  overlay?: boolean;
}

function StopCardContent({ nodeId, sIdx, isDepot, info, stop, fullCustomer, customerOrders, dragging, overlay }: StopCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className={`group relative flex flex-col gap-1.5 p-2.5 rounded-xl border text-sm select-none transition-all ${
      isDepot
        ? 'bg-slate-50 border-dashed border-slate-200'
        : overlay
          ? 'bg-white border-indigo-400 shadow-2xl rotate-1 scale-105 cursor-grabbing'
          : dragging
            ? 'opacity-40 bg-indigo-50 border-indigo-300'
            : 'bg-white border-slate-200 hover:border-indigo-300 cursor-grab active:cursor-grabbing'
    }`}>
      {showDetail && fullCustomer && (
        <CustomerDetailPopup
          customer={fullCustomer}
          orders={customerOrders ?? []}
          timeWindow={info?.time}
          onClose={() => setShowDetail(false)}
        />
      )}
      <div className="flex items-center justify-between">
        <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
          isDepot ? 'bg-slate-200 text-slate-400' : 'bg-indigo-100 text-indigo-600'
        }`}>
          {isDepot ? <Warehouse size={9} /> : sIdx}
        </div>
        {stop?.arrival_time != null && (
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600">
            <Clock size={9} />
            {secondsToTime(stop.arrival_time)}
          </span>
        )}
      </div>
      <p className={`font-semibold truncate leading-tight ${isDepot ? 'text-slate-400' : 'text-slate-800'}`}>
        {isDepot ? 'Kho trung tâm' : (info?.name ?? `#${nodeId}`)}
      </p>
      {!isDepot && !overlay && fullCustomer && (
        <button
          type="button"
          onMouseDown={e => { e.stopPropagation(); setShowDetail(true); }}
          className="absolute -top-6 left-0 right-0 mx-auto w-fit opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-semibold shadow-md whitespace-nowrap"
        >
          Xem thông tin
        </button>
      )}
    </div>
  );
}

function SortableStopCard(props: StopCardProps & { id: UniqueIdentifier }) {
  const { id, isDepot, ...rest } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: isDepot,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(!isDepot ? { ...attributes, ...listeners } : {})}
    >
      <StopCardContent isDepot={isDepot} dragging={isDragging} {...rest} />
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ResultsPanel({
  result, vehicles, customerDB, prevCosts, recalculating, confirming,
  showRealRoute, onShowRealRouteChange, onRecalculate, onConfirm, onDragEnd,
}: Props) {
  const [showMatrix, setShowMatrix] = useState(false);
  const [matrixMode, setMatrixMode] = useState<'distance' | 'time'>('distance');
  const [expandedVehicles, setExpandedVehicles] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [popupDriverId, setPopupDriverId] = useState<number | null>(null);

  const driverMap = useMemo(() => {
    const m: Record<number, FullDriver> = {};
    for (const d of (driversDB as { drivers: FullDriver[] }).drivers) m[d.id] = d;
    return m;
  }, []);

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

  const toggleVehicle = (vId: number) =>
    setExpandedVehicles(prev => {
      const next = new Set(prev);
      if (next.has(vId)) next.delete(vId); else next.add(vId);
      return next;
    });

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(active.id);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    onDragEnd(event);
  };

  // Resolve active card data for DragOverlay
  const activeStop = (() => {
    if (!activeId || !result) return null;
    const [v, t, i] = String(activeId).split(':');
    const vId = parseInt(v.slice(1)), tIdx = parseInt(t.slice(1)), iIdx = parseInt(i.slice(1));
    const route = result.routes?.find((r: any) => r.vehicle_id === vId);
    const trip = route?.trips?.[tIdx];
    if (!trip) return null;
    const nodeId: number = trip.sequence[iIdx];
    return { nodeId, sIdx: iIdx, isDepot: nodeId === 0, info: customerDB[nodeId], stop: trip.stops?.[iIdx] };
  })();

  const popupDriver = popupDriverId != null ? driverMap[popupDriverId] : null;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      {popupDriver && (
        <DriverDetailPopup driver={popupDriver} onClose={() => setPopupDriverId(null)} />
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-violet-100 rounded-lg flex items-center justify-center">
            <BarChart2 size={14} className="text-violet-600" />
          </div>
          <h2 className="font-semibold text-slate-800">Kết quả điều phối</h2>
        </div>
        {result && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onShowRealRouteChange(!showRealRoute)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showRealRoute
                  ? 'bg-teal-50 text-teal-700 border-teal-300 hover:bg-teal-100'
                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <MapIcon size={12} />
              Tuyến thực
              <span className={`font-bold ${showRealRoute ? 'text-teal-600' : 'text-slate-400'}`}>
                {showRealRoute ? 'BẬT' : 'TẮT'}
              </span>
            </button>
            <button
              onClick={onRecalculate}
              disabled={recalculating || confirming}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            >
              {recalculating
                ? <><Loader2 size={12} className="animate-spin" /> Đang cập nhật...</>
                : <><RefreshCw size={12} /> Cập nhật chỉ số</>
              }
            </button>
            <button
              onClick={onConfirm}
              disabled={confirming || recalculating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            >
              {confirming
                ? <><Loader2 size={12} className="animate-spin" /> Đang lưu...</>
                : <><CheckCircle size={12} /> Xác nhận</>
              }
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {!result ? (
        <div className="h-52 flex flex-col items-center justify-center text-slate-400 gap-3">
          <BarChart2 size={32} className="opacity-30" />
          <p className="text-sm text-center">
            Thêm xe, đơn hàng và nhấn<br />
            <span className="font-medium text-slate-500">"Bắt đầu chia tuyến"</span> để xem kết quả
          </p>
        </div>
      ) : (
        <div className="px-5 py-5 space-y-6">

          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Tổng chi phí ước tính',  value: `${Math.round(result.costs?.total ?? 0).toLocaleString()}đ`,              delta: prevCosts ? (result.costs?.total ?? 0) - prevCosts.total : null,                       unit: 'đ',  color: 'bg-blue-50 border-blue-100 text-blue-900'      },
              { label: 'Tổng quãng đường ước tính',   value: `${result.costs?.distance_km} km`,                        delta: prevCosts ? (result.costs?.distance_km ?? 0) - prevCosts.distance_km : null,            unit: ' km', color: 'bg-violet-50 border-violet-100 text-violet-900' },
              { label: 'Ước tính phạt vi phạm',  value: `${Math.round((result.costs?.penalty ?? 0) / 10).toLocaleString()}đ`, delta: prevCosts ? ((result.costs?.penalty ?? 0) - prevCosts.penalty) / 10 : null,           unit: 'đ',  color: result.costs?.penalty > 0 ? 'bg-rose-50 border-rose-100 text-rose-900' : 'bg-emerald-50 border-emerald-100 text-emerald-900' },
              { label: 'Số xe sử dụng', value: String(result.routes?.length),                            delta: prevCosts ? (result.routes?.length ?? 0) - prevCosts.vehicles : null,                   unit: '',   color: 'bg-emerald-50 border-emerald-100 text-emerald-900' },
            ].map(card => (
              <div key={card.label} className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center ${card.color}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{card.label}</p>
                <p className="text-base font-bold mt-0.5">{card.value}</p>
                {card.delta !== null && <Delta delta={card.delta} unit={card.unit} />}
              </div>
            ))}
          </div>

          {/* Violations */}
          {(() => {
            const v = result.violations ?? {};
            const hasViolation = VIOLATION_LABELS.some(({ key }) => v[key] > 0);
            return (
              <div className={`flex flex-wrap gap-2 p-3 rounded-lg border ${hasViolation ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-200'}`}>
                {VIOLATION_LABELS.map(({ key, label }) => (
                  <span key={key} className={`text-[14px] font-semibold px-2.5 py-1 rounded-lg border ${
                    v[key] > 0
                      ? 'bg-white border-rose-300 text-rose-600'
                      : 'bg-white border-slate-200 text-slate-400'
                  }`}>
                    {label}: {v[key] ?? 0}
                  </span>
                ))}
              </div>
            );
          })()}

          {/* Routes */}
          <div>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Nhấn để xem chi tiết lộ trình từng xe
            </h3>

            <DndContext
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setActiveId(null)}
            >
              <div className="space-y-2">
                {result.routes?.map((vehicleRoute: any) => {
                  const assignedVehicle = vehicles.find((v: any) => v.id === vehicleRoute.vehicle_id);
                  const isExpanded = expandedVehicles.has(vehicleRoute.vehicle_id);
                  return (
                    <div key={vehicleRoute.vehicle_id} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div
                        onClick={() => toggleVehicle(vehicleRoute.vehicle_id)}
                        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors cursor-pointer ${
                          isExpanded ? 'bg-slate-800 text-white' : 'bg-slate-50 hover:bg-slate-100 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {isExpanded
                            ? <ChevronDown size={14} className="opacity-60" />
                            : <ChevronRight size={14} className="opacity-60" />
                          }
                          <Truck size={15} className={isExpanded ? 'text-slate-300' : 'text-slate-500'} />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold">
                                Xe {vehicleRoute.vehicle_id} · {assignedVehicle?.type}
                              </p>
                              {assignedVehicle?.driver_id && (
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); setPopupDriverId(assignedVehicle.driver_id); }}
                                  className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors whitespace-nowrap ${
                                    isExpanded
                                      ? 'text-indigo-300 bg-slate-700 hover:bg-slate-600'
                                      : 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                  }`}
                                >
                                  Xem tài xế
                                </button>
                              )}
                            </div>
                            <p className={`text-[11px] mt-0.5 ${isExpanded ? 'text-slate-400' : 'text-slate-500'}`}>
                              {assignedVehicle?.max_weight}kg · {vehicleRoute.total_distance_km} km
                            </p>
                            {assignedVehicle?.driver_name && (
                              <p className={`text-[11px] mt-0.5 font-medium ${isExpanded ? 'text-indigo-300' : 'text-indigo-500'}`}>
                                {assignedVehicle.plate} · {assignedVehicle.driver_name} · {assignedVehicle.driver_phone}
                              </p>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] font-bold bg-indigo-500 text-white px-2.5 py-0.5 rounded-full">
                          {vehicleRoute.trips?.length} chuyến
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="bg-slate-50 p-3 space-y-2 animate-in fade-in slide-in-from-top-1">
                          {vehicleRoute.trips?.map((trip: any, tIdx: number) => {
                            const itemIds: UniqueIdentifier[] = trip.sequence.map(
                              (_: number, sIdx: number) => `v${vehicleRoute.vehicle_id}:t${tIdx}:i${sIdx}`
                            );
                            return (
                              <div key={tIdx} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                <div className="flex items-center justify-between px-3 py-2 bg-slate-100 border-b border-slate-200">
                                  <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wide">
                                    Chuyến {tIdx + 1}
                                  </span>
                                  <span className="text-[12px] font-semibold text-indigo-600 flex items-center gap-1">
                                    <Package size={10} />
                                    {trip.sequence.length - 2} đơn
                                  </span>
                                </div>
                                <SortableContext items={itemIds} strategy={rectSortingStrategy}>
                                  <div className="p-2 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 min-h-[8px]">
                                    {trip.sequence.map((nodeId: number, sIdx: number) => {
                                      const id = `v${vehicleRoute.vehicle_id}:t${tIdx}:i${sIdx}`;
                                      const isDepot = nodeId === 0;
                                      return (
                                        <SortableStopCard
                                          key={id}
                                          id={id}
                                          nodeId={nodeId}
                                          sIdx={sIdx}
                                          isDepot={isDepot}
                                          info={customerDB[nodeId]}
                                          stop={trip.stops?.[sIdx]}
                                          fullCustomer={customerMap[nodeId]}
                                          customerOrders={ordersByCustomer[nodeId]}
                                        />
                                      );
                                    })}
                                  </div>
                                </SortableContext>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Floating drag preview */}
              <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
                {activeStop && (
                  <StopCardContent
                    nodeId={activeStop.nodeId}
                    sIdx={activeStop.sIdx}
                    isDepot={activeStop.isDepot}
                    info={activeStop.info}
                    stop={activeStop.stop}
                    overlay
                  />
                )}
              </DragOverlay>
            </DndContext>
          </div>

          {/* Distance / time matrix */}
          {result.matrix && (
            <div className="pt-4 border-t border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => setShowMatrix(!showMatrix)}
                  className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
                >
                  {showMatrix ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  Ma trận khoảng cách / thời gian
                </button>
                {showMatrix && (
                  <div className="flex p-1 bg-slate-100 rounded-lg gap-0.5">
                    {(['distance', 'time'] as const).map(mode => (
                      <button key={mode} onClick={() => setMatrixMode(mode)}
                        className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-all ${
                          matrixMode === mode
                            ? 'bg-white text-indigo-600'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}>
                        {mode === 'distance' ? 'KHOẢNG CÁCH' : 'THỜI GIAN'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {showMatrix && (() => {
                const { node_ids, distances_km, times_min } = result.matrix;
                const data = matrixMode === 'distance' ? distances_km : times_min;
                const unit = matrixMode === 'distance' ? 'km' : 'ph';
                const nodeLabel = (id: number) => id === 0 ? 'Kho' : (customerDB[id]?.name?.split(' ')[0] ?? `#${id}`);
                return (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50">
                    <table className="w-full text-[12px] border-collapse">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-20 bg-slate-200 p-2 border-r border-b border-slate-300 font-bold text-slate-600 whitespace-nowrap italic">Từ \ Đến</th>
                          {node_ids.map((id: number) => (
                            <th key={id} className="bg-slate-100 p-2 border-r border-b border-slate-300 font-bold text-slate-700 min-w-[64px]">{nodeLabel(id)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {node_ids.map((rowId: number, i: number) => (
                          <tr key={rowId} className="hover:bg-indigo-50 transition-colors">
                            <td className="sticky left-0 z-10 bg-slate-100 p-2 border-r border-b border-slate-300 font-bold text-slate-700 whitespace-nowrap">{nodeLabel(rowId)}</td>
                            {data[i].map((val: number, j: number) => (
                              <td key={j} className={`p-2 border-r border-b border-slate-200 text-center ${i === j ? 'bg-slate-200 text-slate-400 font-black' : 'text-slate-600'}`}>
                                {i === j ? '—' : `${val}${unit}`}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
