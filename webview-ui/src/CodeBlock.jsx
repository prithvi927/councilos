import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

export default function CodeBlock({ code }) {
  const [expanded, setExpanded] = useState(false);
  const [highlighted, setHighlighted] = useState("");

  useEffect(() => {
  async function highlight() {
    if (!code) return;

    let html = await codeToHtml(code, {
      lang: "python",
      theme: "one-dark-pro",
    });

    html = html
      .replace(/background-color:[^;"]*;?/g, "")
      .replace(/background:[^;"]*;?/g, "")
      .replace(/style="[^"]*"/g, (match) =>
        match.replace(/margin:[^;]*;/g, "")
      );

    setHighlighted(html);
  }

  highlight();
}, [code]);

  return (
    <div className="mb-10 flex justify-center px-2">
        <div className="w-full max-w-[80%]">

      {/* Code Container */}
      <div
        className={`
          relative z-0
          before:absolute before:inset-0 before:rounded-xl
          before:bg-white/[0.015] before:pointer-events-none
          rounded-xl
          bg-gradient-to-b from-[#05070A] to-[#020305]
          border border-white/5
          shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_20px_60px_rgba(0,0,0,0.6)]
          overflow-hidden
          transition-all duration-300
        `}
      >
        {/* Code Content */}
        <div
          id="code-scroll"
          className={`
          relative z-0
          overflow-auto
          
          [&_pre]:whitespace-pre
          [&_pre]:overflow-x-auto

          [&_pre]:!bg-transparent
          [&_pre]:!m-0
          [&_pre]:!p-5

          [&_.line]:bg-[#020305]
          [&_.line]:border-0

          [&_code]:font-mono
          [&_code]:text-[14px]
          [&_pre]:text-shadow-[0_0_2px_rgba(255,255,255,0.03)]

          ${expanded ? "max-h-[500px]" : "max-h-[220px]"}
        `}
        dangerouslySetInnerHTML={{
          __html: highlighted || "<div class='p-5'>No code selected</div>",
        }}
      />

        {/* Fade Overlay (ONLY when collapsed) */}
        {!expanded && (
          <div className="absolute bottom-0 left-0 w-full h-20 bg-gradient-to-t from-[#020305] via-[#020305]/80 to-transparent pointer-events-none" />
        )}
      </div>

      {/* Toggle Button (GPT style minimal) */}
      <div className="relative z-20 flex justify-center mt-3 mb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs 
                text-gray-400 
                opacity-70 
                hover:opacity-100 
                transition-opacity duration-200
                select-none
                "
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      </div>
    </div>
</div>
  );
}