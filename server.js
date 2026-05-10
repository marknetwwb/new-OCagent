// 列出所有檔案（包含 /data 舊檔案 + /data/files 新檔案）
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
