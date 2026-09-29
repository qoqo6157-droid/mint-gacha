const SUPABASE_URL = "https://narkracwfchrlixvufpp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nHK7pXiqP5a3_GrMRw17qw_L0zdL70n";

const SAVE_KEY = "mintGachaSave_v1";
const LOCAL_BACKUP_KEY = "mintGachaLocalBackupBeforeCloud_v1";

const DEFAULT_SAVE = {
  version: 2,
  points: 3000,
  attendance: { lastClaimDate: null, streak: 0, maxSeenDate: null },
  characters: {},
  normalPity: 0,
  limitedPity: 0,
  limitedEventId: null,
  homeCharacters: [],
  homeIllustrationMode: {},
  ssrLimitBreak: {},
  pendingGacha: null,
  gameRecords: {
    matching: {},
    characterPang: {},
    runner: {},
    tetris: {},
    rhythm: {}
  },
  pet: null,
  completedPets: [],
  blackjackPending: null,
  derbyPending: null
};

const DEFAULT_GENERAL_SETTINGS = { ssr: 3, sr: 17, r: 80, exchangePt: 100 };
const DEFAULT_LIMITED_SETTINGS = { pickup: 3, ssr: 3, sr: 17, r: 77, exchangeLpt: 100 };
const ATTENDANCE_REWARDS = [400, 600, 800, 1000, 1300, 1600, 2500];

let saveData = loadSave();
let supabaseClient = null;
let currentUser = null;
let cloudReady = false;
let linkedUserId = null;
let cloudSaveTimer = null;
let safeSaveInterval = null;
let cloudBusy = false;
let authMode = "login";

let characters = [];
let generalSettings = { ...DEFAULT_GENERAL_SETTINGS };
let limitedSettings = { ...DEFAULT_LIMITED_SETTINGS };
let currentCollectionTab = "SSR";
let currentAdminFilter = "SSR";
let isAdmin = false;
let publicDataLoaded = false;
let tempHomeSelection = new Set();

/* =========================================================
   유틸
========================================================= */
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeSave(defaultValue, loadedValue) {
  if (defaultValue === null || typeof defaultValue !== "object" || Array.isArray(defaultValue)) {
    return loadedValue === undefined ? deepClone(defaultValue) : loadedValue;
  }

  const result = deepClone(defaultValue);
  if (loadedValue === null || typeof loadedValue !== "object" || Array.isArray(loadedValue)) return result;

  Object.keys(loadedValue).forEach((key) => {
    if (
      key in defaultValue &&
      defaultValue[key] !== null &&
      typeof defaultValue[key] === "object" &&
      !Array.isArray(defaultValue[key])
    ) {
      result[key] = mergeSave(defaultValue[key], loadedValue[key]);
    } else {
      result[key] = loadedValue[key];
    }
  });

  return result;
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? mergeSave(DEFAULT_SAVE, JSON.parse(raw)) : deepClone(DEFAULT_SAVE);
  } catch (error) {
    console.error("세이브 불러오기 실패:", error);
    return deepClone(DEFAULT_SAVE);
  }
}

function saveLocalOnly() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
    return true;
  } catch (error) {
    console.error("로컬 세이브 저장 실패:", error);
    return false;
  }
}

function saveGame() {
  saveLocalOnly();
  scheduleCloudSave();
}

function formatPoints(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString("ko-KR");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMessage(elementId, message = "", state = "") {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.classList.remove("error", "success");
  if (state) el.classList.add(state);
}

function randomChoice(array) {
  if (!array.length) return null;
  return array[Math.floor(Math.random() * array.length)];
}

function safeUUID() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sumRates(values) {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function ratesEqual100(values) {
  return Math.abs(sumRates(values) - 100) < 0.0001;
}

function addPoints(amount) {
  const safeAmount = Math.floor(Number(amount));
  if (!Number.isSafeInteger(safeAmount)) return false;
  const next = saveData.points + safeAmount;
  if (!Number.isSafeInteger(next) || next < 0) return false;
  saveData.points = next;
  saveGame();
  updatePointDisplays();
  return true;
}

function spendPoints(amount) {
  const cost = Math.floor(Number(amount));
  if (!Number.isSafeInteger(cost) || cost < 0 || saveData.points < cost) return false;
  saveData.points -= cost;
  saveGame();
  updatePointDisplays();
  return true;
}

function getOwnedCount(characterId) {
  return Math.max(0, Number(saveData.characters?.[characterId]) || 0);
}

function getLimitBreakLevel(characterId) {
  return Math.max(0, Math.min(3, Number(saveData.ssrLimitBreak?.[characterId]) || 0));
}

function characterDisplayImage(character, context = "collection") {
  if (!character) return "";
  const level = getLimitBreakLevel(character.id);
  if (level === 3 && character.full_image_url) {
    if (context === "home" && saveData.homeIllustrationMode?.[character.id] === "base") {
      return character.image_url || "";
    }
    return character.full_image_url;
  }
  return character.image_url || "";
}

function artHTML(character, context = "collection", label = "CHARACTER") {
  const url = characterDisplayImage(character, context);
  if (url) return `<img src="${escapeHTML(url)}" alt="${escapeHTML(character.name)}">`;
  return `<div class="fallback-art">${escapeHTML(label)}</div>`;
}

function updatePointDisplays() {
  const text = `${formatPoints(saveData.points)}P`;
  const header = document.getElementById("pointDisplay");
  const gacha = document.getElementById("gachaPointDisplay");
  if (header) header.textContent = `보유 포인트: ${text}`;
  if (gacha) gacha.textContent = text;
}

function renderEverything() {
  updatePointDisplays();
  renderAttendance();
  renderGacha();
  renderCollection();
  renderHomeCharacter();
  renderHomeBanner();
}

/* =========================================================
   페이지 / 탭
========================================================= */
const navButtons = document.querySelectorAll("nav button[data-page]");
const pages = document.querySelectorAll(".page");

function openPage(pageName) {
  pages.forEach((page) => {
    page.style.display = "none";
    page.classList.remove("active");
  });
  navButtons.forEach((button) => button.classList.remove("active"));

  const page = document.getElementById(pageName);
  const button = document.querySelector(`nav button[data-page="${pageName}"]`);
  if (page) {
    page.style.display = "block";
    page.classList.add("active");
  }
  button?.classList.add("active");

  if (pageName === "home") renderHomeCharacter();
  if (pageName === "gacha") renderGacha();
  if (pageName === "collection") renderCollection();
  if (pageName === "admin") void refreshAdminAccess();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

navButtons.forEach((button) => button.addEventListener("click", () => openPage(button.dataset.page)));
document.getElementById("goGachaButton")?.addEventListener("click", () => openPage("gacha"));

document.querySelectorAll("[data-gacha-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-gacha-tab]").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    const limited = button.dataset.gachaTab === "limited";
    document.getElementById("normalGachaPanel")?.classList.toggle("hidden", limited);
    document.getElementById("limitedGachaPanel")?.classList.toggle("hidden", !limited);
  });
});

document.querySelectorAll("[data-collection-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    currentCollectionTab = button.dataset.collectionTab;
    document.querySelectorAll("[data-collection-tab]").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    renderCollection();
  });
});

document.querySelectorAll("[data-admin-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    currentAdminFilter = button.dataset.adminFilter;
    document.querySelectorAll("[data-admin-filter]").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    renderAdminCharacterList();
  });
});

