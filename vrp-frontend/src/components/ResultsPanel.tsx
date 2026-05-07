import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { secondsToTime } from '../utils';

interface Props {
  result: any;
  vehicles: any[];
  customerDB: Record<number, { name: string; address: string; time: string }>;
  prevCosts: { total: number; distance_km: number; penalty: number; vehicles: number } | null;
  recalculating: boolean;
  showRealRoute: boolean;
  onShowRealRouteChange: (val: boolean) => void;
  onRecalculate: () => void;
  onDragEnd: (result: DropResult) => void;
}

function renderDelta(delta: number, unit: string, lowerIsBetter = true) {
  if (Math.abs(delta) < 0.001) return null;
  const isGood = lowerIsBetter ? delta < 0 : delta > 0;
  const arrow = delta > 0 ? '▲' : '▼';
  const abs = Math.abs(delta);
  const formatted = abs >= 1 ? Math.round(abs).toLocaleString() : abs.toFixed(2);
  return (
    <span className={`text-[10px] font-bold block mt-0.5 ${isGood ? 'text-green-500' : 'text-red-500'}`}>
      {arrow} {delta > 0 ? '+' : '−'}{formatted}{unit}
    </span>
  );
}

export default function ResultsPanel({
  result, vehicles, customerDB, prevCosts, recalculating,
  showRealRoute, onShowRealRouteChange, onRecalculate, onDragEnd,
}: Props) {
  const [showMatrix, setShowMatrix] = useState(false);
  const [matrixMode, setMatrixMode] = useState<'distance' | 'time'>('distance');
  const [expandedVehicles, setExpandedVehicles] = useState<Set<number>>(new Set());

  const toggleVehicle = (vId: number) => {
    setExpandedVehicles(prev => {
      const next = new Set(prev);
      if (next.has(vId)) next.delete(vId); else next.add(vId);
      return next;
    });
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-6 border-b pb-4">
        <h2 className="text-2xl font-bold text-gray-800">Kết quả điều phối</h2>
        {result && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onShowRealRouteChange(!showRealRoute)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold text-sm border transition-colors ${showRealRoute ? 'bg-teal-50 text-teal-700 border-teal-300 hover:bg-teal-100' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'}`}
              title="Bật để vẽ tuyến đường theo đường thực tế (chậm hơn)"
            >
              🗺 Tuyến thực: <span className={`font-black ${showRealRoute ? 'text-teal-600' : 'text-gray-400'}`}>{showRealRoute ? 'BẬT' : 'TẮT'}</span>
            </button>
            <button
              onClick={onRecalculate}
              disabled={recalculating}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 transition-all disabled:bg-gray-300"
            >
              {recalculating ? '🔄 Đang cập nhật...' : '📊 Cập nhật chỉ số'}
            </button>
          </div>
        )}
      </div>

      {!result ? (
        <div className="h-64 flex flex-col items-center justify-center text-gray-400 text-center">
          <span className="text-4xl mb-4">📊</span>
          <p>Thêm xe, đơn hàng và nhấn "Bắt đầu chia tuyến" <br /> để xem lộ trình và ma trận dữ liệu</p>
        </div>
      ) : (
        <div className="space-y-8">

          {/* Dashboard stats */}
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 text-center text-blue-800">
                <p className="text-[10px] font-bold uppercase">Tổng chi phí</p>
                <p className="text-lg font-black">{result.costs?.total?.toLocaleString()}đ</p>
                {prevCosts && renderDelta((result.costs?.total ?? 0) - prevCosts.total, 'đ')}
              </div>
              <div className="bg-purple-50 p-3 rounded-xl border border-purple-100 text-center text-purple-800">
                <p className="text-[10px] font-bold uppercase">Quãng đường</p>
                <p className="text-lg font-black">{result.costs?.distance_km} km</p>
                {prevCosts && renderDelta((result.costs?.distance_km ?? 0) - prevCosts.distance_km, ' km')}
              </div>
              <div className={`p-3 rounded-xl border text-center ${result.costs?.penalty > 0 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
                <p className="text-[10px] font-bold uppercase">Phạt vi phạm</p>
                <p className="text-lg font-black">{(result.costs?.penalty / 10).toLocaleString() || '0'}đ</p>
                {prevCosts && renderDelta(((result.costs?.penalty ?? 0) - prevCosts.penalty) / 10, 'đ')}
              </div>
              <div className="bg-green-50 p-3 rounded-xl border border-green-100 text-center text-green-800">
                <p className="text-[10px] font-bold uppercase">Số xe sử dụng</p>
                <p className="text-lg font-black">{result.routes?.length}</p>
                {prevCosts && renderDelta((result.routes?.length ?? 0) - prevCosts.vehicles, '')}
              </div>
            </div>

            {/* Violations */}
            {(() => {
              const v = result.violations ?? {};
              const labels = [
                { label: 'Tải trọng', val: v.capacity, icon: '⚖️' },
                { label: 'Thể tích', val: v.volume, icon: '📦' },
                { label: 'Quá giờ', val: v.overtime, icon: '⏰' },
                { label: 'Quá km', val: v.overdistance, icon: '📏' },
                { label: 'Chưa giao', val: v.unserved, icon: '🚫' },
              ];
              return (
                <div className="flex flex-wrap gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200">
                  {labels.map(item => (
                    <div key={item.label} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold ${item.val > 0 ? 'bg-white border-red-300 text-red-600 shadow-sm' : 'bg-gray-100 text-gray-400 opacity-60'}`}>
                      <span>{item.icon} {item.label}: {item.val}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Drag-drop routes */}
          <div className="space-y-4">
            <h3 className="font-bold text-gray-700 text-sm flex items-center gap-2">
              📋 Lộ trình các xe (Nhấn để đóng/mở)
            </h3>
            <DragDropContext onDragEnd={onDragEnd}>
              <div className="space-y-3">
                {result.routes?.map((vehicleRoute: any) => {
                  const assignedVehicle = vehicles.find((v: any) => v.id === vehicleRoute.vehicle_id);
                  const isExpanded = expandedVehicles.has(vehicleRoute.vehicle_id);
                  return (
                    <div key={vehicleRoute.vehicle_id} className="border-2 border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                      <div
                        onClick={() => toggleVehicle(vehicleRoute.vehicle_id)}
                        className={`cursor-pointer px-5 py-3 flex justify-between items-center transition-colors ${isExpanded ? 'bg-gray-800 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                      >
                        <div className="flex items-center gap-3">
                          <span>{isExpanded ? '🔽' : '▶️'}</span>
                          <span className="text-lg">🚚</span>
                          <div>
                            <h4 className="font-bold text-sm">Xe {vehicleRoute.vehicle_id} - {assignedVehicle?.type}</h4>
                            <p className={`text-[10px] ${isExpanded ? 'opacity-60' : 'text-gray-500'}`}>Tải: {assignedVehicle?.max_weight}kg | Quãng đường: {vehicleRoute.total_distance_km}km</p>
                          </div>
                        </div>
                        <span className="bg-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black uppercase">{vehicleRoute.trips?.length} Chuyến</span>
                      </div>

                      {isExpanded && (
                        <div className="p-3 bg-gray-50 space-y-3 animate-in fade-in slide-in-from-top-1">
                          {vehicleRoute.trips?.map((trip: any, tIdx: number) => (
                            <div key={tIdx} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                              <div className="bg-gray-100 px-3 py-1.5 border-b text-[10px] font-bold text-gray-500 uppercase flex justify-between">
                                <span>Chuyến {tIdx + 1}</span>
                                <span className="text-blue-600">📦 Giao {trip.sequence.length - 2} đơn</span>
                              </div>
                              <Droppable droppableId={`vehicle-${vehicleRoute.vehicle_id}-trip-${tIdx}`}>
                                {(provided, snapshot) => (
                                  <div {...provided.droppableProps} ref={provided.innerRef} className={`p-2 space-y-1 ${snapshot.isDraggingOver ? 'bg-indigo-50' : ''}`}>
                                    {trip.sequence.map((nodeId: number, sIdx: number) => {
                                      const isDepot = nodeId === 0;
                                      const info = customerDB[nodeId];
                                      const stop = trip.stops?.[sIdx];
                                      return (
                                        <Draggable key={`${vehicleRoute.vehicle_id}-${tIdx}-${nodeId}-${sIdx}`} draggableId={`${vehicleRoute.vehicle_id}-${tIdx}-${nodeId}-${sIdx}`} index={sIdx} isDragDisabled={isDepot}>
                                          {(dragProv, dragSnap) => (
                                            <div ref={dragProv.innerRef} {...dragProv.draggableProps} {...dragProv.dragHandleProps} className={`flex items-center gap-3 p-2 rounded-lg border text-xs ${isDepot ? 'bg-gray-50 text-gray-400 border-dashed' : 'bg-white shadow-sm hover:border-indigo-300'} ${dragSnap.isDragging ? 'shadow-xl z-50 border-indigo-500 scale-105' : ''}`}>
                                              <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${isDepot ? 'bg-gray-200' : 'bg-blue-100 text-blue-600'}`}>{sIdx + 1}</div>
                                              <div className="flex-1 truncate">
                                                <p className="font-bold">{isDepot ? 'Kho trung tâm' : info?.name}</p>
                                                {!isDepot && <p className="text-[10px] opacity-60 truncate">{info?.address}</p>}
                                              </div>
                                              {stop?.arrival_time != null && (
                                                <div className="text-[10px] font-bold text-green-600 whitespace-nowrap">⏱ {secondsToTime(stop.arrival_time)}</div>
                                              )}
                                            </div>
                                          )}
                                        </Draggable>
                                      );
                                    })}
                                    {provided.placeholder}
                                  </div>
                                )}
                              </Droppable>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </DragDropContext>
          </div>

          {/* Distance / time matrix */}
          {result.matrix && (
            <div className="mt-10 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setShowMatrix(!showMatrix)} className="flex items-center gap-2 font-bold text-gray-700 hover:text-gray-900 transition-colors">
                  <span className="text-lg">{showMatrix ? '🔽' : '▶️'}</span>
                  <span>Ma trận dữ liệu giữa các điểm</span>
                </button>
                {showMatrix && (
                  <div className="flex p-1 bg-gray-100 rounded-lg">
                    <button onClick={() => setMatrixMode('distance')} className={`px-4 py-1.5 rounded-md text-[11px] font-bold transition-all ${matrixMode === 'distance' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}>KHOẢNG CÁCH</button>
                    <button onClick={() => setMatrixMode('time')} className={`px-4 py-1.5 rounded-md text-[11px] font-bold transition-all ${matrixMode === 'time' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}>THỜI GIAN</button>
                  </div>
                )}
              </div>

              {showMatrix && (() => {
                const { node_ids, distances_km, times_min } = result.matrix;
                const data = matrixMode === 'distance' ? distances_km : times_min;
                const unit = matrixMode === 'distance' ? 'km' : 'ph';
                const nodeLabel = (id: number) => id === 0 ? 'Kho' : (customerDB[id]?.name?.split(' ')[0] ?? `#${id}`);
                return (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-inner bg-gray-50">
                    <table className="w-full text-[10px] border-collapse">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-20 bg-gray-200 p-2 border-r border-b border-gray-300 font-bold text-gray-600 whitespace-nowrap italic">Từ \ Đến</th>
                          {node_ids.map((id: number) => (
                            <th key={id} className="bg-gray-100 p-2 border-r border-b border-gray-300 font-bold text-gray-700 min-w-[70px]">{nodeLabel(id)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {node_ids.map((rowId: number, i: number) => (
                          <tr key={rowId} className="hover:bg-indigo-50 transition-colors">
                            <td className="sticky left-0 z-10 bg-gray-100 p-2 border-r border-b border-gray-300 font-bold text-gray-700 whitespace-nowrap">{nodeLabel(rowId)}</td>
                            {data[i].map((val: number, j: number) => (
                              <td key={j} className={`p-2 border-r border-b border-gray-200 text-center ${i === j ? 'bg-gray-200 text-gray-400 font-black' : 'text-gray-600'}`}>
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
