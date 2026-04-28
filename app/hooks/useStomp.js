'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const WS_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080') + '/ws';

const RECONNECT_DELAY = 5000;

/**
 * STOMP-over-SockJS with JWT on CONNECT.
 *
 * - Subscribes to /user/topic/live-predictions (per-user queue)
 * - Subscribes to /user/topic/live-prices
 * - Sends horizon to /app/predict/subscribe (starts live AI prediction loop server-side)
 */
export function useStomp(accessToken) {
  const clientRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [livePrediction, setLivePrediction] = useState(null);
  const [livePrice, setLivePrice] = useState(null);
  const activeHorizonRef = useRef('15M');

  const disconnect = useCallback(() => {
    const c = clientRef.current;
    if (c?.connected) {
      try {
        c.publish({ destination: '/app/predict/unsubscribe', body: '{}' });
      } catch {
        /* ignore */
      }
    }
    if (c?.active) {
      c.deactivate();
    }
    clientRef.current = null;
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!accessToken) {
      return;
    }
    if (clientRef.current?.active) {
      return;
    }

    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      connectHeaders: {
        Authorization: 'Bearer ' + accessToken,
      },
      reconnectDelay: RECONNECT_DELAY,

      onConnect: () => {
        setConnected(true);
        setConnectionError(null);

        client.subscribe('/user/topic/live-predictions', (msg) => {
          try {
            const data = JSON.parse(msg.body);
            setLivePrediction(data);
          } catch {
            /* ignore malformed frames */
          }
        });

        client.subscribe('/user/topic/live-prices', (msg) => {
          try {
            setLivePrice(JSON.parse(msg.body));
          } catch {
            /* ignore */
          }
        });

        client.publish({
          destination: '/app/predict/subscribe',
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
  }, [accessToken]);

  const setHorizon = useCallback((horizon) => {
    activeHorizonRef.current = horizon;
    setLivePrediction(null);
    try {
      if (clientRef.current?.connected) {
        clientRef.current.publish({
          destination: '/app/predict/subscribe',
          body: JSON.stringify({ horizon }),
        });
      }
    } catch (e) {
      console.warn('[WS] Could not send horizon:', e.message);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) {
      disconnect();
      return undefined;
    }
    connect();
    return () => disconnect();
  }, [accessToken, connect, disconnect]);

  return { connected, livePrediction, livePrice, connectionError, setHorizon };
}