/* =========================================================
   출석
========================================================= */
function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateFromLocalString(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function dayDifference(older, newer) {
  return Math.round((dateFromLocalString(newer) - dateFromLocalString(older)) / 86400000);
}

function isAttendanceDateLocked() {
  const today = localDateString();
  const maxSeen = saveData.attendance.maxSeenDate;
  return Boolean(maxSeen && today < maxSeen);
}

function updateMaxSeenDate() {
  const today = localDateString();
  if (!saveData.attendance.maxSeenDate || today > saveData.attendance.maxSeenDate) {
    saveData.attendance.maxSeenDate = today;
    saveGame();
  }
}

function getNextAttendanceDay() {
  const a = saveData.attendance;
  const today = localDateString();
  if (!a.lastClaimDate) return 1;
  if (a.lastClaimDate === today) return a.streak || 1;
  const diff = dayDifference(a.lastClaimDate, today);
  if (diff === 1) return a.streak >= 7 ? 1 : a.streak + 1;
  return 1;
}

function renderAttendance() {
  const a = saveData.attendance;
  const today = localDateString();
  const locked = isAttendanceDateLocked();
  const claimedToday = a.lastClaimDate === today;
  const nextDay = getNextAttendanceDay();

  document.querySelectorAll(".attendance-day").forEach((card) => {
    card.classList.remove("today", "claimed");
    const day = Number(card.dataset.day);
    if (claimedToday) {
      if (day <= a.streak) card.classList.add("claimed");
      if (day === a.streak) card.classList.add("today");
    } else {
      if (a.lastClaimDate && day < nextDay && nextDay !== 1) card.classList.add("claimed");
      if (day === nextDay) card.classList.add("today");
    }
  });

  const status = document.getElementById("attendanceStatus");
  const button = document.getElementById("attendanceButton");
  const message = document.getElementById("attendanceMessage");
  if (status) status.textContent = `${claimedToday ? a.streak : nextDay}일차`;
  if (!button || !message) return;

  if (locked) {
    button.disabled = true;
    button.textContent = "출석 잠금";
    message.textContent = "기기 날짜가 이전 기록보다 과거라 출석이 잠겼어요.";
  } else if (claimedToday) {
    button.disabled = true;
    button.textContent = "오늘 출석 완료";
    message.textContent = `오늘 ${formatPoints(ATTENDANCE_REWARDS[Math.max(0, a.streak - 1)])}P를 이미 받았어요.`;
  } else {
    button.disabled = false;
    button.textContent = "오늘 출석하기";
    message.textContent = `${nextDay}일차 보상 ${formatPoints(ATTENDANCE_REWARDS[nextDay - 1])}P`;
  }
}

function claimAttendance() {
  if (isAttendanceDateLocked()) return renderAttendance();
  const today = localDateString();
  const a = saveData.attendance;
  if (a.lastClaimDate === today) return renderAttendance();
  const nextDay = getNextAttendanceDay();
  const reward = ATTENDANCE_REWARDS[nextDay - 1];
  a.streak = nextDay;
  a.lastClaimDate = today;
  if (!a.maxSeenDate || today > a.maxSeenDate) a.maxSeenDate = today;
  addPoints(reward);
  saveGame();
  renderAttendance();
}

document.getElementById("attendanceButton")?.addEventListener("click", claimAttendance);

/* =========================================================
   Supabase / 인증 / 클라우드
========================================================= */
function initSupabase() {
  if (!window.supabase) return false;
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return true;
}

function setCloudUi(state, title, description) {
  const card = document.getElementById("cloudStatusCard");
  const header = document.getElementById("headerSyncStatus");
  card?.classList.remove("connected", "saving", "error");
  header?.classList.remove("connected", "saving", "error");
  if (state) {
    card?.classList.add(state);
    header?.classList.add(state);
  }
  const titleEl = document.getElementById("cloudStatusTitle");
  const descEl = document.getElementById("cloudStatusDescription");
  const syncEl = document.getElementById("headerSyncText");
  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = description;
  if (syncEl) syncEl.textContent = title;
}

function renderAccountUi() {
  const loggedIn = Boolean(currentUser);
  document.getElementById("loginStatusBox")?.classList.toggle("logged-in", loggedIn);
  const badge = document.getElementById("cloudBadge");

  if (!loggedIn) {
    document.getElementById("loginStatusText").textContent = "게스트 이용 중";
    document.getElementById("accountTitle").textContent = "현재 게스트로 이용 중이에요.";
    document.getElementById("accountDescription").textContent = "로그인하면 다른 기기에서도 내 데이터를 불러올 수 있어요.";
    document.getElementById("accountEmail").textContent = "";
    badge.textContent = "로컬 저장";
    badge.classList.remove("connected");
    document.getElementById("guestAccountButtons")?.classList.remove("hidden");
    document.getElementById("loggedInAccountButtons")?.classList.add("hidden");
    setCloudUi("", "게스트 · 로컬 저장", "현재 데이터는 이 브라우저에 저장돼요.");
    return;
  }

  document.getElementById("loginStatusText").textContent = "계정 로그인 중";
  document.getElementById("accountTitle").textContent = "계정과 연결되어 있어요.";
  document.getElementById("accountDescription").textContent = "변경된 데이터는 자동으로 클라우드에 저장됩니다.";
  document.getElementById("accountEmail").textContent = currentUser.email || "";
  badge.textContent = cloudReady ? "클라우드 연결" : "연결 중";
  badge.classList.toggle("connected", cloudReady);
  document.getElementById("guestAccountButtons")?.classList.add("hidden");
  document.getElementById("loggedInAccountButtons")?.classList.remove("hidden");
  if (cloudReady) setCloudUi("connected", "클라우드 연결됨", "계정 세이브를 불러왔고 자동 저장이 켜져 있어요.");
}

function createLocalBackupBeforeCloud(userId) {
  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify({
      userId,
      backedUpAt: new Date().toISOString(),
      saveData: deepClone(saveData)
    }));
  } catch (error) {
    console.error("로컬 백업 실패:", error);
  }
}

async function loadOrCreateCloudSave(user) {
  if (!supabaseClient || !user || cloudBusy) return;
  cloudBusy = true;
  cloudReady = false;
  linkedUserId = user.id;
  renderAccountUi();
  setCloudUi("saving", "클라우드 확인 중", "이 계정의 서버 세이브를 확인하고 있어요.");

  try {
    const { data, error } = await supabaseClient
      .from("user_saves")
      .select("save_data, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;

    if (data?.save_data) {
      createLocalBackupBeforeCloud(user.id);
      saveData = mergeSave(DEFAULT_SAVE, data.save_data);
      saveLocalOnly();
      recoverPendingGacha();
      cloudReady = true;
      renderEverything();
      setCloudUi("connected", "클라우드 불러오기 완료", "기존 서버 세이브를 이 브라우저에 적용했어요.");
    } else {
      const { error: insertError } = await supabaseClient.from("user_saves").insert({
        user_id: user.id,
        save_data: deepClone(saveData)
      });
      if (insertError) throw insertError;
      cloudReady = true;
      setCloudUi("connected", "첫 클라우드 저장 완료", "현재 브라우저 세이브를 계정의 첫 서버 세이브로 올렸어요.");
    }

    renderAccountUi();
    startSafeSaveInterval();
  } catch (error) {
    console.error("클라우드 연결 실패:", error);
    cloudReady = false;
    setCloudUi("error", "클라우드 연결 실패", "로컬 세이브는 유지돼요. Supabase 설정을 확인해주세요.");
    renderAccountUi();
  } finally {
    cloudBusy = false;
  }
}

function scheduleCloudSave() {
  if (!currentUser || !cloudReady || !supabaseClient || linkedUserId !== currentUser.id) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    cloudSaveTimer = null;
    void saveCloudNow("자동 저장");
  }, 900);
}

async function saveCloudNow(reason = "클라우드 저장") {
  if (!currentUser || !cloudReady || !supabaseClient || linkedUserId !== currentUser.id) return false;
  saveLocalOnly();
  setCloudUi("saving", "저장 중...", `${reason}을 진행하고 있어요.`);
  try {
    const { error } = await supabaseClient.from("user_saves").upsert({
      user_id: currentUser.id,
      save_data: deepClone(saveData)
    }, { onConflict: "user_id" });
    if (error) throw error;
    setCloudUi("connected", "자동 저장됨", `마지막 저장 ${new Date().toLocaleTimeString("ko-KR")}`);
    return true;
  } catch (error) {
    console.error("클라우드 저장 실패:", error);
    setCloudUi("error", "클라우드 저장 실패", "로컬에는 저장됐어요.");
    return false;
  }
}

function startSafeSaveInterval() {
  clearInterval(safeSaveInterval);
  if (!currentUser || !cloudReady) return;
  safeSaveInterval = setInterval(() => void saveCloudNow("30초 안전 저장"), 30000);
}

