const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));


require('dotenv').config();


const express = require('express');
const cors = require('cors');
// const { GoogleGenerativeAI } = require('@google/generative-ai');

// 🔥 EMBEDDING SETUP
const { pipeline } = require('@xenova/transformers');

let embedder;

async function initEmbedder() {
    if (!embedder) {
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log("✅ Embedding model loaded");
    }
}

function cosine(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

async function embed(text) {
    const out = await embedder(text, { pooling: 'mean', normalize: true });
    return out.data;
}


//  CORE CLEANER
async function cleanSemantic(text) {
    if (!text) return text;

    const lines = text
        .replace(/\n/g, ' ')
        .split(/(?<=[.?!])\s+/)   // split by sentences
        .filter(Boolean)
        .map(l => l.trim())
        .filter(Boolean);

    const embeddings = [];
    const result = [];

    for (let line of lines) {

        // preserve important tokens
        if (line.includes('[CLEAR]') || line.includes('[MAJOR]') || line.includes('[MINOR]')) {
            result.push(line);
            continue;
        }

        const emb = await embed(line);

        let duplicate = false;

        for (let prev of embeddings) {
            if (cosine(emb, prev) > 0.80) {
                duplicate = true;
                break;
            }
        }

        if (!duplicate) {
            embeddings.push(emb);
            result.push(line);
        }
    }

    // 🔥 SEMANTIC STOP (REPLACES HARD LIMIT)
    const SIMILARITY_THRESHOLD = 0.88;

    let finalLines = [];
    let prevEmbeddings = [];
    let repetitionCount = 0;

    for (let line of result) {

        const emb = await embed(line);

        let isRepetitive = false;

        for (let prev of prevEmbeddings) {
            if (cosine(emb, prev) > SIMILARITY_THRESHOLD) {
                isRepetitive = true;
                break;
            }
        }

        if (isRepetitive) {
            repetitionCount++;
        } else {
            repetitionCount = 0; // reset if new info appears
        }

    // 🔥 STOP only when repetition persists

        prevEmbeddings.push(emb);
        finalLines.push(line);

        if (repetitionCount >= 2 && finalLines.length > 5) {
            break;
        }
    
    }
return finalLines.join('\n');
}


const app = express();
app.use(cors());
app.use(express.json());


console.log("DEBATE ROUTE LOADED");
app.post('/debate', async (req, res) => {

    try {

        await initEmbedder();
        const { code, intent } = req.body;

        let history = [];
        let analysis = await callLLAMA({
            prompt: `

        Look at this code.  

        List ALL potential issues you can find.

        Include runtime bugs, logical issues, edge cases, and incorrect assumptions.
        Do not explain deeply — focus on coverage.
        Be exhaustive.


        Code:
        ${code}

        `
    });

        analysis = analysis || "";
        analysis = await cleanSemantic(analysis);

        history.push({
        agent: "LLAMA",
        content: analysis
    });

//  CONFLICT PHASE

        let qwenReply = await callQWEN({
            prompt: `
You are reviewing an existing analysis of the code.

Before responding, quickly re-check the code yourself.
Do not completely rely only on the existing analysis as it can be wrong.

You are absolutely free to form your own opinion and analysis based of the existing analysis and the code


Respond primarily if:
- you disagree
- something feels wrong
- something important is missing
- you notice a new issue not mentioned yet

If they are right → acknowledge briefly.



Code:
${code}

Other opinion:
${analysis}
`
});
        let qwenReplyText = qwenReply || "";
        qwenReplyText = await cleanSemantic(qwenReplyText);

        history.push({
            agent: "QWEN",
            content: qwenReplyText,
});

        let llamaReply = await callLLAMA({
            prompt: `
You are reviewing an existing analysis of the code.

Before responding, quickly re-check the code yourself.
Do not completely rely only on the existing analysis as it can be wrong.

You are absolutely free to form your own opinion and analysis based of the existing analysis and the code


Respond primarily if:
- you disagree
- something feels wrong
- something important is missing
- you notice a new issue not mentioned yet

If they are right → acknowledge briefly.


Code:
${code}

Other opinion:
${analysis}
`
});

        llamaReply = await cleanSemantic(llamaReply);

        // 🧾 Save llama response
        history.push({ agent: "LLAMA", content: llamaReply });

        // 🔁 DYNAMIC BACK-AND-FORTH LOOP (REPLACE OLD LOGIC)

        let maxTurns = 3; // prevents infinite loops
        let turn = 0;

        let lastLLAMA = llamaReply;

        while (turn < maxTurns) {

            const isClear = (lastLLAMA || "").toUpperCase().includes("[CLEAR]");
            if (isClear) break;

            // 🧠 QWEN replies to LLAMA
            let qwenFollow = await callQWEN({
                prompt: `
Continue the discussion.

Before responding, quickly re-check the code yourself.
Do not rely only on the other opinion.

Respond freely — do not hold back your reasoning.

- If you disagree → explain why clearly
- If you agree → confirm, but only after re-checking the code
- If something is still unclear → point it out

Before accepting any claim:

Try to DISPROVE it.

- Identify the exact condition where the issue would occur
- Check if that condition is actually possible in the code

If you cannot find a real execution path where it fails → reject the claim.

If you believe a bug exists, show the exact execution path where it fails.

Do not accept a claim just because it sounds plausible.

Only conclude with [CLEAR] if you are confident after attempting to disprove all remaining claims
and the reasoning is correct based on the code execution.


Code:
${code}

Other message:
${lastLLAMA}
`
    });

    let qwenText = qwenFollow || "";
    qwenText = await cleanSemantic(qwenText);

    history.push({
        agent: "QWEN",
        content: qwenText
    });

    // 🔍 LLAMA replies again
    let llamaFollow = await callLLAMA({
        prompt: `

Continue the discussion.

Before responding, quickly re-check the code yourself.
Do not rely only on the other opinion.

Respond freely — do not hold back your reasoning.

- If you disagree → explain why clearly
- If you agree → confirm, but only after re-checking the code
- If something is still unclear → point it out

Before accepting any claim:

Try to DISPROVE it.

- Identify the exact condition where the issue would occur
- Check if that condition is actually possible in the code

If you cannot find a real execution path where it fails → reject the claim.

If you believe a bug exists, show the exact execution path where it fails.

Do not accept a claim just because it sounds plausible.

Only conclude with [CLEAR] if you are confident after attempting to disprove all remaining claims
and the reasoning is correct based on the code execution.


Code:
${code}

Other message:
${qwenText}
`
    });

    lastLLAMA = await cleanSemantic(llamaFollow || "");

    history.push({
        agent: "LLAMA",
        content: lastLLAMA
    });

    turn++;
}
        
        return res.json({
            success: true,
            debate: history
        });

    } catch (err) {
        console.error("DEBATE ERROR:", err.message);

        return res.status(500).json({
            success: false,
            error: err.message
        });
    }

});

    

app.post('/debate-stream', async (req, res) => {

    const { code } = req.body;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        res.flushHeaders?.();
    };
    try {

        await initEmbedder();

        let history = [];

        // 🧠 LLAMA (Round 1)
        let analysis = await callLLAMA({
            prompt: `

        Look at this code.

        List ALL potential issues you can find.

        Include runtime bugs, logical issues, edge cases, and incorrect assumptions.
        Do not explain deeply — focus on coverage.
        Be exhaustive.
        

        Code:
        ${code}
        `
    });

        analysis = analysis || "";
        analysis = await cleanSemantic(analysis);

        send({
            agent: "LLAMA",
            content: analysis
        });

        history.push({
            agent: "LLAMA",
            content: analysis
        });

//  CONFLICT PHASE

        let qwenReply = await callQWEN({
            prompt: `
You are reviewing an existing analysis of the code.

Before responding, quickly re-check the code yourself.
Do not completely rely only on the existing analysis as it can be wrong.

You are absolutely free to form your own opinion and analysis based of the existing analysis and the code


Respond primarily if:
- you disagree
- something feels wrong
- something important is missing
- you notice a new issue not mentioned yet

If they are right → acknowledge briefly.



Code:
${code}

Other opinion:
${analysis}

`
});
        let qwenReplyText = qwenReply || "";
        qwenReplyText = await cleanSemantic(qwenReplyText);

       send({
            agent: "QWEN",
            content: qwenReplyText
});
        history.push({ agent: "QWEN", content: qwenReplyText });

        let llamaReply = await callLLAMA({
            prompt: `
You are reviewing an existing analysis of the code.

Before responding, quickly re-check the code yourself.
Do not completely rely only on the existing analysis as it can be wrong.

You are absolutely free to form your own opinion and analysis based of the existing analysis and the code

Respond primarily if:
- you disagree
- something feels wrong
- something important is missing
- you notice a new issue not mentioned yet

If they are right → acknowledge briefly.


Code:
${code}

Other opinion:
${analysis}
`
});

        llamaReply = llamaReply || "";
        llamaReply = await cleanSemantic(llamaReply);

        send({
            agent: "LLAMA",
            content: llamaReply
});

        // 🧾 Save llama response
        history.push({ agent: "LLAMA", content: llamaReply });


        // 🔁 LIVE BACK-AND-FORTH LOOP

        let maxTurns = 3; // prevents infinite loop
        let turn = 0;

        let lastLLAMA = llamaReply;

        while (turn < maxTurns) {

            const isClear = (lastLLAMA || "").toUpperCase().includes("[CLEAR]");
            if (isClear) break;

            // 🧠 QWEN responds
            let qwenFollow = await callQWEN({
            prompt: `
Continue the discussion.

Before responding, quickly re-check the code yourself.
Do not rely only on the other opinion.

Before responding, quickly re-check the code yourself.
Do not rely only on the other opinion.

Respond freely — do not hold back your reasoning.

- If you disagree → explain why clearly
- If you agree → confirm, but only after re-checking the code
- If something is still unclear → point it out

Before accepting any claim:

Try to DISPROVE it.

- Identify the exact condition where the issue would occur
- Check if that condition is actually possible in the code

If you cannot find a real execution path where it fails → reject the claim.

If you believe a bug exists, show the exact execution path where it fails.

Do not accept a claim just because it sounds plausible.

Only conclude with [CLEAR] if you are confident after attempting to disprove all remaining claims
and the reasoning is correct based on the code execution.



Code:
${code}

Other message:
${lastLLAMA}
`
    });

    let qwenText = qwenFollow || "";
    qwenText = await cleanSemantic(qwenText);

    // 📡 STREAM QWEN response
    send({
        agent: "QWEN",
        content: qwenText
    });

    // 🧾 Save
    history.push({
        agent: "QWEN",
        content: qwenText
    });


    // 🔍 LLAMA responds again
    let llamaFollow = await callLLAMA({
        prompt: `
Continue the discussion.

Before responding, quickly re-check the code yourself.
Do not rely only on the other opinion.

Respond freely — do not hold back your reasoning.

- If you disagree → explain why clearly
- If you agree → confirm, but only after re-checking the code
- If something is still unclear → point it out

Before accepting any claim:

Try to DISPROVE it.

- Identify the exact condition where the issue would occur
- Check if that condition is actually possible in the code

If you cannot find a real execution path where it fails → reject the claim.

If you believe a bug exists, show the exact execution path where it fails.

Do not accept a claim just because it sounds plausible.

Only conclude with [CLEAR] if you are confident after attempting to disprove all remaining claims
and the reasoning is correct based on the code execution.


Code:
${code}

Other message:
${qwenText}
`
    });

    let llamaText = await cleanSemantic(llamaFollow || "");

    // 📡 STREAM LLAMA response
    send({
        agent: "LLAMA",
        content: llamaText
    });

    // 🧾 Save
    history.push({
        agent: "LLAMA",
        content: llamaText
    });

    lastLLAMA = llamaText;
    turn++;
}       

        send({
            command: "discussionFinished"
        });
        
        res.end();

    } catch (err) {
        send({ agent: "System", content: err.message });
        res.end();
    }
});

