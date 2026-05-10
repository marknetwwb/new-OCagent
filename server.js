import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
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
  lastSummaryDate: null,
  lastChatId: null
});

// ========= 3. 對話記憶 =========
function addMessage(chatId, role, content) {
  if (!memory[chatId]) memory[chatId] = [];
  memory[chatId].push({ role, content });
  if (memory[chatId].length > 20) memory[chatId].shift();
  saveJSON("memory.json", memory);
}

// ========= 4. 任務系統 =========
function addTask(chatId, text) {
  if (!tasks[chatId]) tasks[chatId] = [];
  tasks[chatId].push({ id: Date.now(), text, done: false });
  saveJSON("tasks.json", tasks);
}

function listTasks(chatId) {
  return tasks[chatId] || [];
}

// ========= 5. 筆記 =========
function addNote(chatId, text) {
  if (!notes[chatId]) notes[chatId] = [];
  notes[chatId].push({ id: Date.now(), text });
  saveJSON("notes.json", notes);
}

// ========= 6. Vector Memory =========
function addVector(chatId, text) {
  if (!vectors[chatId]) vectors[chatId] = [];
  vectors[chatId].push({ id: Date.now(), text });
  saveJSON("vectors.json", vectors);
}

// ========= 7. Multi-Agent =========
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

// ========= 8. 檔案上傳處理 =========
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

  // 自動摘要
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

// ========= 9. 每日自動摘要（22:00） =========
async function runDailySummary(chatId) {
  const today = new Date().toISOString().slice(0, 10);
  if (settings.lastSummaryDate === today) return;

  settings.lastSummaryDate = today;
  saveJSON("settings.json", settings);

  const userNotes = notes[chatId] || [];
  const userTasks = tasks[chatId] || [];
  const userVectors = vectors[chatId] || [];

  const prompt = `
請根據以下資料產生「今日總結」，繁體中文，條列式：

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

// 每分鐘檢查一次
setInterval(() => {
  if (!settings.autoSummary) return;
  const now = new Date();
  if (now.getHours() === 22 && now.getMinutes() === 0) {
    const chatId = settings.lastChatId;
    if (chatId) runDailySummary(chatId).catch(console.error);
  }
}, 60000);

// ========= 10. 自動任務建議 =========
async function runAutoTasks(chatId) {
  if (!settings.autoTask) return;
  const list = listTasks(chatId).filter(t => !t.done);
  if (list.length === 0) return;

  const prompt = `
請根據以下未完成任務，給出簡短建議與優先順序：

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
    await handleFileUpload(message);
    return res.sendStatus(200);
  }

  if (!message.text) return res.sendStatus(200);
  const userText = message.text;

  // ====== /files ======
  if (userText === "/files") {
    try {
      const rootFiles = fs
        .readdirSync("/data")
        .filter(f => {
          const full = "/data/" + f;
          return fs.existsSync(full) && fs.lstatSync(full).isFile();
        });

      const subFiles = listFiles(); // /data/files

      const all = [...rootFiles, ...subFiles];

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: all.length
          ? all.join("\n")
          : "目前沒有任何檔案（包含舊檔案與新檔案）"
      });

    } catch (err) {
      console.error("FILES ERROR:", err.message);

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "讀取檔案時發生錯誤。"
      });
    }

    return res.sendStatus(200);
  }

  // ====== /task ======
  if (userText.startsWith("/task ")) {
    addTask(chatId, userText.replace("/task ", ""));
    return res.sendStatus(200);
  }

  // ====== /open filename ======
  if (userText.startsWith("/open ")) {
    const filename = userText.replace("/open ", "").trim();

    try {
      let fileBuf = null;

      const fileInFiles = path.join("/data/files", filename);
      if (fs.existsSync(fileInFiles)) {
        fileBuf = fs.readFileSync(fileInFiles, "utf8");
      }

      const fileInRoot = path.join("/data", filename);
      if (!fileBuf && fs.existsSync(fileInRoot)) {
        fileBuf = fs.readFileSync(fileInRoot, "utf8");
      }

      if (!fileBuf) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `找不到檔案：${filename}`
        });
        return res.sendStatus(200);
      }

      const MAX_LEN = 3800;
      let text = fileBuf.toString();

      if (text.length > MAX_LEN) {
        text = text.slice(0, MAX_LEN) + "\n\n（內容過長，已截斷）";
      }

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `📄 *${filename}*\n\n${text}`,
        parse_mode: "Markdown"
      });

    } catch (err) {
      console.error("OPEN FILE ERROR:", err.message);

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "讀取檔案時發生錯誤。"
      });
    }

    return res.sendStatus(200);
  }

  // ====== /tasks ======
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

  // ====== /note ======
  if (userText.startsWith("/note ")) {
    addNote(chatId, userText.replace("/note ", ""));
    return res.sendStatus(200);
  }

  // ====== /remember ======
  if (userText.startsWith("/remember ")) {
    addVector(chatId, userText.replace("/remember ", ""));
    return res.sendStatus(200);
  }

  // ====== /autotask ======
  if (userText === "/autotask") {
    await runAutoTasks(chatId);
    return res.sendStatus(200);
  }

  // ====== /plan ======
  if (userText.startsWith("/plan ")) {
    const plan = await plannerAgent(userText.replace("/plan ", ""));
    const result = await executorAgent(plan.steps);

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: result
    });

    return res.sendStatus(200);
  }

  // ====== 一般聊天（含 ChatGPT-style typing loop） ======
  const history = memory[chatId] || [];
  const messages = [...history, { role: "user", content: userText }];

  try {
    let typing = true;

    const typingLoop = setInterval(() => {
      if (!typing) return;
      axios.post(`${TELEGRAM_API}/sendChatAction`, {
        chat_id: chatId,
        action: "typing"
      }).catch(() => {});
    }, 1000);

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

    typing = false;
    clearInterval(typingLoop);

    const reply = response.data.choices[0].message.content;

    addMessage(chatId, "user", userText);
    addMessage(chatId, "assistant",
