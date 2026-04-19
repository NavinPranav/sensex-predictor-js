'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStomp } from './hooks/useStomp';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// ── Styles ──
const styles = {
  page: { minHeight: '100vh', background: '#f8f9fa' },
  center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  card: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' },
  input: { width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  btnPrimary: { width: '100%', padding: '12px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnOutline: { padding: '6px 14px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#666' },
  label: { display: 'block', fontSize: 12, color: '#888', marginBottom: 4 },
  error: { background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 },
  topBar: { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  metric: { padding: '14px 18px', background: '#fff' },
  metricLabel: { fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue: { fontSize: 18, fontWeight: 600, marginTop: 4 },
};

// ── API Client ──
const api = {
  token: null,

  async login(email, password) {
    const res = await fetch(API + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error('Invalid email or password');
    const data = await res.json();
    this.token = data.accessToken;
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', data.accessToken);
      localStorage.setItem('user', JSON.stringify({ name: data.name, email: data.email }));
    }
    return data;
  },

  async register(name, email, password) {
    const res = await fetch(API + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Registration failed');
    }
    const data = await res.json();
    this.token = data.accessToken;
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', data.accessToken);
      localStorage.setItem('user', JSON.stringify({ name: data.name, email: data.email }));
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

  logout() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  },

  init() {
    if (typeof window === 'undefined') return null;
    this.token = localStorage.getItem('token');
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  },
};

// ── Login ──
function Login({ onLogin }) {
  const [isReg, setIsReg] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      const data = isReg
        ? await api.register(name, email, pass)
        : await api.login(email, pass);
      onLogin({ name: data.name, email: data.email });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.center}>
      <div style={{ width: '100%', maxWidth: 380, padding: 20 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Sensex Predictor</h1>
          <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>AI-powered market prediction</p>
        </div>

        <div style={{ ...styles.card, padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 16px' }}>
            {isReg ? 'Create account' : 'Sign in'}
          </h2>

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
            <input style={styles.input} type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Min 8 characters" />
          </div>

          <button style={{ ...styles.btnPrimary, opacity: loading ? 0.6 : 1 }} onClick={submit} disabled={loading}>
            {loading ? 'Please wait...' : isReg ? 'Create account' : 'Sign in'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button
              onClick={() => { setIsReg(!isReg); setError(''); }}
              style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: 13, cursor: 'pointer' }}
            >
              {isReg ? 'Already have an account? Sign in' : "Don't have an account? Register"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Live Price Ticker ──
function LivePriceTicker({ livePrice }) {
  if (!livePrice) return null;

  const pick = (...keys) => { for (const k of keys) if (livePrice[k] != null) return livePrice[k]; return null; };
  const symbol = pick('tradingSymbol', 'trading_symbol', 'symbolName', 'symbol_name', 'symbol') || 'SENSEX';
  const ltp = pick('ltp', 'lastTradedPrice', 'last_traded_price', 'lastPrice');
  const open = pick('open', 'openPrice', 'open_price_of_the_day');
  const high = pick('high', 'highPrice', 'high_price_of_the_day');
  const low = pick('low', 'lowPrice', 'low_price_of_the_day');
  const close = pick('close', 'closePrice', 'close_price');
  const volume = pick('volume', 'volumeTradeForTheDay', 'volume_trade_for_the_day', 'totalTradedVolume');
  let change = pick('change', 'netChange', 'net_change');
  let changePct = pick('changePercent', 'percentChange', 'pChange', 'netChangePercent');
  if (change == null && ltp != null && close != null) change = ltp - close;
  if (changePct == null && change != null && close) changePct = (change / close) * 100;
  change = change ?? 0;
  changePct = changePct ?? 0;

  const isUp = change >= 0;
  const changeColor = isUp ? '#22c55e' : '#ef4444';
  const fmtPrice = (v) => v != null ? '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—';

  return (
    <div style={{
      ...styles.card, marginBottom: 16, padding: '16px 20px',
      background: 'linear-gradient(135deg, #1e293b, #0f172a)', color: '#fff', border: 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{symbol}</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 2 }}>{ltp != null ? fmtPrice(ltp) : '—'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: changeColor }}>
            {isUp ? '▲' : '▼'} {isUp ? '+' : ''}{Number(change).toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: changeColor, marginTop: 2 }}>
            ({isUp ? '+' : ''}{Number(changePct).toFixed(2)}%)
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        {[['Open', open], ['High', high], ['Low', low], ['Volume', volume]].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, color: '#e2e8f0' }}>
              {label === 'Volume' ? (val != null ? Number(val).toLocaleString('en-IN') : '—') : fmtPrice(val)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: '#475569', textAlign: 'right' }}>
        LIVE
        <span style={{
          display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
          background: '#22c55e', marginLeft: 4, verticalAlign: 'middle', animation: 'pulse 2s infinite',
        }} />
      </div>
    </div>
  );
}

// ── Connection Status Badge ──
function ConnectionBadge({ connected, error }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 10px', borderRadius: 12,
      background: connected ? '#f0fdf4' : error ? '#fef2f2' : '#fffbeb',
      border: `1px solid ${connected ? '#bbf7d0' : error ? '#fecaca' : '#fde68a'}`,
      fontSize: 11, color: connected ? '#16a34a' : error ? '#dc2626' : '#d97706',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: connected ? '#22c55e' : error ? '#ef4444' : '#f59e0b',
      }} />
      {connected ? 'Live' : error ? 'Disconnected' : 'Connecting…'}
    </div>
  );
}

// ── Dashboard ──
function Dashboard({ user, onLogout }) {
  const [restPrediction, setRestPrediction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [horizon, setHorizon] = useState('1D');
  const [lastRestUpdate, setLastRestUpdate] = useState(null);

  const { connected, livePrediction, livePrice, connectionError, setHorizon: wsSetHorizon } = useStomp();

  // Prefer live WebSocket prediction when it matches the selected horizon
  const isLive = connected && livePrediction?.horizon === horizon;
  const prediction = isLive ? livePrediction : restPrediction;

  // When user switches tab: tell backend to stream this horizon
  const switchHorizon = useCallback((h) => {
    setHorizon(h);
    wsSetHorizon(h);
  }, [wsSetHorizon]);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.predict(horizon);
      setRestPrediction(data);
      setLastRestUpdate(new Date());
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED') { onLogout(); return; }
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [horizon, onLogout]);

  // REST fetch on mount and horizon change (provides initial data before WS kicks in)
  useEffect(() => { fetch_(); }, [fetch_]);

  // Fallback polling only when WebSocket is disconnected
  useEffect(() => {
    if (connected) return;
    const i = setInterval(fetch_, 5 * 60 * 1000);
    return () => clearInterval(i);
  }, [fetch_, connected]);

  const dir = prediction?.direction || 'NEUTRAL';
  const isBull = dir === 'BULLISH' || dir === 'BUY';
  const isBear = dir === 'BEARISH' || dir === 'SELL';
  const color = isBull ? '#22c55e' : isBear ? '#ef4444' : '#f59e0b';
  const bg = isBull ? '#f0fdf4' : isBear ? '#fef2f2' : '#fffbeb';
  const arrow = isBull ? '▲' : isBear ? '▼' : '▬';
  const dirLabel = isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL';

  const fmtVol = (v) => {
    if (v == null) return 'N/A';
    const n = Number(v);
    return (n > 1 ? n.toFixed(1) : (n * 100).toFixed(1)) + '%';
  };

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Sensex Predictor</span>
          <ConnectionBadge connected={connected} error={connectionError} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#888' }}>{user.name}</span>
          <button style={styles.btnOutline} onClick={onLogout}>Sign out</button>
        </div>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: 16 }}>
        {/* Live market price — always streaming */}
        <LivePriceTicker livePrice={livePrice} />

        {/* Horizon tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['1D', '3D', '1W'].map(h => (
            <button key={h} onClick={() => switchHorizon(h)} style={{
              flex: 1, padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: horizon === h ? '#2563eb' : '#fff', color: horizon === h ? '#fff' : '#666',
              border: horizon === h ? 'none' : '1px solid #e5e7eb',
            }}>
              {h === '1D' ? '1 Day' : h === '3D' ? '3 Days' : '1 Week'}
            </button>
          ))}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {loading && !prediction ? (
          <div style={{ ...styles.card, padding: 32, textAlign: 'center' }}>
            <div style={{ color: '#888', fontSize: 14 }}>Loading prediction...</div>
          </div>
        ) : prediction ? (
          <div style={styles.card}>
            {/* Live indicator */}
            {isLive && (
              <div style={{
                padding: '6px 20px', background: '#f0fdf4',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Live AI Signal
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: '#22c55e', marginLeft: 4, verticalAlign: 'middle',
                    animation: 'pulse 2s infinite',
                  }} />
                </span>
                {prediction.engine && (
                  <span style={{ fontSize: 10, color: '#888' }}>{prediction.engine} Engine</span>
                )}
              </div>
            )}

            {/* Direction banner */}
            <div style={{ background: bg, padding: '24px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 36, color }}>{arrow}</span>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color }}>{dirLabel}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  Confidence: {prediction.confidence != null ? Number(prediction.confidence).toFixed(1) + '%' : 'N/A'}
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              {[
                ['Magnitude', prediction.magnitude != null ? (Number(prediction.magnitude) >= 0 ? '+' : '') + Number(prediction.magnitude).toFixed(2) + '%' : 'N/A'],
                ['Volatility', fmtVol(prediction.predictedVolatility)],
                ['Current', prediction.currentSensex ? '₹' + Number(prediction.currentSensex).toLocaleString('en-IN') : 'N/A'],
                ['Target', prediction.targetSensex ? '₹' + Number(prediction.targetSensex).toLocaleString('en-IN') : 'N/A'],
              ].map(([label, val]) => (
                <div key={label} style={{ ...styles.metric, borderTop: '1px solid #f3f4f6' }}>
                  <div style={styles.metricLabel}>{label}</div>
                  <div style={styles.metricValue}>{val}</div>
                </div>
              ))}
            </div>

            {(prediction.modelsUsed || prediction.predictionDate) && (
              <div style={{ padding: '10px 18px', borderTop: '1px solid #f3f4f6', fontSize: 11, color: '#aaa', display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  {prediction.modelsUsed && `Ensemble of ${prediction.modelsUsed} models`}
                  {prediction.directionScore != null && ` | Score: ${Number(prediction.directionScore).toFixed(3)}`}
                </span>
                {prediction.predictionDate && <span>{prediction.predictionDate}</span>}
              </div>
            )}
          </div>
        ) : (
          <div style={{ ...styles.card, padding: 24 }}>
            <p style={{ color: '#888', fontSize: 13, margin: 0 }}>No prediction available. ML service may be starting up.</p>
            <button onClick={fetch_} style={{ ...styles.btnOutline, marginTop: 12 }}>Retry</button>
          </div>
        )}

        {/* Status footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <button onClick={fetch_} style={styles.btnOutline}>Refresh now</button>
          <span style={{ fontSize: 11, color: '#aaa' }}>
            {isLive
              ? 'Streaming live'
              : lastRestUpdate
                ? `Updated: ${lastRestUpdate.toLocaleTimeString()}`
                : ''}
          </span>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: '#f9fafb', borderRadius: 8, fontSize: 11, color: '#999', textAlign: 'center' }}>
          Market hours: Mon-Fri 9:15 AM - 3:30 PM IST
          {connected
            ? ' | Live updates via WebSocket'
            : ' | Fallback: auto-refreshes every 5 min'}
        </div>
      </div>
    </div>
  );
}

// ── App ──
export default function Home() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(api.init());
    setReady(true);
  }, []);

  const logout = () => { api.logout(); setUser(null); };

  if (!ready) return null;
  if (!user) return <Login onLogin={setUser} />;
  return <Dashboard user={user} onLogout={logout} />;
}