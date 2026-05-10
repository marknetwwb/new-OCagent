import fs from "fs";
import path from "path";

const WORKSPACE_DIR = "/data";  // Railway Volume mount point

// 確保資料夾存在
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// 讀取 JSON 檔案
export function loadJSON(filename, defaultValue = {}) {
  const filePath = path.join(WORKSPACE_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }

  try {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("讀取 JSON 失敗:", err);
    return defaultValue;
  }
}

// 寫入 JSON 檔案
export function saveJSON(filename, data) {
  const filePath = path.join(WORKSPACE_DIR, filename);

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("寫入 JSON 失敗:", err);
  }
}
