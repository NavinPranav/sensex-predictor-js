'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useStomp } from './hooks/useStomp';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/** Hardcoded market list; only Bank Nifty is active until backend supports more. */
const MARKET_INSTRUMENTS = [
  { id: 'BANKNIFTY', name: 'Bank Nifty', symbol: 'BANKNIFTY', exchange: 'NSE', enabled: true },
  { id: 'NIFTY', name: 'Nifty 50', symbol: 'NIFTY 50', exchange: 'NSE', enabled: false },
  { id: 'SENSEX', name: 'S&P BSE Sensex', symbol: 'SENSEX', exchange: 'BSE', enabled: false },
  { id: 'FINNIFTY', name: 'Nifty Fin Service', symbol: 'FINNIFTY', exchange: 'NSE', enabled: false },
  { id: 'MIDCPNIFTY', name: 'Nifty Midcap Select', symbol: 'MIDCPNIFTY', exchange: 'NSE', enabled: false },
  { id: 'BANKEX', name: 'S&P BSE Bankex', symbol: 'BANKEX', exchange: 'BSE', enabled: false },
];

// ── IST helpers ──
function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function getMarketSession() {
  const t = nowIST();
  const hm = t.getHours() * 100 + t.getMinutes();
  if (hm < 915) return 'pre-market';
  if (hm >= 1530) return 'closed';
  if (hm >= 1500) return 'approaching-close';
  return 'open';
}

function minutesToClose() {
  const t = nowIST();
  const closeMs = new Date(t).setHours(15, 30, 0, 0);
  return Math.max(0, Math.floor((closeMs - t) / 60000));
}

function fmtINR(v) {
  if (v == null) return '—';
  return '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSecs(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s ago`;
}

