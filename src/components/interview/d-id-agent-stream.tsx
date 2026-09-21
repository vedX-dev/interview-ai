"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { createAgentManager, AgentManager } from "@d-id/client-sdk";

export interface DIdAgentStreamHandle {
  speak: (text: string) => Promise<void>;
  isConnected: boolean;
}

interface DIdAgentStreamProps {
  agentId?: string;
  clientKey?: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
}

export const DIdAgentStream = forwardRef<DIdAgentStreamHandle, DIdAgentStreamProps>(
  ({ agentId, clientKey, onConnected, onDisconnected, onError }, ref) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const agentManagerRef = useRef<AgentManager | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [videoState, setVideoState] = useState<string>("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const activeAgentId = agentId || process.env.NEXT_PUBLIC_D_ID_AGENT_ID || "v2_agt_u7SXmJRa";
    const activeClientKey = clientKey || process.env.NEXT_PUBLIC_D_ID_CLIENT_KEY;

    useImperativeHandle(
      ref,
      () => ({
        async speak(text: string) {
          if (!agentManagerRef.current || !isConnected) {
            console.warn("[D-ID STREAM] Agent not connected, cannot speak");
            return;
          }
          const tSpeakStart = performance.now();
          try {
            console.log(`[PERF TIMING] [D-ID SPEAK START] t=${tSpeakStart.toFixed(1)}ms - Text length: ${text.length}`);
            await agentManagerRef.current.speak({ type: "text", input: text });
            console.log(`[PERF TIMING] [D-ID SPEAK DISPATCHED] t=${performance.now().toFixed(1)}ms (duration: ${(performance.now() - tSpeakStart).toFixed(1)}ms)`);
          } catch (err: any) {
            console.error("[D-ID STREAM] Error in speak():", err);
            throw err;
          }
        },
        isConnected,
      }),
      [isConnected]
    );

    useEffect(() => {
      if (!activeClientKey || !activeAgentId) {
        console.warn("[D-ID STREAM] Client Key or Agent ID not configured, WebRTC stream skipped");
        return;
      }

      let isMounted = true;
      const connectStartTime = performance.now();

      async function initAgent() {
        if (!activeClientKey || !activeAgentId) {
          console.warn("[D-ID STREAM] Client Key or Agent ID not configured");
          return;
        }

        try {
          setIsConnecting(true);
          setErrorMessage(null);
          console.log(`[PERF TIMING] [D-ID CONNECT INIT] t=${connectStartTime.toFixed(1)}ms - Agent ID:`, activeAgentId);

          const manager = await createAgentManager(activeAgentId, {
            auth: {
              type: "key",
              clientKey: activeClientKey,
            },
            callbacks: {
              onSrcObjectReady(srcObject: MediaStream) {
                console.log(`[PERF TIMING] [D-ID WEBRTC MEDIA READY] t=${performance.now().toFixed(1)}ms`);
                if (videoRef.current) {
                  videoRef.current.srcObject = srcObject;
                  videoRef.current.play().catch((e) => console.warn("[D-ID STREAM] Video play error:", e));
                }
              },
              onConnectionStateChange(state: string) {
                const now = performance.now();
                console.log(`[PERF TIMING] [D-ID STATE CHANGE] ${state} at t=${now.toFixed(1)}ms (elapsed: ${(now - connectStartTime).toFixed(1)}ms)`);
                if (state === "connected") {
                  if (isMounted) {
                    setIsConnected(true);
                    setIsConnecting(false);
                    onConnected?.();
                  }
                } else if (state === "disconnected" || state === "failed" || state === "closed") {
                  if (isMounted) {
                    setIsConnected(false);
                    setIsConnecting(false);
                    onDisconnected?.();
                  }
                }
              },
              onVideoStateChange(state: any) {
                console.log("[D-ID STREAM] Video state change:", state);
                if (isMounted) {
                  setVideoState(String(state));
                }
              },
              onError(err: Error) {
                console.error("[D-ID STREAM] Manager error:", err);
                if (isMounted) {
                  setErrorMessage(err.message || "D-ID WebRTC Stream Error");
                  setIsConnecting(false);
                  onError?.(err);
                }
              },
            },
          });

          if (!isMounted) {
            await manager.disconnect().catch(() => {});
            return;
          }

          agentManagerRef.current = manager;
          console.log(`[PERF TIMING] [D-ID CONNECT CALL] t=${performance.now().toFixed(1)}ms`);
          await manager.connect();
        } catch (err: any) {
          console.error("[D-ID STREAM] Failed to initialize agent manager:", err);
          if (isMounted) {
            setErrorMessage(err?.message || "Failed to connect D-ID Agent");
            setIsConnecting(false);
            onError?.(err);
          }
        }
      }

      initAgent();

      return () => {
        isMounted = false;
        if (agentManagerRef.current) {
          console.log("[D-ID STREAM] Disconnecting Agent Manager");
          agentManagerRef.current.disconnect().catch((e) => console.warn("[D-ID STREAM] Disconnect warning:", e));
          agentManagerRef.current = null;
        }
      };
    }, [activeAgentId, activeClientKey, onConnected, onDisconnected, onError]);

    if (!activeClientKey) {
      return null;
    }

    return (
      <div className="relative h-full w-full bg-black flex items-center justify-center overflow-hidden rounded-xl border border-purple-900/40 shadow-inner">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            isConnected ? "opacity-100" : "opacity-0 absolute"
          }`}
        />

        {isConnecting && (
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-purple-500/30 border-t-purple-500" />
            <span className="text-xs font-medium text-purple-300">Connecting Real-Time Avatar...</span>
          </div>
        )}

        {errorMessage && !isConnected && (
          <div className="p-4 text-center text-xs text-amber-400 bg-amber-950/20 border border-amber-900/40 rounded-lg max-w-xs">
            <span>D-ID WebRTC Stream: {errorMessage}</span>
          </div>
        )}

        {isConnected && (
          <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 backdrop-blur-md border border-purple-800/50">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-semibold text-purple-200">Real-Time D-ID Agent</span>
          </div>
        )}
      </div>
    );
  }
);

DIdAgentStream.displayName = "DIdAgentStream";
