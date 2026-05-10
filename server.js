import express from "express";
import axios from "axios";
import { loadJSON, saveJSON, saveFile, loadFile } from "./workspace.js";

const app = express();
app.use(express.json());

// =========================
// 1. 基礎設定
// =========================
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

// =========================
// 2. 載入持久化資料
// =========================
let memory = loadJSON("memory.json", {});
let tasks = loadJSON("tasks.json", {});
let notes = loadJSON("notes.json", {});
let vectors = loadJSON("vectors.json", {});

// =========================
// 3. 對話記憶
// =========================
function addMessage(chatId, role, content) {
  if (!memory[chatId]) memory[chatId] = [];
  memory[chatId].push({ role, content });

  if (memory[chatId].length > 50) memory[chatId].shift();

  saveJSON("memory.json", memory);
}

// =========================
// 4. 任務系統 (A)
// =========================
function addTask(chatId, text) {
  if (!tasks[chatId]) tasks[chatId] = [];
  tasks[chatId].push({ id: Date.now(), text, done: false });
  saveJSON("tasks.json", tasks);
}

function listTasks(chatId) {
  return tasks[chatId] || [];
}

function completeTask(chatId, id) {
  if (!tasks[chatId]) return;
  const t = tasks[chatId].find(x => x.id === id);
  if (t) t.done = true;
  saveJSON("tasks.json", tasks);
}

// =========================
// 5. 自動筆記 (E)
// =========================
function addNote(chatId, text) {
  if (!notes[chatId]) notes[chatId] = [];
  notes[chatId].push({ id: Date.now(), text });
  saveJSON("notes.json", notes);
}

// =========================
// 6. Vector Memory (C)
// =========================
function addVector(chatId, text) {
  if (!vectors[chatId]) vectors[chatId] = [];
  vectors[chatId].push({ id: Date.now(), text });
  saveJSON("vectors.json", vectors);
}

// =========================
// 7. Multi-Agent Workflow (D)
// =========================
async function plannerAgent(userText) {
  const prompt = `
你是一個 Planner Agent，負責把使用者需求拆解成步驟。
請輸出 JSON：
{
  "steps": ["step1", "step2", ...]
}
使用者需求：${userText}
`;

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "z-ai/glm-4.5-air:free",
      messages: [{ role: "user", content: prompt }]
    },
    {
      headers: {
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return JSON.parse(response.data.choices[0].message.content);
}

async function executorAgent(steps) {
  let result = "以下是執行計畫：\n\n";
  for (const step of steps) result += `- ${step}\n`;
  return result;
}

// =========================
// 8. Telegram Webhook
// =========================
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userText = message.text;

  // =========================
  // A. 任務系統指令
  // =========================
  if (userText.startsWith("/task ")) {
    addTask(chatId, userText.replace("/task ", ""));
    return res.sendStatus(200);
  }

  if (userText === "/tasks") {
    const list = listTasks(chatId)
      .map(t => `${t.done ? "✔" : "⬜"} ${t.text}`)
      .join("\n");

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: list || "沒有任務"
    });

    return res.sendStatus(200);
  }

  // =========================
  // B. 自動筆記
  // =========================
  if (userText.startsWith("/note ")) {
    addNote(chatId, userText.replace("/note ", ""));
    return res.sendStatus(200);
  }

  // =========================
  // C. Vector 記憶
  // =========================
  if (userText.startsWith("/remember ")) {
    addVector(chatId, userText.replace("/remember ", ""));
    return res.sendStatus(200);
  }

  // =========================
  // D. Multi-Agent Workflow
  // =========================
  if (userText.startsWith("/plan ")) {
    const plan = await plannerAgent(userText.replace("/plan ", ""));
    const result = await executorAgent(plan.steps);

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: result
    });

    return res.sendStatus(200);
  }

  // =========================
  // E.
