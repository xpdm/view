const webpush = require("web-push");
const store = require("./store");

// 계정이 많아져도 안전하게 돌기 위한 설정 (기존 데스크탑 버전과 동일한 전략)
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 한 바퀴 기준: 1시간
const MIN_GAP_MS = 8 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000; // 최대 6시간

/**
 * 로그인 없이 공개 프로필 페이지만 요청해서 is_private 필드만 추출.
 * 게시물/이미지 등 내용은 전혀 가져오지 않음.
 * 반환값: true(비공개) / false(공개) / "not_found" / null(조회 실패)
 */
const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

// 1차: 인스타그램 웹 클라이언트가 실제로 쓰는 비공식 JSON API.
// HTML 정규식 파싱보다 구조 변경/로그인월(wall)에 덜 취약함.
async function fetchIsPrivateViaApi(username) {
  const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      "x-ig-app-id": "936619743392459", // IG 웹 프론트엔드가 쓰는 공개 app id (계정/로그인과 무관)
    },
  });

  if (res.status === 404) return "not_found";
  if (res.status === 429) {
    console.warn(`[checker] ${username}: API 429 (rate limited)`);
    return null;
  }
  if (!res.ok) {
    console.warn(`[checker] ${username}: API HTTP ${res.status}`);
    return null;
  }

  const data = await res.json().catch(() => null);
  const isPrivate = data?.data?.user?.is_private;
  if (typeof isPrivate === "boolean") return isPrivate;

  console.warn(
    `[checker] ${username}: API 응답에 is_private 없음 (로그인월/차단 가능성) - ${JSON.stringify(data).slice(0, 200)}`
  );
  return null;
}

// 2차 폴백: 기존 HTML 스크래핑 방식
async function fetchIsPrivateViaHtml(username) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const res = await fetch(url, { headers: COMMON_HEADERS });

  if (res.status === 404) return "not_found";
  if (!res.ok) {
    console.warn(`[checker] ${username} HTML HTTP ${res.status}`);
    return null;
  }

  const html = await res.text();
  const match = html.match(/"is_private"\s*:\s*(true|false)/);
  if (!match) {
    const looksLikeLoginWall = /Log in|loginForm|"loggedIn":false/i.test(html);
    console.warn(
      `[checker] ${username}: HTML에서 is_private 필드를 찾지 못함 ` +
        `(로그인월로 보임: ${looksLikeLoginWall}, 길이: ${html.length}자) ` +
        `스니펫: ${html.replace(/\s+/g, " ").slice(0, 300)}`
    );
    return null;
  }
  return match[1] === "true";
}

async function fetchIsPrivate(username) {
  try {
    const apiResult = await fetchIsPrivateViaApi(username);
    if (apiResult !== null) return apiResult;
  } catch (e) {
    console.warn(`[checker] ${username}: API 요청 오류 - ${e.message}`);
  }

  try {
    return await fetchIsPrivateViaHtml(username);
  } catch (e) {
    console.error(`[checker] ${username} 조회 오류:`, e.message);
    return null;
  }
}

function isDue(info) {
  if (!info.nextCheckAfter) return true;
  return Date.now() >= new Date(info.nextCheckAfter).getTime();
}

async function checkOne(username, { respectBackoff = false } = {}) {
  const accounts = store.getAccounts();
  const info = accounts[username];
  if (!info) return;
  if (respectBackoff && !isDue(info)) return;

  const prev = info.isPrivate;
  const result = await fetchIsPrivate(username);
  info.lastChecked = new Date().toISOString();

  if (result === null) {
    info.failCount = (info.failCount || 0) + 1;
    const backoff = Math.min(60_000 * 2 ** info.failCount, MAX_BACKOFF_MS);
    info.nextCheckAfter = new Date(Date.now() + backoff).toISOString();
  } else {
    info.isPrivate = result;
    info.failCount = 0;
    info.nextCheckAfter = null;
  }

  accounts[username] = info;
  store.saveAccounts(accounts);

  if (prev === true && result === false && info.pushEnabled !== false) {
    await notifySubscribers(username);
  }
}

async function notifySubscribers(username) {
  const subs = store.getSubscriptions();
  const payload = JSON.stringify({
    title: "계정 공개 전환 알림",
    body: `@${username} 계정이 공개로 전환되었습니다!`,
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (e) {
      // 구독이 만료/무효화된 경우 정리
      if (e.statusCode === 404 || e.statusCode === 410) {
        store.removeSubscription(sub.endpoint);
      } else {
        console.error("[push] 알림 발송 실패:", e.message);
      }
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function refreshAll({ respectBackoff = false } = {}) {
  const accounts = store.getAccounts();
  let usernames = Object.keys(accounts);
  if (respectBackoff) {
    usernames = usernames.filter((u) => isDue(accounts[u]));
  }
  const n = usernames.length;
  if (n === 0) return;

  const baseGap = CHECK_INTERVAL_MS / n;
  for (let i = 0; i < n; i++) {
    await checkOne(usernames[i], { respectBackoff });
    if (i < n - 1) {
      const gap =
        MIN_GAP_MS +
        Math.random() * Math.max(baseGap * 0.8, MIN_GAP_MS);
      await sleep(gap);
    }
  }
}

let loopStarted = false;
function startBackgroundLoop() {
  if (loopStarted) return;
  loopStarted = true;
  (async function loop() {
    while (true) {
      try {
        await refreshAll({ respectBackoff: true });
      } catch (e) {
        console.error("[checker] 스케줄 루프 오류:", e.message);
      }
      // 계정이 하나도 없거나 전부 백오프 중이면 잠깐 쉬었다가 다시 확인
      await sleep(60 * 1000);
    }
  })();
}

module.exports = {
  fetchIsPrivate,
  checkOne,
  refreshAll,
  startBackgroundLoop,
};
