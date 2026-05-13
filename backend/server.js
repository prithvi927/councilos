const fetch = require('node-fetch');

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
        let analysis = await callAnalyzer({
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
        agent: "Analyzer",
        content: analysis
    });

//  CONFLICT PHASE

        let architectReply = await callQWEN({
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
        let architectReplyText = architectReply || "";
        architectReplyText = await cleanSemantic(architectReplyText);

        history.push({
            agent: "Architect",
            content: architectReplyText,
});

        let criticReply = await callCritic({
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

        criticReply = await cleanSemantic(criticReply);

        // 🧾 Save critic response
        history.push({ agent: "Critic", content: criticReply });

        // 🔁 DYNAMIC BACK-AND-FORTH LOOP (REPLACE OLD LOGIC)

        let maxTurns = 3; // prevents infinite loops
        let turn = 0;

        let lastCritic = criticReply;

        while (turn < maxTurns) {

            const isClear = (lastCritic || "").toUpperCase().includes("[CLEAR]");
            if (isClear) break;

            // 🧠 Architect replies to Critic
            let architectFollow = await callQWEN({
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
${lastCritic}
`
    });

    let architectText = architectFollow || "";
    architectText = await cleanSemantic(architectText);

    history.push({
        agent: "Architect",
        content: architectText
    });

    // 🔍 Critic replies again
    let criticFollow = await callCritic({
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
${architectText}
`
    });

    lastCritic = await cleanSemantic(criticFollow || "");

    history.push({
        agent: "Critic",
        content: lastCritic
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

        // 🧠 Analyzer (Round 1)
        let analysis = await callAnalyzer({
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
            agent: "Analyzer",
            content: analysis
        });

        history.push({
            agent: "Analyzer",
            content: analysis
        });

//  CONFLICT PHASE

        let architectReply = await callQWEN({
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
        let architectReplyText = architectReply || "";
        architectReplyText = await cleanSemantic(architectReplyText);

       send({
            agent: "Architect",
            content: architectReplyText
});
        history.push({ agent: "Architect", content: architectReplyText });

        let criticReply = await callCritic({
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

        criticReply = criticReply || "";
        criticReply = await cleanSemantic(criticReply);

        send({
            agent: "Critic",
            content: criticReply
});

        // 🧾 Save critic response
        history.push({ agent: "Critic", content: criticReply });


        // 🔁 LIVE BACK-AND-FORTH LOOP

        let maxTurns = 3; // prevents infinite loop
        let turn = 0;

        let lastCritic = criticReply;

        while (turn < maxTurns) {

            const isClear = (lastCritic || "").toUpperCase().includes("[CLEAR]");
            if (isClear) break;

            // 🧠 Architect responds
            let architectFollow = await callQWEN({
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
${lastCritic}
`
    });

    let architectText = architectFollow || "";
    architectText = await cleanSemantic(architectText);

    // 📡 STREAM Architect response
    send({
        agent: "Architect",
        content: architectText
    });

    // 🧾 Save
    history.push({
        agent: "Architect",
        content: architectText
    });


    // 🔍 Critic responds again
    let criticFollow = await callCritic({
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
${architectText}
`
    });

    let criticText = await cleanSemantic(criticFollow || "");

    // 📡 STREAM Critic response
    send({
        agent: "Critic",
        content: criticText
    });

    // 🧾 Save
    history.push({
        agent: "Critic",
        content: criticText
    });

    lastCritic = criticText;
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