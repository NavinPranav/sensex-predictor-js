'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const WS_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080') + '/ws';

const RECONNECT_DELAY = 5000;

/**
 * Manages a STOMP-over-SockJS connection with auto-reconnect.
 *
 * - Subscribes to /topic/live-predictions (one horizon at a time)
 * - Subscribes to /topic/live-prices (always streaming raw market data)
 * - Sends horizon changes to /app/set-horizon
 *
 * @returns {{ connected, livePrediction, livePrice, connectionError, setHorizon }}
 */
export function useStomp() {
  const clientRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [livePrediction, setLivePrediction] = useState(null);
  const [livePrice, setLivePrice] = useState(null);
  const activeHorizonRef = useRef('1D');

  const connect = useCallback(() => {
    if (clientRef.current?.active) return;

    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      reconnectDelay: RECONNECT_DELAY,

      onConnect: () => {
        setConnected(true);
        setConnectionError(null);

        client.subscribe('/topic/live-predictions', (msg) => {
          try {
            const data = JSON.parse(msg.body);
            console.log('[WS] /topic/live-predictions:', data);
            setLivePrediction(data);
          } catch { /* ignore malformed frames */ }
        });

        client.subscribe('/topic/live-prices', (msg) => {
          try {
            const data = JSON.parse(msg.body);
            console.log('[WS] /topic/live-prices:', data);
            setLivePrice(data);
          } catch { /* ignore malformed frames */ }
        });

        // Tell backend to stream predictions for the current horizon
        client.publish({
          destination: '/app/set-horizon',
          body: JSON.stringify({ horizon: activeHorizonRef.current }),
        });
      },

      onStompError: (frame) => {
        setConnectionError(frame.headers?.message || 'STOMP error');
        setConnected(false);
      },

      onWebSocketClose: () => {
        setConnected(false);
      },

      onDisconnect: () => {
        setConnected(false);
      },
    });

    clientRef.current = client;
    client.activate();
  }, []);

  const disconnect = useCallback(() => {
    if (clientRef.current?.active) {
      clientRef.current.deactivate();
    }
    clientRef.current = null;
    setConnected(false);
  }, []);

  const setHorizon = useCallback((horizon) => {
    activeHorizonRef.current = horizon;
    setLivePrediction(null);
    try {
      if (clientRef.current?.connected) {
        clientRef.current.publish({
          destination: '/app/set-horizon',
          body: JSON.stringify({ horizon }),
        });
        console.log('[WS] Sent /app/set-horizon:', horizon);
      } else {
        console.warn('[WS] Not connected — horizon will be sent on reconnect');
      }
    } catch (e) {
      console.warn('[WS] Could not send horizon:', e.message);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { connected, livePrediction, livePrice, connectionError, setHorizon };
}
