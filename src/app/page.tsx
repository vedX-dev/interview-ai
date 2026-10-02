"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

const Orb = dynamic(() => import("@/src/components/ui/Orb"), {
  ssr: false,
});

export default function Home() {
  const router = useRouter();

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-[#09090b] text-[#fafafa] selection:bg-white selection:text-black">
      {/* Background Orb Component */}
      <div className="absolute inset-0 z-0 w-full h-full">
        <Orb
          hoverIntensity={0.5}
          rotateOnHover={true}
          hue={0}
          forceHoverState={false}
          backgroundColor="#09090b"
        />
      </div>

      {/* Hero Content Overlay */}
      <div className="relative z-10 flex flex-col items-center justify-center px-6 text-center max-w-4xl space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-mono tracking-widest text-zinc-300 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          INTERVIA AUTONOMOUS PLATFORM
        </div>

        <h1 className="text-6xl sm:text-7xl md:text-8xl font-bold tracking-tighter text-white drop-shadow-sm">
          Intervia
        </h1>

        <p className="max-w-xl text-base sm:text-lg text-zinc-400 font-normal leading-relaxed">
          AI-powered technical interviews with real-time feedback, dynamic code probing, and comprehensive evaluation.
        </p>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-black transition-all duration-200 hover:bg-zinc-200 shadow-2xl active:scale-95 cursor-pointer"
          >
            Start Interview
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </button>
        </div>
      </div>
    </main>
  );
}
