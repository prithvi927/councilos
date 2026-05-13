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
