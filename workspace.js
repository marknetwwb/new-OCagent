import fs from "fs";
import path from "path";

const WORKSPACE_DIR = "/data";

// 確保資料夾存在
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// 讀取 JSON
export function loadJSON(filename, defaultValue = {}) {
  const filePath = path.join(WORKSPACE_DIR, filename);
  if (!fs.existsSync(filePath)) return defaultValue;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return defaultValue;
  }
}

// 寫入 JSON
export function saveJSON(filename, data) {
  const filePath = path.join(WORKSPACE_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// 儲存檔案
export function saveFile(filename, content) {
  const filePath = path.join(WORKSPACE_DIR, filename);
  fs.writeFileSync(filePath, content, "utf8");
}

// 讀取檔案
export function loadFile(filename) {
  const filePath = path.join(WORKSPACE_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}
