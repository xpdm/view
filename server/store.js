const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const ACCOUNTS_PATH = path.join(DATA_DIR, "accounts.json");
const SUBS_PATH = path.join(DATA_DIR, "subscriptions.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.error(`[store] ${filePath} 읽기 실패:`, e.message);
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ---------- 계정 ----------
function getAccounts() {
  return readJson(ACCOUNTS_PATH, {});
}

function saveAccounts(accounts) {
  writeJson(ACCOUNTS_PATH, accounts);
}

// ---------- 구독(웹푸시) ----------
function getSubscriptions() {
  return readJson(SUBS_PATH, []);
}

function addSubscription(sub) {
  const subs = getSubscriptions();
  const exists = subs.some((s) => s.endpoint === sub.endpoint);
  if (!exists) {
    subs.push(sub);
    writeJson(SUBS_PATH, subs);
  }
}

function removeSubscription(endpoint) {
  const subs = getSubscriptions().filter((s) => s.endpoint !== endpoint);
  writeJson(SUBS_PATH, subs);
}

module.exports = {
  getAccounts,
  saveAccounts,
  getSubscriptions,
  addSubscription,
  removeSubscription,
};
