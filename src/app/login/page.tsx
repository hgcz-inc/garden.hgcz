'use client';
import { useState } from 'react';
import { Leaf, ArrowRight } from 'lucide-react';
export default function Login() {
  const [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <main className="login-page"><div className="login-card"><div className="brand"><span className="brand-icon"><Leaf /></span>GardenCare<span className="brand-dot">.</span></div><p className="eyebrow">MỘT KHOẢNG XANH, MỖI NGÀY</p><h1>Về với khu vườn.</h1><p className="muted">Đăng nhập để ghi nhận chăm cây và xem lịch tưới của bạn.</p><form onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); location.assign('/'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Không kết nối được.'); } finally { setBusy(false); }
  }}><label>Mật khẩu<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>{error && <p className="error" role="alert">{error}</p>}<button className="button primary full" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Mở khu vườn'}<ArrowRight size={18}/></button></form></div></main>;
}
