require("dotenv").config();
const express = require("express");
const path = require("path");
const webpush = require("web-push");
const store = require("./store");
const checker = require("./checker");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 3000;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:example@example.com";

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn(
    "[경고] VAPID 키가 설정되지 않았습니다. .env 파일을 확인하세요. 푸시 알림이 동작하지 않습니다."
  );
} else {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const DEFAULT_CATEGORY = "미분류";

// ---------- 계정 API ----------
app.get("/api/accounts", (req, res) => {
  res.json(store.getAccounts());
});

app.post("/api/accounts", (req, res) => {
  const { username, category } = req.body;
  if (!username || typeof username !== "string") {
    return res.status(400).json({ error: "username이 필요합니다." });
  }
  const uname = username.trim().replace(/^@/, "");
  if (!uname) return res.status(400).json({ error: "유효한 username이 아닙니다." });

  const accounts = store.getAccounts();
  if (accounts[uname]) {
    return res.status(409).json({ error: "이미 등록된 계정입니다." });
  }
  accounts[uname] = {
    isPrivate: null,
    lastChecked: null,
    category: (category && category.trim()) || DEFAULT_CATEGORY,
    failCount: 0,
    nextCheckAfter: null,
  };
  store.saveAccounts(accounts);
  res.status(201).json(accounts[uname]);

  // 등록 직후 바로 한 번 체크 (백그라운드)
  checker.checkOne(uname).catch((e) => console.error(e));
});

app.delete("/api/accounts/:username", (req, res) => {
  const accounts = store.getAccounts();
  delete accounts[req.params.username];
  store.saveAccounts(accounts);
  res.status(204).end();
});

app.delete("/api/categories/:category", (req, res) => {
  const category = req.params.category;
  const accounts = store.getAccounts();
  for (const [uname, info] of Object.entries(accounts)) {
    if (info.category === category) delete accounts[uname];
  }
  store.saveAccounts(accounts);
  res.status(204).end();
});

app.post("/api/refresh", (req, res) => {
  // 수동 새로고침: 백오프 무시하고 즉시 전체 체크 시작 (완료를 기다리지 않고 바로 응답)
  checker.refreshAll({ respectBackoff: false }).catch((e) => console.error(e));
  res.json({ status: "started" });
});

// ---------- 웹푸시 API ----------
app.get("/api/vapid-public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || null });
});

app.post("/api/subscribe", (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: "유효한 구독 정보가 아닙니다." });
  }
  store.addSubscription(subscription);
  res.status(201).json({ status: "subscribed" });
});

app.post("/api/unsubscribe", (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) store.removeSubscription(endpoint);
  res.json({ status: "unsubscribed" });
});

app.listen(PORT, () => {
  console.log(`인스타 모니터 서버 실행 중: http://localhost:${PORT}`);
  checker.startBackgroundLoop();
});
