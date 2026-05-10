import express from "express";
import axios from "axios";
import {
  loadJSON,
  saveJSON,
  saveFile,
  loadFile,
  listFiles
} from "./workspace.js";

const app = express();
app.use(express.json());

// ========= 1. 基礎設定 =========
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const TELEGRAM_FILE_API = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}`;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

// ========= 2. 載入持久化資料 =========
let memory = loadJSON("memory.json", {});
let tasks = loadJSON("tasks.json", {});
let notes = loadJSON("notes.json", {});
let vectors = loadJSON("vectors.json", {});
let settings = loadJSON("settings.json", {
  autoSummary: true,
  autoTask: true,
  lastSummaryDate: null
});

// ========= 3. 對話記憶 =========
function addMessage(chatId, role, content) {
  if (!memory[chatId]) memory[chatId] = [];
  memory[chatId].push({ role, content });
  if (memory[chatId].length > 50) memory[chatId].shift();
  saveJSON("memory.json", memory);
}

// ========= 4. 任務系統 (A) =========
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

// ========= 5. 自動筆記 (E) =========
function addNote(chatId, text) {
  if (!notes[chatId]) notes[chatId] = [];
  notes[chatId].push({ id: Date.now(), text });
  saveJSON("notes.json", notes);
}

// ========= 6. Vector Memory (C) =========
function addVector(chatId, text) {
  if (!vectors[chatId]) vectors[chatId] = [];
  vectors[chatId].push({ id: Date.now(), text });
  saveJSON("vectors.json", vectors);
}

// ========= 7. Multi-Agent Workflow (D) =========
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
        Authorization: `Bearer ${OPENROUTER_KEY}`,
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

// ========= 8. 檔案處理 (B + C) =========
async function handleFileUpload(message) {
  const chatId = message.chat.id;
  const doc = message.document || message.photo?.slice(-1)[0];
  if (!doc) return;

  const fileId = doc.file_id;
  const fileInfo = await axios.get(
    `${TELEGRAM_API}/getFile?file_id=${fileId}`
  );
  const filePath = fileInfo.data.result.file_path;
  const fileUrl = `${TELEGRAM_FILE_API}/${filePath}`;

  const fileRes = await axios.get(fileUrl, { responseType: "arraybuffer" });
  const filename = doc.file_name || `file_${Date.now()}`;
  saveFile(filename, fileRes.data);

  // 自動摘要 + 筆記 + 向量記憶（用簡單提示）
  const prompt = `
我上傳了一個檔案，檔名：${filename}。
請你幫我產生一段簡短摘要（不超過 200 字），用繁體中文。
`;

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "z-ai/glm-4.5-air:free",
      messages: [{ role: "user", content: prompt }]
    },
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const summary = response.data.choices[0].message.content.trim();
  addNote(chatId, `檔案：${filename}\n摘要：${summary}`);
  addVector(chatId, `檔案：${filename}\n摘要：${summary}`);

  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: `已儲存檔案：${filename}\n\n自動摘要：\n${summary}`
  });
}

// ========= 9. 每日自動摘要 (22:00) =========
async function runDailySummary(chatId) {
  const today = new Date().toISOString().slice(0, 10);
  if (settings.lastSummaryDate === today) return;
  settings.lastSummaryDate = today;
  saveJSON("settings.json", settings);

  const userNotes = notes[chatId] || [];
  const userTasks = tasks[chatId] || [];
  const userVectors = vectors[chatId] || [];

  const prompt = `
你是一個每日總結助手。
請根據以下資料，產生一份「今日總結」，用繁體中文，條列式，精簡但有重點。

筆記：
${userNotes.map(n => "- " + n.text).join("\n")}

任務：
${userTasks.map(t => `- ${t.done ? "已完成" : "未完成"}：${t.text}`).join("\n")}

