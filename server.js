import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// Telegram Bot Token
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Telegram Webhook Handler
app.post("/webhook", async (req, res) => {
  const message = req.body.message;

  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const userText = message.text;

  try {
    // 呼叫 OpenRouter API（GLM-4-Air）
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "glm-4-air",
        messages: [
          { role: "user", content: userText }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    // 正確取得 LLM 回覆
    const reply = response.data.choices[0].message.content;

    // 回覆 Telegram
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: reply
    });

  } catch (err) {
    console.error("Error:", err.message);

    // 即使錯誤，也要回覆 Telegram，避免 webhook 卡住
    try {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "抱歉，我無法處理你的訊息。"
      });
    } catch (e) {
      console.error("Telegram 回覆失敗:", e.message);
    }
  }

  // **最重要：一定要回應 Telegram**
  res.sendStatus(200);
});

// Railway 會注入 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot server running on port", PORT);
});
