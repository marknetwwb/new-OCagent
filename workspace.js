import fs from "fs";
import path from "path";

const WORKSPACE_DIR = "/data";
const FILES_DIR = path.join(WORKSPACE_DIR, "files");

// 確保資料夾存在
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
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
  const filePath = path.join(FILES_DIR, filename);
  fs.writeFileSync(filePath, content);
}

// 讀取檔案
export function loadFile(filename) {
  const filePath = path.join(FILES_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

// 列出檔案
export function listFiles() {
  return fs.readdirSync(FILES_DIR);
}
