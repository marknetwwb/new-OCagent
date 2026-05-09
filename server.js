import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// Telegram Bot Token
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Openclaw API Endpoint
const OPENCLAW_API = process.env.OPENCLAW_API; 
// 例如: https://your-openclaw-service.up.railway.app/api/chat

// Telegram Webhook Handler
app.post("/webhook", async (req, res) => {
  const message = req.body.message;

  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const userText = message.text;

  try {
    // 呼叫 Openclaw API
    const response = await axios.post(OPENCLAW_API, {
      messages: [
        { role: "user", content: userText }
      ]
    });

    const reply = response.data?.reply ?? "Openclaw 沒有回應";

    // 回覆 Telegram
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: reply
    });

  } catch (err) {
    console.error("Error:", err.message);

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "抱歉，我無法處理你的訊息。"
    });
  }

  res.sendStatus(200);
});

// Railway 會注入 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot server running on port", PORT);
});