async function callLLAMA({ prompt }) {

    let attempts = 0;

    while (attempts < 3) {

          // 🔥 PRE-REQUEST DELAY (prevents 429)
        await new Promise(r => setTimeout(r, 1000));

        try {

            const response = await fetch(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    temperature: 0.2,
                    messages: [{ role: "user", content: prompt }]
                })
            }
        );

         // ✅ retry first
        if (response.status === 429 || response.status === 503) {
            attempts++;
            const delay = 2000 * attempts;
            await new Promise(r => setTimeout(r, delay));
            continue;
        }

        if (!response.ok) {
            throw new Error(`LLAMA API failed: ${response.status}`);
        }


        const data = await response.json();

        let text = data.choices?.[0]?.message?.content || "No response";

        text = text
            .replace(/\\n/g, '\n')
            .replace(/\*\*/g, '')
            .trim();

        return text;
    } catch (err) {
            attempts++;
            if (attempts >= 3) throw err;

            const delay = 2000 * attempts;
            await new Promise(r => setTimeout(r, delay));
        }
    }

     return "⚠️ Failed to generate response";
}


async function callLLAMA({ prompt }) {
    return await callLLAMA({ prompt }); 
}

async function callQWEN({ prompt }) {

    let attempts = 0;

    while (attempts < 3) {

          // 🔥 PRE-REQUEST DELAY (prevents 429)
        await new Promise(r => setTimeout(r, 1000));
    
        try {

            console.log(`Calling QWEN (PRIMARY QWEN) Attempt ${attempts + 1}`);

            const response = await fetch(
                "https://api.groq.com/openai/v1/chat/completions",
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "qwen/qwen3-32b",
                        temperature: 0.5,
                        messages: [
                            {

                                 role: "user",
                                content: prompt
                          
                            }
                        ]
                    })
                }
            );

            console.log("QWEN STATUS:", response.status);

            if (response.status === 429 || response.status === 503) {
                attempts++;
                const delay = 2000 * attempts;
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            if (!response.ok) {
                throw new Error(`QWEN failed: ${response.status}`);
            }

            const data = await response.json();
            console.log("QWEN RAW:", data);
            console.log("QWEN ERROR CHECK:", data);

            let text = data.choices?.[0]?.message?.content || "";

            text = text
                .replace(/\\n/g, '\n')
                .replace(/\*\*/g, '')
                .replace(/#/g, '')
                .trim();

            if (!text) {
                attempts++;
                continue;
            }

            return text;

        } catch (err) {
            attempts++;
            if (attempts >= 3) {
                console.log("QWEN final failure:", err.message);
                return "";
            }

            const delay = 2000 * attempts;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    return "";
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Council backend running on port ${PORT}`);
});