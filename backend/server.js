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
