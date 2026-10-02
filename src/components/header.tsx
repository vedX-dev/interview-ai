"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

export function Header() {
  const pathname = usePathname();
  const [showAbout, setShowAbout] = useState(false);

  // Render navbar strictly on the hero page ("/") only
  if (pathname !== "/") {
    return null;
  }

  return (
    <>
      <header className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-5xl rounded-full glass-nav px-5 py-2.5 flex items-center justify-between transition-all duration-300 shadow-2xl">
        {/* Left Side: Logo Icon + Brand Name */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center transition-transform group-hover:scale-105 shadow-inner">
            <svg
              className="w-4.5 h-4.5 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <ellipse cx="12" cy="12" rx="9" ry="3" transform="rotate(30 12 12)" />
              <ellipse cx="12" cy="12" rx="9" ry="3" transform="rotate(90 12 12)" />
              <ellipse cx="12" cy="12" rx="9" ry="3" transform="rotate(150 12 12)" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <span className="font-semibold text-sm sm:text-base text-white tracking-tight">
            Intervia
          </span>
        </Link>

        {/* Right Side: About & Authentication */}
        <div className="flex items-center gap-5 text-xs sm:text-sm font-medium">
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            className="text-zinc-300 hover:text-white transition-colors cursor-pointer"
          >
            About
          </button>

          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="text-zinc-300 hover:text-white transition-colors px-1 py-1">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="bg-white text-black font-semibold text-xs sm:text-sm rounded-full px-4.5 py-1.5 transition-all hover:bg-zinc-200 active:scale-95 shadow-md cursor-pointer">
                Sign up
              </button>
            </SignUpButton>
          </Show>

          <Show when="signed-in">
            <Link
              href="/dashboard"
              className="text-zinc-300 hover:text-white transition-colors"
            >
              Dashboard
            </Link>
            <UserButton />
          </Show>
        </div>
      </header>

      {/* About Modal */}
      {showAbout && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md px-4 animate-in fade-in duration-200"
          onClick={() => setShowAbout(false)}
        >
          <div
            className="relative w-full max-w-lg glass-card rounded-2xl p-8 border border-white/10 text-zinc-100 shadow-2xl space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polygon points="12 2 2 7 12 12 22 7 12 2" />
                    <polyline points="2 17 12 22 22 17" />
                    <polyline points="2 12 12 17 22 12" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white tracking-tight">
                  About Intervia
                </h3>
              </div>
              <button
                onClick={() => setShowAbout(false)}
                className="text-zinc-400 hover:text-white text-xl leading-none p-1"
              >
                &times;
              </button>
            </div>

            <p className="text-sm text-zinc-300 leading-relaxed">
              Intervia is a Tier-1 autonomous technical interview platform powered by adaptive AI models.
              It conducts dynamic code evaluations, real-time voice & text technical dialogue, and instant candidate feedback loops.
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
                <div className="font-semibold text-white">Adaptive Evaluation</div>
                <div className="text-zinc-400">Contextual multi-turn technical probing.</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
                <div className="font-semibold text-white">Instant Scoring</div>
                <div className="text-zinc-400">Comprehensive feedback and breakdown reports.</div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowAbout(false)}
                className="bg-white text-black font-semibold text-xs rounded-lg px-4 py-2 hover:bg-zinc-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