// ── Styles ──
const styles = {
  page: { minHeight: '100vh', background: '#f1f5f9' },
  center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  card: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' },
  input: { width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  btnPrimary: { width: '100%', padding: '12px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnOutline: { padding: '6px 14px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#666' },
  label: { display: 'block', fontSize: 12, color: '#888', marginBottom: 4 },
  error: { background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
};

// ── API Client ──
const api = {
  token: null,
  async login(email, password) {
    const res = await fetch(API + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error('Invalid email or password');
    const data = await res.json();
    this.token = data.accessToken;
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', data.accessToken);
      localStorage.setItem('user', JSON.stringify({ name: data.name, email: data.email, role: data.role || 'USER' }));
    }
    return data;
  },
  /** Authoritative name/email/role from DB (JWT does not carry role). */
  async fetchMe() {
    const res = await fetch(API + '/api/auth/me', {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) throw new Error('Failed to load profile');
    return res.json();
  },
  async register(name, email, password) {
    const res = await fetch(API + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || 'Registration failed'); }
    const data = await res.json();
    this.token = data.accessToken;
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', data.accessToken);
      localStorage.setItem('user', JSON.stringify({ name: data.name, email: data.email, role: data.role || 'USER' }));
    }
    return data;
  },
  async predict(horizon) {
    const res = await fetch(API + '/api/predictions/latest?horizon=' + horizon, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) throw new Error('Failed to fetch prediction');
    return res.json();
  },
  async getOhlcv(period, interval) {
    const res = await fetch(`${API}/api/market/sensex/ohlcv?period=${period}&interval=${interval}`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) return [];
    return res.json();
  },
  async getHistory(page, size, scope = 'all', filters = {}) {
    const horizons = filters.horizons ?? [];
    const signals = filters.signals ?? [];
    const sortTime = filters.sortTime === 'asc' ? 'asc' : 'desc';
    const params = new URLSearchParams({ page: page ?? 0, size: size ?? 20, sortTime });
    if (scope && scope !== 'all') params.set('scope', scope);
    horizons.forEach((h) => params.append('horizons', h));
    signals.forEach((s) => params.append('signals', s));
    const res = await fetch(`${API}/api/predictions/history?${params}`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) return { predictions: [], total: 0, totalPages: 0, summary: null };
    return res.json();
  },
  async getActivePrompt() {
    const res = await fetch(`${API}/api/admin/prompts/active`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (!res.ok) return null;
    return res.json();
  },
  async getPromptHistory(page, size, label) {
    const params = new URLSearchParams({ page: page ?? 0, size: size ?? 10 });
    const q = label != null && String(label).trim() !== '' ? String(label).trim() : '';
    if (q) params.set('label', q);
    const res = await fetch(`${API}/api/admin/prompts?${params}`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (!res.ok) return { prompts: [], totalElements: 0, totalPages: 0 };
    return res.json();
  },
  async savePrompt(label, promptText) {
    const res = await fetch(`${API}/api/admin/prompts`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, prompt_text: promptText }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Failed to save prompt'); }
    return res.json();
  },
  async analysePredictions(predictionIds) {
    const res = await fetch(`${API}/api/predictions/analyse`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ predictionIds }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('SESSION_EXPIRED');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Analysis failed');
    }
    return res.json();
  },
  async getDailyAnalysis() {
    const res = await fetch(`${API}/api/predictions/daily-analysis/latest`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401 || res.status === 403) throw new Error('SESSION_EXPIRED');
    if (res.status === 204) return null;
    if (!res.ok) return null;
    return res.json();
  },
  async markDailyAnalysisRead(id) {
    await fetch(`${API}/api/predictions/daily-analysis/${id}/read`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token },
    }).catch(() => {});
  },
  async getAiTools() {
    const res = await fetch(`${API}/api/admin/ai-tools`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (!res.ok) return [];
    return res.json();
  },
  async activateAiModel(id) {
    const res = await fetch(`${API}/api/admin/ai-models/${id}/activate`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Failed to activate model'); }
    return res.json();
  },
  async getNewsSentiment() {
    const res = await fetch(`${API}/api/news/sentiment`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (!res.ok) return { overall: 'UNAVAILABLE', score: 0, article_count: 0, bullish_count: 0, bearish_count: 0, neutral_count: 0, top_headlines: [] };
    return res.json();
  },
  async getChecklistWeight() {
    const res = await fetch(`${API}/api/admin/checklist-weight`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (!res.ok) return { weight: 40, remaining: 60 };
    return res.json();
  },
  async setChecklistWeight(weight) {
    const res = await fetch(`${API}/api/admin/checklist-weight`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Failed to save weight'); }
    return res.json();
  },
  async getPredictionPolicy() {
    const res = await fetch(`${API}/api/admin/prediction-policy`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (!res.ok) return null;
    return res.json();
  },
  async setPredictionPolicy(payload) {
    const res = await fetch(`${API}/api/admin/prediction-policy`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const d = err.detail;
      const detailMsg = Array.isArray(d) ? d.map((x) => (typeof x === 'string' ? x : x.msg || JSON.stringify(x))).join('; ') : d;
      throw new Error(err.error || detailMsg || 'Failed to save prediction policy');
    }
    return res.json();
  },
  async resetPredictionPolicy() {
    const res = await fetch(`${API}/api/admin/prediction-policy`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to reset prediction policy');
    }
    return res.json();
  },
  async getMyRiskSettings() {
    const res = await fetch(`${API}/api/me/risk-settings`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401 || res.status === 403) throw new Error('SESSION_EXPIRED');
    if (!res.ok) return null;
    return res.json();
  },
  async updateMyRiskSettings(body) {
    const res = await fetch(`${API}/api/me/risk-settings`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) throw new Error('SESSION_EXPIRED');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to save risk settings');
    }
    return res.json();
  },
  async listAdminUsers(page, size) {
    const params = new URLSearchParams({ page: page ?? 0, size: size ?? 50 });
    const res = await fetch(`${API}/api/admin/users?${params}`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) return { users: [] };
    return res.json();
  },
  async updateUserRole(userId, role) {
    const res = await fetch(`${API}/api/admin/users/${userId}/role`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to update role');
    }
    return res.json();
  },
  logout() {
    this.token = null;
    if (typeof window !== 'undefined') { localStorage.removeItem('token'); localStorage.removeItem('user'); }
  },
  init() {
    if (typeof window === 'undefined') return null;
    this.token = localStorage.getItem('token');
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  },
};

// ── Live price field extractor ──
function extractLiveFields(livePrice) {
  if (!livePrice) return null;
  const pick = (...keys) => { for (const k of keys) if (livePrice[k] != null) return livePrice[k]; return null; };
  const ltp = pick('ltp', 'lastTradedPrice', 'last_traded_price', 'lastPrice');
  const open = pick('open', 'openPrice', 'open_price_of_the_day');
  const high = pick('high', 'highPrice', 'high_price_of_the_day');
  const low = pick('low', 'lowPrice', 'low_price_of_the_day');
  const close = pick('close', 'closePrice', 'close_price');
  const volume = pick('volume', 'volumeTradeForTheDay', 'volume_trade_for_the_day', 'totalTradedVolume');
  let change = pick('change', 'netChange', 'net_change');
  let changePct = pick('changePercent', 'percentChange', 'pChange', 'netChangePercent', 'changePct');
  if (change == null && ltp != null && close != null) change = ltp - close;
  if (changePct == null && change != null && close) changePct = (change / close) * 100;
  return { ltp, open, high, low, close, volume, change: change ?? 0, changePct: changePct ?? 0 };
}

// ── Convert OHLCV bar array to lightweight-charts format ──
function toChartCandles(rows) {
  if (!rows?.length) return [];
  const seen = new Set();
  return rows
    .map(r => {
      if (!r.timestamp) return null;
      let ts;
      try {
        ts = Math.floor(new Date(r.timestamp).getTime() / 1000);
      } catch { return null; }
      if (!ts || seen.has(ts)) return null;
      seen.add(ts);
      return {
        time: ts,
        open: Number(r.open), high: Number(r.high),
        low: Number(r.low), close: Number(r.close),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

// ── Login ──
function Login({ onLogin }) {
  const [isReg, setIsReg] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(''); setLoading(true);
    try {
      const data = isReg ? await api.register(name, email, pass) : await api.login(email, pass);
      onLogin({ name: data.name, email: data.email, role: data.role || 'USER' });
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div style={styles.center}>
      <div className="login-shell">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Bank Nifty Intraday</h1>
          <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>AI-assisted intra-day prediction</p>
        </div>
        <div style={{ ...styles.card, padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 16px' }}>{isReg ? 'Create account' : 'Sign in'}</h2>
          {error && <div style={styles.error}>{error}</div>}
          {isReg && (
            <div style={{ marginBottom: 12 }}>
              <label style={styles.label}>Name</label>
              <input style={styles.input} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={styles.label}>Email</label>
            <input style={styles.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={styles.label}>Password</label>
            <input style={styles.input} type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Min 8 characters" />
          </div>
          <button style={{ ...styles.btnPrimary, opacity: loading ? 0.6 : 1 }} onClick={submit} disabled={loading}>
            {loading ? 'Please wait...' : isReg ? 'Create account' : 'Sign in'}
          </button>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button onClick={() => { setIsReg(!isReg); setError(''); }}
              style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer' }}>
              {isReg ? 'Already have an account? Sign in' : "Don't have an account? Register"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Market session badge ──
function SessionBadge({ session, minutesToCloseVal }) {
  const cfg = {
    'open': { label: 'Market Open', bg: '#f0fdf4', color: '#16a34a', dot: '#22c55e' },
    'approaching-close': { label: `Close in ${minutesToCloseVal}m`, bg: '#fff7ed', color: '#c2410c', dot: '#f97316' },
    'pre-market': { label: 'Pre-Market', bg: '#eff6ff', color: '#1d4ed8', dot: '#3b82f6' },
    'closed': { label: 'Market Closed', bg: '#f9fafb', color: '#6b7280', dot: '#9ca3af' },
  }[session] ?? { label: session, bg: '#f9fafb', color: '#6b7280', dot: '#9ca3af' };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: cfg.bg, border: `1px solid ${cfg.dot}30` }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot, display: 'inline-block', animation: session === 'open' ? 'pulse 2s infinite' : 'none' }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, letterSpacing: 0.3 }}>{cfg.label}</span>
    </div>
  );
}

// ── Square-off warning banner ──
function SquareOffBanner({ minutesToCloseVal }) {
  if (minutesToCloseVal > 30 || minutesToCloseVal <= 0) return null;
  return (
    <div style={{ background: '#fef2f2', borderTop: '2px solid #ef4444', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 16 }}>⚠️</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#dc2626' }}>
        Square-off in {minutesToCloseVal} min — close all intra-day positions before 3:20 PM IST to avoid forced exit at market price.
      </span>
    </div>
  );
}

// ── Live price banner ──
function LiveBanner({ livePrice, connected, connectionError }) {
  const f = extractLiveFields(livePrice);
  if (!f) {
    const msg = !connected
      ? (connectionError ? `Bank Nifty — ${connectionError}` : 'Bank Nifty — connect to stream live')
      : 'Bank Nifty — waiting for first tick…';
    return <div className="live-stream-banner live-stream-banner--muted">{msg}</div>;
  }
  const { ltp, change, changePct } = f;
  const isUp = change >= 0;
  const changeColor = isUp ? '#4ade80' : '#f87171';
  return (
    <div className="live-stream-banner live-stream-banner--live">
      <span className="live-stream-banner__ltp">{fmtINR(ltp)}</span>
      <span className="live-stream-banner__chg" style={{ color: changeColor }}>
        {isUp ? '▲' : '▼'} {isUp ? '+' : ''}{Number(change).toFixed(2)}
        <span style={{ opacity: 0.9, marginLeft: 6 }}>({isUp ? '+' : ''}{Number(changePct).toFixed(2)}%)</span>
      </span>
    </div>
  );
}

// ── Session stats strip ──
function SessionStats({ livePrice }) {
  if (!livePrice) return null;
  const f = extractLiveFields(livePrice);
  if (!f) return null;
  const { open, high, low, volume } = f;
  return (
    <div className="session-ticker">
      <div style={{ fontSize: 11, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Bank Nifty · session</div>
      <div className="session-ticker__grid">
        {[['Open', open], ['High', high], ['Low', low], ['Volume', volume]].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: '#f8fafc' }}>
              {label === 'Volume' ? (val != null ? Number(val).toLocaleString('en-IN') : '—') : fmtINR(val)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Unix seconds for chart time comparison (lightweight-charts may use number UTCTimestamp). */
function chartTimeToUnixSeconds(t) {
  if (t == null) return null;
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  return null;
}

// ── Candlestick chart (lightweight-charts) ──
function CandlestickChart({ candles, liveCandle, signal }) {
  const fullscreenRootRef = useRef(null);
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const candlesRef = useRef(candles);
  const liveCandleRef = useRef(liveCandle);
  const signalRef = useRef(signal);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  candlesRef.current = candles;
  liveCandleRef.current = liveCandle;
  signalRef.current = signal;

  const toggleChartFullscreen = useCallback(async () => {
    const el = fullscreenRootRef.current;
    if (!el || typeof document === 'undefined') return;
    try {
      const doc = document;
      const inFs = doc.fullscreenElement === el || doc.webkitFullscreenElement === el;
      if (inFs) {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
    } catch {
      /* unsupported or blocked */
    }
  }, []);

  useEffect(() => {
    const syncFs = () => {
      const root = fullscreenRootRef.current;
      const active =
        root &&
        (document.fullscreenElement === root || document.webkitFullscreenElement === root);
      setIsChartFullscreen(!!active);
      requestAnimationFrame(() => {
        if (containerRef.current && chartRef.current) {
          const w = containerRef.current.clientWidth;
          const h = Math.max(containerRef.current.clientHeight, 1);
          chartRef.current.applyOptions({ width: w, height: h });
        }
      });
    };
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);
    return () => {
      document.removeEventListener('fullscreenchange', syncFs);
      document.removeEventListener('webkitfullscreenchange', syncFs);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let ro;
    let disposed = false;

    import('lightweight-charts').then(({ createChart, CrosshairMode }) => {
      if (!containerRef.current || disposed) return;
      const initialH = Math.max(containerRef.current.clientHeight, 1);
      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: initialH || 220,
        layout: { background: { type: 'solid', color: '#0f172a' }, textColor: '#94a3b8' },
        grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: { borderColor: '#334155', timeVisible: true, secondsVisible: false },
        handleScroll: true,
        handleScale: true,
      });

      const series = chart.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      });

      chartRef.current = chart;
      seriesRef.current = series;

      ro = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          const w = containerRef.current.clientWidth;
          const h = Math.max(containerRef.current.clientHeight, 1);
          chartRef.current.applyOptions({ width: w, height: h });
        }
      });
      ro.observe(containerRef.current);

      // OHLCV often resolves before this dynamic import finishes; apply latest props immediately.
      const data = Array.isArray(candlesRef.current) ? candlesRef.current : [];
      series.setData(data);
      if (data.length) chart.timeScale().fitContent();

      const lc = liveCandleRef.current;
      if (lc) {
        const liveTs = chartTimeToUnixSeconds(lc.time);
        if (liveTs != null) {
          const lastTs = data.length ? chartTimeToUnixSeconds(data[data.length - 1].time) : null;
          if (lastTs == null || liveTs >= lastTs) {
            try {
              series.update(lc);
            } catch {
              /* ignore race with setData */
            }
          }
        }
      }

      const sig = signalRef.current;
      const lastTime = data.length ? data[data.length - 1]?.time : null;
      const isBuy = sig === 'BUY';
      const isSell = sig === 'SELL';
      if (lastTime && (isBuy || isSell)) {
        series.setMarkers([{
          time: lastTime,
          position: isBuy ? 'belowBar' : 'aboveBar',
          color: isBuy ? '#22c55e' : '#ef4444',
          shape: isBuy ? 'arrowUp' : 'arrowDown',
          text: isBuy ? 'BUY' : 'SELL',
        }]);
      }
    });

    return () => {
      disposed = true;
      ro?.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Load historical candles (empty array clears series when horizon resets)
  useEffect(() => {
    if (!seriesRef.current) return;
    const data = Array.isArray(candles) ? candles : [];
    seriesRef.current.setData(data);
    if (data.length) chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Stream live candle updates — never pass a bar older than the last loaded OHLC bar (prevents LW error on horizon switch / duplicate tab clicks).
  useEffect(() => {
    if (!seriesRef.current || !liveCandle) return;
    const liveTs = chartTimeToUnixSeconds(liveCandle.time);
    if (liveTs == null) return;
    if (candles?.length) {
      const lastTs = chartTimeToUnixSeconds(candles[candles.length - 1].time);
      if (lastTs != null && liveTs < lastTs) return;
    }
    try {
      seriesRef.current.update(liveCandle);
    } catch {
      /* ignore race with setData */
    }
  }, [liveCandle, candles]);

  // Draw BUY/SELL signal markers
  useEffect(() => {
    if (!seriesRef.current || !signal || !candles?.length) return;
    const lastTime = candles[candles.length - 1]?.time;
    if (!lastTime) return;
    const isBuy = signal === 'BUY';
    const isSell = signal === 'SELL';
    if (!isBuy && !isSell) { seriesRef.current.setMarkers([]); return; }
    seriesRef.current.setMarkers([{
      time: lastTime,
      position: isBuy ? 'belowBar' : 'aboveBar',
      color: isBuy ? '#22c55e' : '#ef4444',
      shape: isBuy ? 'arrowUp' : 'arrowDown',
      text: isBuy ? 'BUY' : 'SELL',
    }]);
  }, [signal, candles]);

  return (
    <div
      ref={fullscreenRootRef}
      className="candlestick-chart-shell"
      style={{ ...styles.card, overflow: 'hidden', marginBottom: 0 }}
    >
      <div
        style={{
          padding: '10px 16px',
          background: '#0f172a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Bank Nifty · 5 min candles
        </span>
        <span style={{ fontSize: 10, color: '#475569', whiteSpace: 'nowrap' }}>live ticks streamed</span>
      </div>
      <div className="candlestick-chart__plot-wrap">
        <div ref={containerRef} className="candlestick-chart__plot" style={{ width: '100%', height: 220, background: '#0f172a' }} />
        <button
          type="button"
          onClick={toggleChartFullscreen}
          aria-label={isChartFullscreen ? 'Exit fullscreen chart' : 'Fullscreen chart'}
          title={isChartFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          className="candlestick-chart-shell__fs-btn candlestick-chart-shell__fs-btn--corner"
        >
          {isChartFullscreen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

/** Horizontal swipe: session OHLC (left) ↔ candlestick chart (right). Viewport height tracks the active slide only. */
function SessionChartCarousel({ livePrice, candles, liveCandle, signal }) {
  const vpRef = useRef(null);
  const slide0Ref = useRef(null);
  const slide1Ref = useRef(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [vpHeight, setVpHeight] = useState(null);

  const measureActiveSlide = useCallback(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const w = vp.clientWidth;
    if (w < 1) return;
    const idx = Math.min(1, Math.max(0, Math.round(vp.scrollLeft / w)));
    setSlideIdx(idx);
    // Height follows the visible slide only so a compact session strip shrinks the carousel (and page) instead of reserving chart height.
    const inner = idx === 0 ? slide0Ref.current : slide1Ref.current;
    const h = inner?.offsetHeight ?? 0;
    if (h > 0) setVpHeight(h);
  }, []);

  useLayoutEffect(() => {
    measureActiveSlide();
  }, [measureActiveSlide, livePrice, candles, liveCandle, signal]);

  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    vp.addEventListener('scroll', measureActiveSlide, { passive: true });
    vp.addEventListener('scrollend', measureActiveSlide);
    return () => {
      vp.removeEventListener('scroll', measureActiveSlide);
      vp.removeEventListener('scrollend', measureActiveSlide);
    };
  }, [measureActiveSlide]);

  useEffect(() => {
    const s0 = slide0Ref.current;
    const s1 = slide1Ref.current;
    const ro = new ResizeObserver(() => measureActiveSlide());
    if (s0) ro.observe(s0);
    if (s1) ro.observe(s1);
    return () => ro.disconnect();
  }, [measureActiveSlide, livePrice, candles, liveCandle, signal]);

  const goToSlide = useCallback((idx) => {
    const vp = vpRef.current;
    if (!vp) return;
    const w = vp.clientWidth;
    if (w < 1) return;
    vp.scrollTo({ left: idx * w, behavior: 'smooth' });
  }, []);

  return (
    <section className="session-chart-carousel" aria-label="Bank Nifty session and chart">
      <div className="session-chart-carousel__wrap">
        <div
          ref={vpRef}
          className="session-chart-carousel__viewport"
          style={vpHeight != null ? { height: vpHeight } : undefined}
        >
          <div className="session-chart-carousel__slide">
            <div ref={slide0Ref} className="session-chart-carousel__slide-inner">
              {livePrice ? (
                <SessionStats livePrice={livePrice} />
              ) : (
                <div className="session-ticker session-ticker--placeholder session-ticker--placeholder-carousel">
                  <div style={{ fontSize: 11, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5 }}>Bank Nifty · session</div>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 10 }}>Waiting for live ticks…</div>
                </div>
              )}
            </div>
          </div>
          <div className="session-chart-carousel__slide">
            <div ref={slide1Ref} className="session-chart-carousel__slide-inner">
              <CandlestickChart candles={candles} liveCandle={liveCandle} signal={signal} />
            </div>
          </div>
        </div>

        {slideIdx === 1 ? (
          <div className="session-chart-carousel__edge session-chart-carousel__edge--left">
            <button
              type="button"
              className="session-chart-carousel__arrow-btn"
              onClick={() => goToSlide(0)}
              aria-label="Show live market session data"
              title="Live session"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
        ) : null}
        {slideIdx === 0 ? (
          <div className="session-chart-carousel__edge session-chart-carousel__edge--right">
            <button
              type="button"
              className="session-chart-carousel__arrow-btn"
              onClick={() => goToSlide(1)}
              aria-label="Show candlestick chart"
              title="Chart"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
      <div className="session-chart-carousel__nav" aria-hidden="true">
        <span className={'session-chart-carousel__dot' + (slideIdx === 0 ? ' session-chart-carousel__dot--active' : '')} />
        <span className={'session-chart-carousel__dot' + (slideIdx === 1 ? ' session-chart-carousel__dot--active' : '')} />
      </div>
      <p className="session-chart-carousel__hint">Pan or zoom the chart in the center · Edge arrows or swipe to switch session ↔ chart</p>
    </section>
  );
}

// ── Trading levels card ──
function TradingLevels({ prediction, isBull, isBear }) {
  const entry = prediction?.entryPrice;
  const sl = prediction?.stopLoss;
  const tp = prediction?.targetPrice ?? prediction?.targetSensex;
  const rr = prediction?.riskReward;
  const validMin = prediction?.validMinutes;

  if (!entry && !sl && !tp) return null;

  const dir = prediction?.direction;
  const isAction = dir === 'BUY' || dir === 'SELL' || dir === 'BULLISH' || dir === 'BEARISH';
  const accentColor = isBull ? '#22c55e' : isBear ? '#ef4444' : '#94a3b8';

  return (
    <div style={{ padding: '16px 18px', borderTop: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
        Intraday Trade Levels
        {validMin && <span style={{ marginLeft: 8, fontWeight: 400, color: '#9ca3af' }}>valid ~{validMin} min</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {[
          { label: 'Entry', value: entry, color: '#2563eb' },
          { label: 'Stop Loss', value: sl, color: '#ef4444' },
          { label: 'Target', value: tp, color: '#22c55e' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px', border: `1px solid ${color}22` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color }}>{fmtINR(value)}</div>
          </div>
        ))}
      </div>

      {rr != null && isAction && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (Number(rr) / 4) * 100)}%`, height: '100%', background: Number(rr) >= 2 ? '#22c55e' : Number(rr) >= 1.5 ? '#f59e0b' : '#ef4444', borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: Number(rr) >= 2 ? '#16a34a' : Number(rr) >= 1.5 ? '#d97706' : '#dc2626', whiteSpace: 'nowrap' }}>
            R:R {Number(rr).toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Confidence bar ──
function ConfidenceBar({ confidence }) {
  const pct = Math.min(100, Math.max(0, Number(confidence || 0)));
  const color = pct >= 75 ? '#22c55e' : pct >= 65 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ padding: '12px 18px', borderTop: '1px solid #f3f4f6' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>AI Confidence</span>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
        {/* No-trade zone threshold line at 65% */}
        <div style={{ position: 'absolute', left: '65%', top: 0, bottom: 0, width: 2, background: '#94a3b8', opacity: 0.6 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3 }}>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>65% threshold</span>
      </div>
    </div>
  );
}

// ── Prediction staleness ──
function PredictionMeta({ prediction, isLive }) {
  const [age, setAge] = useState('');
  const ts = prediction?.predictionTimestampMs;

  useEffect(() => {
    if (!ts) { setAge(''); return; }
    const update = () => setAge(fmtSecs(Date.now() - ts));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [ts]);

  if (!prediction) return null;
  const validMin = prediction.validMinutes;
  const validUntil = ts && validMin ? new Date(ts + validMin * 60000) : null;
  const validUntilStr = validUntil
    ? validUntil.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div style={{ padding: '8px 18px', borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {isLive && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite', display: 'inline-block' }} />
            Live AI
          </span>
        )}
        {age && <span style={{ fontSize: 11, color: '#9ca3af' }}>{age}</span>}
      </div>
      {validUntilStr && (
        <span style={{ fontSize: 11, color: '#6b7280' }}>Valid until ~{validUntilStr} IST</span>
      )}
    </div>
  );
}

// ── AI reason ticker ──
function AiReasonTicker({ text, attached = false }) {
  const viewportRef = useRef(null);
  const segmentRef = useRef(null);
  const [mode, setMode] = useState('fit');
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduceMotion(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useLayoutEffect(() => {
    const v = viewportRef.current; const seg = segmentRef.current;
    if (!v || !seg || !text) { setMode('fit'); return; }
    const overflows = seg.scrollHeight > v.clientHeight + 6;
    setMode(overflows ? (reduceMotion ? 'reducedScroll' : 'scroll') : 'fit');
  }, [text, reduceMotion]);

  const duration = Math.min(88, Math.max(18, Math.round((text?.length || 0) / 11)));
  const vpClass = mode === 'reducedScroll'
    ? 'ai-reason-ticker__viewport ai-reason-ticker__viewport--reduced ai-reason-ticker__viewport--scroll'
    : 'ai-reason-ticker__viewport';

  const segment = (
    <div ref={segmentRef} className="ai-reason-ticker__segment">
      <p className="ai-reason-ticker__text">{text}</p>
    </div>
  );

  return (
    <div className={'ai-reason-ticker' + (attached ? ' ai-reason-ticker--attached' : '')} role="region" aria-label="Prediction rationale">
      <div className="ai-reason-ticker__head"><span className="ai-reason-ticker__dot" aria-hidden /> AI insight</div>
      <div ref={viewportRef} className={vpClass}>
        {mode === 'scroll' ? (
          <div className="ai-reason-ticker__track ai-reason-ticker__track--marquee" style={{ '--ai-reason-duration': `${duration}s` }}>
            {segment}
            <div className="ai-reason-ticker__segment" aria-hidden="true"><p className="ai-reason-ticker__text">{text}</p></div>
          </div>
        ) : mode === 'reducedScroll' ? segment : (
          <div className="ai-reason-ticker__track ai-reason-ticker__track--static">{segment}</div>
        )}
      </div>
    </div>
  );
}

// ── Profile menu ──
function ProfileMenu({ userName, onLogout, onOpenSettings }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDocMouse = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocMouse);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocMouse); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={wrapRef} className={'profile-menu' + (open ? ' profile-menu--open' : '')}>
      <div className="profile-menu__hover-zone">
        <button type="button" className="profile-menu__trigger" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label={`Account menu for ${userName}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        </button>
        <div className="profile-menu__name-pop" aria-hidden="true">{userName}</div>
      </div>
      {open && (
        <div className="profile-menu__dropdown" role="menu">
          <button
            type="button"
            className="profile-menu__settings"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings?.();
            }}
          >
            Settings
          </button>
          <div className="profile-menu__divider" aria-hidden="true" />
          <button type="button" className="profile-menu__signout" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}

// ── Prediction History Dialog ──
const OUTCOME_CFG = {
  TARGET_HIT:    { label: 'Target Hit', bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  STOP_LOSS_HIT: { label: 'SL Hit',     bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  EXPIRED:       { label: 'Expired',    bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  PENDING:       { label: 'Pending',    bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' },
};

/** Inline hourglass for pending outcome — matches pill height (~24px row padding). */
function OutcomePendingIcon({ color }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{ display: 'block', flexShrink: 0, color }}
    >
      <path
        d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.41L12 12l-4.41 4.42A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.41L12 12l4.41-4.42A2 2 0 0 0 17 6.17V2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Nested modal: read-only prediction rationale from history row */
function PredictionReasonDialog({ open, onClose, text, subtitle }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="prediction-reason-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="prediction-reason-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prediction-reason-dialog-title"
      >
        <div className="prediction-reason-dialog__header">
          <div className="prediction-reason-dialog__header-text">
            <h3 id="prediction-reason-dialog-title" className="prediction-reason-dialog__title">
              Prediction reason
            </h3>
            {subtitle ? (
              <p className="prediction-reason-dialog__meta">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="prediction-reason-dialog__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="prediction-reason-dialog__body">
          <div className="prediction-reason-dialog__content">{text || '—'}</div>
        </div>
      </div>
    </div>
  );
}

const HISTORY_HORIZON_OPTIONS = [
  { value: '5M', label: '5 Min' },
  { value: '15M', label: '15 Min' },
  { value: '30M', label: '30 Min' },
];

const HISTORY_SIGNAL_OPTIONS = [
  { value: 'BUY', label: 'Buy' },
  { value: 'SELL', label: 'Sell' },
  { value: 'HOLD', label: 'Hold' },
  { value: 'BULLISH', label: 'Bullish' },
  { value: 'BEARISH', label: 'Bearish' },
  { value: 'NEUTRAL', label: 'Neutral' },
];

const HISTORY_TABLE_COLUMNS = [
  'Horizon',
  'Signal',
  'Conf',
  'Entry',
  'Stop Loss',
  'Target',
  'R:R',
  'AI Tool',
  'AI Model',
  'Outcome',
  'Actual Close',
  'P&L',
  'Reason',
];

function sortHorizonKeys(arr) {
  const order = ['5M', '15M', '30M'];
  return [...arr].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function sortSignalKeys(arr) {
  const order = HISTORY_SIGNAL_OPTIONS.map((o) => o.value);
  return [...arr].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Gemini / API messages that indicate quota or rate limiting (for highlighted notice styling). */
function isGeminiRateLimitMessage(text) {
  const t = String(text || '').toLowerCase();
  return (
    t.includes('rate limit')
    || t.includes('429')
    || t.includes('quota')
    || t.includes('resource exhausted')
    || t.includes('too many requests')
  );
}

function PredictionHistoryDialog({ open, onClose, isAdmin }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [appliedHorizons, setAppliedHorizons] = useState([]);
  const [appliedSignals, setAppliedSignals] = useState([]);
  const [horizonDraft, setHorizonDraft] = useState([]);
  const [signalDraft, setSignalDraft] = useState([]);
  const [openPanel, setOpenPanel] = useState(null);
  const filterToolbarRef = useRef(null);
  const [page, setPage] = useState(0);
  /** Server-side order for prediction timestamp: desc = newest first, asc = oldest first */
  const [timeSort, setTimeSort] = useState('desc');
  const [reasonView, setReasonView] = useState(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  /** Prediction row ids the user chose for AI analysis (can span multiple pages). */
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const selectAllPageRef = useRef(null);
  const PAGE_SIZE = 20;

  /** Admins load platform-wide history; everyone else only their rows (matches backend). */
  const effectiveScope = isAdmin ? 'all' : 'mine';

  const toggleDraftValue = useCallback((setDraft, value, mode) => {
    setDraft((prev) => {
      const next = prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value];
      return mode === 'horizon' ? sortHorizonKeys(next) : sortSignalKeys(next);
    });
  }, []);

  const dismissAnalysisDialog = useCallback(() => {
    setAnalysis(null);
    setAnalysisError(null);
  }, []);

  useEffect(() => {
    if (!open) setReasonView(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setAnalysis(null);
      setAnalysisError(null);
      setAnalysing(false);
      setSelectedIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .getHistory(page, PAGE_SIZE, effectiveScope, {
        horizons: appliedHorizons,
        signals: appliedSignals,
        sortTime: timeSort,
      })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, appliedHorizons, appliedSignals, page, effectiveScope, timeSort]);

  useEffect(() => {
    if (!open || !openPanel) return;
    const onDown = (e) => {
      if (filterToolbarRef.current && !filterToolbarRef.current.contains(e.target)) {
        setOpenPanel(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, openPanel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const analysisDialogHasContent = analysis != null || analysisError != null;
      if (analysisDialogHasContent) {
        dismissAnalysisDialog();
        return;
      }
      if (openPanel) {
        setOpenPanel(null);
        return;
      }
      if (reasonView) {
        setReasonView(null);
      } else {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, openPanel, reasonView, analysis, analysisError, dismissAnalysisDialog]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const openHorizonPanel = useCallback(() => {
    setHorizonDraft(sortHorizonKeys(appliedHorizons));
    setOpenPanel((p) => (p === 'horizon' ? null : 'horizon'));
  }, [appliedHorizons]);

  const openSignalPanel = useCallback(() => {
    setSignalDraft(sortSignalKeys(appliedSignals));
    setOpenPanel((p) => (p === 'signal' ? null : 'signal'));
  }, [appliedSignals]);

  const clearHorizonDraft = useCallback(() => setHorizonDraft([]), []);
  const clearSignalDraft = useCallback(() => setSignalDraft([]), []);

  const toggleTimeSort = useCallback(() => {
    setTimeSort((s) => (s === 'desc' ? 'asc' : 'desc'));
    setPage(0);
    setAnalysis(null);
    setAnalysisError(null);
    setSelectedIds(new Set());
  }, []);

  const applyHorizonFilter = useCallback(() => {
    setAppliedHorizons(sortHorizonKeys(horizonDraft));
    setOpenPanel(null);
    setPage(0);
    setAnalysis(null);
    setAnalysisError(null);
    setSelectedIds(new Set());
  }, [horizonDraft]);

  const applySignalFilter = useCallback(() => {
    setAppliedSignals(sortSignalKeys(signalDraft));
    setOpenPanel(null);
    setPage(0);
    setAnalysis(null);
    setAnalysisError(null);
    setSelectedIds(new Set());
  }, [signalDraft]);

  const toggleRowSelected = useCallback((id) => {
    if (id == null) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const preds = data?.predictions || [];
      const pageIds = preds.map((p) => p.id).filter((x) => x != null);
      if (pageIds.length === 0) return prev;
      const next = new Set(prev);
      const allOnPageSelected = pageIds.every((id) => next.has(id));
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }, [data?.predictions]);

  const handleAnalyse = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setAnalysing(true);
    setAnalysis(null);
    setAnalysisError(null);
    try {
      const result = await api.analysePredictions(ids);
      if (result?.error) {
        setAnalysisError(result.error);
      } else {
        setAnalysis(result);
      }
    } catch (e) {
      setAnalysisError(e.message || 'Analysis failed');
    } finally {
      setAnalysing(false);
    }
  }, [selectedIds]);

  const pageIdList = useMemo(
    () => (data?.predictions || []).map((p) => p.id).filter((id) => id != null),
    [data?.predictions],
  );
  const allPageSelected = pageIdList.length > 0 && pageIdList.every((id) => selectedIds.has(id));
  const somePageSelected = pageIdList.some((id) => selectedIds.has(id));

  useEffect(() => {
    const el = selectAllPageRef.current;
    if (el) el.indeterminate = somePageSelected && !allPageSelected;
  }, [somePageSelected, allPageSelected]);

  /** Dialog opens only after the API returns (success or error). While loading, the table stays visible with a sweep indicator. */
  const analysisDialogVisible = analysis != null || analysisError != null;

  if (!open) return null;

  const summary = data?.summary;
  const predictions = data?.predictions || [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, data?.totalPages ?? 1);
  const showPager = !loading && total > 0 && totalPages > 1;

  return (
    <>
    <div className="prediction-history-overlay" onClick={onClose} role="presentation">
      <div
        className="prediction-history-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hist-dialog-title"
      >
      <header className="prediction-history-shell__header prediction-history-shell__header--centered">
        <h2 id="hist-dialog-title" className="prediction-history-shell__title prediction-history-shell__title--center">
          Prediction metrics
        </h2>
        <button
          type="button"
          className="prediction-history-shell__close prediction-history-shell__close--floating"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </header>

      {summary ? (
        <div className="prediction-history-shell__summary">
          {[
            { label: 'Total',      value: summary.total ?? 0,                                                              color: '#0f172a' },
            { label: 'Win Rate',   value: (summary.resolved ?? 0) > 0 ? `${summary.winRatePct ?? 0}%` : '—',              color: Number(summary.winRatePct) >= 50 ? '#16a34a' : '#dc2626' },
            { label: 'Avg Conf',   value: summary.avgConfidence != null ? `${summary.avgConfidence}%` : '—',              color: '#2563eb' },
            { label: 'Avg R:R',    value: summary.avgRiskReward != null ? Number(summary.avgRiskReward).toFixed(2) : '—', color: '#6b7280' },
          ].map(({ label, value, color }) => (
            <div key={label} className="prediction-history-shell__summary-card">
              <div className="prediction-history-shell__summary-label">{label}</div>
              <div className="prediction-history-shell__summary-value" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="prediction-history-shell__table-scroll">
        <div className="prediction-history-shell__table-head-sticky">
          <div className="prediction-history-shell__table-toolbar" ref={filterToolbarRef}>
          <div className="prediction-history-shell__filter-dropdown">
            <button
              type="button"
              className={
                'prediction-history-shell__filter-trigger' +
                (openPanel === 'horizon' ? ' prediction-history-shell__filter-trigger--open' : '') +
                (appliedHorizons.length > 0 ? ' prediction-history-shell__filter-trigger--active' : '')
              }
              onClick={openHorizonPanel}
              aria-expanded={openPanel === 'horizon'}
              aria-haspopup="true"
            >
              Horizon
              {appliedHorizons.length > 0 ? (
                <span className="prediction-history-shell__filter-trigger-badge">{appliedHorizons.length}</span>
              ) : null}
            </button>
            {openPanel === 'horizon' ? (
              <div className="prediction-history-shell__filter-panel" role="dialog" aria-label="Horizon filter">
                <ul className="prediction-history-shell__filter-checklist">
                  {HISTORY_HORIZON_OPTIONS.map(({ value, label }) => (
                    <li key={value}>
                      <label className="prediction-history-shell__filter-check-label">
                        <input
                          type="checkbox"
                          checked={horizonDraft.includes(value)}
                          onChange={() => toggleDraftValue(setHorizonDraft, value, 'horizon')}
                        />
                        <span>{label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="prediction-history-shell__filter-panel-actions">
                  <button type="button" className="prediction-history-shell__filter-panel-btn" onClick={clearHorizonDraft}>
                    Clear
                  </button>
                  <button
                    type="button"
                    className="prediction-history-shell__filter-panel-btn prediction-history-shell__filter-panel-btn--primary"
                    onClick={applyHorizonFilter}
                  >
                    Apply
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="prediction-history-shell__filter-dropdown">
            <button
              type="button"
              className={
                'prediction-history-shell__filter-trigger' +
                (openPanel === 'signal' ? ' prediction-history-shell__filter-trigger--open' : '') +
                (appliedSignals.length > 0 ? ' prediction-history-shell__filter-trigger--active' : '')
              }
              onClick={openSignalPanel}
              aria-expanded={openPanel === 'signal'}
              aria-haspopup="true"
            >
              Signal
              {appliedSignals.length > 0 ? (
                <span className="prediction-history-shell__filter-trigger-badge">{appliedSignals.length}</span>
              ) : null}
            </button>
            {openPanel === 'signal' ? (
              <div className="prediction-history-shell__filter-panel" role="dialog" aria-label="Signal filter">
                <ul className="prediction-history-shell__filter-checklist">
                  {HISTORY_SIGNAL_OPTIONS.map(({ value, label }) => (
                    <li key={value}>
                      <label className="prediction-history-shell__filter-check-label">
                        <input
                          type="checkbox"
                          checked={signalDraft.includes(value)}
                          onChange={() => toggleDraftValue(setSignalDraft, value, 'signal')}
                        />
                        <span>{label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="prediction-history-shell__filter-panel-actions">
                  <button type="button" className="prediction-history-shell__filter-panel-btn" onClick={clearSignalDraft}>
                    Clear
                  </button>
                  <button
                    type="button"
                    className="prediction-history-shell__filter-panel-btn prediction-history-shell__filter-panel-btn--primary"
                    onClick={applySignalFilter}
                  >
                    Apply
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        </div>
        <div
          className={
            'prediction-history-shell__table-body-wrap' +
            (analysing ? ' prediction-history-shell__table-body-wrap--analysing' : '')
          }
        >
          {analysing ? (
            <span className="sr-only" aria-live="polite">
              Analysis is running in the background.
            </span>
          ) : null}
          {loading ? (
            <div className="prediction-history-shell__center-msg">Loading predictions…</div>
          ) : predictions.length === 0 ? (
            <div className="prediction-history-shell__empty">
              <span style={{ fontSize: 28 }}>📭</span>
              <span style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '0 16px' }}>No predictions recorded yet. They appear here after WebSocket signals are received.</span>
            </div>
          ) : (
            <table className="prediction-history-shell__table">
              <thead>
                <tr className="prediction-history-shell__thead-row">
                  <th className="prediction-history-shell__th prediction-history-shell__th--select" scope="col">
                    <input
                      ref={selectAllPageRef}
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectAllOnPage}
                      aria-label="Select all predictions on this page"
                    />
                  </th>
                  <th
                    className="prediction-history-shell__th prediction-history-shell__th--sortable"
                    aria-sort={timeSort === 'desc' ? 'descending' : 'ascending'}
                    scope="col"
                  >
                    <button
                      type="button"
                      className="prediction-history-shell__sort-trigger"
                      onClick={toggleTimeSort}
                      title={timeSort === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'}
                      aria-label={
                        timeSort === 'desc'
                          ? 'Sorted by time newest first. Activate to sort oldest first.'
                          : 'Sorted by time oldest first. Activate to sort newest first.'
                      }
                    >
                      Time (IST)
                      <span className="prediction-history-shell__sort-arrow" aria-hidden>
                        {timeSort === 'desc' ? '↓' : '↑'}
                      </span>
                    </button>
                  </th>
                  {HISTORY_TABLE_COLUMNS.map((col) => (
                    <th key={col} className="prediction-history-shell__th">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {predictions.map((p, i) => {
                  const ts = p.predictionTimestamp ? new Date(p.predictionTimestamp) : null;
                  const timeStr = ts ? ts.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
                  const dir = p.direction || '—';
                  const isBuy = dir === 'BUY' || dir === 'BULLISH';
                  const isSell = dir === 'SELL' || dir === 'BEARISH';
                  const dirColor = isBuy ? '#16a34a' : isSell ? '#dc2626' : '#d97706';
                  const oc = OUTCOME_CFG[p.outcomeStatus] ?? OUTCOME_CFG.PENDING;
                  const pnl = p.actualPnlPct != null ? Number(p.actualPnlPct) : null;
                  const showPendingIcon = !p.outcomeStatus || p.outcomeStatus === 'PENDING';

                  const rowId = p.id;
                  const rowChecked = rowId != null && selectedIds.has(rowId);

                  return (
                    <tr key={p.id ?? i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td className="prediction-history-shell__td--select">
                        {rowId != null ? (
                          <input
                            type="checkbox"
                            checked={rowChecked}
                            onChange={() => toggleRowSelected(rowId)}
                            aria-label={`Select prediction ${rowId}`}
                          />
                        ) : null}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#475569', whiteSpace: 'nowrap' }}>{timeStr}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>{p.horizon}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: dirColor }}>{dir}</td>
                      <td style={{ padding: '8px 10px', color: '#475569' }}>{p.confidence != null ? `${Number(p.confidence).toFixed(0)}%` : '—'}</td>
                      <td style={{ padding: '8px 10px', color: '#2563eb', whiteSpace: 'nowrap' }}>{p.entryPrice != null ? fmtINR(p.entryPrice) : '—'}</td>
                      <td style={{ padding: '8px 10px', color: '#dc2626', whiteSpace: 'nowrap' }}>{p.stopLoss != null ? fmtINR(p.stopLoss) : '—'}</td>
                      <td style={{ padding: '8px 10px', color: '#16a34a', whiteSpace: 'nowrap' }}>{p.targetSensex != null ? fmtINR(p.targetSensex) : '—'}</td>
                      <td style={{ padding: '8px 10px', color: '#475569' }}>{p.riskReward != null ? Number(p.riskReward).toFixed(2) : '—'}</td>
                      <td style={{ padding: '8px 10px', color: '#475569', whiteSpace: 'nowrap' }}>{p.aiTool || '—'}</td>
                      <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {p.aiModel || '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                        <span
                          title="Pending"
                          aria-label="Pending"
                          style={{
                            padding: showPendingIcon ? '4px 10px' : '2px 8px',
                            borderRadius: 12,
                            fontSize: 10,
                            fontWeight: 700,
                            background: oc.bg,
                            color: oc.color,
                            border: `1px solid ${oc.border}`,
                            whiteSpace: 'nowrap',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            lineHeight: 1,
                          }}
                        >
                          {showPendingIcon ? <OutcomePendingIcon color={oc.color} /> : oc.label}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', color: '#475569', whiteSpace: 'nowrap' }}>{p.actualClosePrice != null ? fmtINR(p.actualClosePrice) : '—'}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap', color: pnl == null ? '#94a3b8' : pnl >= 0 ? '#16a34a' : '#dc2626' }}>
                        {pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                        {p.predictionReason && String(p.predictionReason).trim() ? (
                          <button
                            type="button"
                            className="prediction-reason-view-btn"
                            onClick={() =>
                              setReasonView({
                                text: String(p.predictionReason).trim(),
                                subtitle: `${timeStr} · ${p.horizon || '—'}`,
                              })
                            }
                          >
                            View
                          </button>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {analysing ? (
            <div className="prediction-history-shell__flashlight-overlay" aria-hidden="true">
              <div className="prediction-history-shell__flashlight-beam" />
            </div>
          ) : null}
        </div>
      </div>

      {!loading && predictions.length > 0 ? (
        <footer className="prediction-history-shell__footer prediction-history-shell__footer--split">
          <button
            type="button"
            className="prediction-history-analyse-btn"
            onClick={handleAnalyse}
            disabled={analysing || selectedIds.size === 0}
            aria-label="Analyse selected predictions with AI"
          >
            {analysing ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="analyse-spinner" aria-hidden="true" />
                Analysing…
              </span>
            ) : 'Analyse'}
          </button>

          {showPager ? (
            <nav className="prediction-history-shell__pager-stack" aria-label="Table pagination">
              <div className="prediction-history-shell__pager-arrows">
                <button
                  type="button"
                  className="prediction-history-shell__page-btn prediction-history-shell__page-btn--arrow"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="prediction-history-shell__page-btn prediction-history-shell__page-btn--arrow"
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  aria-label="Next page"
                >
                  ›
                </button>
              </div>
              <span className="prediction-history-shell__pager-caption" aria-live="polite">
                {page + 1} / {totalPages}
              </span>
            </nav>
          ) : null}
        </footer>
      ) : null}
      </div>
    </div>

    {analysisDialogVisible ? (
      <div className="prediction-analysis-overlay" onClick={dismissAnalysisDialog} role="presentation">
        <div
          className="prediction-analysis-dialog"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="prediction-analysis-dialog-title"
        >
          <header className="prediction-analysis-dialog__header">
            <h3 id="prediction-analysis-dialog-title" className="prediction-analysis-dialog__title">
              AI analysis
            </h3>
            <button
              type="button"
              className="prediction-analysis-dialog__close"
              onClick={dismissAnalysisDialog}
              aria-label="Close analysis"
            >
              ×
            </button>
          </header>
          <div className="prediction-analysis-dialog__body">
            {analysisError ? (
              <div
                className={
                  'prediction-analysis-dialog__notice' +
                  (isGeminiRateLimitMessage(analysisError)
                    ? ' prediction-analysis-dialog__notice--rate-limit'
                    : ' prediction-analysis-dialog__notice--error')
                }
                role="alert"
              >
                {analysisError}
              </div>
            ) : null}

            {analysis && !analysisError ? (
              <>
                {analysis.overall_assessment ? (
                  <div className="prediction-analysis-section">
                    <div className="prediction-analysis-section__label">Overall Assessment</div>
                    <p className="prediction-analysis-section__text">{analysis.overall_assessment}</p>
                  </div>
                ) : null}

                {analysis.what_went_wrong?.length > 0 ? (
                  <div className="prediction-analysis-section">
                    <div className="prediction-analysis-section__label prediction-analysis-section__label--red">What Went Wrong</div>
                    <ul className="prediction-analysis-list">
                      {analysis.what_went_wrong.map((item, i) => (
                        <li key={i} className="prediction-analysis-list__item prediction-analysis-list__item--red">{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {analysis.patterns?.length > 0 ? (
                  <div className="prediction-analysis-section">
                    <div className="prediction-analysis-section__label prediction-analysis-section__label--amber">Patterns Observed</div>
                    <ul className="prediction-analysis-list">
                      {analysis.patterns.map((item, i) => (
                        <li key={i} className="prediction-analysis-list__item prediction-analysis-list__item--amber">{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {analysis.what_can_improve?.length > 0 ? (
                  <div className="prediction-analysis-section">
                    <div className="prediction-analysis-section__label prediction-analysis-section__label--blue">What Can Improve</div>
                    <ul className="prediction-analysis-list">
                      {analysis.what_can_improve.map((item, i) => (
                        <li key={i} className="prediction-analysis-list__item prediction-analysis-list__item--blue">{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {analysis.recommendations?.length > 0 ? (
                  <div className="prediction-analysis-section">
                    <div className="prediction-analysis-section__label prediction-analysis-section__label--green">Recommendations</div>
                    <ul className="prediction-analysis-list">
                      {analysis.recommendations.map((item, i) => (
                        <li key={i} className="prediction-analysis-list__item prediction-analysis-list__item--green">{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {analysis.reason_quality?.length > 0 ? (
                  <div className="prediction-analysis-section">
                    <div className="prediction-analysis-section__label">Reason Quality</div>
                    <div className="prediction-analysis-reason-grid">
                      {analysis.reason_quality.map((rq, i) => (
                        <div key={i} className="prediction-analysis-reason-card">
                          <div className="prediction-analysis-reason-card__meta">
                            <span style={{ fontWeight: 600, color: '#0f172a', fontSize: 12 }}>ID {rq.id}</span>
                            <span
                              className="prediction-analysis-reason-card__score"
                              style={{ color: rq.quality_score >= 7 ? '#16a34a' : rq.quality_score >= 4 ? '#d97706' : '#dc2626' }}
                            >
                              {rq.quality_score}/10
                            </span>
                          </div>
                          <p className="prediction-analysis-reason-card__feedback">{rq.feedback}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    ) : null}

    <PredictionReasonDialog
      open={!!reasonView}
      onClose={() => setReasonView(null)}
      text={reasonView?.text ?? ''}
      subtitle={reasonView?.subtitle ?? ''}
    />
    </>
  );
}

const USER_ROLES = ['USER', 'PREMIUM', 'ADMIN'];

function AdminUsersSection({ currentEmail, onSelfRoleChanged, embedded }) {
  const [rows, setRows] = useState([]);
  const [pending, setPending] = useState({}); // id -> selected role before save
  const [savingId, setSavingId] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => {
    api.listAdminUsers(0, 100).then(d => {
      setRows(d.users || []);
    }).catch(() => setRows([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function applyRole(u) {
    const next = pending[u.id] ?? u.role;
    if (next === u.role) return;
    setSavingId(u.id);
    setMsg(null);
    try {
      const updated = await api.updateUserRole(u.id, next);
      setRows(list => list.map(x => (x.id === updated.id ? { ...x, role: updated.role } : x)));
      setPending(p => { const c = { ...p }; delete c[u.id]; return c; });
      if (updated.email === currentEmail && onSelfRoleChanged) onSelfRoleChanged(updated.role);
      setMsg({ type: 'ok', text: `Updated ${updated.email} to ${updated.role}.` });
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div style={embedded ? { marginTop: 0, paddingTop: 0 } : { marginTop: 24, borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: '#1e293b' }}>User roles</h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
        Grant <strong>ADMIN</strong> to another account after they have registered. You cannot remove the last admin.
        If you change your own role away from admin, refresh the page — admin-only sections will disappear.
      </p>
      {msg && (
        <p style={{ fontSize: 12, margin: '0 0 10px', color: msg.type === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.text}</p>
      )}
      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px', fontWeight: 600, color: '#475569' }}>Name</th>
              <th style={{ padding: '10px 12px', fontWeight: 600, color: '#475569' }}>Email</th>
              <th style={{ padding: '10px 12px', fontWeight: 600, color: '#475569' }}>Role</th>
              <th style={{ padding: '10px 12px', width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(u => {
              const sel = pending[u.id] ?? u.role;
              const dirty = sel !== u.role;
              return (
                <tr key={u.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', color: '#0f172a' }}>{u.name}</td>
                  <td style={{ padding: '10px 12px', color: '#64748b' }}>{u.email}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <select
                      value={sel}
                      onChange={e => setPending(p => ({ ...p, [u.id]: e.target.value }))}
                      style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13 }}
                    >
                      {USER_ROLES.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <button
                      type="button"
                      disabled={!dirty || savingId === u.id}
                      onClick={() => applyRole(u)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: 'none',
                        cursor: dirty && savingId !== u.id ? 'pointer' : 'not-allowed',
                        background: dirty && savingId !== u.id ? '#0f766e' : '#cbd5e1',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {savingId === u.id ? '…' : 'Apply'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p style={{ padding: 16, margin: 0, fontSize: 13, color: '#94a3b8' }}>No users loaded.</p>
        )}
      </div>
    </div>
  );
}

// ── Admin Prompt Management Section ──
const DEFAULT_PROMPT_HINT = `You are an expert intra-day Bank Nifty trader and options analyst.
Predict what Bank Nifty will do in the NEXT {target_minutes} MINUTES.

Respond with ONE JSON object only (no markdown fences), with EXACTLY these keys:
  direction, entry_price, stop_loss, target_price, risk_reward,
  confidence, magnitude, predicted_volatility, valid_minutes, reason

STRICT RULES:
  1. If confidence < 65 → direction = HOLD
  2. Risk-reward must be >= 1.5 for BUY or SELL; if not achievable, use HOLD.
  3. stop_loss is mandatory and must never equal entry_price or target_price.
  4. Output ONLY valid JSON — no extra text, no markdown.`;

function pickPromptText(p) {
  if (!p) return null;
  const t = p.promptText ?? p.prompt_text;
  return typeof t === 'string' && t.trim() ? t : null;
}

function formatPromptHistoryTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const tz = 'Asia/Kolkata';
  const datePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
  const timePart = new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);
  return `${datePart}, ${timePart}`;
}

/** Nested modal: read-only full prompt for one history row */
function PromptTextDetailDialog({ row, onClose, onUseInEditor }) {
  if (!row) return null;
  const text = pickPromptText(row) || '';
  const editor = row.createdBy ?? row.created_by ?? '—';
  const label = row.label ?? '—';
  const when = formatPromptHistoryTimestamp(row.createdAt ?? row.created_at);
  const isActivePrompt = row.isActive ?? row.is_active;

  return (
    <div className="prompt-detail-overlay" onClick={onClose} role="presentation">
      <div
        className="prompt-detail-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-detail-title"
      >
        <div className="prompt-detail-dialog__header">
          <div>
            <h3 id="prompt-detail-title" className="prompt-detail-dialog__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isActivePrompt ? (
                <span
                  title="Active prompt"
                  aria-label="Active prompt"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#16a34a',
                    flexShrink: 0,
                  }}
                />
              ) : null}
              <span>{label}</span>
            </h3>
            <p className="prompt-detail-dialog__meta">
              Editor: <strong style={{ color: '#334155' }}>{editor}</strong>
              {' · '}
              {when}
            </p>
          </div>
          <button
            type="button"
            className="prediction-history-shell__close"
            onClick={onClose}
            aria-label="Close prompt preview"
          >
            ×
          </button>
        </div>
        <div className="prompt-detail-dialog__body">
          <label htmlFor="prompt-detail-body" className="sr-only">
            Prompt text
          </label>
          <textarea
            id="prompt-detail-body"
            readOnly
            value={text}
            className="prompt-detail-dialog__textarea"
            spellCheck={false}
            aria-label="Full prompt text"
          />
          <div className="prompt-detail-dialog__actions">
            {typeof onUseInEditor === 'function' ? (
              <button
                type="button"
                className="prediction-history-shell__page-btn"
                onClick={() => onUseInEditor({ label, promptText: text, row })}
              >
                Use in editor
              </button>
            ) : null}
            <button type="button" className="prediction-history-shell__page-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PROMPT_HISTORY_PAGE_SIZE = 10;

function PromptHistoryDialog({ open, onClose, onUseInEditor }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [detailRow, setDetailRow] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedLabel, setDebouncedLabel] = useState('');
  const committedLabelRef = useRef('');

  useEffect(() => {
    if (!open) return;
    setPage(0);
    setDetailRow(null);
    setSearchInput('');
    setDebouncedLabel('');
    committedLabelRef.current = '';
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const trimmed = searchInput.trim();
      if (committedLabelRef.current === trimmed) return;
      committedLabelRef.current = trimmed;
      setDebouncedLabel(trimmed);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .getPromptHistory(page, PROMPT_HISTORY_PAGE_SIZE, debouncedLabel)
      .then(setData)
      .catch(() => setData({ prompts: [], totalElements: 0, totalPages: 0 }))
      .finally(() => setLoading(false));
  }, [open, page, debouncedLabel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (detailRow) setDetailRow(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, detailRow, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const prompts = data?.prompts ?? [];
  const totalElements = data?.totalElements ?? 0;
  const totalPages = Math.max(1, data?.totalPages ?? 1);

  function handleUseInEditor(payload) {
    if (typeof onUseInEditor === 'function') onUseInEditor(payload);
    setDetailRow(null);
    onClose();
  }

  return (
    <>
      <div className="prediction-history-overlay" onClick={onClose} role="presentation">
        <div
          className="prediction-history-dialog"
          style={{ maxWidth: 720 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-hist-dialog-title"
        >
          <header className="prediction-history-shell__header prediction-history-shell__header--centered">
            <h2 id="prompt-hist-dialog-title" className="prediction-history-shell__title prediction-history-shell__title--center">
              Prompt history
            </h2>
            <button
              type="button"
              className="prediction-history-shell__close prediction-history-shell__close--floating"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </header>

          <div className="prompt-history-toolbar" aria-label="Filter prompt history">
            <label className="prompt-history-search">
              <span className="prompt-history-search__icon" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path d="M16 16 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search label…"
                className="prompt-history-search__input"
                autoComplete="off"
                aria-label="Search prompts by label"
              />
            </label>
          </div>

          <div className="prediction-history-shell__table-scroll prediction-history-shell__table-scroll--below-search">
            {loading ? (
              <div className="prediction-history-shell__center-msg">Loading prompt history…</div>
            ) : prompts.length === 0 ? (
              <div className="prediction-history-shell__empty">
                <span style={{ fontSize: 28 }}>📭</span>
                <span style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '0 16px' }}>
                  {debouncedLabel
                    ? 'No prompts match this label.'
                    : 'No prompt versions saved yet.'}
                </span>
              </div>
            ) : (
              <table className="prediction-history-shell__table">
                <thead>
                  <tr className="prediction-history-shell__thead-row">
                    {['Editor', 'Label', 'Date & time (IST)'].map((col) => (
                      <th key={col} className="prediction-history-shell__th">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {prompts.map((h, i) => {
                    const editor = h.createdBy ?? h.created_by ?? '—';
                    const lab = h.label ?? '—';
                    const when = formatPromptHistoryTimestamp(h.createdAt ?? h.created_at);
                    const active = h.isActive ?? h.is_active;
                    return (
                      <tr
                        key={h.id ?? i}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          background: i % 2 === 0 ? '#fff' : '#fafafa',
                        }}
                      >
                        <td style={{ padding: '10px 12px', color: '#334155' }}>{editor}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            {active ? (
                              <span
                                title="Active prompt"
                                aria-label="Active prompt"
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  background: '#16a34a',
                                  flexShrink: 0,
                                }}
                              />
                            ) : null}
                            <button
                              type="button"
                              className="prompt-history-label-btn"
                              onClick={() => setDetailRow(h)}
                            >
                              {lab}
                            </button>
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#475569', whiteSpace: 'nowrap' }}>{when}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {!loading && totalElements > 0 ? (
            <footer className="prediction-history-shell__footer">
              <span className="prediction-history-shell__footer-meta">
                {totalElements} version{totalElements === 1 ? '' : 's'} · Page {page + 1} of {totalPages}
              </span>
              <div className="prediction-history-shell__pager">
                <button
                  type="button"
                  className="prediction-history-shell__page-btn"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  className="prediction-history-shell__page-btn"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Next →
                </button>
              </div>
            </footer>
          ) : null}
        </div>
      </div>

      {detailRow ? (
        <PromptTextDetailDialog
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onUseInEditor={
            typeof onUseInEditor === 'function'
              ? ({ promptText, label: lb }) =>
                  handleUseInEditor({ promptText, label: lb })
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function AdminAiModelSection() {
  const [tools, setTools] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [activating, setActivating] = useState(null);
  const [status, setStatus] = useState(null);
  const [confirmModel, setConfirmModel] = useState(null); // { id, displayName, modelId }

  useEffect(() => {
    api.getAiTools()
      .then(data => {
        setTools(data);
        const firstEnabled = data.find(t => t.enabled);
        if (firstEnabled) setSelectedTool(firstEnabled.name);
      })
      .catch(() => {});
  }, []);

  async function handleActivate(modelId) {
    setConfirmModel(null);
    setActivating(modelId);
    setStatus(null);
    try {
      await api.activateAiModel(modelId);
      const updated = await api.getAiTools();
      setTools(updated);
      setStatus({ type: 'ok', msg: 'Model activated. All future predictions will use this model.' });
    } catch (e) {
      setStatus({ type: 'error', msg: e.message });
    } finally {
      setActivating(null);
    }
  }

  const activeTool = tools.find(t => t.name === selectedTool);

  return (
    <div>
      {confirmModel && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setConfirmModel(null)}
          role="presentation"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-model-title"
            style={{
              background: '#fff', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h3 id="confirm-model-title" style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              Change AI Model?
            </h3>
            <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, margin: '0 0 20px' }}>
              <strong style={{ color: '#0f172a' }}>{confirmModel.displayName}</strong>{' '}
              (<code style={{ fontSize: 11, background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>{confirmModel.modelId}</code>)
              {' '}will be used for all new predictions across the app. You can change it again here anytime.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirmModel(null)}
                style={{
                  padding: '8px 20px', borderRadius: 7, border: '1px solid #e2e8f0',
                  background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleActivate(confirmModel.id)}
                style={{
                  padding: '8px 20px', borderRadius: 7, border: 'none',
                  background: '#4f46e5', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
        Select the AI provider and model used for all future predictions. Only enabled providers are selectable.
      </p>

      <p style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
        AI Provider
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {tools.map(tool => {
          const isSelected = selectedTool === tool.name;
          return (
            <button
              key={tool.name}
              type="button"
              disabled={!tool.enabled}
              onClick={() => tool.enabled && setSelectedTool(tool.name)}
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                border: isSelected ? '2px solid #4f46e5' : '1.5px solid #e2e8f0',
                background: isSelected ? '#eef2ff' : tool.enabled ? '#fff' : '#f8fafc',
                cursor: tool.enabled ? 'pointer' : 'not-allowed',
                opacity: tool.enabled ? 1 : 0.5,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                minWidth: 100,
                transition: 'border-color 0.15s',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#4f46e5' : '#1e293b' }}>
                {tool.displayName}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                background: tool.enabled ? '#dcfce7' : '#f1f5f9',
                color: tool.enabled ? '#16a34a' : '#94a3b8',
              }}>
                {tool.enabled ? 'AVAILABLE' : 'COMING SOON'}
              </span>
            </button>
          );
        })}
      </div>

      {activeTool && (
        <>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
            {activeTool.displayName} Models
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(activeTool.models || []).map(model => (
              <div
                key={model.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: model.isActive ? '1.5px solid #4f46e5' : '1px solid #e2e8f0',
                  background: model.isActive ? '#eef2ff' : '#fff',
                  opacity: model.enabled ? 1 : 0.5,
                }}
              >
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{model.displayName}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>{model.modelId}</span>
                </div>
                {model.isActive ? (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#4f46e5', background: '#e0e7ff', padding: '3px 10px', borderRadius: 10 }}>
                    ACTIVE
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={!model.enabled || activating === model.id}
                    onClick={() => setConfirmModel({ id: model.id, displayName: model.displayName, modelId: model.modelId })}
                    style={{
                      padding: '5px 14px', borderRadius: 6, border: 'none',
                      background: activating === model.id ? '#94a3b8' : '#4f46e5',
                      color: '#fff', fontSize: 12, fontWeight: 600,
                      cursor: model.enabled && activating !== model.id ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {activating === model.id ? 'Activating…' : 'Activate'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {status && (
        <p style={{ fontSize: 12, margin: '12px 0 0', color: status.type === 'ok' ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
          {status.type === 'ok' ? '✓ ' : '✗ '}{status.msg}
        </p>
      )}
    </div>
  );
}

// ── News Sentiment Card ──────────────────────────────────────────────────────
const NEWS_SENTIMENT_COLORS = {
  BULLISH:     { color: '#16a34a', bg: '#dcfce7', bar: '#16a34a' },
  BEARISH:     { color: '#dc2626', bg: '#fee2e2', bar: '#dc2626' },
  NEUTRAL:     { color: '#d97706', bg: '#fef9c3', bar: '#d97706' },
  UNAVAILABLE: { color: '#94a3b8', bg: '#f1f5f9', bar: '#cbd5e1' },
};

function NewsSentimentCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const result = await api.getNewsSentiment();
      setData(result);
    } catch {
      /* keep stale data on error */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Re-fetch every 15 min to stay in sync with server-side TTL
    const id = setInterval(() => load(), 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div className="news-sentiment-card news-sentiment-card--loading">
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Loading market news…</span>
      </div>
    );
  }

  const overall = data?.overall ?? 'UNAVAILABLE';
  const scheme = NEWS_SENTIMENT_COLORS[overall] ?? NEWS_SENTIMENT_COLORS.UNAVAILABLE;
  const score = typeof data?.score === 'number' ? data.score : 0;
  // Map score -1..+1 → bar fill 0..100%
  const barPct = Math.round(((score + 1) / 2) * 100);
  const headlines = data?.top_headlines ?? [];
  const isUnavailable = overall === 'UNAVAILABLE';

  return (
    <div className="news-sentiment-card">
      {/* Header: collapsed shows only "Market News" + chevron; click expands sentiment details */}
      <div
        className="news-sentiment-card__header"
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: 'pointer' }}
        aria-expanded={expanded}
        aria-label={expanded ? 'Market news details expanded, click to collapse' : 'Market news collapsed, click to show sentiment and headlines'}
      >
        <div className="news-sentiment-card__left">
          <span className="news-sentiment-card__label">Market News</span>
          {expanded && !isUnavailable && (
            <>
              <span className="news-sentiment-card__badge" style={{ color: scheme.color, background: scheme.bg }}>
                {overall}
              </span>
              <span className="news-sentiment-card__counts">
                <span style={{ color: '#16a34a' }}>↑{data.bullish_count}</span>
                {' '}
                <span style={{ color: '#dc2626' }}>↓{data.bearish_count}</span>
                {' '}
                <span style={{ color: '#94a3b8' }}>→{data.neutral_count}</span>
              </span>
            </>
          )}
        </div>
        <div className="news-sentiment-card__right">
          {expanded && data?.fetched_at_ist && (
            <span className="news-sentiment-card__time">{data.fetched_at_ist.slice(11, 16)} IST</span>
          )}
          {expanded && (
            <button
              type="button"
              className="news-sentiment-card__refresh"
              onClick={e => { e.stopPropagation(); load(true); }}
              disabled={refreshing}
              aria-label="Refresh news"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', animation: refreshing ? 'news-spin 0.7s linear infinite' : 'none' }} aria-hidden>
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
          <span className="news-sentiment-card__chevron" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }} aria-hidden>▾</span>
        </div>
      </div>

      {/* Score bar — only after expanding */}
      {expanded && !isUnavailable && (
        <div className="news-sentiment-card__bar-wrap">
          <div className="news-sentiment-card__bar-track">
            <div className="news-sentiment-card__bar-fill" style={{ width: `${barPct}%`, background: scheme.bar }} />
            <div className="news-sentiment-card__bar-mid" />
          </div>
          <div className="news-sentiment-card__bar-labels">
            <span>Bearish</span><span>Neutral</span><span>Bullish</span>
          </div>
        </div>
      )}

      {expanded && isUnavailable && (
        <p className="news-sentiment-card__unavailable">
          {data?.error ?? 'News API not configured. Set NEWS_API_KEY in the ML service environment.'}
        </p>
      )}

      {/* Headlines — only when expanded */}
      {expanded && headlines.length > 0 && (
        <ul className="news-sentiment-card__headlines">
          {headlines.map((h, i) => {
            const hScheme = NEWS_SENTIMENT_COLORS[h.label] ?? NEWS_SENTIMENT_COLORS.NEUTRAL;
            return (
              <li key={i} className="news-sentiment-card__headline">
                <span className="news-sentiment-card__headline-score" style={{ color: hScheme.color }}>
                  {h.score >= 0 ? '+' : ''}{h.score.toFixed(2)}
                </span>
                <span className="news-sentiment-card__headline-text">{h.title}</span>
                {h.source && <span className="news-sentiment-card__headline-source">{h.source}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AdminPromptSection({ embedded }) {
  const [promptText, setPromptText] = useState(DEFAULT_PROMPT_HINT);
  const [label, setLabel] = useState('');
  const [activePrompt, setActivePrompt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'ok'|'error', msg }
  const [promptHistoryOpen, setPromptHistoryOpen] = useState(false);
  const [checklistWeight, setChecklistWeight] = useState(40);
  const [weightSaving, setWeightSaving] = useState(false);
  const [weightStatus, setWeightStatus] = useState(null);

  useEffect(() => {
    api.getActivePrompt()
      .then((p) => {
        if (p && p.active === false) return;
        const text = pickPromptText(p);
        if (text) {
          setActivePrompt(p);
          setPromptText(text);
          setLabel((p.label && String(p.label)) || '');
        }
      })
      .catch(() => {});
    api.getChecklistWeight()
      .then((d) => { if (d && d.weight != null) setChecklistWeight(d.weight); })
      .catch(() => {});
  }, []);

  async function handleWeightSave() {
    setWeightSaving(true);
    setWeightStatus(null);
    try {
      await api.setChecklistWeight(checklistWeight);
      setWeightStatus({ type: 'ok', msg: `Checklist weight set to ${checklistWeight}%.` });
    } catch (e) {
      setWeightStatus({ type: 'error', msg: e.message });
    } finally {
      setWeightSaving(false);
    }
  }

  async function handleSave() {
    if (!label.trim()) { setStatus({ type: 'error', msg: 'Label is required.' }); return; }
    if (!promptText.includes('{target_minutes}')) {
      setStatus({ type: 'error', msg: 'Prompt must contain {target_minutes}.' });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const saved = await api.savePrompt(label.trim(), promptText.trim());
      setActivePrompt(saved);
      setStatus({ type: 'ok', msg: 'Prompt saved and activated.' });
    } catch (e) {
      setStatus({ type: 'error', msg: e.message });
    } finally {
      setSaving(false);
    }
  }

  const hasMissingVar = promptText && !promptText.includes('{target_minutes}');

  return (
    <div style={embedded ? { marginTop: 0, paddingTop: 0, borderTop: 'none' } : { marginTop: 24, borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
      {!embedded ? (
        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: '#1e293b' }}>AI Prompt Management</h3>
      ) : null}
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
        Customise the system prompt sent to Gemini for every prediction. The following dynamic variables are
        substituted at runtime — you <strong>must</strong> include them:
      </p>
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, lineHeight: 1.8 }}>
        <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4 }}>Required</div>
        <code style={{ display: 'block', color: '#0f172a' }}><strong>{'{target_minutes}'}</strong> — horizon in minutes (5, 15, 30…)</code>
        <div style={{ fontWeight: 600, color: '#374151', margin: '8px 0 4px' }}>Price &amp; OHLC</div>
        <code style={{ display: 'block', color: '#475569' }}>{'{spot_price}'} · {'{open}'} · {'{high}'} · {'{low}'} · {'{prev_close}'} · {'{day_change_pct}'}</code>
        <div style={{ fontWeight: 600, color: '#374151', margin: '8px 0 4px' }}>Technical indicators</div>
        <code style={{ display: 'block', color: '#475569' }}>{'{ema_20}'} · {'{ema_50}'} · {'{rsi_14}'} · {'{vwap}'} · {'{atr_14}'}</code>
        <code style={{ display: 'block', color: '#475569' }}>{'{macd}'} · {'{macd_signal}'} · {'{macd_histogram}'} · {'{volume_ratio}'}</code>
        <div style={{ fontWeight: 600, color: '#374151', margin: '8px 0 4px' }}>Volatility &amp; levels</div>
        <code style={{ display: 'block', color: '#475569' }}>{'{india_vix}'} · {'{vix_change}'} · {'{pivot}'} · {'{support_1}'} · {'{support_2}'} · {'{resistance_1}'} · {'{resistance_2}'}</code>
        <div style={{ fontWeight: 600, color: '#374151', margin: '8px 0 4px' }}>Context</div>
        <code style={{ display: 'block', color: '#475569' }}>{'{market_phase}'} · {'{time_ist}'} · {'{last_5_candles}'}</code>
        <div style={{ fontWeight: 600, color: '#374151', margin: '8px 0 4px' }}>Policy (auto-filled from settings)</div>
        <code style={{ display: 'block', color: '#475569' }}>{'{min_confidence}'} · {'{min_risk_reward}'}</code>
        <div style={{ fontWeight: 600, color: '#374151', margin: '8px 0 4px' }}>Appended automatically — do not include in template</div>
        <code style={{ display: 'block', color: '#94a3b8' }}>{'{checklist_weight}'} · {'{remaining_weight}'} — added by the checklist suffix block</code>
      </div>

      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0369a1', marginBottom: 6 }}>
          Checklist Signal Weight — {checklistWeight}%
          <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 6 }}>
            (AI uses own analysis for remaining {100 - checklistWeight}%)
          </span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={checklistWeight}
          onChange={e => setChecklistWeight(Number(e.target.value))}
          style={{ width: '100%', accentColor: '#0369a1', cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
          <span>0% (AI only)</span>
          <span>50% balanced</span>
          <span>100% (checklist only)</span>
        </div>
        {weightStatus && (
          <p style={{ fontSize: 11, margin: '6px 0 0', color: weightStatus.type === 'ok' ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
            {weightStatus.type === 'ok' ? '✓ ' : '✗ '}{weightStatus.msg}
          </p>
        )}
        <button
          type="button"
          onClick={handleWeightSave}
          disabled={weightSaving}
          style={{
            marginTop: 8, padding: '5px 14px', borderRadius: 6, border: 'none',
            cursor: weightSaving ? 'not-allowed' : 'pointer',
            background: weightSaving ? '#94a3b8' : '#0369a1', color: '#fff', fontWeight: 600, fontSize: 12,
          }}
        >
          {weightSaving ? 'Saving…' : 'Save weight'}
        </button>
      </div>

      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        Label <span style={{ fontWeight: 400, color: '#94a3b8' }}>(short name for this version)</span>
      </label>
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="e.g. v2 — tighter stop rules"
        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }}
      />
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        Prompt template
      </label>
      <textarea
        value={promptText}
        onChange={e => setPromptText(e.target.value)}
        rows={12}
        spellCheck="false"
        autoComplete="off"
        aria-label="Active prompt template, editable"
        style={{
          width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.6, fontFamily: 'monospace',
          border: hasMissingVar ? '1.5px solid #ef4444' : '1px solid #cbd5e1',
          resize: 'vertical', boxSizing: 'border-box', background: '#fff',
        }}
      />
      {hasMissingVar && (
        <p style={{ fontSize: 11, color: '#ef4444', margin: '4px 0 0' }}>
          Missing required variable: <code>{'{target_minutes}'}</code>
        </p>
      )}
      {status && (
        <p style={{ fontSize: 12, margin: '8px 0 0', color: status.type === 'ok' ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
          {status.type === 'ok' ? '✓ ' : '✗ '}{status.msg}
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || hasMissingVar || !promptText.trim()}
          style={{
            padding: '8px 18px', borderRadius: 6, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            background: saving ? '#94a3b8' : '#4f46e5', color: '#fff', fontWeight: 600, fontSize: 13,
          }}
        >
          {saving ? 'Saving…' : 'Save & Activate'}
        </button>
        <button
          type="button"
          onClick={() => setPromptHistoryOpen(true)}
          style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#475569' }}
        >
          View history
        </button>
      </div>
      <PromptHistoryDialog
        open={promptHistoryOpen}
        onClose={() => setPromptHistoryOpen(false)}
        onUseInEditor={({ promptText: t, label: lb }) => {
          if (t) setPromptText(t);
          const base = lb && lb !== '—' ? String(lb).trim() : '';
          setLabel(base ? `${base} (copy)` : '');
          setStatus({ type: 'ok', msg: 'Loaded prompt into editor. Save to activate if you want this version live.' });
        }}
      />
    </div>
  );
}

/** Live-tunable prediction thresholds (ML service). Labels avoid vendor-specific naming. */
function AdminAdjustmentsSection({ embedded }) {
  const emptyPolicy = () => ({
    minConfidence: 65,
    minRiskReward: 1.5,
    strongTrendMinEmaGapPct: 0.1,
    relaxedConfidenceFloorStrongTrend: 58,
    sellNearSupportMinConfidence: 72,
    minAtrPctOfPrice: 0,
    rateLimitMaxRetries: 4,
    rateLimitRetryBaseDelaySec: 8,
  });

  const [policy, setPolicy] = useState(emptyPolicy);
  const [envDefaults, setEnvDefaults] = useState(null);
  const [hasOverrides, setHasOverrides] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getPredictionPolicy()
      .then((d) => {
        if (!d) return;
        setPolicy({
          minConfidence: Number(d.minConfidence),
          minRiskReward: Number(d.minRiskReward),
          strongTrendMinEmaGapPct: Number(d.strongTrendMinEmaGapPct),
          relaxedConfidenceFloorStrongTrend: Number(d.relaxedConfidenceFloorStrongTrend),
          sellNearSupportMinConfidence: Number(d.sellNearSupportMinConfidence),
          minAtrPctOfPrice: Number(d.minAtrPctOfPrice),
          rateLimitMaxRetries: Number(d.rateLimitMaxRetries),
          rateLimitRetryBaseDelaySec: Number(d.rateLimitRetryBaseDelaySec),
        });
        setHasOverrides(Boolean(d.hasActiveOverrides));
        if (d.envDefaults) setEnvDefaults(d.envDefaults);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      await api.setPredictionPolicy(policy);
      setStatus({ type: 'ok', msg: 'Adjustments saved. They apply to new predictions immediately.' });
      load();
    } catch (e) {
      setStatus({ type: 'error', msg: e.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setStatus(null);
    try {
      await api.resetPredictionPolicy();
      setStatus({ type: 'ok', msg: 'Reverted to server environment defaults.' });
      load();
    } catch (e) {
      setStatus({ type: 'error', msg: e.message });
    } finally {
      setSaving(false);
    }
  }

  const row = (label, help, key, opts = {}) => (
    <div key={key} style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        {label}
        {envDefaults && envDefaults[key] != null && (
          <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>
            (env default: {envDefaults[key]})
          </span>
        )}
      </label>
      <p style={{ margin: '0 0 6px', fontSize: 11, color: '#64748b', lineHeight: 1.45 }}>{help}</p>
      <input
        type="number"
        value={policy[key]}
        min={opts.min}
        max={opts.max}
        step={opts.step ?? 'any'}
        onChange={(e) => {
          const v = opts.int ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
          setPolicy((p) => ({ ...p, [key]: Number.isFinite(v) ? v : p[key] }));
        }}
        style={{ width: '100%', maxWidth: 200, padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, boxSizing: 'border-box' }}
      />
    </div>
  );

  return (
    <div style={embedded ? { marginTop: 0, paddingTop: 0, borderTop: 'none' } : { marginTop: 24, borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b', lineHeight: 1.55 }}>
        Tune how raw model output is filtered into BUY / SELL / HOLD, optional chop detection, and how hard the service
        retries on rate limits. Values here override environment defaults until you reset.
      </p>
      {hasOverrides ? (
        <p style={{ fontSize: 11, color: '#b45309', margin: '0 0 12px', fontWeight: 500 }}>
          Custom adjustments are active (overriding env).
        </p>
      ) : null}
      {loading ? (
        <p style={{ fontSize: 13, color: '#64748b' }}>Loading…</p>
      ) : (
        <>
          {row('Minimum confidence (%)', 'BUY/SELL below this becomes HOLD unless strong-trend relaxation applies.', 'minConfidence', { min: 0, max: 100, step: 1 })}
          {row('Minimum risk : reward', 'Below this ratio, directional signals are downgraded to HOLD.', 'minRiskReward', { min: 0.5, max: 20, step: 0.1 })}
          {row('Strong trend — EMA gap (%)', 'If EMA9 vs EMA21 separation vs price is at least this, a lower confidence floor may apply.', 'strongTrendMinEmaGapPct', { min: 0, max: 5, step: 0.01 })}
          {row('Strong trend — relaxed confidence floor (%)', 'Minimum confidence allowed when the strong-trend rule fires (reduces excess HOLD in trends).', 'relaxedConfidenceFloorStrongTrend', { min: 0, max: 100, step: 1 })}
          {row('SELL near support — min confidence (%)', 'Stricter floor when the checklist marks price near support and the model says SELL.', 'sellNearSupportMinConfidence', { min: 0, max: 100, step: 1 })}
          {row('Low volatility gate — min ATR %% of price', 'Set to 0 to disable. If ATR(14)/price × 100 is below this, force HOLD (dead tape).', 'minAtrPctOfPrice', { min: 0, max: 10, step: 0.01 })}
          {row('Rate-limit retries', 'HTTP 429: attempts before returning a placeholder HOLD.', 'rateLimitMaxRetries', { min: 1, max: 20, step: 1, int: true })}
          {row('Rate-limit retry base delay (sec)', 'First backoff delay; doubles each attempt (capped).', 'rateLimitRetryBaseDelaySec', { min: 1, max: 120, step: 1 })}
        </>
      )}
      {status && (
        <p style={{ fontSize: 12, margin: '12px 0 0', color: status.type === 'ok' ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
          {status.type === 'ok' ? '✓ ' : '✗ '}{status.msg}
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          style={{
            padding: '8px 18px', borderRadius: 6, border: 'none', cursor: saving || loading ? 'not-allowed' : 'pointer',
            background: saving || loading ? '#94a3b8' : '#4f46e5', color: '#fff', fontWeight: 600, fontSize: 13,
          }}
        >
          {saving ? 'Saving…' : 'Save adjustments'}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={saving || loading}
          style={{
            padding: '8px 14px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: saving || loading ? 'not-allowed' : 'pointer',
            fontSize: 13, color: '#475569',
          }}
        >
          Reset to env defaults
        </button>
      </div>
    </div>
  );
}

function RiskLimitsSettingsForm({ hideHeading = false }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [halted, setHalted] = useState(false);
  const [maxSig, setMaxSig] = useState('');
  const [maxLoss, setMaxLoss] = useState('');
  const [todayDir, setTodayDir] = useState(0);
  const [todayPnl, setTodayPnl] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    api.getMyRiskSettings()
      .then((d) => {
        if (!d) return;
        setHalted(Boolean(d.tradingHalted));
        setMaxSig(d.maxSignalsPerDay != null ? String(d.maxSignalsPerDay) : '');
        setMaxLoss(d.maxDailyLossPct != null ? String(d.maxDailyLossPct) : '');
        setTodayDir(Number(d.directionalSignalsToday) || 0);
        setTodayPnl(Number(d.resolvedPnlSumTodayPct) || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const maxSignalsPerDay = maxSig.trim() === '' ? null : parseInt(maxSig, 10);
      if (maxSignalsPerDay != null && (!Number.isFinite(maxSignalsPerDay) || maxSignalsPerDay < 1)) {
        setStatus({ type: 'error', msg: 'Max signals per day must be empty (unlimited) or a positive integer.' });
        return;
      }
      let maxDailyLossPct = null;
      if (maxLoss.trim() !== '') {
        const v = parseFloat(maxLoss);
        if (!Number.isFinite(v) || v <= 0) {
          setStatus({ type: 'error', msg: 'Daily loss cap must be empty (off) or a positive number (%).' });
          return;
        }
        maxDailyLossPct = v;
      }
      await api.updateMyRiskSettings({
        tradingHalted: halted,
        maxSignalsPerDay,
        maxDailyLossPct,
      });
      setStatus({ type: 'ok', msg: 'Risk settings saved.' });
      load();
    } catch (err) {
      if (err.message === 'SESSION_EXPIRED') {
        setStatus({ type: 'error', msg: 'Session expired — sign in again.' });
      } else {
        setStatus({ type: 'error', msg: err.message });
      }
    } finally {
      setSaving(false);
    }
  }

  const formStyle = hideHeading
    ? { marginTop: 0, paddingTop: 0, borderTop: 'none' }
    : { marginTop: 20, paddingTop: 18, borderTop: '1px solid #e2e8f0' };

  return (
    <form onSubmit={handleSave} style={formStyle}>
      {!hideHeading ? (
        <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>Risk limits</h3>
      ) : null}
      <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
        These guardrails apply to <strong>signals</strong> this app shows (not your broker). Counts are <strong>stored prediction rows</strong> for the IST day, not broker fills. Directional calls can be forced to HOLD when a limit trips.
      </p>
      {loading ? <p style={{ fontSize: 13, color: '#64748b' }}>Loading…</p> : (
        <>
          <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 12px' }}>
            Today (IST): <strong>{todayDir}</strong> directional signals stored · resolved P&amp;L sum:{' '}
            <strong>{todayPnl === 0 ? '0' : `${todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(2)}`}%</strong>
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={halted} onChange={(e) => setHalted(e.target.checked)} />
            <span>Halt trading (kill switch) — only HOLD-style output</span>
          </label>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            Max directional signals per day
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Unlimited if empty"
            value={maxSig}
            onChange={(e) => setMaxSig(e.target.value.replace(/[^\d]/g, ''))}
            style={{ width: '100%', maxWidth: 220, padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', marginBottom: 12, boxSizing: 'border-box' }}
          />
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
            Daily loss cap (% of summed resolved P&amp;L)
          </label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Off if empty — e.g. 2.5"
            value={maxLoss}
            onChange={(e) => setMaxLoss(e.target.value.replace(/[^\d.]/g, ''))}
            style={{ width: '100%', maxWidth: 220, padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', marginBottom: 12, boxSizing: 'border-box' }}
          />
          <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 12px', lineHeight: 1.45 }}>
            When the sum of <em>resolved</em> prediction P&amp;L% for today falls to −cap or below, new BUY/SELL/BULLISH/BEARISH calls are blocked until the next session day.
          </p>
        </>
      )}
      {status && (
        <p style={{ fontSize: 12, margin: '8px 0 0', color: status.type === 'ok' ? '#16a34a' : '#dc2626', fontWeight: 500 }}>
          {status.type === 'ok' ? '✓ ' : '✗ '}{status.msg}
        </p>
      )}
      <button
        type="submit"
        disabled={saving || loading}
        style={{
          marginTop: 8,
          padding: '8px 16px',
          borderRadius: 6,
          border: 'none',
          cursor: saving || loading ? 'not-allowed' : 'pointer',
          background: saving || loading ? '#94a3b8' : '#0f766e',
          color: '#fff',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        {saving ? 'Saving…' : 'Save risk limits'}
      </button>
    </form>
  );
}

// ── AI Management Modal ──
function AiManagementModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('prompt');

  return (
    <div
      className="dashboard-settings-backdrop dashboard-settings-backdrop--nested"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div
        className="dashboard-settings-panel dashboard-settings-panel--prompt"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-mgmt-dialog-title"
      >
        <button type="button" className="dashboard-settings-panel__close" onClick={onClose} aria-label="Close AI management">
          ×
        </button>
        <h2 id="ai-mgmt-dialog-title" style={{ marginBottom: 16 }}>AI management</h2>

        <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid #e2e8f0', paddingBottom: 12, flexWrap: 'wrap' }}>
          {[{ key: 'prompt', label: 'Prompt' }, { key: 'adjustments', label: 'Adjustments' }, { key: 'model', label: 'AI Model' }].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              style={{
                padding: '6px 18px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontWeight: activeTab === key ? 700 : 400,
                fontSize: 13,
                background: activeTab === key ? '#4f46e5' : '#f1f5f9',
                color: activeTab === key ? '#fff' : '#475569',
                transition: 'background 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'prompt' ? <AdminPromptSection embedded /> : activeTab === 'adjustments' ? <AdminAdjustmentsSection embedded /> : <AdminAiModelSection />}
      </div>
    </div>
  );
}

// ── Dashboard ──
function Dashboard({ user, accessToken, onLogout, onUserUpdate }) {
  const [restPrediction, setRestPrediction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [horizon, setHorizon] = useState('15M');
  const [session, setSession] = useState(getMarketSession());
  const [minsToClose, setMinsToClose] = useState(minutesToClose());
  const [chartCandles, setChartCandles] = useState([]);
  const [liveCandle, setLiveCandle] = useState(null);
  const liveTickRef = useRef(null);
  const [instrumentsOpen, setInstrumentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [riskLimitsOpen, setRiskLimitsOpen] = useState(false);
  const [userMgmtOpen, setUserMgmtOpen] = useState(false);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [activeInstrumentId, setActiveInstrumentId] = useState('BANKNIFTY');
  const instrumentsRef = useRef(null);
  const sidebarRef = useRef(null);

  const { connected, livePrediction, livePrice, dailyAnalysis: wsDailyAnalysis, connectionError, setHorizon: wsSetHorizon } = useStomp(accessToken);
  const [dailyAnalysisPopup, setDailyAnalysisPopup] = useState(null);

  // On login: fetch any unread daily analysis from the server
  useEffect(() => {
    api.getDailyAnalysis()
      .then(data => { if (data) setDailyAnalysisPopup(data); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time: show popup when pushed via WebSocket
  useEffect(() => {
    if (wsDailyAnalysis) setDailyAnalysisPopup(wsDailyAnalysis);
  }, [wsDailyAnalysis]);

  const dismissDailyAnalysis = useCallback(() => {
    const id = dailyAnalysisPopup?.id;
    setDailyAnalysisPopup(null);
    if (id) api.markDailyAnalysisRead(id);
  }, [dailyAnalysisPopup]);

  const isLive = connected && livePrediction?.horizon === horizon;
  const prediction = isLive ? livePrediction : restPrediction;
  const LIVE_PREDICTION_STALE_AFTER_SEC = 90;
  const liveTsMs = Number(livePrediction?.predictionTimestampMs || 0);
  const liveAgeSec = isLive && liveTsMs > 0 ? Math.max(0, Math.floor((Date.now() - liveTsMs) / 1000)) : null;
  const isLiveStale = isLive && liveAgeSec != null && liveAgeSec > LIVE_PREDICTION_STALE_AFTER_SEC;
  const liveBackendFailed = isLive && Boolean(livePrediction?.liveError);
  const liveStatusText = (() => {
    if (liveBackendFailed) {
      const reason = String(livePrediction?.liveErrorMessage || '').trim();
      return reason
        ? `Live AI update failed on backend (${reason}). Showing fallback output.`
        : 'Live AI update failed on backend. Showing fallback output.';
    }
    if (isLiveStale) {
      return `No fresh live AI update for ${liveAgeSec}s. Showing last received output.`;
    }
    return '';
  })();

  // Clock and session update every 10s
  useEffect(() => {
    const id = setInterval(() => {
      setSession(getMarketSession());
      setMinsToClose(minutesToClose());
    }, 10000);
    return () => clearInterval(id);
  }, []);

  /** Refresh session OHLCV for chart + Trade Checklist (same cadence as 5m bars). */
  const refreshChartCandles = useCallback(() => {
    const intervalCode = horizon === '5M' ? '1M' : '5M';
    const periodCode = horizon === '5M' ? '3D' : '5D';
    api.getOhlcv(periodCode, intervalCode)
      .then(rows => setChartCandles(toChartCandles(rows)))
      .catch(() => {});
  }, [horizon]);

  useEffect(() => {
    refreshChartCandles();
  }, [refreshChartCandles]);

  useEffect(() => {
    const id = setInterval(refreshChartCandles, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshChartCandles]);

  // Aggregate live ticks into current candle for chart
  useEffect(() => {
    if (!livePrice) return;
    const f = extractLiveFields(livePrice);
    if (!f?.ltp) return;
    const intervalMinutes = horizon === '5M' ? 1 : 5;
    const nowSec = Math.floor(Date.now() / 1000);
    const candleTime = Math.floor(nowSec / (intervalMinutes * 60)) * (intervalMinutes * 60);
    const ltp = Number(f.ltp);
    setLiveCandle(prev => {
      if (!prev || prev.time !== candleTime) {
        return { time: candleTime, open: ltp, high: ltp, low: ltp, close: ltp };
      }
      return { ...prev, high: Math.max(prev.high, ltp), low: Math.min(prev.low, ltp), close: ltp };
    });
    liveTickRef.current = f;
  }, [livePrice, horizon]);

  const prevHorizonRef = useRef(horizon);

  const switchHorizon = useCallback((h) => {
    if (h !== prevHorizonRef.current) {
      prevHorizonRef.current = h;
      setChartCandles([]);
    }
    setHorizon(h);
    wsSetHorizon(h);
    setRestPrediction(null);
    setLiveCandle(null);
  }, [wsSetHorizon]);

  const fetchPrediction = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.predict(horizon);
      setRestPrediction(data);
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED') { onLogout(); return; }
      setError(e.message);
    } finally { setLoading(false); }
  }, [horizon, onLogout]);

  useEffect(() => { fetchPrediction(); }, [fetchPrediction]);

  useEffect(() => {
    if (connected) return;
    const id = setInterval(fetchPrediction, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchPrediction, connected]);

  useEffect(() => {
    if (!instrumentsOpen) return;
    const onDoc = (e) => {
      if (instrumentsRef.current && !instrumentsRef.current.contains(e.target)) setInstrumentsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [instrumentsOpen]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!aiPromptOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setAiPromptOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [aiPromptOpen]);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    if (sidebarOpen) el.removeAttribute('inert');
    else el.setAttribute('inert', '');
  }, [sidebarOpen]);

  const dir = prediction?.direction || 'HOLD';
  const isBull = dir === 'BUY' || dir === 'BULLISH';
  const isBear = dir === 'SELL' || dir === 'BEARISH';
  const isHold = !isBull && !isBear;
  const signalColor = isBull ? '#22c55e' : isBear ? '#ef4444' : '#f59e0b';
  const signalBg   = isBull ? '#f0fdf4' : isBear ? '#fef2f2' : '#fffbeb';
  const signalArrow = isBull ? '▲' : isBear ? '▼' : '▬';
  const signalLabel = isBull ? 'BUY' : isBear ? 'SELL' : 'HOLD';


  const aiText = (() => {
    const risk = (prediction?.riskLimitNotice || '').trim();
    const q = (prediction?.aiQuotaNotice || '').trim();
    const r = (prediction?.predictionReason || '').trim();
    const parts = [risk, q, r].filter(Boolean);
    return parts.join('\n\n');
  })();

  const lastPredictionText = (() => {
    const ts = Number(prediction?.predictionTimestampMs || 0);
    if (Number.isFinite(ts) && ts > 0) {
      const t = new Date(ts);
      if (!Number.isNaN(t.getTime())) {
        return `Last updated: ${t.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        })} IST`;
      }
    }
    return '';
  })();

  const HORIZONS = [
    { key: '5M', label: '5 Min' },
    { key: '15M', label: '15 Min' },
    { key: '30M', label: '30 Min' },
  ];

  return (
    <div className="dashboard-root" style={styles.page}>
      <div className="dashboard-shell">
        <aside
          ref={sidebarRef}
          id="dashboard-sidebar"
          className={'dashboard-sidebar' + (sidebarOpen ? ' dashboard-sidebar--open' : '')}
          aria-label="Instruments, history, and user management"
          aria-hidden={!sidebarOpen}
        >
          <nav className="dashboard-sidebar-nav" aria-label="Dashboard menu">
            <ul className="dashboard-sidebar-nav__list">
              <li className="dashboard-sidebar-nav__item">
                <div className="dashboard-sidebar__instruments-block" ref={instrumentsRef}>
                  <button
                    type="button"
                    className={'dashboard-sidebar-nav__link' + (instrumentsOpen ? ' dashboard-sidebar-nav__link--active' : '')}
                    onClick={() => setInstrumentsOpen((o) => !o)}
                    aria-expanded={instrumentsOpen}
                    aria-controls="instruments-panel"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" />
                      <line x1="17" y1="16" x2="23" y2="16" />
                    </svg>
                    Instruments
                  </button>
                  {instrumentsOpen ? (
                    <div id="instruments-panel" className="dashboard-sidebar-popover dashboard-sidebar-popover--instruments" role="region" aria-label="Market instruments">
                      <div className="dashboard-instrument-list__heading">Market instruments</div>
                      <ul className="dashboard-instrument-list">
                        {MARKET_INSTRUMENTS.map((inst) => {
                          const isActive = activeInstrumentId === inst.id;
                          if (!inst.enabled) {
                            return (
                              <li key={inst.id}>
                                <button
                                  type="button"
                                  className="dashboard-instrument-list__item dashboard-instrument-list__item--disabled"
                                  disabled
                                  title="Coming soon"
                                >
                                  <span className="dashboard-instrument-list__text">
                                    <span className="dashboard-instrument-list__name">{inst.name}</span>
                                    <span className="dashboard-instrument-list__meta">
                                      {inst.symbol} · {inst.exchange}
                                    </span>
                                  </span>
                                </button>
                              </li>
                            );
                          }
                          return (
                            <li key={inst.id}>
                              <button
                                type="button"
                                className={
                                  'dashboard-instrument-list__item' +
                                  (isActive ? ' dashboard-instrument-list__item--active' : '')
                                }
                                onClick={() => setActiveInstrumentId(inst.id)}
                                aria-pressed={isActive}
                              >
                                <span className="dashboard-instrument-list__text">
                                  <span className="dashboard-instrument-list__name">{inst.name}</span>
                                  <span className="dashboard-instrument-list__meta">
                                    {inst.symbol} · {inst.exchange}
                                  </span>
                                </span>
                                {isActive ? (
                                  <span className="dashboard-instrument-list__check" aria-hidden>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </li>

              <li className="dashboard-sidebar-nav__item">
                <button
                  type="button"
                  className="dashboard-sidebar-nav__link"
                  onClick={() => setHistoryOpen(true)}
                  aria-haspopup="dialog"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  History
                </button>
              </li>

              <li className="dashboard-sidebar-nav__item">
                <button
                  type="button"
                  className={'dashboard-sidebar-nav__link' + (checklistOpen ? ' dashboard-sidebar-nav__link--active' : '')}
                  onClick={() => { setChecklistOpen(true); setSidebarOpen(false); }}
                  aria-haspopup="dialog"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <polyline points="3 6 4 7 6 5" />
                    <polyline points="3 12 4 13 6 11" />
                    <polyline points="3 18 4 19 6 17" />
                  </svg>
                  Trade Checklist
                </button>
              </li>

              {user?.role === 'ADMIN' ? (
                <li className="dashboard-sidebar-nav__item">
                  <button
                    type="button"
                    className="dashboard-sidebar-nav__link"
                    onClick={() => {
                      setUserMgmtOpen(true);
                      setSidebarOpen(false);
                    }}
                    aria-haspopup="dialog"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    User management
                  </button>
                </li>
              ) : null}
            </ul>
          </nav>
        </aside>

        {sidebarOpen ? (
          <div
            className="dashboard-sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            onKeyDown={(e) => e.key === 'Escape' && setSidebarOpen(false)}
            role="presentation"
            aria-hidden="true"
          />
        ) : null}

        <div className="dashboard-main">
      {/* Sticky header */}
      <header className="dashboard-sticky-header">
        <div className="top-bar-row top-bar-row--compact-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="dashboard-sidebar-toggle"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-expanded={sidebarOpen}
              aria-controls="dashboard-sidebar"
              title={sidebarOpen ? 'Close menu' : 'Open menu'}
            >
              <span className="dashboard-sidebar-toggle__lines" aria-hidden>
                <span className="dashboard-sidebar-toggle__line" />
                <span className="dashboard-sidebar-toggle__line" />
                <span className="dashboard-sidebar-toggle__line" />
              </span>
              <span className="sr-only">{sidebarOpen ? 'Close sidebar' : 'Open sidebar'}</span>
            </button>
            <SessionBadge session={session} minutesToCloseVal={minsToClose} />
          </div>
          <ProfileMenu userName={user.name} onLogout={onLogout} onOpenSettings={() => setSettingsOpen(true)} />
        </div>
        <LiveBanner livePrice={livePrice} connected={connected} connectionError={connectionError} />
        <SquareOffBanner minutesToCloseVal={minsToClose} />
      </header>

      <div className="dashboard-content">
        {/* Session OHLC ↔ chart (horizontal swipe) */}
        <SessionChartCarousel
          livePrice={livePrice}
          candles={chartCandles}
          liveCandle={liveCandle}
          signal={isBull ? 'BUY' : isBear ? 'SELL' : null}
        />

        {/* Horizon tabs */}
        <div className="horizon-tabs">
          {HORIZONS.map(({ key, label }) => (
            <button key={key} onClick={() => switchHorizon(key)} style={{
              flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: horizon === key ? '#2563eb' : '#fff',
              color: horizon === key ? '#fff' : '#666',
              border: horizon === key ? 'none' : '1px solid #e5e7eb',
            }}>
              {label}
            </button>
          ))}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {/* Market closed notice */}
        {(session === 'closed' || session === 'pre-market') && (
          <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 18px', fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
            {session === 'pre-market' ? 'Market opens at 9:15 AM IST. Predictions will start automatically.' : 'Market closed. Predictions are available during trading hours (9:15 AM – 3:30 PM IST, Mon–Fri).'}
          </div>
        )}

        {/* Prediction card */}
        {loading && !prediction ? (
          <div style={{ ...styles.card, padding: 32, textAlign: 'center', color: '#888', fontSize: 14 }}>Loading prediction…</div>
        ) : prediction ? (
          <div style={{ ...styles.card, position: 'relative' }}>
            {/* Refresh button */}
            <button type="button" onClick={fetchPrediction} disabled={loading} aria-label="Refresh prediction"
              style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, width: 30, height: 30, padding: 0, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>

            {/* Direction banner */}
            <div style={{ background: signalBg, padding: '20px 48px 20px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 40, color: signalColor }}>{signalArrow}</span>
              <div>
                <div style={{ fontSize: 30, fontWeight: 700, color: signalColor }}>{signalLabel}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  Predict {horizon} ahead · {prediction.horizon || horizon}
                </div>
                {lastPredictionText ? (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    {lastPredictionText}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Trading levels */}
            <TradingLevels prediction={prediction} isBull={isBull} isBear={isBear} />

            {/* Confidence bar */}
            <ConfidenceBar confidence={prediction.confidence} />

            {/* Volatility + magnitude */}
            <div className="prediction-metrics" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid #f3f4f6' }}>
              {[
                ['Expected Move', prediction.magnitude != null ? (Number(prediction.magnitude) >= 0 ? '+' : '') + Number(prediction.magnitude).toFixed(2) + '%' : 'N/A'],
                ['Volatility', prediction.predictedVolatility != null ? (Number(prediction.predictedVolatility) > 1 ? Number(prediction.predictedVolatility).toFixed(1) : (Number(prediction.predictedVolatility) * 100).toFixed(1)) + '%' : 'N/A'],
              ].map(([label, val]) => (
                <div key={label} style={{ padding: '12px 18px', borderRight: '1px solid #f3f4f6' }}>
                  <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: '#0f172a' }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Prediction metadata */}
            <PredictionMeta prediction={prediction} isLive={isLive} />

            {/* Live prediction health */}
            {liveStatusText ? (
              <div style={{
                margin: '10px 16px 0',
                borderRadius: 10,
                border: '1px solid #fde68a',
                background: '#fffbeb',
                color: '#92400e',
                fontSize: 12,
                lineHeight: 1.45,
                padding: '10px 12px',
              }}>
                {liveStatusText}
              </div>
            ) : null}

            {/* AI rationale */}
            {aiText ? <AiReasonTicker text={aiText} attached /> : null}
          </div>
        ) : (
          <div style={{ ...styles.card, padding: 24 }}>
            <p style={{ color: '#888', fontSize: 13, margin: 0 }}>No prediction available. ML service may be starting up.</p>
            <button onClick={fetchPrediction} style={{ ...styles.btnOutline, marginTop: 12 }}>Retry</button>
          </div>
        )}

        <NewsSentimentCard />

        <footer className="dashboard-page-footer">
          Bank Nifty spot · Mon–Fri 9:15 AM–3:30 PM IST
          {isLive ? ' · Live AI signal' : ' · REST fallback every 5 min'}
          {connected ? ' · WebSocket connected' : ' · WebSocket disconnected'}
        </footer>
      </div>
        </div>
      </div>

      <PredictionHistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} isAdmin={user?.role === 'ADMIN'} />
      <DailyAnalysisPopup data={dailyAnalysisPopup} onDismiss={dismissDailyAnalysis} />

      {settingsOpen ? (
        <div
          className="dashboard-settings-backdrop"
          onClick={() => {
            setAiPromptOpen(false);
            setRiskLimitsOpen(false);
            setSettingsOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setAiPromptOpen(false);
              setRiskLimitsOpen(false);
              setSettingsOpen(false);
            }
          }}
          role="presentation"
        >
          <div
            className="dashboard-settings-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
          >
            <button
              type="button"
              className="dashboard-settings-panel__close"
              onClick={() => {
                setAiPromptOpen(false);
                setRiskLimitsOpen(false);
                setSettingsOpen(false);
              }}
              aria-label="Close settings"
            >
              ×
            </button>
            <h2 id="settings-dialog-title">Settings</h2>
            {user?.role === 'ADMIN' ? (
              <button
                type="button"
                className="dashboard-settings-ai-btn"
                onClick={() => setAiPromptOpen(true)}
              >
                <span className="dashboard-settings-ai-btn__inner">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <path d="M9 2v2M15 2v2M9 20v2M15 20v2M20 9h2M20 14h2M2 9h2M2 14h2" />
                  </svg>
                  <span>AI management</span>
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className="dashboard-settings-ai-btn dashboard-settings-risk-btn"
              onClick={() => setRiskLimitsOpen(true)}
            >
              <span className="dashboard-settings-ai-btn__inner">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>Risk limits</span>
              </span>
            </button>
          </div>
        </div>
      ) : null}

      {riskLimitsOpen ? (
        <div
          className="dashboard-settings-backdrop dashboard-settings-backdrop--nested"
          onClick={() => setRiskLimitsOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setRiskLimitsOpen(false)}
          role="presentation"
        >
          <div
            className="dashboard-settings-panel dashboard-settings-panel--prompt"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="risk-limits-dialog-title"
          >
            <button
              type="button"
              className="dashboard-settings-panel__close"
              onClick={() => setRiskLimitsOpen(false)}
              aria-label="Close risk limits"
            >
              ×
            </button>
            <h2 id="risk-limits-dialog-title">Risk limits</h2>
            <RiskLimitsSettingsForm hideHeading />
          </div>
        </div>
      ) : null}

      {userMgmtOpen && user?.role === 'ADMIN' ? (
        <div
          className="dashboard-settings-backdrop"
          onClick={() => setUserMgmtOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setUserMgmtOpen(false)}
          role="presentation"
        >
          <div
            className="dashboard-settings-panel dashboard-settings-panel--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-mgmt-dialog-title"
          >
            <button type="button" className="dashboard-settings-panel__close" onClick={() => setUserMgmtOpen(false)} aria-label="Close user management">
              ×
            </button>
            <h2 id="user-mgmt-dialog-title">User management</h2>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, margin: '0 0 12px' }}>
              Change roles for registered accounts. The last admin cannot be demoted.
            </p>
            <AdminUsersSection
              embedded
              currentEmail={user?.email}
              onSelfRoleChanged={role => onUserUpdate?.({ role })}
            />
          </div>
        </div>
      ) : null}

      {aiPromptOpen && user?.role === 'ADMIN' ? (
        <AiManagementModal onClose={() => setAiPromptOpen(false)} />
      ) : null}

      <ProChecklistPage
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        chartCandles={chartCandles}
      />
    </div>
  );
}

// ── Pro Checklist helpers ──
function _calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeStep1Trend(chartCandles) {
  const closes = (chartCandles || [])
    .map(c => Number(c.close))
    .filter(v => !isNaN(v) && v > 0);
  if (closes.length < 50) {
    return { signal: 'INSUFFICIENT_DATA', ema20: null, ema50: null, tradeType: 'NONE', diffPct: null };
  }
  const ema20 = _calcEMA(closes, 20);
  const ema50 = _calcEMA(closes, 50);
  if (ema20 === null || ema50 === null) {
    return { signal: 'INSUFFICIENT_DATA', ema20: null, ema50: null, tradeType: 'NONE', diffPct: null };
  }
  const diffPct = Math.abs(ema20 - ema50) / ema50;
  let signal, tradeType;
  if (diffPct <= 0.001) { signal = 'MIXED';   tradeType = 'NONE'; }
  else if (ema20 > ema50) { signal = 'BULLISH'; tradeType = 'CE'; }
  else                    { signal = 'BEARISH'; tradeType = 'PE'; }
  return {
    signal, tradeType,
    ema20: Math.round(ema20 * 100) / 100,
    ema50: Math.round(ema50 * 100) / 100,
    diffPct: (diffPct * 100).toFixed(3),
  };
}

function computeStep2VWAP(chartCandles) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const todayCandles = (chartCandles || []).filter(c => {
    const d = new Date(Number(c.time) * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    return d === todayStr;
  });
  if (todayCandles.length === 0) {
    return { signal: 'INSUFFICIENT_DATA', vwap: null, currentPrice: null, diffPct: null };
  }
  let sumTPV = 0, sumV = 0;
  for (const c of todayCandles) {
    const tp = (Number(c.high) + Number(c.low) + Number(c.close)) / 3;
    const vol = Number(c.volume) || 1;
    sumTPV += tp * vol;
    sumV += vol;
  }
  const vwap = sumTPV / sumV;
  const currentPrice = Number(todayCandles[todayCandles.length - 1].close);
  const diffPct = Math.abs(currentPrice - vwap) / vwap;
  let signal;
  if (diffPct <= 0.0005)      signal = 'AVOID';
  else if (currentPrice > vwap) signal = 'BULLISH';
  else                          signal = 'BEARISH';
  return {
    signal,
    vwap: Math.round(vwap * 100) / 100,
    currentPrice,
    diffPct: (diffPct * 100).toFixed(3),
  };
}

function _calcRSI(closes, period) {
  if (closes.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeStep3RSI(chartCandles) {
  const closes = (chartCandles || [])
    .map(c => Number(c.close))
    .filter(v => !isNaN(v) && v > 0);
  if (closes.length <= 14) {
    return { signal: 'INSUFFICIENT_DATA', rsi: null };
  }
  const rsi = _calcRSI(closes, 14);
  if (rsi === null) return { signal: 'INSUFFICIENT_DATA', rsi: null };
  let signal;
  if (rsi > 55)      signal = 'BUY';
  else if (rsi < 45) signal = 'SELL';
  else               signal = 'SIDEWAYS';
  return { signal, rsi: Math.round(rsi * 100) / 100 };
}

function computeStep5Levels(chartCandles) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const dateMap = {};
  for (const c of (chartCandles || [])) {
    const d = new Date(Number(c.time) * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (!dateMap[d]) dateMap[d] = [];
    dateMap[d].push(c);
  }
  const sortedDates = Object.keys(dateMap).sort();
  const todayIdx = sortedDates.indexOf(todayStr);
  if (todayIdx < 1) return { signal: 'INSUFFICIENT_DATA', pivot: null, r1: null, r2: null, s1: null, s2: null, currentPrice: null };
  const prev = dateMap[sortedDates[todayIdx - 1]];
  const H = Math.max(...prev.map(c => Number(c.high)));
  const L = Math.min(...prev.map(c => Number(c.low)));
  const C = Number(prev[prev.length - 1].close);
  const pivot = (H + L + C) / 3;
  const r1 = 2 * pivot - L;
  const s1 = 2 * pivot - H;
  const r2 = pivot + (H - L);
  const s2 = pivot - (H - L);
  const todayCandles = dateMap[todayStr] || [];
  if (!todayCandles.length) return { signal: 'INSUFFICIENT_DATA', pivot: Math.round(pivot*100)/100, r1: Math.round(r1*100)/100, r2: Math.round(r2*100)/100, s1: Math.round(s1*100)/100, s2: Math.round(s2*100)/100, currentPrice: null };
  const currentPrice = Number(todayCandles[todayCandles.length - 1].close);
  const PROX = 0.003;
  const aboveR1 = currentPrice > r1 * (1 + PROX);
  const belowS1 = currentPrice < s1 * (1 - PROX);
  const nearR = Math.abs(currentPrice - r1) / r1 <= PROX || Math.abs(currentPrice - r2) / r2 <= PROX;
  const nearS = Math.abs(currentPrice - s1) / s1 <= PROX || Math.abs(currentPrice - s2) / s2 <= PROX;
  const signal = aboveR1 ? 'BREAKOUT_UP' : belowS1 ? 'BREAKOUT_DOWN' : nearR ? 'NEAR_RESISTANCE' : nearS ? 'NEAR_SUPPORT' : 'NO_LEVEL';
  return { signal, pivot: Math.round(pivot*100)/100, r1: Math.round(r1*100)/100, r2: Math.round(r2*100)/100, s1: Math.round(s1*100)/100, s2: Math.round(s2*100)/100, currentPrice };
}

function computeStep6Candle(chartCandles) {
  const candles = (chartCandles || []).filter(c => Number(c.high) > 0 && !isNaN(Number(c.close)));
  if (candles.length < 2) return { signal: 'INSUFFICIENT_DATA', bodyRatio: null, isBullish: null, open: null, close: null, high: null, low: null };
  const c = candles[candles.length - 2];
  const o = Number(c.open), cl = Number(c.close), h = Number(c.high), l = Number(c.low);
  const range = h - l;
  if (range === 0) return { signal: 'WEAK_CANDLE', bodyRatio: 0, isBullish: null, open: o, close: cl, high: h, low: l };
  const bodyRatio = Math.abs(cl - o) / range;
  const isBullish = cl > o;
  const signal = bodyRatio > 0.6 ? (isBullish ? 'BULLISH_CANDLE' : 'BEARISH_CANDLE') : 'WEAK_CANDLE';
  return { signal, bodyRatio: Math.round(bodyRatio * 1000) / 1000, isBullish, open: Math.round(o*100)/100, close: Math.round(cl*100)/100, high: Math.round(h*100)/100, low: Math.round(l*100)/100 };
}

function computeStep7Strike(chartCandles, trendResult, levelResult, confidence) {
  const candles = (chartCandles || []).filter(c => Number(c.close) > 0);
  if (!candles.length) return { signal: 'INSUFFICIENT_DATA', strike: null, strikeType: null, atm: null, currentPrice: null };
  const currentPrice = Number(candles[candles.length - 1].close);
  const INTERVAL = 100;
  const atm = Math.round(currentPrice / INTERVAL) * INTERVAL;
  const isBullish = trendResult.signal === 'BULLISH';
  const isBreakout = levelResult.signal === 'BREAKOUT_UP' || levelResult.signal === 'BREAKOUT_DOWN';
  let strikeType;
  if (isBreakout)          strikeType = 'OTM';
  else if (confidence >= 75) strikeType = 'ATM';
  else                       strikeType = 'ITM';
  const strike = strikeType === 'OTM'
    ? (isBullish ? atm + INTERVAL : atm - INTERVAL)
    : strikeType === 'ATM'
    ? atm
    : (isBullish ? atm - INTERVAL : atm + INTERVAL);
  return { signal: strikeType, strikeType, strike, atm, currentPrice };
}

function computeStep8Risk() {
  const slPct = 12, tgtPct = 25;
  return { signal: 'VALID', slPct, tgtPct, riskReward: parseFloat((tgtPct / slPct).toFixed(2)), maxTrades: 2 };
}

function computeStep9NoTrade(chartCandles, vwapResult, rsiResult, levelResult, candleResult) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const dateVolMap = {};
  for (const c of (chartCandles || [])) {
    const d = new Date(Number(c.time) * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    dateVolMap[d] = (dateVolMap[d] || 0) + (Number(c.volume) || 0);
  }
  const pastDates = Object.keys(dateVolMap).sort().filter(d => d < todayStr).slice(-20);
  const avgVol = pastDates.length > 0 ? pastDates.reduce((s, d) => s + dateVolMap[d], 0) / pastDates.length : 0;
  const lowVolume = avgVol > 0 && (dateVolMap[todayStr] || 0) < avgVol * 0.8;

  const bullishCount = [vwapResult.signal === 'BULLISH', rsiResult.signal === 'BUY', levelResult.signal === 'NEAR_SUPPORT' || levelResult.signal === 'BREAKOUT_UP', candleResult.signal === 'BULLISH_CANDLE'].filter(Boolean).length;
  const bearishCount = [vwapResult.signal === 'BEARISH', rsiResult.signal === 'SELL', levelResult.signal === 'NEAR_RESISTANCE' || levelResult.signal === 'BREAKOUT_DOWN', candleResult.signal === 'BEARISH_CANDLE'].filter(Boolean).length;
  const conflicting = Math.min(bullishCount, bearishCount) >= 2;

  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const mins = ist.getHours() * 60 + ist.getMinutes();
  const tooEarly = mins >= 555 && mins < 570;
  const tooLate  = mins >= 915 && mins <= 930;

  const conditions = [
    { reason: 'Price hugging VWAP (within 0.05%)',                                   triggered: vwapResult.signal === 'AVOID' },
    { reason: 'RSI in neutral zone 45–55 (sideways market)',                          triggered: rsiResult.signal === 'SIDEWAYS' },
    { reason: "Today's volume below 80% of 20-day average",                           triggered: lowVolume },
    { reason: `${Math.min(bullishCount, bearishCount)} of 4 signals conflicting`,     triggered: conflicting },
    { reason: 'Trade tracking not active — 0 losing trades assumed',                  triggered: false },
    { reason: tooEarly ? 'Market just opened (9:15–9:30 AM IST)' : tooLate ? 'Market about to close (3:15–3:30 PM IST)' : 'Market in normal trading window', triggered: tooEarly || tooLate },
  ];
  return { signal: conditions.some(c => c.triggered) ? 'NO_TRADE' : 'GO', conditions };
}


function _stepColors(signal) {
  const green  = { color: '#16a34a', bg: '#dcfce7' };
  const red    = { color: '#dc2626', bg: '#fee2e2' };
  const amber  = { color: '#b45309', bg: '#fef3c7' };
  const grey   = { color: '#64748b', bg: '#f1f5f9' };
  const blue   = { color: '#2563eb', bg: '#dbeafe' };
  const purple = { color: '#7c3aed', bg: '#ede9fe' };
  switch (signal) {
    case 'BULLISH': case 'BUY': case 'NEAR_SUPPORT': case 'BREAKOUT_UP':
    case 'BULLISH_CANDLE': case 'GO': case 'VALID': return green;
    case 'BEARISH': case 'SELL': case 'NEAR_RESISTANCE': case 'BREAKOUT_DOWN':
    case 'BEARISH_CANDLE': case 'NO_TRADE': case 'INVALID': return red;
    case 'MIXED': case 'AVOID': case 'SIDEWAYS': case 'NO_LEVEL': case 'WEAK_CANDLE': return amber;
    case 'INSUFFICIENT_DATA': return grey;
    case 'ATM': return green;
    case 'ITM': return blue;
    case 'OTM': return purple;
    default: return amber;
  }
}

function ProChecklistPage({ open, onClose, chartCandles }) {
  const trend   = useMemo(() => computeStep1Trend(chartCandles),  [chartCandles]);
  const vwap    = useMemo(() => computeStep2VWAP(chartCandles),   [chartCandles]);
  const rsi     = useMemo(() => computeStep3RSI(chartCandles),    [chartCandles]);
  const levels  = useMemo(() => computeStep5Levels(chartCandles), [chartCandles]);
  const candle  = useMemo(() => computeStep6Candle(chartCandles), [chartCandles]);

  const confidence = useMemo(() => {
    const b = [vwap.signal === 'BULLISH', rsi.signal === 'BUY', levels.signal === 'NEAR_SUPPORT' || levels.signal === 'BREAKOUT_UP', candle.signal === 'BULLISH_CANDLE'].filter(Boolean).length;
    const s = [vwap.signal === 'BEARISH', rsi.signal === 'SELL', levels.signal === 'NEAR_RESISTANCE' || levels.signal === 'BREAKOUT_DOWN', candle.signal === 'BEARISH_CANDLE'].filter(Boolean).length;
    return (Math.max(b, s) / 4) * 100;
  }, [vwap, rsi, levels, candle]);

  const strike  = useMemo(() => computeStep7Strike(chartCandles, trend, levels, confidence), [chartCandles, trend, levels, confidence]);
  const risk    = useMemo(() => computeStep8Risk(), []);
  const noTrade = useMemo(() => computeStep9NoTrade(chartCandles, vwap, rsi, levels, candle), [chartCandles, vwap, rsi, levels, candle]);

  if (!open) return null;

  const sc = (sig) => _stepColors(sig);

  return (
    <div className="checklist-overlay" role="dialog" aria-modal="true" aria-labelledby="checklist-title">
      <div className="checklist-panel" onClick={e => e.stopPropagation()}>

        <div className="checklist-panel__header">
          <div>
            <div className="checklist-panel__eyebrow">Rule-Based Signal Engine · 5-min candles</div>
            <h2 id="checklist-title" className="checklist-panel__title">Bank Nifty Pro Trading Checklist</h2>
          </div>
          <button type="button" className="checklist-panel__close" onClick={onClose} aria-label="Close checklist">×</button>
        </div>

        <div className="checklist-progress-bar">
          <div className="checklist-progress-bar__fill" style={{ width: '100%' }} />
        </div>
        <p className="checklist-meta">All 8 steps active · runs on 5-min candles</p>

        <div className="checklist-panel__body">

          {/* ── Step 1: TREND ── */}
          <div className="checklist-step checklist-step--active">
            <div className="checklist-step__header">
              <span className="checklist-step__number">01</span>
              <span className="checklist-step__name">TREND <span className="checklist-step__subtitle">Direction Filter</span></span>
              <span className="checklist-step__badge" style={{ color: sc(trend.signal).color, background: sc(trend.signal).bg }}>{trend.signal}</span>
            </div>
            <p className="checklist-step__desc">EMA 20 vs EMA 50 on 5-min candles. EMA 20 &gt; EMA 50 → BULLISH (CE). EMA 20 &lt; EMA 50 → BEARISH (PE). Within 0.1% → MIXED.</p>
            {trend.signal === 'INSUFFICIENT_DATA' ? <div className="checklist-step__warning">Need at least 50 candles.</div> : (
              <div className="checklist-step__metrics">
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">EMA 20</span><span className="checklist-step__metric-value">{trend.ema20?.toLocaleString('en-IN')}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">EMA 50</span><span className="checklist-step__metric-value">{trend.ema50?.toLocaleString('en-IN')}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Gap</span><span className="checklist-step__metric-value">{trend.diffPct}%</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Trade Side</span><span className="checklist-step__metric-value checklist-step__metric-value--highlight" style={{ color: sc(trend.signal).color }}>{trend.tradeType === 'NONE' ? 'NO TRADE' : trend.tradeType}</span></div>
              </div>
            )}
          </div>

          {/* ── Step 2: VWAP ── */}
          <div className="checklist-step checklist-step--active">
            <div className="checklist-step__header">
              <span className="checklist-step__number">02</span>
              <span className="checklist-step__name">VWAP <span className="checklist-step__subtitle">Intraday Control</span></span>
              <span className="checklist-step__badge" style={{ color: sc(vwap.signal).color, background: sc(vwap.signal).bg }}>{vwap.signal}</span>
            </div>
            <p className="checklist-step__desc">Price vs VWAP from today&apos;s intraday bars. &gt;VWAP → BULLISH. &lt;VWAP → BEARISH. Within 0.05% → AVOID.</p>
            {vwap.signal === 'INSUFFICIENT_DATA' ? <div className="checklist-step__warning">No intraday candles for today.</div> : (
              <div className="checklist-step__metrics">
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">VWAP</span><span className="checklist-step__metric-value">{vwap.vwap?.toLocaleString('en-IN')}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Price</span><span className="checklist-step__metric-value">{vwap.currentPrice?.toLocaleString('en-IN')}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Gap</span><span className="checklist-step__metric-value">{vwap.diffPct}%</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Signal</span><span className="checklist-step__metric-value checklist-step__metric-value--highlight" style={{ color: sc(vwap.signal).color }}>{vwap.signal}</span></div>
              </div>
            )}
          </div>

          {/* ── Step 3: MOMENTUM ── */}
          <div className="checklist-step checklist-step--active">
            <div className="checklist-step__header">
              <span className="checklist-step__number">03</span>
              <span className="checklist-step__name">MOMENTUM <span className="checklist-step__subtitle">RSI Filter</span></span>
              <span className="checklist-step__badge" style={{ color: sc(rsi.signal).color, background: sc(rsi.signal).bg }}>{rsi.signal}</span>
            </div>
            <p className="checklist-step__desc">RSI(14) on 5-min candles. &gt;55 → BUY. &lt;45 → SELL. 45–55 → SIDEWAYS (no trade).</p>
            {rsi.signal === 'INSUFFICIENT_DATA' ? <div className="checklist-step__warning">Need more than 14 candles.</div> : (
              <div className="checklist-step__metrics">
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">RSI (14)</span><span className="checklist-step__metric-value">{rsi.rsi}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Zone</span><span className="checklist-step__metric-value">{rsi.rsi > 55 ? '> 55 Strong' : rsi.rsi < 45 ? '< 45 Weak' : '45–55 Neutral'}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Signal</span><span className="checklist-step__metric-value checklist-step__metric-value--highlight" style={{ color: sc(rsi.signal).color }}>{rsi.signal}</span></div>
              </div>
            )}
          </div>


          {/* ── Step 5: LEVELS ── */}
          <div className="checklist-step checklist-step--active">
            <div className="checklist-step__header">
              <span className="checklist-step__number">05</span>
              <span className="checklist-step__name">LEVELS <span className="checklist-step__subtitle">Entry Location</span></span>
              <span className="checklist-step__badge" style={{ color: sc(levels.signal).color, background: sc(levels.signal).bg }}>{levels.signal}</span>
            </div>
            <p className="checklist-step__desc">Pivot points from prev-day H/L/C. Within 0.3% of support → CE. Within 0.3% of resistance → PE. Break above R1 → BREAKOUT_UP. Break below S1 → BREAKOUT_DOWN.</p>
            {levels.signal === 'INSUFFICIENT_DATA' ? <div className="checklist-step__warning">Need previous day&apos;s candles to compute pivots.</div> : (
              <div className="checklist-step__metrics">
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Pivot</span><span className="checklist-step__metric-value">{levels.pivot?.toLocaleString('en-IN')}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">R1 / R2</span><span className="checklist-step__metric-value">{levels.r1?.toLocaleString('en-IN')} / {levels.r2?.toLocaleString('en-IN')}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">S1 / S2</span><span className="checklist-step__metric-value">{levels.s1?.toLocaleString('en-IN')} / {levels.s2?.toLocaleString('en-IN')}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Signal</span><span className="checklist-step__metric-value checklist-step__metric-value--highlight" style={{ color: sc(levels.signal).color }}>{levels.signal}</span></div>
              </div>
            )}
          </div>

          {/* ── Step 6: ENTRY CANDLE ── */}
          <div className="checklist-step checklist-step--active">
            <div className="checklist-step__header">
              <span className="checklist-step__number">06</span>
              <span className="checklist-step__name">ENTRY CANDLE <span className="checklist-step__subtitle">Trigger</span></span>
              <span className="checklist-step__badge" style={{ color: sc(candle.signal).color, background: sc(candle.signal).bg }}>{candle.signal}</span>
            </div>
            <p className="checklist-step__desc">Last completed 5-min candle. Body ratio &gt;0.6 + green → BULLISH_CANDLE. &gt;0.6 + red → BEARISH_CANDLE. &lt;0.6 → WEAK_CANDLE (skip).</p>
            {candle.signal === 'INSUFFICIENT_DATA' ? <div className="checklist-step__warning">Need at least 2 candles.</div> : (
              <div className="checklist-step__metrics">
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Body Ratio</span><span className="checklist-step__metric-value">{candle.bodyRatio}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Open / Close</span><span className="checklist-step__metric-value">{candle.open?.toLocaleString('en-IN')} / {candle.close?.toLocaleString('en-IN')}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Direction</span><span className="checklist-step__metric-value">{candle.isBullish === true ? 'Green' : candle.isBullish === false ? 'Red' : '—'}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Signal</span><span className="checklist-step__metric-value checklist-step__metric-value--highlight" style={{ color: sc(candle.signal).color }}>{candle.signal}</span></div>
              </div>
            )}
          </div>

          {/* ── Step 7: STRIKE SELECTION ── */}
          <div className="checklist-step checklist-step--active">
            <div className="checklist-step__header">
              <span className="checklist-step__number">07</span>
              <span className="checklist-step__name">STRIKE SELECTION <span className="checklist-step__subtitle">Options Setup</span></span>
              <span className="checklist-step__badge" style={{ color: sc(strike.signal).color, background: sc(strike.signal).bg }}>{strike.signal}</span>
            </div>
            <p className="checklist-step__desc">ITM (conf 60–75%) · ATM (conf ≥75%) · OTM (breakout). Bank Nifty interval: 100 pts.</p>
            {strike.signal === 'INSUFFICIENT_DATA' ? <div className="checklist-step__warning">No price data for strike calculation.</div> : (
              <div className="checklist-step__metrics">
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">ATM</span><span className="checklist-step__metric-value">{strike.atm?.toLocaleString('en-IN')}</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Recommended</span><span className="checklist-step__metric-value checklist-step__metric-value--highlight" style={{ color: sc(strike.signal).color }}>{strike.strike?.toLocaleString('en-IN')} ({strike.strikeType})</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Confidence</span><span className="checklist-step__metric-value">{confidence.toFixed(0)}%</span></div>
                <div className="checklist-step__metric"><span className="checklist-step__metric-label">Option</span><span className="checklist-step__metric-value">{trend.signal === 'BULLISH' ? 'CE' : trend.signal === 'BEARISH' ? 'PE' : '—'}</span></div>
              </div>
            )}
          </div>

          {/* ── Step 8: RISK MANAGEMENT ── */}
          <div className="checklist-step checklist-step--active">
            <div className="checklist-step__header">
              <span className="checklist-step__number">08</span>
              <span className="checklist-step__name">RISK MANAGEMENT <span className="checklist-step__subtitle">SL & Target</span></span>
              <span className="checklist-step__badge" style={{ color: sc(risk.signal).color, background: sc(risk.signal).bg }}>{risk.signal}</span>
            </div>
            <p className="checklist-step__desc">SL: 10–15% of premium. Target: 20–40% of premium. R:R ≥ 1:2. Max 2–3 trades/day.</p>
            <div className="checklist-step__metrics">
              <div className="checklist-step__metric"><span className="checklist-step__metric-label">Stop Loss</span><span className="checklist-step__metric-value">{risk.slPct}% of premium</span></div>
              <div className="checklist-step__metric"><span className="checklist-step__metric-label">Target</span><span className="checklist-step__metric-value">{risk.tgtPct}% of premium</span></div>
              <div className="checklist-step__metric"><span className="checklist-step__metric-label">R:R Ratio</span><span className="checklist-step__metric-value" style={{ color: sc(risk.signal).color }}>{risk.riskReward}:1</span></div>
              <div className="checklist-step__metric"><span className="checklist-step__metric-label">Max Trades</span><span className="checklist-step__metric-value">{risk.maxTrades}/day</span></div>
            </div>
          </div>

          {/* ── Step 9: NO TRADE CONDITIONS ── */}
          <div className="checklist-step checklist-step--active">
            <div className="checklist-step__header">
              <span className="checklist-step__number">09</span>
              <span className="checklist-step__name">NO TRADE CONDITIONS <span className="checklist-step__subtitle">Final Override</span></span>
              <span className="checklist-step__badge" style={{ color: sc(noTrade.signal).color, background: sc(noTrade.signal).bg }}>{noTrade.signal}</span>
            </div>
            <p className="checklist-step__desc">Overrides all other signals. Any triggered condition blocks the trade regardless of other step results.</p>
            <div className="checklist-step__conditions">
              {noTrade.conditions.map((cond, i) => (
                <div key={i} className={'checklist-condition' + (cond.triggered ? ' checklist-condition--triggered' : '')}>
                  <span className="checklist-condition__icon">{cond.triggered ? '✕' : '✓'}</span>
                  <span className="checklist-condition__text">{cond.reason}</span>
                </div>
              ))}
            </div>
          </div>

        </div>

        <div className="checklist-panel__footer">
          <div className={'checklist-summary ' + (noTrade.signal === 'GO' ? 'checklist-summary--go' : noTrade.signal === 'NO_TRADE' ? 'checklist-summary--nogo' : 'checklist-summary--waiting')}>
            <div>
              <div className="checklist-summary__label">Final Signal</div>
              {noTrade.signal === 'GO' && strike.signal !== 'INSUFFICIENT_DATA' && (
                <div className="checklist-summary__sub">
                  {trend.signal === 'BULLISH' ? 'CE' : trend.signal === 'BEARISH' ? 'PE' : '—'} · Strike {strike.strike?.toLocaleString('en-IN')} ({strike.strikeType}) · SL {risk.slPct}% · TGT {risk.tgtPct}%
                </div>
              )}
            </div>
            <div className="checklist-summary__value" style={{ color: sc(noTrade.signal).color }}>
              {noTrade.signal === 'GO' ? 'GO' : noTrade.signal === 'NO_TRADE' ? 'NO TRADE' : 'PENDING'}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Daily Analysis Popup ──
function DailyAnalysisPopup({ data, onDismiss }) {
  if (!data) return null;

  const sections = [
    { key: 'overall_assessment', label: 'Overall Assessment', type: 'text' },
    { key: 'what_went_wrong',    label: 'What Went Wrong',    type: 'list', color: '#dc2626' },
    { key: 'patterns',           label: 'Patterns Observed',  type: 'list', color: '#d97706' },
    { key: 'what_can_improve',   label: 'What Can Improve',   type: 'list', color: '#2563eb' },
    { key: 'recommendations',    label: 'Recommendations',    type: 'list', color: '#16a34a' },
  ];

  return (
    <div className="daily-analysis-overlay" role="dialog" aria-modal="true" aria-labelledby="da-title">
      <div className="daily-analysis-modal" onClick={e => e.stopPropagation()}>
        <div className="daily-analysis-modal__header">
          <div>
            <div className="daily-analysis-modal__eyebrow">End-of-Day Analysis</div>
            <h2 id="da-title" className="daily-analysis-modal__title">
              {data.analysisDate ? `${data.analysisDate} · ` : ''}{data.predictionCount ?? 0} predictions reviewed
            </h2>
          </div>
          <button
            type="button"
            className="daily-analysis-modal__close"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>

        <div className="daily-analysis-modal__body">
          {sections.map(({ key, label, type, color }) => {
            const val = data[key];
            if (!val || (Array.isArray(val) && val.length === 0)) return null;
            return (
              <div key={key} className="daily-analysis-modal__section">
                <div className="daily-analysis-modal__section-label" style={color ? { color } : undefined}>
                  {label}
                </div>
                {type === 'text' ? (
                  <p className="daily-analysis-modal__section-text">{val}</p>
                ) : (
                  <ul className="daily-analysis-modal__list">
                    {val.map((item, i) => (
                      <li key={i} className="daily-analysis-modal__list-item" style={color ? { color } : undefined}>
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {data.reason_quality?.length > 0 && (
            <div className="daily-analysis-modal__section">
              <div className="daily-analysis-modal__section-label">Reason Quality</div>
              <div className="daily-analysis-modal__rq-grid">
                {data.reason_quality.map((rq, i) => (
                  <div key={i} className="daily-analysis-modal__rq-card">
                    <div className="daily-analysis-modal__rq-meta">
                      <span style={{ fontWeight: 600, fontSize: 12, color: '#7eb8f7' }}>ID {rq.id}</span>
                      <span style={{
                        fontWeight: 700, fontSize: 12,
                        color: rq.quality_score >= 7 ? '#16a34a' : rq.quality_score >= 4 ? '#d97706' : '#dc2626',
                      }}>
                        {rq.quality_score}/10
                      </span>
                    </div>
                    <p className="daily-analysis-modal__rq-feedback">{rq.feedback}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="daily-analysis-modal__footer">
          <button type="button" className="daily-analysis-modal__dismiss-btn" onClick={onDismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// ── App ──
export default function Home() {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const fromStorage = api.init();
      setAccessToken(api.token);
      if (api.token) {
        try {
          const profile = await api.fetchMe();
          if (cancelled) return;
          const next = { name: profile.name, email: profile.email, role: profile.role || 'USER' };
          setUser(next);
          localStorage.setItem('user', JSON.stringify(next));
        } catch (e) {
          if (cancelled) return;
          if (e.message === 'SESSION_EXPIRED') {
            api.logout();
            setUser(null);
            setAccessToken(null);
          } else {
            setUser(fromStorage);
          }
        }
      } else {
        setUser(fromStorage);
      }
      if (!cancelled) setReady(true);
    }
    boot();
    return () => { cancelled = true; };
  }, []);

  const logout = () => { api.logout(); setUser(null); setAccessToken(null); };
  const onLogin = (u) => {
    setUser({ name: u.name, email: u.email, role: u.role || 'USER' });
    setAccessToken(api.token);
  };
  const onUserUpdate = (patch) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (typeof window !== 'undefined') localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  };

  if (!ready) return null;
  if (!user) return <Login onLogin={onLogin} />;
  return <Dashboard user={user} accessToken={accessToken} onLogout={logout} onUserUpdate={onUserUpdate} />;
}
