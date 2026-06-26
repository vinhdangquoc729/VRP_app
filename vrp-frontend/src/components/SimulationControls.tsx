import { secondsToTime } from '../utils';
import { Play, Pause, SkipBack, Loader2 } from 'lucide-react';

interface Props {
  simTime: number | null;
  simBounds: { start: number; end: number } | null;
  isSimulating: boolean;
  simSpeed: number;
  insertingOrder?: boolean;
  onToggle: () => void;
  onReset: () => void;
  onSpeedChange: (speed: number) => void;
  onTimeChange: (time: number) => void;
}

export default function SimulationControls({
  simTime, simBounds, isSimulating, simSpeed,
  insertingOrder = false,
  onToggle, onReset, onSpeedChange, onTimeChange,
}: Props) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-slate-700">Mô phỏng di chuyển xe</h3>
        <div className="flex items-center gap-2">
          {insertingOrder && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg animate-pulse">
              <Loader2 size={11} className="animate-spin" />
              Đang cập nhật tuyến...
            </span>
          )}
          <span className="font-mono text-sm font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-lg">
            {simTime != null ? secondsToTime(Math.floor(simTime)) : '--:--'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onToggle}
          disabled={!simBounds}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm transition-colors disabled:opacity-40 ${
            isSimulating
              ? 'bg-amber-400 text-amber-900 hover:bg-amber-500'
              : 'bg-emerald-500 text-white hover:bg-emerald-600'
          }`}
        >
          {isSimulating
            ? <><Pause size={14} /> Tạm dừng</>
            : <><Play size={14} /> {simTime != null ? 'Tiếp tục' : 'Chạy mô phỏng'}</>
          }
        </button>

        <button
          onClick={onReset}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
        >
          <SkipBack size={14} />
          Reset
        </button>

        <select
          value={simSpeed}
          onChange={e => onSpeedChange(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-2.5 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value={1}>1× (thời gian thực)</option>
          <option value={60}>60× (1 phút/giây)</option>
          <option value={300}>300× (5 phút/giây)</option>
          <option value={600}>600× (10 phút/giây)</option>
          <option value={1800}>1800× (30 phút/giây)</option>
          <option value={3600}>3600× (1 giờ/giây)</option>
        </select>

        {simBounds && (
          <input
            type="range"
            min={simBounds.start}
            max={simBounds.end}
            step={60}
            value={simTime ?? simBounds.start}
            onChange={e => onTimeChange(Number(e.target.value))}
            className="flex-1 min-w-[100px] accent-indigo-600"
          />
        )}
      </div>
    </div>
  );
}
