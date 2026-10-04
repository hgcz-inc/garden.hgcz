'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, CalendarDays, Check, CheckCheck, ChevronRight, CloudRain, Droplets, History, LayoutGrid, List, House, Leaf, LoaderCircle, LogOut, Plus, Search, Settings, Sparkles, Sprout, Undo2, WifiOff, X } from 'lucide-react';
import type { Action, AppState, Group, Mode, Plan, Plant, SessionInput } from '@/lib/types';
import { addDays, diffDays, labelDate, today, validDate } from '@/lib/dates';
import { baseline, buildContext, historyDecisions, makePlan, waterDates } from '@/lib/planner';
import { blankPlant, recordDemo, undoDemo } from '@/lib/demo';
import { gardenSchema, groupSchema, plantSchema } from '@/lib/validation';

const CACHE = 'gardencare-state-v1', QUEUE = 'gardencare-queue-v1', DEMO = 'gardencare-demo-v1';
const actionNames: Record<Action, string> = { watered: 'Tưới nước', checked: 'Kiểm tra', skipped: 'Chưa cần tưới', water_changed: 'Thay nước', water_topped_up: 'Châm nước', legacy_water_care: 'Lịch sử Excel' };
const navItems = [{ id: 'home', label: 'Hôm nay', icon: House }, { id: 'calendar', label: 'Lịch tưới', icon: CalendarDays }, { id: 'plants', label: 'Cây của tôi', icon: Sprout }, { id: 'history', label: 'Nhật ký', icon: History }, { id: 'settings', label: 'Thiết lập', icon: Settings }] as const;
type Tab = typeof navItems[number]['id'];
type ModalState = { type: 'record'; ids: string[]; action?: SessionInput['action'] } | { type: 'generate' } | { type: 'plant'; plant: Plant } | { type: 'group'; group?: Group } | null;
function readLocal<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } }
function writeLocal(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* UI state still works when browser storage is unavailable. */ } }
async function request(path: string, method = 'GET', data?: unknown) {
  const response = await fetch(path, { method, headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined, cache: 'no-store' });
  const result = await response.json();
  if (response.status === 401 && path !== '/api/login') { location.assign('/login'); throw new Error('Vui lòng đăng nhập.'); }
  if (!response.ok) throw new Error(result.error ?? 'Không hoàn tất được.');
  return result;
}
function download(plan: Plan) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `gardencare-${plan.mode}-${plan.period.start}.json`; link.click(); URL.revokeObjectURL(url);
}
function ToggleList({ plants, selected, setSelected, events, search = '' }: { plants: Plant[]; selected: string[]; setSelected: (ids: string[]) => void; events: AppState['events']; search?: string }) {
  return <div className="selection-list">{plants.filter(p => `${p.name} ${p.code}`.toLowerCase().includes(search.toLowerCase())).map(p => {
    const history = waterDates(p.id, events, today());
    return <label className={`selection-row ${selected.includes(p.id) ? 'selected' : ''}`} key={p.id}>
      <input type="checkbox" checked={selected.includes(p.id)} onChange={() => setSelected(selected.includes(p.id) ? selected.filter(id => id !== p.id) : [...selected, p.id])} />
      <span className="plant-avatar small">{p.profile.growingMedium === 'water' ? <Droplets size={19}/> : <Sprout size={19}/>}</span>
      <span className="row-text"><strong>{p.name}</strong><small>{p.code} · {history.length ? `Gần nhất ${labelDate(history.at(-1)!)}` : 'Chưa có lần tưới'}{p.profile.growingMedium === 'water' ? ' · Thủy sinh' : ''}</small></span>
    </label>;
  })}</div>;
}
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button, input')?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, a[href]') ?? [])];
        const first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', listener);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', listener); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Đóng"><X/></button></header>{children}</div></div>;
}
export default function GardenApp() {
  const [state, setState] = useState<AppState | null>(null), [tab, setTab] = useState<Tab>('home'), [modal, setModal] = useState<ModalState>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [offline, setOffline] = useState(false), [queue, setQueue] = useState<SessionInput[]>([]);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [showArchived, setShowArchived] = useState(false), [selectedPlan, setSelectedPlan] = useState('');
  const [plantView, setPlantView] = useState<'table' | 'cards'>('table');
  const syncing = useRef(false);
  const cacheState = useCallback((value: AppState) => { setState(value); writeLocal(CACHE, value); if (value.storage === 'demo') writeLocal(DEMO, value); }, []);
  const load = useCallback(async () => {
    try {
      const data: AppState = await request('/api/state');
      const value = data.storage === 'demo' ? readLocal<AppState | null>(DEMO, null) ?? data : data;
      cacheState(value); setError('');
    } catch (error) {
      if (!navigator.onLine) { const cached = readLocal<AppState | null>(CACHE, null); if (cached) { setState(cached); return; } }
      setError(error instanceof Error ? error.message : 'Không tải được dữ liệu.');
    }
  }, [cacheState]);
  const syncQueue = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    const pending = readLocal<SessionInput[]>(QUEUE, []);
    if (!pending.length) return;
    syncing.current = true;
    try {
      let undone = 0;
      while (pending.length) {
        const result = await request('/api/sessions', 'POST', pending[0]);
        if (result.undone) undone++;
        pending.shift(); writeLocal(QUEUE, pending); setQueue([...pending]);
      }
      await load(); setNotice(undone ? 'Đã đồng bộ. Buổi đã hoàn tác trước đó không được ghi lại.' : 'Đã đồng bộ các buổi chăm sóc.');
    } catch (error) { setError(error instanceof Error ? `Chưa đồng bộ được: ${error.message}` : 'Chưa đồng bộ được.'); }
    finally { syncing.current = false; }
  }, [load]);
  useEffect(() => {
    setOffline(!navigator.onLine); setQueue(readLocal(QUEUE, [])); void load(); if (navigator.onLine) void syncQueue();
    const online = () => { setOffline(false); void load(); void syncQueue(); }, offline = () => setOffline(true);
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') void navigator.serviceWorker.register('/sw.js');
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [load, syncQueue]);
  const execute = async (action: () => Promise<void>, message = '') => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); if (message) setNotice(message); }
    catch (error) { setError(error instanceof Error ? error.message : 'Không hoàn tất được.'); }
    finally { setBusy(false); }
  };
  const closeModal = useCallback(() => { setModal(null); setError(''); }, []);
  const openModal = (value: Exclude<ModalState, null>) => { setError(''); setModal(value); };
  const activePlants = state?.plants.filter(p => !p.archivedAt) ?? [];
  const currentDay = today();
  const plantStats = useMemo(() => new Map(state?.plants.map(p => {
    const history = waterDates(p.id, state.events, currentDay), interval = baseline(history, 'history');
    const last = history.at(-1) ?? null;
    return [p.id, { history, interval, last, average: history.length > 1 ? diffDays(history.at(-1)!, history[0]) / (history.length - 1) : null, daysSince: last ? diffDays(currentDay, last) : null, due: last && interval ? addDays(last, interval) : null }];
  }) ?? []), [state, currentDay]);
  const plan = state?.plans.find(p => p.id === selectedPlan) ?? state?.plans[0];
  const due = activePlants.filter(p => { const stats = plantStats.get(p.id); return !stats?.due || stats.due <= currentDay; });
  const todayTasks = plan?.visits.find(v => v.date === currentDay)?.tasks ?? [];
  const record = (ids?: string[], action: SessionInput['action'] = 'watered') => { const chosen = ids ?? state?.sessions.find(s => !s.undoneAt && s.action === action)?.plantIds ?? []; openModal({ type: 'record', ids: chosen.filter(id => activePlants.some(p => p.id === id && (action !== 'watered' || p.profile.growingMedium !== 'water'))), action }); };
  const saveSession = (input: SessionInput) => execute(async () => {
    if (!state) return;
    if (state.storage === 'demo') { cacheState(recordDemo(state, input)); }
    else {
      if (!navigator.onLine) {
        const existing = readLocal<SessionInput[]>(QUEUE, []);
        const next = existing.some(s => s.requestId === input.requestId) ? existing : [...existing, input];
        writeLocal(QUEUE, next);
        if (!readLocal<SessionInput[]>(QUEUE, []).some(s => s.requestId === input.requestId)) throw new Error('Thiết bị không lưu được hàng đợi. Giữ màn hình này và thử khi có mạng.');
        setQueue(next); setNotice('Đã lưu trên thiết bị, đang chờ đồng bộ.');
      } else {
        const result = await request('/api/sessions', 'POST', input);
        await load();
        if (result.undone) throw new Error('Buổi này đã được hoàn tác trước đó. Kiểm tra nhật ký; tạo một buổi mới nếu cần ghi nhận lại.');
      }
    }
    setModal(null);
    if (navigator.onLine || state.storage === 'demo') setNotice(`Đã ghi nhận ${input.plantIds.length} cây${state.storage === 'demo' ? ' trên thiết bị (xem thử)' : ''}.`);
  });
  const undo = (id: string) => execute(async () => { if (!state) return; if (state.storage === 'demo') cacheState(undoDemo(state, id)); else { await request('/api/sessions', 'DELETE', { id }); await load(); } }, 'Đã hoàn tác buổi chăm sóc.');
  const generate = (mode: Mode, start: string, ids: string[], weekdays: number[]) => execute(async () => {
    if (!state) return;
    let result: Plan;
    if (state.storage === 'demo') {
      if (mode === 'ai') throw new Error('Để chạy AI và lưu lịch thực, hãy cấu hình Neon, migration và OPENAI_API_KEY. Bạn có thể thử Theo lịch sử ngay.');
      const context = buildContext(state.garden, activePlants.filter(p => ids.includes(p.id)), state.events, start, mode, weekdays);
      result = makePlan(context, historyDecisions(context), mode, null, crypto.randomUUID());
      cacheState({ ...state, plans: [result, ...state.plans].slice(0, 10) });
    } else {
      if (queue.length) throw new Error('Đồng bộ các buổi chăm sóc đang chờ trước khi tạo lịch.');
      result = await request('/api/plans', 'POST', { requestId: crypto.randomUUID(), mode, start, plantIds: ids, weekdays });
      await load();
    }
    setSelectedPlan(result.id); setModal(null); setTab('calendar');
  }, 'Đã tạo lịch đề xuất 7 ngày.');
  const savePlant = (input: Plant) => execute(async () => {
    if (!state) return;
    const parsed = plantSchema.parse({ ...input, id: input.id || undefined });
    if (state.storage === 'demo') {
      if (state.plants.some(p => p.code === parsed.code && p.id !== input.id)) throw new Error('Mã cây đã tồn tại.');
      const p = { ...input, ...parsed, id: input.id || crypto.randomUUID() };
      cacheState({ ...state, plants: input.id ? state.plants.map(old => old.id === input.id ? p : old) : [...state.plants, p] });
    } else { await request('/api/plants', 'POST', parsed); await load(); }
    setModal(null);
  }, 'Đã lưu thông tin cây.');
  const archive = (p: Plant) => { if (!p.archivedAt && !confirm(`Lưu trữ ${p.name}? Lịch sử chăm sóc vẫn được giữ.`)) return; void execute(async () => {
    if (!state) return;
    if (state.storage === 'demo') cacheState({ ...state, plants: state.plants.map(old => old.id === p.id ? { ...old, archivedAt: p.archivedAt ? null : new Date().toISOString() } : old) });
    else { await request('/api/plants', 'DELETE', { id: p.id, restore: !!p.archivedAt }); await load(); }
    setModal(null);
  }, p.archivedAt ? 'Đã khôi phục cây.' : 'Đã lưu trữ cây.'); };
  const saveGroup = (group: Group) => execute(async () => {
    if (!state) return;
    const parsed = groupSchema.parse({ ...group, id: group.id || undefined });
    if (state.storage === 'demo') {
      if (state.groups.some(g => g.id !== group.id && g.name === parsed.name && g.kind === group.kind)) throw new Error('Tên nhóm đã tồn tại.');
      const next = { ...group, id: group.id || crypto.randomUUID() };
      cacheState({ ...state, groups: group.id ? state.groups.map(g => g.id === group.id ? next : g) : [...state.groups, next] });
    } else { await request('/api/groups', 'POST', parsed); await load(); }
    setModal(null);
  }, 'Đã lưu nhóm nhập nhanh.');
  const deleteGroup = (group: Group) => { if (!confirm(`Xóa nhóm ${group.name}? Các cây vẫn được giữ.`)) return; void execute(async () => {
    if (!state) return;
    if (state.storage === 'demo') cacheState({ ...state, groups: state.groups.filter(g => g.id !== group.id) });
    else { await request('/api/groups', 'DELETE', { id: group.id }); await load(); }
    setModal(null);
  }, 'Đã xóa nhóm.'); };
  if (!state) return <main className="loading-screen"><Leaf size={40}/><h1>GardenCare</h1>{error ? <><p className="error" role="alert">{error}</p><button className="button primary" onClick={() => void load()}>Thử tải lại</button><p className="muted">Hướng dẫn cấu hình database và đăng nhập nằm trong README của dự án.</p></> : <p className="muted">Đang mở khu vườn…</p>}</main>;
  const renderedPlants = state.plants.filter(p => (showArchived || !p.archivedAt) && (filter === 'all' || state.groups.find(g => g.id === filter)?.plantIds.includes(p.id)) && `${p.name} ${p.code}`.toLowerCase().includes(search.toLowerCase()));
  const changedSincePlan = !!plan && state.sessions.some(s => Math.max(Date.parse(s.createdAt ?? s.occurredAt ?? '1970-01-01'), Date.parse(s.undoneAt ?? '1970-01-01')) > Date.parse(plan.generatedAt));
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/" aria-label="GardenCare trang chủ"><span className="brand-icon"><Leaf size={23}/></span>GardenCare<span className="brand-dot">.</span></a><div className="garden-label"><span className="tiny-dot"/>{state.garden.locationName}</div><nav>{navItems.map(item => <button key={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}><item.icon size={20}/><span>{item.label}</span>{item.id === 'plants' && <small>{activePlants.length}</small>}</button>)}</nav><div className="sidebar-note"><Sprout size={28}/><p>Chăm một chút.<br/>Xanh thêm mỗi ngày.</p><span>Lịch đề xuất · Quyết định ở bạn</span></div></aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumb">VƯỜN CỦA TÔI <span>/</span> {navItems.find(i => i.id === tab)?.label.toUpperCase()}</div><div className="topbar-right"><span className="status-pill"><span className="tiny-dot"/>{offline ? 'Ngoại tuyến' : state.storage === 'demo' ? 'Xem thử' : 'Đã kết nối'}</span><span className="avatar">H</span></div></header>
    {state.storage === 'demo' && <div className="demo-banner"><Leaf size={17}/><span>Đang xem thử với dữ liệu Excel của bạn. Thay đổi chỉ lưu trên thiết bị này.</span><button onClick={() => setTab('settings')}>Kết nối Neon <ArrowRight size={14}/></button></div>}
    {offline && <div className="inline-banner"><WifiOff size={17}/>Mất kết nối. Bạn vẫn có thể ghi nhận chăm sóc để đồng bộ sau.</div>}
    {queue.length > 0 && <div className="inline-banner"><History size={17}/>{queue.length} buổi đang chờ đồng bộ.<button onClick={() => void syncQueue()}>Đồng bộ</button></div>}
    {error && !modal && <div className="feedback error" role="alert">{error}<button aria-label="Đóng thông báo lỗi" onClick={() => setError('')}><X size={16}/></button></div>}
    {notice && <div className="feedback success" role="status"><Check size={17}/>{notice}<button aria-label="Đóng thông báo" onClick={() => setNotice('')}><X size={16}/></button></div>}
    <div className="page-content">
    {tab === 'home' && <>
      <section className="hero"><div><p className="eyebrow">{labelDate(currentDay, { weekday: 'long', day: 'numeric', month: 'long' })} · AUCKLAND</p><h1>Một chút chăm sóc,<br/><em>một khu vườn xanh.</em></h1><p>Ghi nhận cả buổi tưới trong vài chạm.<br/>Để lịch sử và AI giúp bạn lên kế hoạch tuần tới.</p><button className="button cream" onClick={() => record(todayTasks.some(t => t.action === 'check_then_water') ? todayTasks.filter(t => t.action === 'check_then_water').map(t => t.plantId) : undefined)}><Droplets size={18}/>Ghi nhận vừa tưới<ArrowRight size={18}/></button></div><div className="hero-art" aria-hidden="true"><div className="art-orbit"/><div className="art-leaf leaf-one"/><div className="art-leaf leaf-two"/><div className="art-leaf leaf-three"/><div className="art-stem"/><div className="art-pot"/><span className="art-sun"/></div></section>
      <div className="stats-grid"><Stat label="Cây đang chăm" value={activePlants.length} detail="Một mục có thể gồm nhiều chậu" icon={<Sprout/>}/><Stat label="Cần kiểm tra" value={due.length} detail="Theo mốc lịch sử hiện có" icon={<Droplets/>}/><Stat label="Buổi đề xuất" value={plan?.stats.visitCount ?? '—'} detail={plan ? `${labelDate(plan.period.start)} – ${labelDate(plan.period.end)}` : 'Tạo lịch cho 7 ngày tới'} icon={<CalendarDays/>}/></div>
      <div className="home-columns"><section className="card"><div className="section-heading"><div><p className="eyebrow">ÍT THAO TÁC HƠN</p><h2>Ghi nhận nhanh</h2></div><button className="text-button" onClick={() => openModal({ type: 'group' })}><Plus size={16}/>Tạo nhóm</button></div><p className="muted">Chọn nhóm bạn vừa chăm, bỏ chọn những cây chưa tưới.</p><div className="quick-groups">{state.groups.filter(g => g.plantIds.some(id => activePlants.some(p => p.id === id))).map((g, i) => <button className="group-card" key={g.id} onClick={() => record(g.plantIds)}><span className={`group-symbol tone-${i % 3}`}><Sprout size={22}/></span><span><strong>{g.name}</strong><small>{g.plantIds.filter(id => activePlants.some(p => p.id === id)).length} mục cây</small></span><ChevronRight size={17}/></button>)}</div></section>
      <section className="card week-preview"><div className="section-heading"><div><p className="eyebrow">NHỊP CHĂM VƯỜN</p><h2>Tuần này</h2></div><CalendarDays size={21}/></div>{plan ? <><div className="mini-week">{Array.from({ length: 7 }, (_, i) => { const day = addDays(plan.period.start, i); const visit = plan.visits.find(v => v.date === day); return <div className={visit ? 'has-visit' : ''} key={day}><small>{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][(new Date(day).getUTCDay() + 6) % 7]}</small><strong>{Number(day.slice(-2))}</strong><span>{visit ? <Droplets size={12}/> : '·'}</span></div>; })}</div><p>{plan.stats.taskCount} lượt kiểm tra cho {plan.stats.plantCount} cây.</p><p className="muted">{plan.mode === 'ai' ? 'Có AI và dự báo thời tiết' : 'Dựa trên lịch sử tưới'}</p><button className="button secondary full" onClick={() => setTab('calendar')}>Xem lịch tưới<ArrowRight size={17}/></button></> : <div className="empty-small"><span className="empty-icon"><CalendarDays size={30}/></span><h3>Lên lịch cho khu vườn</h3><p className="muted">Chọn theo lịch sử hoặc để AI cân nhắc thêm thời tiết và đặc tính cây.</p><button className="button primary full" onClick={() => openModal({ type: 'generate' })}><Plus size={17}/>Tạo lịch đề xuất</button></div>}<p className="footnote">Luôn kiểm tra đất hoặc nước trước khi chăm cây.</p></section></div>
      <section className="card"><div className="section-heading"><div><p className="eyebrow">THEO DÕI HÔM NAY</p><h2>Cây cần bạn ghé thăm</h2></div><button className="text-button" onClick={() => setTab('plants')}>Tất cả cây<ArrowRight size={16}/></button></div>{due.length ? <div className="due-list">{due.slice(0, 6).map(p => <button key={p.id} className="due-row" onClick={() => openModal({ type: 'plant', plant: p })}><span className="plant-avatar"><Sprout size={21}/></span><span className="row-text"><strong>{p.name}</strong><small>{p.positionLabel ?? 'Chưa rõ vị trí'} · {plantStats.get(p.id)?.last ? `Gần nhất ${labelDate(plantStats.get(p.id)!.last!)}` : 'Chưa có lịch sử'}</small></span><span className="tag amber">Kiểm tra</span></button>)}</div> : <p className="muted">Chưa có cây đến mốc kiểm tra theo lịch sử.</p>}</section>
    </>}
    {tab === 'calendar' && <><PageHeading eyebrow="KẾ HOẠCH 7 NGÀY" title="Lịch tưới đề xuất" subtitle="Gom các lượt chăm cây trong giới hạn phù hợp." action={<button className="button primary" onClick={() => openModal({ type: 'generate' })}><Plus size={17}/>Tạo lịch mới</button>}/>{plan ? <>
      <div className="plan-toolbar"><select aria-label="Chọn lịch đã tạo" value={plan.id} onChange={e => setSelectedPlan(e.target.value)}>{state.plans.map(p => <option key={p.id} value={p.id}>{labelDate(p.period.start)} – {labelDate(p.period.end)} · {p.mode === 'ai' ? 'AI Agent' : 'Theo lịch sử'} · {new Date(p.generatedAt).toLocaleTimeString('vi-VN', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' })}</option>)}</select><button className="button secondary" onClick={() => download(plan)}><ArrowDownToLine size={17}/>Tải JSON</button></div>
      <div className="plan-summary card"><span className={`tag ${plan.mode === 'ai' ? 'purple' : 'green'}`}>{plan.mode === 'ai' ? <Sparkles size={14}/> : <History size={14}/>} {plan.mode === 'ai' ? 'AI Agent' : 'Theo lịch sử'}</span><h2>{plan.stats.visitCount} buổi · {plan.stats.plantCount} cây</h2><p>{plan.summary}</p><small className="muted">Tạo lúc {new Date(plan.generatedAt).toLocaleString('vi-VN', { timeZone: 'Pacific/Auckland' })} · Giờ Auckland</small>{plan.agent && <small className="usage">{plan.agent.model} · {plan.agent.turns} lượt · {plan.agent.inputTokens.toLocaleString()} token vào / {plan.agent.outputTokens.toLocaleString()} token ra</small>}</div>
      {changedSincePlan && <div className="inline-banner">Bạn đã có ghi nhận mới sau khi tạo lịch. Hãy tạo lại lịch để cập nhật.</div>}
      <p className="week-hint muted">Mỗi cột là một ngày. Cuộn ngang để xem trọn tuần trên màn hình nhỏ.</p><div className="week-scroll" role="region" aria-label="Lịch tưới trong 7 ngày" tabIndex={0}><div className="week-grid">{Array.from({ length: 7 }, (_, i) => { const day = addDays(plan.period.start, i), visit = plan.visits.find(v => v.date === day), weather = plan.weather?.days.find(w => w.date === day); return <section className={`week-day ${visit ? '' : 'week-rest'} ${day === currentDay ? 'week-today' : ''}`} key={day}><div className="day-date"><small>{labelDate(day, { weekday: 'short' })}</small><strong>{Number(day.slice(-2))}</strong><span>Tháng {Number(day.slice(5, 7))}</span>{day === currentDay && <span className="today-dot">Hôm nay</span>}</div><div className="day-content"><div className="day-heading"><h3>{visit ? `${visit.tasks.length} cây cần kiểm tra` : 'Chưa có lượt đề xuất'}</h3>{weather && <span className="weather"><CloudRain size={15}/>{weather.rainMm} mm · {weather.maxTemp}°C</span>}</div>{visit?.tasks.map(task => <div className="task" key={task.id}><strong>{task.name}</strong></div>)}{visit && day <= currentDay && <div className="day-actions"><button className="button secondary" onClick={() => record(visit.tasks.filter(t => t.action === 'check_then_water').map(t => t.plantId))}><Droplets size={16}/>Ghi nhận đã tưới</button><button className="text-button" onClick={() => record(visit.tasks.map(t => t.plantId), 'checked')}>Ghi nhận kiểm tra</button></div>}</div></section>; })}</div></div>
      {plan.reviews.length > 0 && <details className="card review-box"><summary>{plan.reviews.length} thông tin cần kiểm tra thêm</summary>{plan.reviews.map((r, i) => <p key={i}><strong>{state.plants.find(p => p.id === r.plantId)?.code}</strong> · {r.message}</p>)}</details>}
    </> : <Empty icon={<CalendarDays size={34}/>} title="Chưa có lịch tưới" text="Tạo lịch theo lịch sử không tốn token; AI sẽ cân nhắc thêm thời tiết và hồ sơ cây." action={<button className="button primary" onClick={() => openModal({ type: 'generate' })}>Tạo lịch đầu tiên<ArrowRight size={17}/></button>}/>}</>}
    {tab === 'plants' && <><PageHeading eyebrow="TỪNG CÂY, TỪNG CHÚT" title="Cây của tôi" subtitle={`${activePlants.length} mục cây · Thông tin và lịch sử chăm sóc ở cùng một nơi.`} action={<button className="button primary" onClick={() => openModal({ type: 'plant', plant: blankPlant(`P${String(Math.max(0, ...state.plants.map(p => Number(p.code.replace(/^P/, '')) || 0)) + 1).padStart(3, '0')}`) })}><Plus size={17}/>Thêm cây</button>}/>
      <div className="plant-controls"><div className="search-box"><Search size={18}/><input aria-label="Tìm cây" placeholder="Tìm tên hoặc mã cây…" value={search} onChange={e => setSearch(e.target.value)}/></div><select aria-label="Lọc nhóm cây" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Tất cả nhóm</option>{state.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select><label className="inline-check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}/>Cả cây lưu trữ</label></div>
      <div className="plant-view-toolbar"><div className="view-switch" role="group" aria-label="Kiểu xem cây"><button aria-pressed={plantView === 'table'} onClick={() => setPlantView('table')}><List size={16}/>Dạng bảng</button><button aria-pressed={plantView === 'cards'} onClick={() => setPlantView('cards')}><LayoutGrid size={16}/>Dạng thẻ</button></div><small className="muted">{renderedPlants.length} cây · Đỏ: đã quá ngày dự kiến</small></div>
      {plantView === 'table' && <><div className="plant-table-scroll" role="region" aria-label="Bảng theo dõi tưới cây" tabIndex={0}><table className="plant-table"><thead><tr><th scope="col">ID</th><th scope="col">Tên cây</th><th scope="col">Trung bình số ngày<br/>tưới 1 lần</th><th scope="col">Số ngày từ<br/>lần tưới gần nhất</th><th scope="col">Dự kiến ngày<br/>tiếp theo</th></tr></thead><tbody>{renderedPlants.map(p => {
        const stats = plantStats.get(p.id)!, overdue = !p.archivedAt && !!stats.due && stats.due < currentDay;
        return <tr key={p.id} className={p.archivedAt ? 'archived' : overdue ? 'plant-overdue' : ''}><td className="plant-code">{p.code}</td><td><button className="plant-name-button" onClick={() => openModal({ type: 'plant', plant: p })}>{p.name}</button>{p.archivedAt && <small className="table-status">Đã lưu trữ</small>}</td><td className="number-cell">{stats.average === null ? '—' : stats.average.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</td><td className="number-cell">{stats.daysSince ?? '—'}</td><td className="date-cell">{stats.due ? labelDate(stats.due, { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Chưa đủ lịch sử'}{overdue && <small className="table-status">Quá hạn {diffDays(currentDay, stats.due!)} ngày</small>}{stats.due === currentDay && !p.archivedAt && <small className="table-status">Đến ngày hôm nay</small>}</td></tr>;
      })}</tbody></table></div><p className="table-note muted">Ngày dự kiến = ngày tưới gần nhất + khoảng tưới trung bình làm tròn đến ngày. Nhấn tên cây để xem và chỉnh sửa. Cây có dưới 2 lần tưới chưa có ngày dự kiến.</p></>}
      {plantView === 'cards' && <div className="plants-grid">{renderedPlants.map((p, i) => { const stats = plantStats.get(p.id)!; return <button className={`plant-card ${p.archivedAt ? 'archived' : stats.due && stats.due < currentDay ? 'plant-overdue' : ''}`} key={p.id} onClick={() => openModal({ type: 'plant', plant: p })}><div className={`plant-card-art tone-${i % 3}`}><span>{p.name.match(/^[\p{Extended_Pictographic}\uFE0F]+/u)?.[0] ?? '🌿'}</span><small>{p.code}</small></div><div className="plant-card-body"><span className="tag neutral">{p.archivedAt ? 'Đã lưu trữ' : p.positionLabel ?? 'Chưa rõ vị trí'}</span><h3>{p.name.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '')}</h3><div className="plant-card-meta"><Droplets size={15}/><span>{stats.last ? `Gần nhất ${labelDate(stats.last)}` : 'Chưa ghi nhận tưới'}</span></div><div className="plant-card-footer"><span>{stats.due ? `Mốc kế tiếp ${labelDate(stats.due)}` : 'Cần thêm lịch sử'}</span><ChevronRight size={15}/></div></div></button>; })}</div>}{!renderedPlants.length && <p className="muted">Không có cây phù hợp bộ lọc.</p>}</>}
    {tab === 'history' && <><PageHeading eyebrow="CHĂM SÓC ĐÃ THỰC HIỆN" title="Nhật ký khu vườn" subtitle="Mỗi buổi chăm sóc, một lần ghi nhận." action={<button className="button primary" onClick={() => record()}><Plus size={17}/>Ghi nhận</button>}/>
      <section className="card"><div className="section-heading"><h2>Buổi chăm sóc gần đây</h2><span className="tag neutral">{state.sessions.length} buổi</span></div>{state.sessions.length ? state.sessions.map(s => <div className={`session-row ${s.undoneAt ? 'undone' : ''}`} key={s.id}><span className="plant-avatar"><Droplets size={20}/></span><div className="row-text"><strong>{actionNames[s.action]} · {s.plantIds.length} cây</strong><small>{labelDate(s.occurredOn, { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })}{s.undoneAt ? ' · Đã hoàn tác' : ''}</small><p>{s.plantIds.map(id => state.plants.find(p => p.id === id)?.code).join(', ')}{s.notes ? ` · ${s.notes}` : ''}</p></div>{!s.undoneAt && <button className="text-button" disabled={busy || offline} onClick={() => void undo(s.id)}><Undo2 size={16}/>Hoàn tác</button>}</div>) : <p className="muted">Sau lần ghi nhận đầu tiên, buổi chăm sóc sẽ hiện ở đây.</p>}</section>
      <section className="card"><div className="section-heading"><h2>Lịch sử của từng cây</h2><span className="tag neutral">{state.events.filter(e => !e.voidedAt).length} bản ghi</span></div><PlantHistory state={state}/></section>
    </>}
    {tab === 'settings' && <><PageHeading eyebrow="THEO CÁCH BẠN CHĂM VƯỜN" title="Thiết lập" subtitle="Tạo nhóm quen thuộc và cập nhật thông tin vườn."/>
      <section className="card"><div className="section-heading"><h2>Thông tin vườn</h2><span className="tag green">Pacific/Auckland</span></div><GardenForm state={state} busy={busy} onSave={input => void execute(async () => { const parsed = gardenSchema.parse(input); if (state.storage === 'demo') cacheState({ ...state, garden: { ...state.garden, ...parsed } }); else { await request('/api/garden', 'POST', parsed); await load(); } }, 'Đã lưu thông tin vườn.')}/></section>
      <section className="card"><div className="section-heading"><h2>Nhóm nhập nhanh</h2><button className="button secondary" onClick={() => openModal({ type: 'group' })}><Plus size={16}/>Thêm nhóm</button></div><p className="muted">Gom theo lối đi hoặc vị trí bạn thường tưới cùng nhau. Một cây có thể ở nhiều nhóm.</p>{state.groups.map(g => <button key={g.id} className="group-edit-row" onClick={() => openModal({ type: 'group', group: g })}><span><strong>{g.name}</strong><small>{g.plantIds.length} cây · {g.kind === 'spreadsheet_category' ? 'Nhóm từ Excel' : 'Nhóm nhập nhanh'}</small></span><ChevronRight size={18}/></button>)}</section>
      <section className="card"><div className="section-heading"><h2>Dữ liệu & thiết bị</h2><span className="tag neutral">{state.storage === 'demo' ? 'Xem thử' : 'Neon PostgreSQL'}</span></div>{state.storage === 'demo' ? <><p>App đã sẵn sàng kết nối Neon. Cấu hình <code>DATABASE_URL</code>, <code>APP_PASSWORD</code> và <code>SESSION_SECRET</code> trên máy hoặc Vercel, sau đó chạy migration và import theo README.</p><p className="muted">Thay đổi trong chế độ xem thử không tự chuyển sang Neon. Dữ liệu Excel gốc được import bằng lệnh seed.</p><button className="button secondary" onClick={() => { if (confirm('Xóa thay đổi xem thử trên thiết bị và tải lại dữ liệu Excel gốc?')) { localStorage.removeItem(DEMO); localStorage.removeItem(CACHE); location.reload(); } }}>Đặt lại dữ liệu xem thử</button></> : <p>Đã kết nối database. OPENAI_API_KEY được cấu hình trên server; chế độ Theo lịch sử không cần key.</p>}
      <p className="muted">Trên điện thoại, chọn “Thêm vào màn hình chính” trong trình duyệt để mở app nhanh hơn.</p>{queue.length > 0 && <div className="pending-list"><h3>Đang chờ đồng bộ</h3>{queue.map(item => <div key={item.requestId}><span>{labelDate(item.occurredOn)} · {actionNames[item.action]} · {item.plantIds.length} cây</span><button className="text-button" onClick={() => { if (!confirm('Bỏ bản ghi chưa đồng bộ này?')) return; const next = queue.filter(s => s.requestId !== item.requestId); setQueue(next); writeLocal(QUEUE, next); }}>Bỏ bản ghi</button></div>)}<button className="button secondary" onClick={() => void syncQueue()}>Thử đồng bộ lại</button></div>}
      {state.storage === 'neon' && <button className="button secondary" onClick={() => void execute(async () => { if (queue.length) throw new Error('Đồng bộ hoặc xử lý các bản ghi đang chờ trước khi đăng xuất.'); await request('/api/logout', 'POST'); localStorage.removeItem(CACHE); location.assign('/login'); })}><LogOut size={16}/>Đăng xuất</button>}</section>
    </>}
    <footer className="page-footer"><Leaf size={15}/>GardenCare · Chăm cây theo dữ liệu, kiểm tra theo thực tế.<span>Giờ vườn: Auckland</span></footer>
    </div></main>
    {modal && <Modal title={modal.type === 'record' ? 'Ghi nhận chăm sóc' : modal.type === 'generate' ? 'Tạo lịch đề xuất' : modal.type === 'plant' ? (modal.plant.id ? 'Thông tin cây' : 'Thêm cây mới') : 'Nhóm nhập nhanh'} subtitle={modal.type === 'record' ? 'Chọn các cây bạn đã thực sự chăm sóc.' : modal.type === 'generate' ? 'Chọn cách đề xuất, ngày bắt đầu và các cây cần lên lịch.' : undefined} onClose={busy ? () => {} : closeModal}>
      {error && <div className="feedback error" role="alert">{error}</div>}
      {modal.type === 'record' && <RecordForm state={state} ids={modal.ids} action={modal.action ?? 'watered'} busy={busy} onSave={saveSession}/>}
      {modal.type === 'generate' && <GenerateForm state={state} busy={busy} onGenerate={generate}/>}
      {modal.type === 'plant' && <PlantForm plant={modal.plant} state={state} busy={busy} onSave={savePlant} onArchive={() => archive(modal.plant)}/>}
      {modal.type === 'group' && <GroupForm group={modal.group} state={state} busy={busy} onSave={saveGroup} onDelete={() => modal.group && deleteGroup(modal.group)}/>}
    </Modal>}
  </div>;
}
function Stat({ label, value, detail, icon }: { label: string; value: number | string; detail: string; icon: React.ReactNode }) { return <div className="stat card"><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div><span>{icon}</span></div>; }
function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{subtitle}</p></div>{action}</div>; }
function Empty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action: React.ReactNode }) { return <div className="card empty"><span className="empty-icon">{icon}</span><h2>{title}</h2><p className="muted">{text}</p>{action}</div>; }
function RecordForm({ state, ids, action: initialAction, busy, onSave }: { state: AppState; ids: string[]; action: SessionInput['action']; busy: boolean; onSave: (input: SessionInput) => void }) {
  const [selected, setSelected] = useState(ids), [action, setAction] = useState(initialAction), [day, setDay] = useState(today()), [notes, setNotes] = useState(''), [moisture, setMoisture] = useState<SessionInput['moisture']>('unknown'), [search, setSearch] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const active = state.plants.filter(p => !p.archivedAt);
  const eligible = active.filter(p => action === 'watered' ? p.profile.growingMedium !== 'water' : ['water_changed', 'water_topped_up'].includes(action) ? p.profile.growingMedium === 'water' : true);
  const choose = (ids: string[]) => setSelected(ids.filter(id => eligible.some(p => p.id === id)));
  const toggleGroup = (ids: string[]) => { const available = ids.filter(id => eligible.some(p => p.id === id)); setSelected(available.every(id => selected.includes(id)) ? selected.filter(id => !available.includes(id)) : [...new Set([...selected, ...available])]); };
  return <form onSubmit={e => { e.preventDefault(); onSave({ requestId, occurredOn: day, action, plantIds: selected, moisture, notes }); }}><div className="modal-body"><div className="form-grid"><label>Ngày chăm sóc<input type="date" required max={today()} value={day} onChange={e => setDay(e.target.value)}/></label><label>Đã làm gì?<select value={action} onChange={e => { const next = e.target.value as SessionInput['action']; setAction(next); setSelected(selected.filter(id => active.some(p => p.id === id && (next === 'watered' ? p.profile.growingMedium !== 'water' : ['water_changed', 'water_topped_up'].includes(next) ? p.profile.growingMedium === 'water' : true)))); }}>{Object.entries(actionNames).filter(([key]) => key !== 'legacy_water_care').map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div><div className="chips"><button type="button" className="chip" onClick={() => setDay(today())}>Hôm nay</button><button type="button" className="chip" onClick={() => setDay(addDays(today(), -1))}>Hôm qua</button>{state.sessions.find(s => !s.undoneAt) && <button type="button" className="chip" onClick={() => choose(state.sessions.find(s => !s.undoneAt)!.plantIds)}>Giống buổi trước</button>}</div>
    <div className="group-chips">{state.groups.filter(g => g.plantIds.some(id => eligible.some(p => p.id === id))).map(g => <button type="button" className={`chip ${g.plantIds.filter(id => eligible.some(p => p.id === id)).every(id => selected.includes(id)) ? 'chip-selected' : ''}`} key={g.id} onClick={() => toggleGroup(g.plantIds)}>{g.name}</button>)}</div><div className="selection-toolbar"><div className="search-box"><Search size={16}/><input aria-label="Tìm cây để ghi nhận" placeholder="Tìm cây…" value={search} onChange={e => setSearch(e.target.value)}/></div><button type="button" className="text-button" onClick={() => setSelected(selected.length === eligible.length ? [] : eligible.map(p => p.id))}>{selected.length === eligible.length ? 'Bỏ chọn' : 'Chọn tất cả'}</button></div><ToggleList plants={eligible} selected={selected} setSelected={setSelected} events={state.events} search={search}/>
    <details className="extra-details"><summary>Thêm ghi chú hoặc tình trạng đất (không bắt buộc)</summary><label>Tình trạng quan sát<select value={moisture} onChange={e => setMoisture(e.target.value as SessionInput['moisture'])}><option value="unknown">Không ghi nhận</option><option value="dry">Khô</option><option value="moist">Ẩm</option><option value="wet">Ướt</option></select></label><small className="muted">Áp dụng cho tất cả cây đã chọn. Nếu tình trạng khác nhau, ghi thành buổi riêng.</small><label>Ghi chú<textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ví dụ: tưới bằng vòi, đất còn ẩm ở góc râm…"/></label></details></div><div className="modal-footer"><small>{selected.length} cây đã chọn · Giờ Auckland</small><button className="button primary" disabled={busy || !selected.length}>{busy ? <LoaderCircle className="spin" size={18}/> : <CheckCheck size={18}/>}{busy ? 'Đang lưu…' : `Lưu ${action === 'watered' ? 'đã tưới' : actionNames[action].toLowerCase()} ${selected.length} cây`}</button></div></form>;
}
function GenerateForm({ state, busy, onGenerate }: { state: AppState; busy: boolean; onGenerate: (mode: Mode, start: string, ids: string[], weekdays: number[]) => void }) {
  const active = state.plants.filter(p => !p.archivedAt);
  const [mode, setMode] = useState<Mode>('history'), [start, setStart] = useState(today()), [selected, setSelected] = useState(active.map(p => p.id)), [weekdays, setWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  return <form onSubmit={e => { e.preventDefault(); onGenerate(mode, start, selected, weekdays); }}><div className="modal-body"><div className="mode-options"><button type="button" aria-pressed={mode === 'history'} className={`mode-card ${mode === 'history' ? 'chosen' : ''}`} onClick={() => setMode('history')}><History size={23}/><strong>Theo lịch sử</strong><p>Khoảng tưới trung bình. Không gọi AI, không dùng thời tiết.</p><span>Không tốn token</span></button><button type="button" aria-pressed={mode === 'ai'} className={`mode-card ai ${mode === 'ai' ? 'chosen' : ''}`} onClick={() => setMode('ai')}><Sparkles size={23}/><strong>Dùng AI Agent</strong><p>Lịch sử + đặc tính cây + thời tiết. Cân nhắc và gom các buổi chăm sóc.</p><span>Sử dụng OpenAI API</span></button></div><label>Bắt đầu từ ngày<input type="date" required min={today()} max={mode === 'ai' ? addDays(today(), 9) : addDays(today(), 90)} value={start} onChange={e => setStart(e.target.value)}/></label><p className="muted">{validDate(start) ? `Lịch từ ${labelDate(start)} đến ${labelDate(addDays(start, 6))}. Các lần chăm sau giả định lần trước đã thực hiện.` : 'Chọn ngày bắt đầu để tạo lịch.'}</p><details className="extra-details"><summary>Ngày có thể vào vườn</summary><div className="chips">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((day, i) => <label className="weekday-check" key={day}><input type="checkbox" checked={weekdays.includes(i)} onChange={() => setWeekdays(weekdays.includes(i) ? weekdays.filter(d => d !== i) : [...weekdays, i])}/>{day}</label>)}</div></details><div className="selection-toolbar"><strong>{selected.length} cây đã chọn</strong><div className="chips"><button type="button" className="text-button" onClick={() => setSelected(active.filter(p => ['P022', 'P023', 'P024', 'P025', 'P026', 'P027'].includes(p.code)).map(p => p.id))}>6 cây ban đầu</button><button type="button" className="text-button" onClick={() => setSelected(selected.length === active.length ? [] : active.map(p => p.id))}>{selected.length === active.length ? 'Bỏ chọn' : 'Tất cả'}</button></div></div><ToggleList plants={active} selected={selected} setSelected={setSelected} events={state.events}/>{mode === 'ai' && state.storage === 'demo' && <p className="inline-banner">AI cần kết nối Neon và API key. Bạn có thể thử chế độ Theo lịch sử trước.</p>}</div><div className="modal-footer"><small>{mode === 'ai' ? 'AI có thể mất vài phút. Giữ màn hình này mở.' : 'Tính lịch trực tiếp từ dữ liệu đã ghi.'}</small><button className="button primary" disabled={busy || !selected.length || !weekdays.length || !validDate(start)}>{busy ? <LoaderCircle size={17} className="spin"/> : mode === 'ai' ? <Sparkles size={17}/> : <CalendarDays size={17}/>} {busy ? 'Đang tạo lịch…' : 'Tạo lịch 7 ngày'}</button></div></form>;
}
function PlantForm({ plant, state, busy, onSave, onArchive }: { plant: Plant; state: AppState; busy: boolean; onSave: (p: Plant) => void; onArchive: () => void }) {
  const [value, setValue] = useState(plant), [sources, setSources] = useState(plant.profile.sources.join('\n'));
  const field = (key: keyof Plant, label: string, multiline = false) => <label>{label}{multiline ? <textarea maxLength={2000} value={String(value[key] ?? '')} onChange={e => setValue({ ...value, [key]: e.target.value })}/> : <input maxLength={1000} value={String(value[key] ?? '')} onChange={e => setValue({ ...value, [key]: e.target.value })}/>}</label>;
  const history = state.events.filter(e => e.plantId === plant.id && !e.voidedAt).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  return <form onSubmit={e => { e.preventDefault(); onSave({ ...value, profile: { ...value.profile, sources: sources.split('\n').map(s => s.trim()).filter(Boolean) } }); }}><div className="modal-body"><div className="form-grid">{field('code', 'Mã cây')}{field('name', 'Tên cây')}</div><div className="form-grid">{field('positionLabel', 'Vị trí / Indoor, Outdoor')}{field('statusLabel', 'Trạng thái')}</div>{field('wateringGuidance', 'Điều kiện chăm sóc / Khi nào tưới', true)}<div className="form-grid">{field('moisturePreference', 'Nhu cầu ẩm')}{field('lightPreference', 'Ánh sáng')}</div>{field('naturalHabitat', 'Môi trường tự nhiên', true)}<details className="extra-details" open><summary>Hồ sơ để AI sử dụng</summary><div className="form-grid"><label>Môi trường trồng<select value={value.profile.growingMedium} onChange={e => setValue({ ...value, profile: { ...value.profile, growingMedium: e.target.value as Plant['profile']['growingMedium'] } })}><option value="unknown">Chưa xác nhận</option><option value="soil">Đất / giá thể</option><option value="water">Thủy sinh</option></select></label><label>Mức nhận mưa<select value={value.profile.rainExposure} onChange={e => setValue({ ...value, profile: { ...value.profile, rainExposure: e.target.value as Plant['profile']['rainExposure'] } })}><option value="unknown">Chưa xác nhận</option><option value="none">Không nhận mưa</option><option value="partial">Nhận một phần</option><option value="full">Nhận mưa trực tiếp</option></select></label><label>Kích thước chậu (lít, nếu biết)<input type="number" min="0.1" max="10000" step="0.1" value={value.profile.potSizeLitres ?? ''} onChange={e => setValue({ ...value, profile: { ...value.profile, potSizeLitres: e.target.value ? Number(e.target.value) : null } })}/></label><label>Giai đoạn sinh trưởng<input maxLength={100} value={value.profile.growthStage} onChange={e => setValue({ ...value, profile: { ...value.profile, growthStage: e.target.value } })}/></label></div><label>Ghi chú đặc tính<textarea maxLength={2000} value={value.profile.careNotes} onChange={e => setValue({ ...value, profile: { ...value.profile, careNotes: e.target.value } })}/></label><label>Nguồn tham khảo (mỗi dòng một URL)<textarea value={sources} onChange={e => setSources(e.target.value)}/></label><label className="inline-check"><input type="checkbox" checked={value.profile.maxEarlyDays === 1} onChange={e => setValue({ ...value, profile: { ...value.profile, maxEarlyDays: e.target.checked ? 1 : 0 } })}/>Cho phép gom sớm tối đa một ngày</label><label className="inline-check"><input type="checkbox" checked={value.profile.maxRainDelayDays === 1} onChange={e => setValue({ ...value, profile: { ...value.profile, maxRainDelayDays: e.target.checked ? 1 : 0 } })}/>Cho phép kiểm tra muộn một ngày khi dự báo mưa (chỉ khi nhận mưa trực tiếp)</label></details>{plant.id && <details className="extra-details"><summary>Lịch sử chăm sóc · {history.length} bản ghi</summary><div className="plant-history-list">{history.map(e => <div key={e.id}><span>{labelDate(e.occurredOn, { day: 'numeric', month: 'numeric', year: 'numeric' })}</span><span>{actionNames[e.action]}</span></div>)}</div></details>}</div><div className="modal-footer">{plant.id ? <button type="button" className="text-button danger" disabled={busy} onClick={onArchive}>{plant.archivedAt ? 'Khôi phục cây' : 'Lưu trữ cây'}</button> : <small>Thông tin chưa rõ có thể để trống.</small>}<button className="button primary" disabled={busy || !value.name.trim() || !value.code.trim()}><Check size={17}/>{busy ? 'Đang lưu…' : 'Lưu thông tin'}</button></div></form>;
}
function GroupForm({ group, state, busy, onSave, onDelete }: { group?: Group; state: AppState; busy: boolean; onSave: (g: Group) => void; onDelete: () => void }) {
  const [name, setName] = useState(group?.name ?? ''), [selected, setSelected] = useState((group?.plantIds ?? []).filter(id => state.plants.some(p => p.id === id && !p.archivedAt)));
  return <form onSubmit={e => { e.preventDefault(); onSave({ id: group?.id ?? '', name, kind: group?.kind ?? 'quick_entry', plantIds: selected }); }}><div className="modal-body"><label>Tên nhóm<input required maxLength={150} value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Rau cạnh hàng rào"/></label><p className="muted">Chọn cây bạn thường chăm trong cùng một buổi.</p><ToggleList plants={state.plants.filter(p => !p.archivedAt)} selected={selected} setSelected={setSelected} events={state.events}/></div><div className="modal-footer">{group ? <button type="button" className="text-button danger" disabled={busy} onClick={onDelete}>Xóa nhóm</button> : <small>{selected.length} cây đã chọn</small>}<button className="button primary" disabled={busy || !name.trim()}><Check size={17}/>Lưu nhóm</button></div></form>;
}
function PlantHistory({ state }: { state: AppState }) {
  const [id, setId] = useState(state.plants[0]?.id ?? '');
  const events = state.events.filter(e => e.plantId === id && !e.voidedAt).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  return <><select aria-label="Chọn cây xem lịch sử" value={id} onChange={e => setId(e.target.value)}>{state.plants.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><div className="plant-history-list">{events.map(e => <div key={e.id}><strong>{labelDate(e.occurredOn, { day: 'numeric', month: 'numeric', year: 'numeric' })}</strong><span>{actionNames[e.action]}{e.moisture !== 'unknown' ? ` · ${e.moisture === 'dry' ? 'Khô' : e.moisture === 'moist' ? 'Ẩm' : 'Ướt'}` : ''}</span>{e.notes && <small>{e.notes}</small>}</div>)}</div>{!events.length && <p className="muted">Chưa có bản ghi chăm sóc.</p>}</>;
}
function GardenForm({ state, busy, onSave }: { state: AppState; busy: boolean; onSave: (input: unknown) => void }) {
  const [value, setValue] = useState(state.garden), [latitude, setLatitude] = useState(String(state.garden.latitude)), [longitude, setLongitude] = useState(String(state.garden.longitude));
  return <form onSubmit={e => { e.preventDefault(); onSave({ ...value, latitude: Number(latitude), longitude: Number(longitude) }); }}><div className="form-grid"><label>Tên vườn<input required value={value.name} onChange={e => setValue({ ...value, name: e.target.value })}/></label><label>Khu vực<input required value={value.locationName} onChange={e => setValue({ ...value, locationName: e.target.value })}/></label><label>Vĩ độ<input type="number" required step="any" min="-90" max="90" value={latitude} onChange={e => setLatitude(e.target.value)}/></label><label>Kinh độ<input type="number" required step="any" min="-180" max="180" value={longitude} onChange={e => setLongitude(e.target.value)}/></label></div><p className="muted">Tọa độ hiện tại gần Panmure. Dùng tọa độ vườn để dự báo phù hợp hơn.</p><button className="button secondary" disabled={busy}><Check size={16}/>Lưu thông tin vườn</button></form>;
}