function stopCloudSaving() {
  clearTimeout(cloudSaveTimer);
  clearInterval(safeSaveInterval);
  cloudSaveTimer = null;
  safeSaveInterval = null;
}

async function handleSignedInUser(user) {
  currentUser = user;
  renderAccountUi();
  if (!(linkedUserId === user.id && cloudReady)) await loadOrCreateCloudSave(user);
  await refreshAdminAccess();
}

function handleSignedOut() {
  stopCloudSaving();
  currentUser = null;
  linkedUserId = null;
  cloudReady = false;
  cloudBusy = false;
  isAdmin = false;
  renderAccountUi();
  renderAdminGate();
}

async function initAuth() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) console.error(error);
  if (data?.session?.user) await handleSignedInUser(data.session.user);
  else handleSignedOut();

  supabaseClient.auth.onAuthStateChange((event, session) => {
    const user = session?.user || null;
    setTimeout(() => {
      if (!user || event === "SIGNED_OUT") handleSignedOut();
      else void handleSignedInUser(user);
    }, 0);
  });
}

/* 인증 모달 */
const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authEmailInput = document.getElementById("authEmailInput");
const authPasswordInput = document.getElementById("authPasswordInput");
const authPasswordConfirmInput = document.getElementById("authPasswordConfirmInput");

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "login";
  setMessage("authMessage", "");
  const signup = authMode === "signup";
  document.getElementById("authModalTitle").textContent = signup ? "회원가입" : "로그인";
  document.getElementById("authModalDescription").textContent = signup ? "이메일과 비밀번호로 계정을 만들어요." : "이메일과 비밀번호로 로그인하세요.";
  document.getElementById("authPasswordConfirmField")?.classList.toggle("hidden", !signup);
  document.getElementById("authSubmitButton").textContent = signup ? "회원가입" : "로그인";
  document.getElementById("authSwitchButton").textContent = signup ? "이미 계정이 있나요? 로그인" : "계정이 없나요? 회원가입";
}

function openAuthModal(mode) {
  setAuthMode(mode);
  authModal?.classList.remove("hidden");
  document.body.classList.add("modal-open");
  setTimeout(() => authEmailInput?.focus(), 30);
}

function closeAuthModal() {
  authModal?.classList.add("hidden");
  document.body.classList.remove("modal-open");
  setMessage("authMessage", "");
  if (authPasswordInput) authPasswordInput.value = "";
  if (authPasswordConfirmInput) authPasswordConfirmInput.value = "";
}

function currentPageUrl() {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  return url.toString();
}

function translateAuthError(error) {
  const message = String(error?.message || "");
  if (message.includes("Invalid login credentials")) return "이메일 또는 비밀번호가 맞지 않아요.";
  if (message.includes("Email not confirmed")) return "이메일 인증이 아직 완료되지 않았어요.";
  if (message.includes("already registered")) return "이미 가입된 이메일이에요.";
  if (message.toLowerCase().includes("rate limit")) return "요청이 너무 많아요. 잠시 후 다시 시도해주세요.";
  return message || "인증 처리 중 오류가 발생했어요.";
}

document.getElementById("openLoginButton")?.addEventListener("click", () => openAuthModal("login"));
document.getElementById("openSignupButton")?.addEventListener("click", () => openAuthModal("signup"));
document.getElementById("closeAuthModal")?.addEventListener("click", closeAuthModal);
document.getElementById("authSwitchButton")?.addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));
authModal?.addEventListener("click", (e) => { if (e.target === authModal) closeAuthModal(); });

authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  const confirm = authPasswordConfirmInput.value;
  if (!email || !password) return setMessage("authMessage", "이메일과 비밀번호를 입력해주세요.", "error");
  if (authMode === "signup" && password !== confirm) return setMessage("authMessage", "비밀번호 확인이 일치하지 않아요.", "error");

  const submit = document.getElementById("authSubmitButton");
  submit.disabled = true;
  try {
    if (authMode === "signup") {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: currentPageUrl() }
      });
      if (error) throw error;
      if (data.session) {
        setMessage("authMessage", "회원가입과 로그인이 완료됐어요.", "success");
        setTimeout(closeAuthModal, 500);
      } else {
        setMessage("authMessage", "회원가입 완료! 이메일 인증 링크를 눌러주세요.", "success");
      }
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setMessage("authMessage", "로그인 완료!", "success");
      setTimeout(closeAuthModal, 400);
    }
  } catch (error) {
    setMessage("authMessage", translateAuthError(error), "error");
  } finally {
    submit.disabled = false;
    submit.textContent = authMode === "signup" ? "회원가입" : "로그인";
  }
});

document.getElementById("manualCloudSaveButton")?.addEventListener("click", () => void saveCloudNow("수동 저장"));
document.getElementById("logoutButton")?.addEventListener("click", async () => {
  if (cloudReady) await saveCloudNow("로그아웃 직전 저장");
  await supabaseClient.auth.signOut();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && currentUser && cloudReady) void saveCloudNow("화면 숨김 안전 저장");
});
window.addEventListener("pagehide", () => {
  if (currentUser && cloudReady) void saveCloudNow("페이지 종료 안전 저장");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeAuthModal();
  closeGachaResultModal();
  closeLimitBreakModal();
  closeHomeCharacterModal();
});

/* =========================================================
   공개 캐릭터 / 설정 데이터
========================================================= */
async function loadPublicData() {
  if (!supabaseClient) return;
  try {
    const [characterResult, settingResult] = await Promise.all([
      supabaseClient.from("characters").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
      supabaseClient.from("site_settings").select("key,value")
    ]);

    if (characterResult.error) throw characterResult.error;
    if (settingResult.error) throw settingResult.error;

    characters = characterResult.data || [];
    const settingMap = Object.fromEntries((settingResult.data || []).map((row) => [row.key, row.value]));
    generalSettings = { ...DEFAULT_GENERAL_SETTINGS, ...(settingMap.general_gacha || {}) };
    limitedSettings = { ...DEFAULT_LIMITED_SETTINGS, ...(settingMap.limited_gacha || {}) };
    publicDataLoaded = true;
    syncLimitedEventId();
    renderEverything();
    if (isAdmin) renderAdmin();
  } catch (error) {
    console.error("공용 데이터 불러오기 실패:", error);
    setMessage("normalGachaMessage", "캐릭터 DB를 불러오지 못했어요. v4 SQL을 먼저 실행해주세요.", "error");
    setMessage("limitedGachaMessage", "캐릭터 DB를 불러오지 못했어요. v4 SQL을 먼저 실행해주세요.", "error");
  }
}

function activeLimitedCharacters() {
  const now = Date.now();
  return characters.filter((char) => {
    if (!char.is_limited || !char.limited_start || !char.limited_end) return false;
    return new Date(char.limited_start).getTime() <= now && now <= new Date(char.limited_end).getTime();
  });
}

function currentLimitedEventId() {
  const active = activeLimitedCharacters();
  if (!active.length) return null;
  return active
    .map((char) => `${char.id}@${char.limited_end}`)
    .sort()
    .join("|");
}

function syncLimitedEventId() {
  const eventId = currentLimitedEventId();
  if (saveData.limitedEventId !== eventId) {
    saveData.limitedEventId = eventId;
    saveData.limitedPity = 0;
    saveGame();
  }
}

function normalPool(rarity) {
  return characters.filter((char) => !char.is_limited && char.rarity === rarity);
}

function validateNormalGacha() {
  const rates = [generalSettings.ssr, generalSettings.sr, generalSettings.r];
  if (!ratesEqual100(rates)) return "일반 가챠 확률 합계가 100%가 아니에요. 관리자 설정을 확인해주세요.";
  if (Number(generalSettings.ssr) > 0 && !normalPool("SSR").length) return "SSR 확률은 있지만 등록된 통상 SSR이 없어요.";
  if (Number(generalSettings.sr) > 0 && !normalPool("SR").length) return "SR 확률은 있지만 등록된 통상 SR이 없어요.";
  if (Number(generalSettings.r) > 0 && !normalPool("R").length) return "R 확률은 있지만 등록된 통상 R이 없어요.";
  return "";
}

