import { useState } from 'react';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import routimeLogo from '../../assets/ROUTIME-logo.png';

interface Props {
  onAdminLogin: () => void;
  onDriverLogin: (driver: any) => void;
  onCustomerLogin: (customer: any) => void;
}

export default function LoginPage({ onAdminLogin, onDriverLogin, onCustomerLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Admin shortcut (local check)
    if (username === 'admin' && password === 'admin') {
      localStorage.setItem('tcpvrp_auth', 'admin');
      onAdminLogin();
      return;
    }

    const body = JSON.stringify({ phone: username, password });
    const headers = { 'Content-Type': 'application/json' };

    try {
      // Try driver login first
      const driverRes = await fetch('http://127.0.0.1:8000/api/v1/drivers/login', { method: 'POST', headers, body });
      if (driverRes.ok) {
        const data = await driverRes.json();
        localStorage.setItem('tcpvrp_auth', `driver:${data.driver.id}`);
        localStorage.setItem('tcpvrp_driver', JSON.stringify(data.driver));
        onDriverLogin(data.driver);
        return;
      }

      // Fall through to customer login
      const customerRes = await fetch('http://127.0.0.1:8000/api/v1/customers/login', { method: 'POST', headers, body });
      if (customerRes.ok) {
        const data = await customerRes.json();
        localStorage.setItem('tcpvrp_auth', `customer:${data.customer.id}`);
        localStorage.setItem('tcpvrp_customer', JSON.stringify(data.customer));
        onCustomerLogin(data.customer);
        return;
      }

      setError('Số điện thoại hoặc mật khẩu không đúng');
    } catch {
      setError('Không thể kết nối đến server. Vui lòng kiểm tra kết nối.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">

        {/* Logo + title */}
        <div className="text-center space-y-3">
          <img src={routimeLogo} alt="Routime" className="h-28 w-auto object-contain mx-auto" />
          <div>
            <h1 className="text-xl font-semibold text-slate-900">ROUTIME - Hệ thống điều phối giao hàng</h1>
            <p className="text-sm text-slate-400 mt-0.5">Điều phối thông minh, giao hàng đúng hẹn</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Đăng nhập</h2>
            {/* <p className="text-sm text-slate-400 mt-0.5">Dùng tài khoản admin, số điện thoại tài xế hoặc khách hàng</p> */}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Tên đăng nhập / Số điện thoại</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin hoặc 09xxxxxxxx"
                autoComplete="username"
                autoFocus
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow placeholder:text-slate-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Mật khẩu</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow placeholder:text-slate-300"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-rose-500 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <LogIn size={15} />
              )}
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>
        </div>

        {/* <p className="text-center text-xs text-slate-400">
          Quản trị viên · Tài xế · Khách hàng
        </p> */}
      </div>
    </div>
  );
}
