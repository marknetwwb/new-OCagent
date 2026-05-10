app.post("/webhook", async (req, res) => {
  const message = req.body.message;

  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const userText = message.text;

  // 讀取記憶
  const history = memory[chatId] || [];

  // 組合 messages（帶記憶）
  const messages = [
    ...history,
    { role: "user", content: userText }
  ];

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "z-ai/glm-4.5-air:free",
        messages
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const reply = response.data.choices[0].message.content;

    // 儲存記憶
    addMessage(chatId, "user", userText);
    addMessage(chatId, "assistant", reply);

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: reply
    });

  } catch (err) {
    console.error("LLM Error:", err.response?.data || err.message);

    try {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "抱歉，我無法處理你的訊息。"
      });
    } catch (e) {
      console.error("Telegram 回覆失敗:", e.message);
    }
  }

  res.sendStatus(200);
});
