import { useEffect, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import CodeBlock from "./CodeBlock";
import ReactMarkdown from "react-markdown";
function cleanDisplayText(text) {
  if (!text) return "";

  return text
    .replace(/<\/?think>/g, "") // remove <think>
    .replace(/\*\*/g, "") // remove bold markers
    .replace(/#{1,6}\s?/g, "") // remove markdown headings
    .replace(/___+/g, "") // remove weird separators
    .replace(/```(\w+)?\s+/g, "```$1\n")
    .trim();
}

function HighlightedCode({ code }) {
  const [highlighted, setHighlighted] = useState("");

  useEffect(() => {
    async function highlight() {
      const html = await codeToHtml(code, {
        lang: "python",
        theme: "github-dark",
      });

      setHighlighted(html);
    }

    highlight();
  }, [code]);

  return (
    <div
      className="
        my-4
        overflow-x-auto
        rounded-xl
        border border-white/5
        shadow-[0_10px_30px_rgba(0,0,0,0.45)]
      "
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}


function MessageBubble({ msg, index }) {
  const isRight = index % 2 !== 0;

  return (
    <div className={`flex min-w-0 ${isRight ? "justify-end" : "justify-start"} mb-5`}>
      <div
        className={`
          relative
          transform-gpu
          will-change-transform
          max-w-[55%] min-w-0
          px-3 py-2
          text-sm
          break-words
          overflow-hidden
          leading-relaxed
          text-[#E5E7EB]

          ${isRight ? "rounded-2xl rounded-br-md" : "rounded-2xl rounded-bl-md"}

          bg-gradient-to-b
          ${isRight 
          ? "from-[#3B4A5C] to-[#2E3A48]" 
          : "from-[#1F2937] to-[#17202A]"
        }

          border border-white/5
          shadow-[0_10px_30px_rgba(0,0,0,0.45)]

          after:absolute after:inset-0 ${isRight ? "after:rounded-2xl after:rounded-br-md" : "after:rounded-2xl after:rounded-bl-md"}
          after:bg-white/5 after:opacity-[0.02]
          after:pointer-events-none
        `}
      >
        <div className="text-[11px] opacity-60 mb-1">
          {msg.agent}
        </div>
        <ReactMarkdown
          components={{
            ul: ({ children }) => (
              <ul className="space-y-2 my-3">
                {children}
              </ul>
            ),

            ol: ({ children }) => (
              <ul className="space-y-2 my-3">
                {children}
              </ul>
            ),

            li: ({ children }) => (
              <li className="flex items-start gap-3">
                <span className="mt-[7px] h-2 w-2 rounded-full bg-[#8FE388] shadow-[0_0_10px_#8FE388]" />
                <span>{children}</span>
              </li>
            ),
            
            code({ className, children }) {
              const isBlock = className?.includes("language-");

              const codeString = String(children).trim();

              if (!isBlock && codeString.length < 120) {
                return (
                  <code
                    className="
                      px-1.5 py-0.5
                      rounded-md
                      bg-[#11161D]
                      text-[#8FE388]
                      font-mono
                      text-[13px]
                      break-words
                    "
                >
                  {children}
                </code>
              );
            }

            return <HighlightedCode code={codeString} />;
          },

          }}
        >
          {cleanDisplayText(msg.content)}
        </ReactMarkdown>
      </div>
    </div>
  );
}


function TypingIndicator({ agent, isRight }) {
  if (!agent) return null;

  return (
    <div
      className={`
      flex items-center gap-3 mb-5 px-2
      ${isRight ? "justify-end" : "justify-start"}
      `}
    >
      
      {/* Model Initial Orb */}
      <div
        className="
          h-8 w-8
          rounded-full
          flex items-center justify-center
          bg-[#273244]
          text-[#E5E7EB]
          text-sm font-medium
          shadow-[0_0_12px_rgba(143,227,136,0.12)]
          border border-white/5
        "
      >
        {agent.charAt(0).toUpperCase()}
      </div>

      {/* Typing Bubble */}
      <div
        className="
          px-4 py-3
          rounded-2xl
          bg-[#1A2330]/90
          border border-white/5
          shadow-[0_10px_30px_rgba(0,0,0,0.35)]
          backdrop-blur-sm
        "
      >
        <div className="flex items-center gap-1">
          
          <span className="h-2 w-2 rounded-full bg-[#8FE388] animate-bounce [animation-delay:0ms]" />

          <span className="h-2 w-2 rounded-full bg-[#8FE388] animate-bounce [animation-delay:150ms]" />

          <span className="h-2 w-2 rounded-full bg-[#8FE388] animate-bounce [animation-delay:300ms]" />

        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [code, setCode] = useState("");
  const [isDiscussionActive, setIsDiscussionActive] = useState(false);
  const [typingAgent, setTypingAgent] = useState("");
  const messagesEndRef = useRef(null);
  const [isHovering, setIsHovering] = useState(false);


  const startCouncil = async () => {
  setMessages([]);
  setIsDiscussionActive(true);

  try {
    const response = await fetch(
      "http://144.202.51.83:3000/debate-stream",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      }
    );

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop();

      for (const part of parts) {
        const line = part.replace("data: ", "").trim();

        if (!line) continue;

        try {
          const msg = JSON.parse(line);

          if (msg.command === "discussionFinished") {
            setIsDiscussionActive(false);
          } else {
            setTypingAgent(
              msg.agent === "QWEN"
                ? "LLAMA"
                : "QWEN"
            );

            setMessages((prev) => [...prev, msg]);
          }
        } catch (err) {
          console.log(err);
        }
      }
    }
  } catch (err) {
    console.log("Stream error:", err);
    setIsDiscussionActive(false);
  }
};


useEffect(() => {
  if (!isDiscussionActive || isHovering) return;

  window.requestAnimationFrame(() => {
  messagesEndRef.current?.scrollIntoView({
    behavior: "smooth",
    block: "end",
  });
});


}, [messages, isDiscussionActive, isHovering]);
 

  return (

    <div className="min-h-screen bg-gradient-to-b from-[#0B0F14] via-[#0D131B] to-[#0B0F14] text-[#E5E7EB] flex justify-center p-6">
      
      <div className="w-full max-w-3xl relative">
  
        {/* Ambient Glow */}
        <div className="absolute inset-0 -z-10 flex justify-center">
          <div className="w-[90%] h-[70%] translate-y-10 bg-gradient-radial from-[#1a2330]/50 via-[#0D131B]/20 to-transparent blur-[120px] opacity-70"></div>
        </div>
        
        <div className="text-center mb-8 opacity-80">
          CouncilOS
        </div>

        <div className="mb-6">
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste your code here..."
            className="
            w-full
            h-56
            p-4
            rounded-2xl
            bg-[#11161D]
            border border-white/5
            text-[#E5E7EB]
            outline-none
            resize-none
            font-mono
            text-sm
            shadow-[0_10px_30px_rgba(0,0,0,0.45)]
          "
        />
      </div>
        <div className="flex justify-center mb-6">
          <button
            onClick={startCouncil}
            className="
              px-5 py-2.5
              rounded-xl
              bg-gradient-to-b from-[#2B3440] to-[#1D2530]
              border border-white/5
              text-sm text-[#E5E7EB]
              shadow-[0_10px_30px_rgba(0,0,0,0.45)]
              hover:from-[#364152] hover:to-[#273244]
              transition-all duration-200
            "
          >
            Start Council
          </button>
        </div>

        <CodeBlock code={code} />

        <div
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} index={i} />
        ))}

          {isDiscussionActive && (
           <TypingIndicator
            agent={typingAgent || "LLAMA"}
            isRight={messages.length % 2 !== 0}
          />

          )}

          <div ref={messagesEndRef} />
        </div>

      </div>
    </div>
  );
}