function validateLimitedGacha() {
  const active = activeLimitedCharacters();
  if (!active.length) return "현재 진행 중인 한정 픽업이 없어요.";
  const rates = [limitedSettings.pickup, limitedSettings.ssr, limitedSettings.sr, limitedSettings.r];
  if (!ratesEqual100(rates)) return "한정 가챠 확률 합계가 100%가 아니에요.";
  if (Number(limitedSettings.pickup) > 0 && !active.length) return "한정 확률은 있지만 활성 한정 캐릭터가 없어요.";
  if (Number(limitedSettings.ssr) > 0 && !normalPool("SSR").length) return "통상 SSR 확률은 있지만 등록 캐릭터가 없어요.";
  if (Number(limitedSettings.sr) > 0 && !normalPool("SR").length) return "SR 확률은 있지만 등록 캐릭터가 없어요.";
  if (Number(limitedSettings.r) > 0 && !normalPool("R").length) return "R 확률은 있지만 등록 캐릭터가 없어요.";
  return "";
}

/* =========================================================
   가챠
========================================================= */
function rollNormalCharacter() {
  const roll = Math.random() * 100;
  const ssr = Number(generalSettings.ssr) || 0;
  const sr = Number(generalSettings.sr) || 0;
  if (roll < ssr) return randomChoice(normalPool("SSR"));
  if (roll < ssr + sr) return randomChoice(normalPool("SR"));
  return randomChoice(normalPool("R"));
}

function rollLimitedCharacter() {
  const roll = Math.random() * 100;
  const pickup = Number(limitedSettings.pickup) || 0;
  const ssr = Number(limitedSettings.ssr) || 0;
  const sr = Number(limitedSettings.sr) || 0;
  if (roll < pickup) return randomChoice(activeLimitedCharacters());
  if (roll < pickup + ssr) return randomChoice(normalPool("SSR"));
  if (roll < pickup + ssr + sr) return randomChoice(normalPool("SR"));
  return randomChoice(normalPool("R"));
}

function recoverPendingGacha() {
  const pending = saveData.pendingGacha;
  if (!pending) return;
  if (pending.status === "started") {
    saveData.points += Number(pending.cost) || 0;
    if (pending.type === "normal") saveData.normalPity = Math.max(0, saveData.normalPity - (Number(pending.count) || 0));
    if (pending.type === "limited") saveData.limitedPity = Math.max(0, saveData.limitedPity - (Number(pending.count) || 0));
  }
  saveData.pendingGacha = null;
  saveLocalOnly();
}

function performGacha(type, count) {
  const limited = type === "limited";
  syncLimitedEventId();
  const validation = limited ? validateLimitedGacha() : validateNormalGacha();
  const messageId = limited ? "limitedGachaMessage" : "normalGachaMessage";
  if (validation) return setMessage(messageId, validation, "error");

  const cost = count * 100;
  if (saveData.points < cost) return setMessage(messageId, "포인트가 부족해요.", "error");

  saveData.pendingGacha = {
    id: safeUUID(), type, count, cost, startedAt: new Date().toISOString(), status: "started"
  };
  saveData.points -= cost;
  if (limited) saveData.limitedPity += count;
  else saveData.normalPity += count;
  saveLocalOnly();

  const results = [];
  for (let i = 0; i < count; i++) {
    const char = limited ? rollLimitedCharacter() : rollNormalCharacter();
    if (!char) continue;
    const before = getOwnedCount(char.id);
    saveData.characters[char.id] = before + 1;
    results.push({ id: char.id, isNew: before === 0, limited: Boolean(char.is_limited) });
  }

  saveData.pendingGacha.status = "applied";
  saveData.pendingGacha.results = results;
  saveGame();
  updatePointDisplays();
  renderGacha();
  renderCollection();
  showGachaResults(type, results);
  saveData.pendingGacha = null;
  saveGame();
  setMessage(messageId, `${count}회 뽑기가 완료됐어요.`, "success");
}

document.getElementById("normalDraw1Button")?.addEventListener("click", () => performGacha("normal", 1));
document.getElementById("normalDraw10Button")?.addEventListener("click", () => performGacha("normal", 10));
document.getElementById("limitedDraw1Button")?.addEventListener("click", () => performGacha("limited", 1));
document.getElementById("limitedDraw10Button")?.addEventListener("click", () => performGacha("limited", 10));

