'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
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

  async getInstruments() {
    const res = await fetch(API + '/api/instruments', {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) throw new Error('Failed to fetch instruments');
    return res.json();
  },

  async getActiveInstruments() {
    const res = await fetch(API + '/api/instruments/active', {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) throw new Error('Failed to fetch active instruments');
    return res.json();
  },

  async switchInstrument(id) {
    const res = await fetch(API + '/api/instruments/' + id + '/switch', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) throw new Error('Failed to switch instrument');
    return res.json();
  },

  async activateInstrument(id) {
    const res = await fetch(API + '/api/instruments/' + id + '/activate', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) throw new Error('Failed to activate instrument');
    return res.json();
  },

  async deactivateInstrument(id) {
    const res = await fetch(API + '/api/instruments/' + id + '/deactivate', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) throw new Error('Failed to deactivate instrument');
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

/** Parse STOMP live-prices payload (Bank Nifty stream only). */
function extractBankNiftyLiveFields(livePrice) {
  if (!livePrice) return null;
  const pick = (...keys) => {
    for (const k of keys) if (livePrice[k] != null) return livePrice[k];
    return null;
  };
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
  return {
    ltp,
    open,
    high,
    low,
    close,
    volume,
    change: change ?? 0,
    changePct: changePct ?? 0,
  };
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
      <div className="login-shell">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Bank Nifty outlook</h1>
          <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>AI-assisted Bank Nifty prediction</p>
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

// ── Full-width live strip: Bank Nifty only (never broker symbol names) ──
function BankNiftyLiveStreamBanner({ livePrice, connected, connectionError }) {
  const BN = 'Bank Nifty';
  const fmtPrice = (v) => (v != null ? '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—');
  const f = extractBankNiftyLiveFields(livePrice);
  if (!f) {
    const msg = !connected
      ? (connectionError ? `${BN} — ${connectionError}` : `${BN} — connect to stream live`)
      : `${BN} — waiting for first tick…`;
    return (
      <div className="live-stream-banner live-stream-banner--muted">
        {msg}
      </div>
    );
  }
  const { ltp, change, changePct } = f;
  const isUp = change >= 0;
  const changeColor = isUp ? '#4ade80' : '#f87171';
  return (
    <div className="live-stream-banner live-stream-banner--live">
      <span className="live-stream-banner__ltp">{ltp != null ? fmtPrice(ltp) : '—'}</span>
      <span className="live-stream-banner__chg" style={{ color: changeColor }}>
        {isUp ? '▲' : '▼'} {isUp ? '+' : ''}{Number(change).toFixed(2)}
        <span style={{ opacity: 0.9, marginLeft: 6 }}>
          ({isUp ? '+' : ''}{Number(changePct).toFixed(2)}%)
        </span>
      </span>
    </div>
  );
}

// ── Bank Nifty session stats (LTP lives in top banner only) ──
function LivePriceTicker({ livePrice }) {
  if (!livePrice) return null;
  const f = extractBankNiftyLiveFields(livePrice);
  if (!f) return null;
  const { open, high, low, volume } = f;
  const fmtPrice = (v) => (v != null ? '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—');

  return (
    <div className="session-ticker">
      <div style={{ fontSize: 11, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        Bank Nifty · session
      </div>
      <div className="session-ticker__grid">
        {[['Open', open], ['High', high], ['Low', low], ['Volume', volume]].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: '#f8fafc', letterSpacing: '0.01em' }}>
              {label === 'Volume' ? (val != null ? Number(val).toLocaleString('en-IN') : '—') : fmtPrice(val)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IndexSymbolMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouse = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="index-symbol-menu">
      <button
        type="button"
        className="index-symbol-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Bank Nifty"
        aria-label="Show index name (Bank Nifty)"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 3v18h18" />
          <path d="M7 15l4-4 4 4 6-8" />
        </svg>
      </button>
      {open ? (
        <div className="index-symbol-menu__dropdown" role="dialog" aria-label="Index">
          <div className="index-symbol-menu__title">Bank Nifty</div>
          <div className="index-symbol-menu__subtitle">NSE index · spot stream</div>
        </div>
      ) : null}
    </div>
  );
}

function ProfileMenu({ userName, onLogout }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouse = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={'profile-menu' + (open ? ' profile-menu--open' : '')}>
      <div className="profile-menu__hover-zone">
        <button
          type="button"
          className="profile-menu__trigger"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`Account menu for ${userName}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </button>
        <div className="profile-menu__name-pop" aria-hidden="true">
          {userName}
        </div>
      </div>
      {open ? (
        <div className="profile-menu__dropdown" role="menu" aria-orientation="vertical">
          <button
            type="button"
            className="profile-menu__signout"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Bank Nifty: sole underlying for live ticks + predictions (showcase) ──
// Commented out for now — "Index / Bank Nifty" chip in top bar.
// function BankNiftyBadge() {
//   return (
//     <div style={{
//       display: 'flex', alignItems: 'center', gap: 8,
//       padding: '6px 12px', borderRadius: 8,
//       border: '1px solid #e5e7eb', background: '#fff',
//       fontSize: 13, fontWeight: 600, color: '#0f172a',
//     }}>
//       <span style={{
//         fontSize: 9, fontWeight: 700, color: '#64748b', letterSpacing: 0.6, textTransform: 'uppercase',
//       }}>Index</span>
//       <span>Bank Nifty</span>
//     </div>
//   );
// }

/**
 * News-style strip: rationale scrolls bottom → top; top edge fades via mask (see globals.css).
 * Matches live banner / session ticker colors (#0f172a, #1e3a5f, #93c5fd accents).
 * When `attached` is true, renders flush inside the prediction card (no standalone margins/border).
 */
function AiReasonNewsTicker({ text, attached = false }) {
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
    const v = viewportRef.current;
    const seg = segmentRef.current;
    if (!v || !seg || !text) {
      setMode('fit');
      return;
    }
    const overflows = seg.scrollHeight > v.clientHeight + 6;
    if (reduceMotion && overflows) {
      setMode('reducedScroll');
    } else if (overflows) {
      setMode('scroll');
    } else {
      setMode('fit');
    }
  }, [text, reduceMotion]);

  const duration = Math.min(88, Math.max(18, Math.round((text?.length || 0) / 11)));

  const viewportClass =
    mode === 'reducedScroll'
      ? 'ai-reason-ticker__viewport ai-reason-ticker__viewport--reduced ai-reason-ticker__viewport--scroll'
      : 'ai-reason-ticker__viewport';

  const segmentBlock = (
    <div ref={segmentRef} className="ai-reason-ticker__segment">
      <p className="ai-reason-ticker__text">{text}</p>
    </div>
  );

  return (
    <div
      className={'ai-reason-ticker' + (attached ? ' ai-reason-ticker--attached' : '')}
      role="region"
      aria-label="Prediction rationale"
    >
      <div className="ai-reason-ticker__head">
        <span className="ai-reason-ticker__dot" aria-hidden />
        AI insight
      </div>
      <div ref={viewportRef} className={viewportClass}>
        {mode === 'scroll' ? (
          <div
            className="ai-reason-ticker__track ai-reason-ticker__track--marquee"
            style={{ '--ai-reason-duration': `${duration}s` }}
          >
            {segmentBlock}
            <div className="ai-reason-ticker__segment" aria-hidden="true">
              <p className="ai-reason-ticker__text">{text}</p>
            </div>
          </div>
        ) : mode === 'reducedScroll' ? (
          segmentBlock
        ) : (
          <div className="ai-reason-ticker__track ai-reason-ticker__track--static">{segmentBlock}</div>
        )}
      </div>
    </div>
  );
}

/** Merges Gemini quota notice into the same copy shown in AI insight (replaces the old yellow banner). */
function buildAiInsightText(quotaNotice, predictionReason) {
  const q = (quotaNotice || '').trim();
  const r = (predictionReason || '').trim();
  if (!q && !r) return '';
  let body;
  if (q && r) {
    if (q.includes(r) || r.includes(q)) {
      body = q.length >= r.length ? q : r;
    } else {
      body = `${q}\n\n${r}`;
    }
  } else {
    body = q || r;
  }
  if (q) {
    return `Gemini quota / rate limit\n\n${body}`;
  }
  return body;
}

// ── Dashboard ──
function Dashboard({ user, accessToken, onLogout }) {
  const [restPrediction, setRestPrediction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [horizon, setHorizon] = useState('1D');
  const [lastRestUpdate, setLastRestUpdate] = useState(null);

  const { connected, livePrediction, livePrice, connectionError, setHorizon: wsSetHorizon } = useStomp(accessToken);

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

  const aiReason =
    prediction?.predictionReason ??
    prediction?.prediction_reason ??
    '';
  const aiInsightText = prediction
    ? buildAiInsightText(prediction?.aiQuotaNotice, aiReason)
    : '';

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
    <div className="dashboard-root" style={styles.page}>
      <header className="dashboard-sticky-header">
        <div className="top-bar-row top-bar-row--compact-nav">
          <IndexSymbolMenu />
          <ProfileMenu userName={user.name} onLogout={onLogout} />
        </div>
        <BankNiftyLiveStreamBanner livePrice={livePrice} connected={connected} connectionError={connectionError} />
      </header>

      <div className="dashboard-content">
        {/* Bank Nifty live quote (single stream) */}
        <LivePriceTicker livePrice={livePrice} />

        {/* Horizon tabs */}
        <div className="horizon-tabs">
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
          <div style={{ ...styles.card, position: 'relative' }}>
            <button
              type="button"
              onClick={fetch_}
              disabled={loading}
              aria-label="Refresh prediction"
              title="Refresh prediction"
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 2,
                width: 30,
                height: 30,
                padding: 0,
                borderRadius: 8,
                border: '1px solid #e5e7eb',
                background: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            {/* Live indicator */}
            {isLive && (
              <div style={{
                padding: '6px 44px 6px 20px', background: '#f0fdf4',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
              }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Live AI Signal
                  <span style={{
                    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                    background: '#22c55e', marginLeft: 4, verticalAlign: 'middle',
                    animation: 'pulse 2s infinite',
                  }} />
                </span>
              </div>
            )}

            {/* Direction banner (extra right padding clears absolute refresh control) */}
            <div style={{ background: bg, padding: '24px 48px 24px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 36, color }}>{arrow}</span>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color }}>{dirLabel}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  Confidence: {prediction.confidence != null ? Number(prediction.confidence).toFixed(1) + '%' : 'N/A'}
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="prediction-metrics">
              {[
                ['Magnitude', prediction.magnitude != null ? (Number(prediction.magnitude) >= 0 ? '+' : '') + Number(prediction.magnitude).toFixed(2) + '%' : 'N/A'],
                ['Volatility', fmtVol(prediction.predictedVolatility)],
                ['Index (now)', (prediction.currentPrice ?? prediction.currentSensex) ? '₹' + Number(prediction.currentPrice ?? prediction.currentSensex).toLocaleString('en-IN') : 'N/A'],
                ['Target', (prediction.targetPrice ?? prediction.targetSensex) ? '₹' + Number(prediction.targetPrice ?? prediction.targetSensex).toLocaleString('en-IN') : 'N/A'],
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
            {aiInsightText ? <AiReasonNewsTicker text={aiInsightText} attached /> : null}
          </div>
        ) : (
          <div style={{ ...styles.card, padding: 24 }}>
            <p style={{ color: '#888', fontSize: 13, margin: 0 }}>No prediction available. ML service may be starting up.</p>
            <button onClick={fetch_} style={{ ...styles.btnOutline, marginTop: 12 }}>Retry</button>
          </div>
        )}

        <footer className="dashboard-page-footer">
          Bank Nifty spot, INR · Market hours Mon–Fri 9:15 AM – 3:30 PM IST
          {isLive
            ? ' · Streaming live · Bank Nifty'
            : lastRestUpdate
              ? ` · Updated: ${lastRestUpdate.toLocaleTimeString()}`
              : ''}
          {connected
            ? ' · Live ticks via WebSocket; AI prediction refresh is periodic (default 60s)'
            : ' · Fallback: REST refresh every 5 min'}
        </footer>
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
    setUser(api.init());
    setAccessToken(api.token);
    setReady(true);
  }, []);

  const logout = () => {
    api.logout();
    setUser(null);
    setAccessToken(null);
  };

  const onLogin = (u) => {
    setUser(u);
    setAccessToken(api.token);
  };

  if (!ready) return null;
  if (!user) return <Login onLogin={onLogin} />;
  return <Dashboard user={user} accessToken={accessToken} onLogout={logout} />;
}