import { useQueryClient } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { useEffect } from "react";
import { ChangeNotification } from "@effect-app/api/drive/api";
import { changeStreamUrl } from "./drive-api";
import { driveKeys } from "./drive-queries";

const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 2_000;
const SILENCE_LIMIT_MS = 7_000;
const WATCHDOG_INTERVAL_MS = 1_000;
const INVALIDATE_DELAY_MS = 50;

const decodeNotification = Schema.decodeUnknownOption(Schema.fromJsonString(ChangeNotification));

export const useDriveChangeStream = (onDisconnected: () => void) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    let source: EventSource | undefined;
    let lastCursor: string | undefined;
    let lastMessageAt = Date.now();
    let caughtUp = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectPending = false;
    let invalidateTimer: ReturnType<typeof setTimeout> | undefined;

    const invalidate = () => {
      clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: driveKeys.all });
      }, INVALIDATE_DELAY_MS);
    };

    const connect = () => {
      clearTimeout(reconnectTimer);
      reconnectPending = false;
      source?.close();
      caughtUp = false;
      lastMessageAt = Date.now();
      const current = new EventSource(changeStreamUrl());
      source = current;
      current.onmessage = (event) => {
        lastMessageAt = Date.now();
        attempts = 0;
        const cursor = Option.getOrUndefined(decodeNotification(event.data))?.cursor;
        if (cursor === undefined) return;
        const reconnected = !caughtUp && lastCursor !== undefined;
        caughtUp = true;
        if (reconnected || (lastCursor !== undefined && cursor !== lastCursor)) invalidate();
        lastCursor = cursor;
      };
      current.onerror = () => {
        if (source !== current) return;
        if (current.readyState === EventSource.CLOSED) onDisconnected();
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      source?.close();
      clearTimeout(reconnectTimer);
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempts);
      attempts += 1;
      reconnectPending = true;
      reconnectTimer = setTimeout(connect, delay);
    };

    const healthy = () =>
      source !== undefined &&
      source.readyState === EventSource.OPEN &&
      Date.now() - lastMessageAt < SILENCE_LIMIT_MS;

    const watchdog = setInterval(() => {
      if (!reconnectPending && Date.now() - lastMessageAt >= SILENCE_LIMIT_MS) connect();
    }, WATCHDOG_INTERVAL_MS);

    const reconnectIfUnhealthy = () => {
      if (document.visibilityState === "visible" && !healthy()) {
        attempts = 0;
        connect();
      }
    };
    window.addEventListener("online", reconnectIfUnhealthy);
    document.addEventListener("visibilitychange", reconnectIfUnhealthy);

    connect();
    return () => {
      clearInterval(watchdog);
      clearTimeout(reconnectTimer);
      clearTimeout(invalidateTimer);
      window.removeEventListener("online", reconnectIfUnhealthy);
      document.removeEventListener("visibilitychange", reconnectIfUnhealthy);
      source?.close();
    };
  }, [queryClient, onDisconnected]);
};