function showGachaResults(type, results) {
  const modal = document.getElementById("gachaResultModal");
  const grid = document.getElementById("gachaResultGrid");
  document.getElementById("gachaResultTitle").textContent = type === "limited" ? "한정 가챠 결과" : "일반 가챠 결과";

  grid.innerHTML = results.map((result) => {
    const char = characters.find((c) => c.id === result.id);
    if (!char) return "";
    const owned = getOwnedCount(char.id);
    const newLabel = result.isNew ? (char.is_limited ? "LIMITED NEW" : "NEW") : "";
    const cardClass = char.is_limited ? "limited" : char.rarity.toLowerCase();
    return `
      <div class="result-card ${cardClass}">
        ${newLabel ? `<span class="result-label ${char.is_limited ? "limited" : ""}">${escapeHTML(newLabel)}</span>` : ""}
        <div class="result-image">${artHTML(char)}</div>
        <div class="result-card-body">
          <strong>${escapeHTML(char.name)}</strong>
          <small>${char.is_limited ? "LIMITED · " : ""}${escapeHTML(char.rarity)} · 보유 ${owned}장</small>
        </div>
      </div>`;
  }).join("");

  modal?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeGachaResultModal() {
  document.getElementById("gachaResultModal")?.classList.add("hidden");
  if (document.querySelectorAll(".modal-backdrop:not(.hidden)").length === 0) document.body.classList.remove("modal-open");
}

document.getElementById("closeGachaResultModal")?.addEventListener("click", closeGachaResultModal);
document.getElementById("gachaResultConfirmButton")?.addEventListener("click", closeGachaResultModal);

function renderGacha() {
  const normalRate = document.getElementById("normalRateRow");
  if (normalRate) normalRate.innerHTML = `
    <span class="rate-chip ssr">SSR ${Number(generalSettings.ssr) || 0}%</span>
    <span class="rate-chip">SR ${Number(generalSettings.sr) || 0}%</span>
    <span class="rate-chip">R ${Number(generalSettings.r) || 0}%</span>`;

  document.getElementById("normalPityDisplay").textContent = `${saveData.normalPity || 0} PT`;
  document.getElementById("normalExchangeCostText").textContent = `교환 필요 ${generalSettings.exchangePt} PT`;
  document.getElementById("limitedPityDisplay").textContent = `${saveData.limitedPity || 0} LPT`;
  document.getElementById("limitedExchangeCostText").textContent = `교환 필요 ${limitedSettings.exchangeLpt} LPT`;

  const normalValidation = validateNormalGacha();
  document.getElementById("normalDraw1Button").disabled = Boolean(normalValidation);
  document.getElementById("normalDraw10Button").disabled = Boolean(normalValidation);
  if (normalValidation && publicDataLoaded) setMessage("normalGachaMessage", normalValidation, "error");

  const limitedRate = document.getElementById("limitedRateRow");
  if (limitedRate) limitedRate.innerHTML = `
    <span class="rate-chip limited">한정 ${Number(limitedSettings.pickup) || 0}%</span>
    <span class="rate-chip ssr">통상 SSR ${Number(limitedSettings.ssr) || 0}%</span>
    <span class="rate-chip">SR ${Number(limitedSettings.sr) || 0}%</span>
    <span class="rate-chip">R ${Number(limitedSettings.r) || 0}%</span>`;

  const active = activeLimitedCharacters();
  const title = document.getElementById("limitedGachaTitle");
  const period = document.getElementById("limitedGachaPeriod");
  if (title) title.textContent = active.length ? `한정 픽업 · ${active.length}명` : "현재 한정 픽업 없음";
  if (period) {
    if (active.length) {
      const latest = active.map((c) => new Date(c.limited_end)).sort((a, b) => b - a)[0];
      period.textContent = `종료 예정 ${latest.toLocaleString("ko-KR")}`;
    } else period.textContent = "관리자가 시작/종료 시각을 지정한 한정 캐릭터가 활성화되면 열려요.";
  }

  const strip = document.getElementById("limitedPickupStrip");
  if (strip) strip.innerHTML = active.length ? active.map((char) => `
    <div class="pickup-mini-card">
      <div>${artHTML(char)}</div>
      <div><strong>${escapeHTML(char.name)}</strong><small>LIMITED · ${escapeHTML(char.rarity)}</small></div>
    </div>`).join("") : `<div class="card">진행 중인 한정 픽업이 없어요.</div>`;

  const limitedDisabled = Boolean(validateLimitedGacha());
  document.getElementById("limitedDraw1Button").disabled = limitedDisabled;
  document.getElementById("limitedDraw10Button").disabled = limitedDisabled;

  renderNormalExchange();
  renderLimitedExchange();
}

function renderNormalExchange() {
  const grid = document.getElementById("normalExchangeGrid");
  if (!grid) return;
  const list = normalPool("SSR");
  if (!list.length) {
    grid.innerHTML = `<div class="card">등록된 통상 SSR이 없어요.</div>`;
    return;
  }
  grid.innerHTML = list.map((char) => `
    <div class="exchange-card">
      <div class="exchange-card-image">${artHTML(char)}</div>
      <div class="exchange-card-body">
        <strong>${escapeHTML(char.name)}</strong>
        <small>현재 보유 ${getOwnedCount(char.id)}장 · ${generalSettings.exchangePt} PT</small>
        <button data-normal-exchange="${char.id}" ${saveData.normalPity < generalSettings.exchangePt ? "disabled" : ""}>교환하기</button>
      </div>
    </div>`).join("");

  grid.querySelectorAll("[data-normal-exchange]").forEach((button) => {
    button.addEventListener("click", () => exchangeNormalSSR(button.dataset.normalExchange));
  });
}

function exchangeNormalSSR(id) {
  const char = characters.find((c) => c.id === id && !c.is_limited && c.rarity === "SSR");
  if (!char || saveData.normalPity < generalSettings.exchangePt) return;
  if (!confirm(`${char.name} 1장을 ${generalSettings.exchangePt} PT로 교환할까요?`)) return;
  saveData.normalPity -= generalSettings.exchangePt;
  saveData.characters[id] = getOwnedCount(id) + 1;
  saveGame();
  renderGacha();
  renderCollection();
}

function renderLimitedExchange() {
  const grid = document.getElementById("limitedExchangeGrid");
  if (!grid) return;
  const list = activeLimitedCharacters();
  if (!list.length) {
    grid.innerHTML = `<div class="card">한정 기간이 아니어서 교환할 수 없어요.</div>`;
    return;
  }
  grid.innerHTML = list.map((char) => `
    <div class="exchange-card">
      <div class="exchange-card-image">${artHTML(char)}</div>
      <div class="exchange-card-body">
        <strong>${escapeHTML(char.name)}</strong>
        <small>현재 보유 ${getOwnedCount(char.id)}장 · ${limitedSettings.exchangeLpt} LPT</small>
        <button data-limited-exchange="${char.id}" ${saveData.limitedPity < limitedSettings.exchangeLpt ? "disabled" : ""}>교환하기</button>
      </div>
    </div>`).join("");
  grid.querySelectorAll("[data-limited-exchange]").forEach((button) => {
    button.addEventListener("click", () => exchangeLimited(button.dataset.limitedExchange));
  });
}

function exchangeLimited(id) {
  const char = activeLimitedCharacters().find((c) => c.id === id);
  if (!char || saveData.limitedPity < limitedSettings.exchangeLpt) return;
  if (!confirm(`${char.name} 1장을 ${limitedSettings.exchangeLpt} LPT로 교환할까요?`)) return;
  saveData.limitedPity -= limitedSettings.exchangeLpt;
  saveData.characters[id] = getOwnedCount(id) + 1;
  saveGame();
  renderGacha();
  renderCollection();
}

document.getElementById("refreshNormalExchangeButton")?.addEventListener("click", renderNormalExchange);

/* =========================================================
   도감 / 한계돌파
========================================================= */
function sortedCollectionCharacters(tab) {
  if (tab === "LIMITED") return characters.filter((c) => c.is_limited).sort((a, b) => a.sort_order - b.sort_order);
  return characters.filter((c) => !c.is_limited && c.rarity === tab).sort((a, b) => a.sort_order - b.sort_order);
}

function renderCollection() {
  const grid = document.getElementById("collectionGrid");
  if (!grid) return;
  const allOwned = characters.filter((c) => getOwnedCount(c.id) > 0).length;
  document.getElementById("collectionSummary").textContent = `${allOwned} / ${characters.length}`;

  const list = sortedCollectionCharacters(currentCollectionTab);
  if (!list.length) {
    grid.innerHTML = `<div class="card">이 분류에 등록된 캐릭터가 없어요.</div>`;
    return;
  }

  grid.innerHTML = list.map((char) => {
    const owned = getOwnedCount(char.id);
    if (!owned) {
      return `
        <article class="collection-card locked">
          <div class="collection-image">🔒</div>
          <div class="collection-body">
            <div class="collection-topline"><span class="rarity-badge ${char.is_limited ? "limited" : char.rarity.toLowerCase()}">${char.is_limited ? "LIMITED" : escapeHTML(char.rarity)}</span></div>
            <h3>???</h3><div class="collection-counts"><span>🔒 미획득</span></div>
          </div>
        </article>`;
    }

    const lb = char.rarity === "SSR" ? getLimitBreakLevel(char.id) : 0;
    const duplicate = Math.max(0, owned - 1);
    const canBreak = char.rarity === "SSR" && lb < 3 && duplicate >= 1;
    const stars = char.rarity === "SSR" ? `${"★".repeat(lb)}${"☆".repeat(3 - lb)}` : "";
    return `
      <article class="collection-card">
        <div class="collection-image">${artHTML(char)}</div>
        <div class="collection-body">
          <div class="collection-topline">
            <span class="rarity-badge ${char.is_limited ? "limited" : char.rarity.toLowerCase()}">${char.is_limited ? "LIMITED" : escapeHTML(char.rarity)}</span>
            ${lb === 3 ? `<span class="rarity-badge">FULL</span>` : ""}
          </div>
          <h3>${escapeHTML(char.name)}</h3>
          <div class="collection-counts"><span>보유 ${owned}장</span><span>중복 ${duplicate}장</span></div>
          ${char.rarity === "SSR" ? `
            <div class="limit-break-box">
              <div class="limit-break-stars">${stars}</div>
              <div class="limit-break-meta">강화 ${lb}/3 · 남은 중복 ${duplicate}장</div>
              <button class="limit-break-button" data-limit-break="${char.id}" ${canBreak ? "" : "disabled"}>${lb === 3 ? "★★★ FULL" : "한계돌파"}</button>
            </div>` : ""}
          <button class="home-toggle-button" data-quick-home="${char.id}">${saveData.homeCharacters.includes(char.id) ? "홈 설정됨" : "홈 후보로 설정"}</button>
        </div>
      </article>`;
  }).join("");

  grid.querySelectorAll("[data-limit-break]").forEach((button) => {
    button.addEventListener("click", () => limitBreakCharacter(button.dataset.limitBreak));
  });
  grid.querySelectorAll("[data-quick-home]").forEach((button) => {
    button.addEventListener("click", () => quickToggleHome(button.dataset.quickHome));
  });
}

function limitBreakCharacter(id) {
  const char = characters.find((c) => c.id === id);
  if (!char || char.rarity !== "SSR") return;
  const level = getLimitBreakLevel(id);
  if (level >= 3 || getOwnedCount(id) < 2) return;
  if (!confirm(`${char.name}의 중복 1장을 소모해 ${level + 1}/3으로 강화할까요?`)) return;

  saveData.characters[id] = getOwnedCount(id) - 1;
  saveData.ssrLimitBreak[id] = level + 1;
  if (level + 1 === 3 && char.full_image_url) saveData.homeIllustrationMode[id] = "full";
  saveGame();
  renderCollection();
  renderHomeCharacter();
  showLimitBreakModal(char, level + 1);
}

function showLimitBreakModal(char, level) {
  document.getElementById("limitBreakCharacterName").textContent = char.name;
  document.getElementById("limitBreakStageText").textContent = level === 3 ? "★★★ 3/3 FULL" : `${"★".repeat(level)}${"☆".repeat(3 - level)} ${level}/3`;
  document.getElementById("limitBreakModal")?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeLimitBreakModal() {
  document.getElementById("limitBreakModal")?.classList.add("hidden");
  if (document.querySelectorAll(".modal-backdrop:not(.hidden)").length === 0) document.body.classList.remove("modal-open");
}

document.getElementById("closeLimitBreakModal")?.addEventListener("click", closeLimitBreakModal);

function quickToggleHome(id) {
  if (!getOwnedCount(id)) return;
  const list = [...saveData.homeCharacters];
  if (list.includes(id)) saveData.homeCharacters = list.filter((x) => x !== id);
  else {
    if (list.length >= 3) return alert("홈 캐릭터는 최대 3명까지 설정할 수 있어요.");
    saveData.homeCharacters = [...list, id];
  }
  saveGame();
  renderCollection();
  renderHomeCharacter();
}

/* =========================================================
   홈 캐릭터
========================================================= */
function validHomeCharacters() {
  saveData.homeCharacters = (saveData.homeCharacters || []).filter((id) => getOwnedCount(id) > 0 && characters.some((c) => c.id === id)).slice(0, 3);
  return saveData.homeCharacters.map((id) => characters.find((c) => c.id === id)).filter(Boolean);
}

function renderHomeCharacter() {
  const list = validHomeCharacters();
  const image = document.getElementById("homeCharacterImage");
  const rarity = document.getElementById("homeCharacterRarity");
  const name = document.getElementById("homeCharacterName");
  const help = document.getElementById("homeCharacterHelp");
  const dialogue = document.getElementById("homeCharacterDialogue");
  if (!image || !rarity || !name || !help || !dialogue) return;

  if (!list.length) {
    image.innerHTML = "<span>캐릭터 이미지</span>";
    rarity.textContent = "SSR";
    name.textContent = "아직 홈 캐릭터가 없어요";
    help.textContent = "도감에서 획득한 캐릭터를 최대 3명까지 홈 캐릭터로 설정할 수 있어요.";
    dialogue.textContent = "“캐릭터를 터치하면 대사가 표시됩니다.”";
    image.dataset.characterId = "";
    dialogue.dataset.characterId = "";
    return;
  }

  const char = randomChoice(list);
  image.innerHTML = artHTML(char, "home");
  image.dataset.characterId = char.id;
  dialogue.dataset.characterId = char.id;
  rarity.textContent = char.is_limited ? `LIMITED · ${char.rarity}` : char.rarity;
  name.textContent = char.name;
  help.textContent = getLimitBreakLevel(char.id) === 3 ? "★★★ FULL · 홈에서 풀돌 전/후 일러를 선택할 수 있어요." : `보유 ${getOwnedCount(char.id)}장`;
  dialogue.textContent = "“캐릭터를 터치하면 대사가 표시됩니다.”";
}

function showRandomDialogue(id) {
  const char = characters.find((c) => c.id === id);
  const dialogue = document.getElementById("homeCharacterDialogue");
  if (!char || !dialogue) return;
  const lines = Array.isArray(char.dialogues) ? char.dialogues.filter(Boolean) : [];
  dialogue.textContent = lines.length ? `“${randomChoice(lines)}”` : "“등록된 대사가 없어요.”";
}

document.getElementById("homeCharacterImage")?.addEventListener("click", (e) => showRandomDialogue(e.currentTarget.dataset.characterId));
document.getElementById("homeCharacterDialogue")?.addEventListener("click", (e) => showRandomDialogue(e.currentTarget.dataset.characterId));

function openHomeCharacterModal() {
  tempHomeSelection = new Set(validHomeCharacters().map((c) => c.id));
  renderHomeSettingList();
  document.getElementById("homeCharacterModal")?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeHomeCharacterModal() {
  document.getElementById("homeCharacterModal")?.classList.add("hidden");
  if (document.querySelectorAll(".modal-backdrop:not(.hidden)").length === 0) document.body.classList.remove("modal-open");
}

function renderHomeSettingList() {
  const listEl = document.getElementById("homeSettingList");
  if (!listEl) return;
  const owned = characters.filter((c) => getOwnedCount(c.id) > 0);
  if (!owned.length) {
    listEl.innerHTML = `<div class="card">아직 획득한 캐릭터가 없어요.</div>`;
    return;
  }
  listEl.innerHTML = owned.map((char) => {
    const selected = tempHomeSelection.has(char.id);
    const fullEligible = char.rarity === "SSR" && getLimitBreakLevel(char.id) === 3 && char.full_image_url;
    const mode = saveData.homeIllustrationMode?.[char.id] || (fullEligible ? "full" : "base");
    return `
      <div class="home-setting-row ${selected ? "selected" : ""}">
        <div class="home-setting-thumb">${artHTML(char, "home")}</div>
        <div class="home-setting-info"><strong>${escapeHTML(char.name)}</strong><small>${char.is_limited ? "LIMITED · " : ""}${escapeHTML(char.rarity)} · 보유 ${getOwnedCount(char.id)}장</small></div>
        <div class="home-setting-controls">
          <button class="${selected ? "active" : ""}" data-home-select="${char.id}">${selected ? "선택됨" : "선택"}</button>
          ${fullEligible ? `<button data-home-art="${char.id}" data-mode="${mode}">${mode === "full" ? "★★★ 풀돌 후 일러" : "풀돌 전 일러"}</button>` : ""}
        </div>
      </div>`;
  }).join("");

  listEl.querySelectorAll("[data-home-select]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.homeSelect;
      if (tempHomeSelection.has(id)) tempHomeSelection.delete(id);
      else {
        if (tempHomeSelection.size >= 3) return setMessage("homeSettingMessage", "최대 3명까지 선택할 수 있어요.", "error");
        tempHomeSelection.add(id);
      }
      setMessage("homeSettingMessage", "");
      renderHomeSettingList();
    });
  });

  listEl.querySelectorAll("[data-home-art]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.homeArt;
      const next = button.dataset.mode === "full" ? "base" : "full";
      saveData.homeIllustrationMode[id] = next;
      saveGame();
      renderHomeSettingList();
    });
  });
}

