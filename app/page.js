'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useStomp } from './hooks/useStomp';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

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
      localStorage.setItem('user', JSON.stringify({ name: data.name, email: data.email }));
    }
    return data;
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
  async getOhlcv(period, interval) {
    const res = await fetch(`${API}/api/market/sensex/ohlcv?period=${period}&interval=${interval}`, {
      headers: { Authorization: 'Bearer ' + this.token },
    });
    if (res.status === 401) throw new Error('SESSION_EXPIRED');
    if (!res.ok) return [];
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
      onLogin({ name: data.name, email: data.email });
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

// ── Candlestick chart ──
function CandlestickChart({ candles, liveCandle, signal }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let chart, series;

    import('lightweight-charts').then(({ createChart, CrosshairMode }) => {
      if (!containerRef.current) return;
      chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 220,
        layout: { background: { type: 'solid', color: '#0f172a' }, textColor: '#94a3b8' },
        grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: { borderColor: '#334155', timeVisible: true, secondsVisible: false },
        handleScroll: true,
        handleScale: true,
      });

      series = chart.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      });

      chartRef.current = chart;
      seriesRef.current = series;

      const ro = new ResizeObserver(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        }
      });
      ro.observe(containerRef.current);
    });

    return () => {
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
    <div style={{ ...styles.card, overflow: 'hidden', marginBottom: 0 }}>
      <div style={{ padding: '10px 16px', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase' }}>Bank Nifty · 5 min candles</span>
        <span style={{ fontSize: 10, color: '#475569' }}>live ticks streamed</span>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: 220, background: '#0f172a' }} />
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
    const inner = idx === 0 ? slide0Ref.current : slide1Ref.current;
    if (!inner) return;
    const h = inner.offsetHeight;
    if (h > 0) setVpHeight(h);
  }, []);

  useLayoutEffect(() => {
    measureActiveSlide();
  }, [measureActiveSlide, livePrice, candles, liveCandle, signal]);

  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    vp.addEventListener('scroll', measureActiveSlide, { passive: true });
    return () => vp.removeEventListener('scroll', measureActiveSlide);
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
function ProfileMenu({ userName, onLogout }) {
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
          <button type="button" className="profile-menu__signout" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}

// ── Dashboard ──
function Dashboard({ user, accessToken, onLogout }) {
  const [restPrediction, setRestPrediction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [horizon, setHorizon] = useState('15M');
  const [session, setSession] = useState(getMarketSession());
  const [minsToClose, setMinsToClose] = useState(minutesToClose());
  const [chartCandles, setChartCandles] = useState([]);
  const [liveCandle, setLiveCandle] = useState(null);
  const liveTickRef = useRef(null);

  const { connected, livePrediction, livePrice, connectionError, setHorizon: wsSetHorizon } = useStomp(accessToken);

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

  // Load chart OHLCV
  useEffect(() => {
    const intervalCode = horizon === '5M' ? '1M' : '5M';
    const periodCode = horizon === '5M' ? '3D' : '5D';
    api.getOhlcv(periodCode, intervalCode)
      .then(rows => setChartCandles(toChartCandles(rows)))
      .catch(() => {});
  }, [horizon]);

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

  const dir = prediction?.direction || 'HOLD';
  const isBull = dir === 'BUY' || dir === 'BULLISH';
  const isBear = dir === 'SELL' || dir === 'BEARISH';
  const isHold = !isBull && !isBear;
  const signalColor = isBull ? '#22c55e' : isBear ? '#ef4444' : '#f59e0b';
  const signalBg   = isBull ? '#f0fdf4' : isBear ? '#fef2f2' : '#fffbeb';
  const signalArrow = isBull ? '▲' : isBear ? '▼' : '▬';
  const signalLabel = isBull ? 'BUY' : isBear ? 'SELL' : 'HOLD';


  const aiText = (() => {
    const q = (prediction?.aiQuotaNotice || '').trim();
    const r = (prediction?.predictionReason || '').trim();
    if (!q && !r) return '';
    if (q && r) return `${q}\n\n${r}`;
    return q || r;
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
      {/* Sticky header */}
      <header className="dashboard-sticky-header">
        <div className="top-bar-row top-bar-row--compact-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Bank Nifty</span>
            <SessionBadge session={session} minutesToCloseVal={minsToClose} />
          </div>
          <ProfileMenu userName={user.name} onLogout={onLogout} />
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

        <footer className="dashboard-page-footer">
          Bank Nifty spot · Mon–Fri 9:15 AM–3:30 PM IST
          {isLive ? ' · Live AI signal' : ' · REST fallback every 5 min'}
          {connected ? ' · WebSocket connected' : ' · WebSocket disconnected'}
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

  const logout = () => { api.logout(); setUser(null); setAccessToken(null); };
  const onLogin = (u) => { setUser(u); setAccessToken(api.token); };

  if (!ready) return null;
  if (!user) return <Login onLogin={onLogin} />;
  return <Dashboard user={user} accessToken={accessToken} onLogout={logout} />;
}