長期記憶：
${userVectors.map(v => "- " + v.text).join("\n")}
`;

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "z-ai/glm-4.5-air:free",
      messages: [{ role: "user", content: prompt }]
    },
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const summary = response.data.choices[0].message.content.trim();
  addNote(chatId, `【每日總結】\n${summary}`);

  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: `【每日 22:00 自動總結】\n\n${summary}`
  });
}

// 每分鐘檢查一次時間（HK 時區假設伺服器時間已對齊）
setInterval(() => {
  if (!settings.autoSummary) return;
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  if (hour === 22 && minute === 0) {
    // 個人使用 → 只針對唯一 chatId；這裡用 settings.lastChatId 記錄
    const chatId = settings.lastChatId;
    if (chatId) runDailySummary(chatId).catch(console.error);
  }
}, 60 * 1000);

// ========= 10. 自動任務執行（簡化版） =========
async function runAutoTasks(chatId) {
  if (!settings.autoTask) return;
  const list = listTasks(chatId).filter(t => !t.done);
  if (list.length === 0) return;

  const prompt = `
你是一個任務助手，請根據以下未完成任務，給出簡短建議與優先順序，繁體中文：

${list.map(t => "- " + t.text).join("\n")}
`;

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "z-ai/glm-4.5-air:free",
      messages: [{ role: "user", content: prompt }]
    },
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const advice = response.data.choices[0].message.content.trim();

  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: `【自動任務建議】\n\n${advice}`
  });
}

// ========= 11. Telegram Webhook =========
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message) return res.sendStatus(200);

  const chatId = message.chat.id;
  settings.lastChatId = chatId;
  saveJSON("settings.json", settings);

  // 檔案上傳
  if (message.document || message.photo) {
    try {
      await handleFileUpload(message);
    } catch (e) {
      console.error("File upload error:", e.message);
    }
    return res.sendStatus(200);
  }

  if (!message.text) return res.sendStatus(200);
  const userText = message.text;

  // 指令：自動摘要開關
  if (userText === "/autosummary on") {
    settings.autoSummary = true;
    saveJSON("settings.json", settings);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "已開啟每日 22:00 自動摘要。"
    });
    return res.sendStatus(200);
  }

  if (userText === "/autosummary off") {
    settings.autoSummary = false;
    saveJSON("settings.json", settings);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "已關閉每日自動摘要。"
    });
    return res.sendStatus(200);
  }

  // 指令：自動任務建議
  if (userText === "/autotask") {
    await runAutoTasks(chatId);
    return res.sendStatus(200);
  }

  // 任務系統
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

  // 筆記
  if (userText.startsWith("/note ")) {
    addNote(chatId, userText.replace("/note ", ""));
    return res.sendStatus(200);
  }

  // 向量記憶
  if (userText.startsWith("/remember ")) {
    addVector(chatId, userText.replace("/remember ", ""));
    return res.sendStatus(200);
  }

  // 檔案下載
  if (userText.startsWith("/download ")) {
    const filename = userText.replace("/download ", "").trim();
    const fileBuf = loadFile(filename);
    if (!fileBuf) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `找不到檔案：${filename}`
      });
      return res.sendStatus(200);
    }

    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("document", new Blob([fileBuf]), filename);

    await axios.post(`${TELEGRAM_API}/sendDocument`, formData, {
      headers: formData.getHeaders?.()
    });

    return res.sendStatus(200);
  }

  // 檔案列表
  if (userText === "/files") {
    const files = listFiles();
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: files.length ? files.join("\n") : "目前沒有檔案"
    });
    return res.sendStatus(200);
  }

  // Multi-Agent /plan
  if (userText.startsWith("/plan ")) {
    const plan = await plannerAgent(userText.replace("/plan ", ""));
    const result = await executorAgent(plan.steps);

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: result
    });

    return res.sendStatus(200);
  }

  // 對話記憶 + 一般聊天
  const history = memory[chatId] || [];
  const messages = [...history, { role: "user", content: userText }];

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "z-ai/glm-4.5-air:free",
        messages
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const reply = response.data.choices[0].message.content;

    addMessage(chatId, "user", userText);
    addMessage(chatId, "assistant", reply);

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: reply
    });
  } catch (err) {
    console.error("LLM Error:", err.response?.data || err.message);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "抱歉，我無法處理你的訊息。"
    });
  }

  res.sendStatus(200);
});

// ========= 12. 啟動伺服器 =========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot server running on port", PORT);
});
