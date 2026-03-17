import { useState, FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useAdminAuthStore } from '@/store/adminAuthStore';

export function AdminLoginModal() {
  const login = useAdminAuthStore((s) => s.login);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 rounded-xl w-full max-w-sm p-8 shadow-2xl">
        <h2 className="text-xl font-semibold mb-1 text-white">登录</h2>
        <p className="text-sm text-gray-400 mb-6">请输入账号密码以继续使用</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="username"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 py-2.5 rounded-lg font-medium text-sm transition"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}