document.getElementById("openHomeCharacterButton")?.addEventListener("click", openHomeCharacterModal);
document.getElementById("closeHomeCharacterModal")?.addEventListener("click", closeHomeCharacterModal);
document.getElementById("saveHomeCharacterButton")?.addEventListener("click", () => {
  saveData.homeCharacters = [...tempHomeSelection].slice(0, 3);
  saveGame();
  renderHomeCharacter();
  renderCollection();
  closeHomeCharacterModal();
});

function renderHomeBanner() {
  const active = activeLimitedCharacters();
  const title = document.getElementById("homeBannerTitle");
  const text = document.getElementById("homeBannerText");
  const image = document.getElementById("homeBannerImage");
  if (!title || !text || !image) return;
  if (!active.length) {
    title.textContent = "새로운 픽업을 기다려주세요!";
    text.textContent = "현재 진행 중인 한정 픽업이 없어요.";
    image.innerHTML = "<span>CHARACTER</span>";
    return;
  }
  const char = active[0];
  title.textContent = `${char.name} 한정 픽업!`;
  text.textContent = `${new Date(char.limited_end).toLocaleString("ko-KR")}까지`;
  image.innerHTML = artHTML(char);
}

/* =========================================================
   관리자 권한 / 설정
========================================================= */
async function refreshAdminAccess() {
  if (!supabaseClient || !currentUser) {
    isAdmin = false;
    renderAdminGate();
    return;
  }
  try {
    const { data, error } = await supabaseClient.rpc("is_admin");
    if (error) throw error;
    isAdmin = Boolean(data);
  } catch (error) {
    console.error("관리자 확인 실패:", error);
    isAdmin = false;
  }
  renderAdminGate();
  if (isAdmin) renderAdmin();
}

