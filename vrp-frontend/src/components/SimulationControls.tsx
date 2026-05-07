import { secondsToTime } from '../utils';

interface Props {
  simTime: number | null;
  simBounds: { start: number; end: number } | null;
  isSimulating: boolean;
  simSpeed: number;
  onToggle: () => void;
  onReset: () => void;
  onSpeedChange: (speed: number) => void;
  onTimeChange: (time: number) => void;
}

export default function SimulationControls({
  simTime, simBounds, isSimulating, simSpeed,
  onToggle, onReset, onSpeedChange, onTimeChange,
}: Props) {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-gray-700 text-sm">🎬 Mô phỏng di chuyển xe</h3>
        <span className="font-mono text-sm font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-lg">
          {simTime != null ? secondsToTime(Math.floor(simTime)) : '--:--'}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onToggle}
          disabled={!simBounds}
          className={`px-4 py-2 rounded-lg font-bold text-sm transition-colors disabled:opacity-40 ${isSimulating ? 'bg-yellow-400 text-yellow-900 hover:bg-yellow-500' : 'bg-green-500 text-white hover:bg-green-600'}`}
        >
          {isSimulating ? '⏸ Tạm dừng' : (simTime != null ? '▶ Tiếp tục' : '▶ Chạy mô phỏng')}
        </button>

        <button onClick={onReset} className="px-3 py-2 rounded-lg bg-gray-200 text-gray-700 font-bold text-sm hover:bg-gray-300 transition-colors">
          ⏮ Reset
        </button>

        <select
          value={simSpeed}
          onChange={e => onSpeedChange(Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-2 py-2 text-sm font-bold text-gray-700 bg-white"
        >
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
