const DEFAULT_CATEGORY = "미분류";

const usernameInput = document.getElementById("usernameInput");
const categorySelect = document.getElementById("categorySelect");
const addBtn = document.getElementById("addBtn");
const refreshBtn = document.getElementById("refreshBtn");
const notifyBtn = document.getElementById("notifyBtn");
const statusText = document.getElementById("statusText");
const accountList = document.getElementById("accountList");

let accountsCache = {};

async function loadAccounts() {
  const res = await fetch("/api/accounts");
  accountsCache = await res.json();
  renderCategoryOptions();
  renderAccounts();
}

function renderCategoryOptions() {
  const cats = new Set([DEFAULT_CATEGORY]);
  Object.values(accountsCache).forEach((info) => cats.add(info.category || DEFAULT_CATEGORY));
  categorySelect.innerHTML = "";
  [...cats].sort().forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  });
  const newOpt = document.createElement("option");
  newOpt.value = "__new__";
  newOpt.textContent = "+ 새 카테고리...";
  categorySelect.appendChild(newOpt);
}

categorySelect.addEventListener("change", () => {
  if (categorySelect.value === "__new__") {
    const name = prompt("새 카테고리 이름을 입력하세요:");
    if (name && name.trim()) {
      const opt = document.createElement("option");
      opt.value = name.trim();
      opt.textContent = name.trim();
      categorySelect.insertBefore(opt, categorySelect.lastChild);
      categorySelect.value = name.trim();
    } else {
      categorySelect.value = DEFAULT_CATEGORY;
    }
  }
});

function statusLabel(info) {
  if (info.isPrivate === true) return { text: "비공개", cls: "status-private" };
  if (info.isPrivate === false) return { text: "공개", cls: "status-public" };
  if (info.isPrivate === "not_found") return { text: "계정없음", cls: "status-unknown" };
  if (info.failCount > 0) return { text: "재시도 대기", cls: "status-unknown" };
  return { text: "확인중", cls: "status-unknown" };
}

function renderAccounts() {
  accountList.innerHTML = "";
  const byCategory = {};
  Object.entries(accountsCache).forEach(([username, info]) => {
    const cat = info.category || DEFAULT_CATEGORY;
    byCategory[cat] = byCategory[cat] || [];
    byCategory[cat].push([username, info]);
  });

  Object.keys(byCategory)
    .sort()
    .forEach((cat) => {
      const block = document.createElement("div");
      block.className = "category-block";

      const title = document.createElement("div");
      title.className = "category-title";
      title.textContent = cat;
      block.appendChild(title);

      byCategory[cat].forEach(([username, info]) => {
        const { text, cls } = statusLabel(info);
        const pushOn = info.pushEnabled !== false; // 필드 없으면 기본 on
        const card = document.createElement("div");
        card.className = "account-card";
        card.innerHTML = `
          <div class="account-info" data-username="${username}">
            <div class="account-name">@${username}</div>
            <div class="account-meta">${info.lastChecked ? new Date(info.lastChecked).toLocaleString("ko-KR") : "-"}</div>
          </div>
          <div style="display:flex; align-items:center;">
            <span class="status-badge ${cls}">${text}</span>
            <button class="push-toggle-btn ${pushOn ? "on" : "off"}" data-username="${username}" title="${pushOn ? "알림 켜짐 (클릭하면 끄기)" : "알림 꺼짐 (클릭하면 켜기)"}">${pushOn ? "🔔" : "🔕"}</button>
            <button class="delete-btn" data-username="${username}">✕</button>
          </div>
        `;
        block.appendChild(card);
      });

      accountList.appendChild(block);
    });

  // 계정 이름/영역 클릭 -> imginn 뷰어에서 해당 계정으로 이동
  accountList.querySelectorAll(".account-info").forEach((el) => {
    el.addEventListener("click", () => {
      const username = el.dataset.username;
      window.open(`https://imginn.com/${encodeURIComponent(username)}/`, "_blank", "noopener");
    });
  });

  // 계정별 알림 온오프 토글
  accountList.querySelectorAll(".push-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const username = btn.dataset.username;
      const info = accountsCache[username];
      const nextValue = !(info.pushEnabled !== false);
      await fetch(`/api/accounts/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pushEnabled: nextValue }),
      });
      loadAccounts();
    });
  });

  accountList.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const username = btn.dataset.username;
      await fetch(`/api/accounts/${encodeURIComponent(username)}`, { method: "DELETE" });
      loadAccounts();
    });
  });
}

addBtn.addEventListener("click", async () => {
  const username = usernameInput.value.trim().replace(/^@/, "");
  if (!username) return;
  const category = categorySelect.value === "__new__" ? DEFAULT_CATEGORY : categorySelect.value;

  const res = await fetch("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, category }),
  });

  if (res.status === 409) {
    alert("이미 등록된 계정입니다.");
    return;
  }
  usernameInput.value = "";
  loadAccounts();
});

refreshBtn.addEventListener("click", async () => {
  statusText.textContent = "새로고침 요청됨...";
  await fetch("/api/refresh", { method: "POST" });
  setTimeout(loadAccounts, 3000);
  setTimeout(() => (statusText.textContent = ""), 5000);
});

// ---------- 웹푸시 구독 ----------
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    alert("이 브라우저는 웹푸시를 지원하지 않습니다. (iOS는 홈화면에 추가한 뒤 그 앱에서 실행해야 지원됩니다)");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    alert("알림 권한이 거부되었습니다.");
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await fetch("/api/vapid-public-key").then((r) => r.json());
  if (!publicKey) {
    alert("서버에 VAPID 키가 설정되어 있지 않습니다. 관리자에게 문의하세요.");
    return;
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await fetch("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });

  notifyBtn.textContent = "🔔 알림 켜짐";
  notifyBtn.disabled = true;
}

notifyBtn.addEventListener("click", enablePush);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js");
}

loadAccounts();