function renderAdminGate() {
  const gate = document.getElementById("adminGate");
  const content = document.getElementById("adminContent");
  const badge = document.getElementById("adminStatusBadge");
  const text = document.getElementById("adminGateText");
  const claim = document.getElementById("claimAdminButton");
  if (!gate || !content || !badge || !text || !claim) return;

  if (isAdmin) {
    gate.classList.add("hidden");
    content.classList.remove("hidden");
    badge.textContent = "관리자";
    return;
  }

  gate.classList.remove("hidden");
  content.classList.add("hidden");
  badge.textContent = currentUser ? "일반 계정" : "로그인 필요";
  if (!currentUser) {
    text.textContent = "먼저 홈에서 로그인해주세요.";
    claim.classList.add("hidden");
  } else {
    text.textContent = "아직 관리자 계정이 하나도 없다면 이 계정을 첫 관리자로 등록할 수 있어요.";
    claim.classList.remove("hidden");
  }
}

document.getElementById("claimAdminButton")?.addEventListener("click", async () => {
  if (!currentUser) return;
  try {
    const { data, error } = await supabaseClient.rpc("claim_first_admin");
    if (error) throw error;
    if (!data) return alert("이미 다른 관리자 계정이 등록되어 있어요.");
    await refreshAdminAccess();
    alert("첫 관리자 권한이 등록됐어요.");
  } catch (error) {
    alert(`관리자 등록 실패: ${error.message || error}`);
  }
});

function renderAdmin() {
  if (!isAdmin) return;
  document.getElementById("adminNormalSSR").value = generalSettings.ssr;
  document.getElementById("adminNormalSR").value = generalSettings.sr;
  document.getElementById("adminNormalR").value = generalSettings.r;
  document.getElementById("adminNormalExchange").value = generalSettings.exchangePt;
  document.getElementById("adminLimitedPickup").value = limitedSettings.pickup;
  document.getElementById("adminLimitedSSR").value = limitedSettings.ssr;
  document.getElementById("adminLimitedSR").value = limitedSettings.sr;
  document.getElementById("adminLimitedR").value = limitedSettings.r;
  document.getElementById("adminLimitedExchange").value = limitedSettings.exchangeLpt;
  renderAdminCharacterList();
}

document.getElementById("normalSettingsForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin) return;
  const value = {
    ssr: Number(document.getElementById("adminNormalSSR").value),
    sr: Number(document.getElementById("adminNormalSR").value),
    r: Number(document.getElementById("adminNormalR").value),
    exchangePt: Math.max(1, Math.floor(Number(document.getElementById("adminNormalExchange").value)))
  };
  if (!ratesEqual100([value.ssr, value.sr, value.r])) return setMessage("normalSettingsMessage", "SSR + SR + R 합계가 정확히 100%여야 해요.", "error");
  try {
    const { error } = await supabaseClient.from("site_settings").upsert({ key: "general_gacha", value });
    if (error) throw error;
    generalSettings = value;
    renderGacha();
    setMessage("normalSettingsMessage", "일반 가챠 설정을 저장했어요.", "success");
  } catch (error) {
    setMessage("normalSettingsMessage", error.message || "저장 실패", "error");
  }
});

document.getElementById("autoLimitedRButton")?.addEventListener("click", () => {
  const pickup = Number(document.getElementById("adminLimitedPickup").value) || 0;
  const ssr = Number(document.getElementById("adminLimitedSSR").value) || 0;
  const sr = Number(document.getElementById("adminLimitedSR").value) || 0;
  document.getElementById("adminLimitedR").value = Math.max(0, 100 - pickup - ssr - sr).toFixed(2).replace(/\.00$/, "");
});

document.getElementById("limitedSettingsForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin) return;
  const value = {
    pickup: Number(document.getElementById("adminLimitedPickup").value),
    ssr: Number(document.getElementById("adminLimitedSSR").value),
    sr: Number(document.getElementById("adminLimitedSR").value),
    r: Number(document.getElementById("adminLimitedR").value),
    exchangeLpt: Math.max(1, Math.floor(Number(document.getElementById("adminLimitedExchange").value)))
  };
  if (!ratesEqual100([value.pickup, value.ssr, value.sr, value.r])) return setMessage("limitedSettingsMessage", "네 확률 합계가 정확히 100%여야 해요.", "error");
  try {
    const { error } = await supabaseClient.from("site_settings").upsert({ key: "limited_gacha", value });
    if (error) throw error;
    limitedSettings = value;
    renderGacha();
    setMessage("limitedSettingsMessage", "한정 가챠 설정을 저장했어요.", "success");
  } catch (error) {
    setMessage("limitedSettingsMessage", error.message || "저장 실패", "error");
  }
});

/* =========================================================
   관리자 캐릭터 CRUD / 이미지 업로드
========================================================= */
const imageInput = document.getElementById("characterImageInput");
const fullImageInput = document.getElementById("characterFullImageInput");

function previewFile(input, previewId) {
  const preview = document.getElementById(previewId);
  const file = input.files?.[0];
  if (!preview || !file) return;
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${url}" alt="미리보기">`;
}

imageInput?.addEventListener("change", () => previewFile(imageInput, "characterImagePreview"));
fullImageInput?.addEventListener("change", () => previewFile(fullImageInput, "characterFullImagePreview"));

function validateImageFile(file) {
  if (!file) return "";
  if (file.size > 10 * 1024 * 1024) return "이미지는 10MB 이하여야 해요.";
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) return "PNG/JPG/WEBP/GIF만 업로드할 수 있어요.";
  return "";
}

