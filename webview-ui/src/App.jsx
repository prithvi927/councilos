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