async function uploadCharacterImage(file, prefix) {
  if (!file) return null;
  const errorText = validateImageFile(file);
  if (errorText) throw new Error(errorText);
  const ext = (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const path = `${currentUser.id}/${prefix}-${safeUUID()}.${ext}`;
  const { error } = await supabaseClient.storage.from("character-images").upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  const { data } = supabaseClient.storage.from("character-images").getPublicUrl(path);
  return data.publicUrl;
}

function storagePathFromPublicUrl(url) {
  if (!url) return null;
  const marker = "/storage/v1/object/public/character-images/";
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return decodeURIComponent(url.slice(index + marker.length));
}

async function tryRemoveStorageUrl(url) {
  const path = storagePathFromPublicUrl(url);
  if (!path) return;
  try { await supabaseClient.storage.from("character-images").remove([path]); } catch (error) { console.warn(error); }
}

function resetCharacterForm() {
  document.getElementById("characterEditId").value = "";
  document.getElementById("characterNameInput").value = "";
  document.getElementById("characterRarityInput").value = "SSR";
  document.getElementById("characterLimitedInput").checked = false;
  document.getElementById("characterLimitedStartInput").value = "";
  document.getElementById("characterLimitedEndInput").value = "";
  document.getElementById("characterDialoguesInput").value = "";
  document.getElementById("removeFullImageInput").checked = false;
  document.getElementById("removeFullImageRow").classList.add("hidden");
  document.getElementById("cancelCharacterEditButton").classList.add("hidden");
  document.getElementById("saveCharacterButton").textContent = "캐릭터 저장";
  imageInput.value = "";
  fullImageInput.value = "";
  document.getElementById("characterImagePreview").textContent = "미리보기";
  document.getElementById("characterFullImagePreview").textContent = "미리보기";
  setMessage("characterFormMessage", "");
}

document.getElementById("resetCharacterFormButton")?.addEventListener("click", resetCharacterForm);
document.getElementById("cancelCharacterEditButton")?.addEventListener("click", resetCharacterForm);

function toDatetimeLocal(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function startCharacterEdit(id) {
  const char = characters.find((c) => c.id === id);
  if (!char) return;
  document.getElementById("characterEditId").value = char.id;
  document.getElementById("characterNameInput").value = char.name || "";
  document.getElementById("characterRarityInput").value = char.rarity || "SSR";
  document.getElementById("characterLimitedInput").checked = Boolean(char.is_limited);
  document.getElementById("characterLimitedStartInput").value = toDatetimeLocal(char.limited_start);
  document.getElementById("characterLimitedEndInput").value = toDatetimeLocal(char.limited_end);
  document.getElementById("characterDialoguesInput").value = Array.isArray(char.dialogues) ? char.dialogues.join("\n") : "";
  document.getElementById("characterImagePreview").innerHTML = char.image_url ? `<img src="${escapeHTML(char.image_url)}" alt="기본 이미지">` : "미리보기";
  document.getElementById("characterFullImagePreview").innerHTML = char.full_image_url ? `<img src="${escapeHTML(char.full_image_url)}" alt="풀돌 이미지">` : "미리보기";
  document.getElementById("removeFullImageRow").classList.toggle("hidden", !char.full_image_url);
  document.getElementById("cancelCharacterEditButton").classList.remove("hidden");
  document.getElementById("saveCharacterButton").textContent = "수정 저장";
  setMessage("characterFormMessage", `${char.name} 수정 중`, "success");
  document.getElementById("characterForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function categoryList(filter) {
  if (filter === "LIMITED") return characters.filter((c) => c.is_limited).sort((a, b) => a.sort_order - b.sort_order);
  return characters.filter((c) => !c.is_limited && c.rarity === filter).sort((a, b) => a.sort_order - b.sort_order);
}

function nextSortOrder(isLimited, rarity) {
  const list = categoryList(isLimited ? "LIMITED" : rarity);
  return list.length ? Math.max(...list.map((c) => Number(c.sort_order) || 0)) + 1 : 0;
}

document.getElementById("characterForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin || !currentUser) return;

  const editId = document.getElementById("characterEditId").value;
  const existing = characters.find((c) => c.id === editId) || null;
  const name = document.getElementById("characterNameInput").value.trim();
  const rarity = document.getElementById("characterRarityInput").value;
  const isLimited = document.getElementById("characterLimitedInput").checked;
  const startValue = document.getElementById("characterLimitedStartInput").value;
  const endValue = document.getElementById("characterLimitedEndInput").value;
  const dialogues = document.getElementById("characterDialoguesInput").value.split("\n").map((x) => x.trim()).filter(Boolean);
  const baseFile = imageInput.files?.[0] || null;
  const fullFile = fullImageInput.files?.[0] || null;
  const removeFull = document.getElementById("removeFullImageInput").checked;

  if (!name) return setMessage("characterFormMessage", "이름을 입력해주세요.", "error");
  if (!existing && !baseFile) return setMessage("characterFormMessage", "새 캐릭터는 기본 일러스트가 필요해요.", "error");
  if (isLimited && (!startValue || !endValue)) return setMessage("characterFormMessage", "한정 캐릭터는 시작/종료 시각이 필요해요.", "error");
  if (isLimited && new Date(startValue) >= new Date(endValue)) return setMessage("characterFormMessage", "한정 종료 시각은 시작 시각보다 뒤여야 해요.", "error");
  if (fullFile && rarity !== "SSR") return setMessage("characterFormMessage", "풀돌 전용 일러스트는 SSR에만 등록할 수 있어요.", "error");

  const saveButton = document.getElementById("saveCharacterButton");
  saveButton.disabled = true;
  setMessage("characterFormMessage", "저장 중...");
  let newBaseUrl = null;
  let newFullUrl = null;

  try {
    if (baseFile) newBaseUrl = await uploadCharacterImage(baseFile, "base");
    if (fullFile) newFullUrl = await uploadCharacterImage(fullFile, "full");

    const payload = {
      name,
      rarity,
      is_limited: isLimited,
      limited_start: isLimited ? new Date(startValue).toISOString() : null,
      limited_end: isLimited ? new Date(endValue).toISOString() : null,
      dialogues,
      image_url: newBaseUrl || existing?.image_url || null,
      full_image_url: rarity === "SSR" ? (removeFull ? null : (newFullUrl || existing?.full_image_url || null)) : null,
      sort_order: existing ? existing.sort_order : nextSortOrder(isLimited, rarity)
    };

    let result;
    if (existing) result = await supabaseClient.from("characters").update(payload).eq("id", existing.id);
    else result = await supabaseClient.from("characters").insert(payload);
    if (result.error) throw result.error;

    if (existing && newBaseUrl && existing.image_url && existing.image_url !== newBaseUrl) await tryRemoveStorageUrl(existing.image_url);
    if (existing && (newFullUrl || removeFull || rarity !== "SSR") && existing.full_image_url && existing.full_image_url !== newFullUrl) await tryRemoveStorageUrl(existing.full_image_url);

    await loadPublicData();
    resetCharacterForm();
    setMessage("characterFormMessage", existing ? "캐릭터 수정을 완료했어요." : "캐릭터를 등록했어요.", "success");
  } catch (error) {
    if (newBaseUrl) await tryRemoveStorageUrl(newBaseUrl);
    if (newFullUrl) await tryRemoveStorageUrl(newFullUrl);
    setMessage("characterFormMessage", error.message || "저장 실패", "error");
  } finally {
    saveButton.disabled = false;
  }
});

async function deleteCharacter(id) {
  const char = characters.find((c) => c.id === id);
  if (!char || !confirm(`${char.name} 캐릭터를 정말 삭제할까요?`)) return;
  try {
    const { error } = await supabaseClient.from("characters").delete().eq("id", id);
    if (error) throw error;
    await tryRemoveStorageUrl(char.image_url);
    await tryRemoveStorageUrl(char.full_image_url);
    delete saveData.characters[id];
    delete saveData.ssrLimitBreak[id];
    delete saveData.homeIllustrationMode[id];
    saveData.homeCharacters = saveData.homeCharacters.filter((x) => x !== id);
    saveGame();
    await loadPublicData();
  } catch (error) {
    alert(`삭제 실패: ${error.message || error}`);
  }
}

async function moveCharacter(id, direction) {
  const list = categoryList(currentAdminFilter);
  const index = list.findIndex((c) => c.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
  [list[index], list[nextIndex]] = [list[nextIndex], list[index]];
  try {
    for (let i = 0; i < list.length; i++) {
      const { error } = await supabaseClient.from("characters").update({ sort_order: i }).eq("id", list[i].id);
      if (error) throw error;
    }
    await loadPublicData();
  } catch (error) {
    alert(`순서 저장 실패: ${error.message || error}`);
  }
}

function renderAdminCharacterList() {
  const listEl = document.getElementById("adminCharacterList");
  if (!listEl || !isAdmin) return;
  const list = categoryList(currentAdminFilter);
  if (!list.length) {
    listEl.innerHTML = `<div class="card">이 분류에 등록된 캐릭터가 없어요.</div>`;
    return;
  }
  listEl.innerHTML = list.map((char, index) => `
    <div class="admin-character-row">
      <div class="admin-character-thumb">${artHTML(char)}</div>
      <div class="admin-character-info"><strong>${escapeHTML(char.name)}</strong><small>${char.is_limited ? "LIMITED · " : ""}${escapeHTML(char.rarity)} · 순서 ${index + 1}</small></div>
      <div class="admin-character-actions">
        <button data-move-up="${char.id}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button data-move-down="${char.id}" ${index === list.length - 1 ? "disabled" : ""}>↓</button>
        <button data-edit-character="${char.id}">수정</button>
        <button class="danger" data-delete-character="${char.id}">삭제</button>
      </div>
    </div>`).join("");

  listEl.querySelectorAll("[data-edit-character]").forEach((button) => button.addEventListener("click", () => startCharacterEdit(button.dataset.editCharacter)));
  listEl.querySelectorAll("[data-delete-character]").forEach((button) => button.addEventListener("click", () => void deleteCharacter(button.dataset.deleteCharacter)));
  listEl.querySelectorAll("[data-move-up]").forEach((button) => button.addEventListener("click", () => void moveCharacter(button.dataset.moveUp, -1)));
  listEl.querySelectorAll("[data-move-down]").forEach((button) => button.addEventListener("click", () => void moveCharacter(button.dataset.moveDown, 1)));
}

/* =========================================================
   시작
========================================================= */
async function boot() {
  recoverPendingGacha();
  updateMaxSeenDate();
  updatePointDisplays();
  renderAttendance();
  renderAccountUi();
  openPage("home");

  if (!initSupabase()) {
    setCloudUi("error", "Supabase 연결 실패", "라이브러리를 불러오지 못했어요.");
    return;
  }

  await Promise.all([
    loadPublicData(),
    initAuth()
  ]);

  renderEverything();
}

void boot();
