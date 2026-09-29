const SUPABASE_URL = "https://narkracwfchrlixvufpp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nHK7pXiqP5a3_GrMRw17qw_L0zdL70n";

const SAVE_KEY = "mintGachaSave_v1";
const LOCAL_BACKUP_KEY = "mintGachaLocalBackupBeforeCloud_v1";
const RHYTHM_SPEED_KEY = "mintRhythmFallSpeed_v1";
const RHYTHM_OFFSET_KEY = "mintRhythmTimingOffset_v1";

const DEFAULT_SAVE = {
  version: 3,
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
    characterPang: { highScore: 0, equippedSSR: null },
    runner: { highScore: 0, selectedCharacter: null },
    tetris: { highScore: 0, bestLines: 0, selectedCharacter: null, tSpinCount: 0, tetrisCount: 0, perfectClearCount: 0,
      tSpinMiniCount: 0 },
    rhythm: { selectedCharacter: null, fallSpeed: 1, timingOffset: 0, bestScore: 0 }
  },
  pet: null,
  completedPets: [],
  blackjackPending: null,
  blackjackStreak: 0,
  blackjackRecent: null,
  derbyPending: null,
  derbyRecent: null
};

const DEFAULT_GENERAL_SETTINGS = { ssr: 3, sr: 17, r: 80, exchangePt: 100, defaultHomeCharacterId: null };
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
let adminCharacterDraftOrder = [];
let adminCharacterOrderDirty = false;
let isAdmin = false;
let publicDataLoaded = false;
let tempHomeSelection = new Set();

// V6 public/operation data
let eventBanners = [];
let rhythmSongs = [];
let petTypes = [];
let adminUsers = [];
let activeBannerIndex = 0;
let bannerSlideTimer = null;
let petDialogueDrafts = {};
let petGiftItemDialogueDrafts = {};
let globalPointGrantV6 = null;
let bannerMasterEnabledV6 = true;

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
  const game = document.getElementById("gamePointDisplay");
  const casino = document.getElementById("casinoPointDisplay");
  if (header) header.textContent = `보유 포인트: ${text}`;
  if (gacha) gacha.textContent = text;
  if (game) game.textContent = text;
  if (casino) casino.textContent = text;
}

function renderEverything() {
  updatePointDisplays();
  renderAttendance();
  renderGacha();
  renderCollection();
  renderHomeCharacter();
  renderHomeBanner();
  renderV5GameHub();
  renderPet();
  renderCasino();
  renderV6HomeBanners();
  renderRhythmSongSelector();
  renderPetTypeSelection();
}

/* =========================================================
   페이지 / 탭
========================================================= */
const navButtons = document.querySelectorAll("nav button[data-page]");
const pages = document.querySelectorAll(".page");

function openPage(pageName) {
  if (pageName !== "games") {
    pauseRunnerForVisibility();
    pauseRhythmForVisibility();
  }
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
    adminCharacterOrderDirty = false;
    adminCharacterDraftOrder = [];
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
  if (document.hidden) {
    pauseRunnerForVisibility();
    pauseRhythmForVisibility();
    pauseTetrisForVisibility();
  }
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
  const personalList = validHomeCharacters();
  const fallback = !personalList.length && generalSettings.defaultHomeCharacterId
    ? characters.find((c) => c.id === generalSettings.defaultHomeCharacterId) || null
    : null;
  const list = personalList.length ? personalList : (fallback ? [fallback] : []);
  const usingPublicFallback = !personalList.length && Boolean(fallback);
  const image = document.getElementById("homeCharacterImage");
  const rarity = document.getElementById("homeCharacterRarity");
  const name = document.getElementById("homeCharacterName");
  const help = document.getElementById("homeCharacterHelp");
  const dialogue = document.getElementById("homeCharacterDialogue");
  const saveImageButton = document.getElementById("saveHomeCharacterImageButton");
  if (!image || !rarity || !name || !help || !dialogue) return;

  if (!list.length) {
    image.innerHTML = "<span>캐릭터 이미지</span>";
    rarity.textContent = "SSR";
    name.textContent = "아직 홈 캐릭터가 없어요";
    help.textContent = "도감에서 획득한 캐릭터를 최대 3명까지 홈 캐릭터로 설정할 수 있어요.";
    dialogue.textContent = "“캐릭터를 터치하면 대사가 표시됩니다.”";
    image.dataset.characterId = "";
    dialogue.dataset.characterId = "";
    if (saveImageButton) {
      saveImageButton.disabled = true;
      saveImageButton.dataset.imageUrl = "";
      saveImageButton.dataset.characterName = "";
    }
    return;
  }

  const char = randomChoice(list);
  const displayedImageUrl = characterDisplayImage(char, "home");
  image.innerHTML = artHTML(char, "home");
  image.dataset.characterId = char.id;
  dialogue.dataset.characterId = char.id;
  if (saveImageButton) {
    saveImageButton.disabled = !displayedImageUrl;
    saveImageButton.dataset.imageUrl = displayedImageUrl || "";
    saveImageButton.dataset.characterName = char.name || "character";
  }
  rarity.textContent = char.is_limited ? `LIMITED · ${char.rarity}` : char.rarity;
  name.textContent = char.name;
  help.textContent = usingPublicFallback
    ? "관리자가 지정한 공용 홈 캐릭터예요. 도감에서 캐릭터를 획득하면 개인 홈 캐릭터를 설정할 수 있어요."
    : (getLimitBreakLevel(char.id) === 3 ? "★★★ FULL · 홈에서 풀돌 전/후 일러를 선택할 수 있어요." : `보유 ${getOwnedCount(char.id)}장`);
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

function extensionFromImage(contentType, url) {
  const byType = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  if (byType[contentType]) return byType[contentType];
  const match = String(url || "").match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  const ext = (match?.[1] || "png").toLowerCase();
  return ["png","jpg","jpeg","webp","gif"].includes(ext) ? (ext === "jpeg" ? "jpg" : ext) : "png";
}

async function saveCurrentHomeCharacterImage() {
  const button = document.getElementById("saveHomeCharacterImageButton");
  const url = button?.dataset.imageUrl;
  if (!url) return;

  try {
    button.disabled = true;
    button.textContent = "저장 중...";
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error("이미지를 불러오지 못했어요.");
    const blob = await response.blob();
    const ext = extensionFromImage(blob.type, url);
    const safeName = String(button.dataset.characterName || "character").replace(/[\\/:*?"<>|]+/g, "_");
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${safeName}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    console.warn("홈 이미지 저장 실패", error);
    alert("자동 저장에 실패했어요. 캐릭터 이미지를 우클릭하거나 모바일에서 길게 눌러 저장해주세요.");
  } finally {
    button.disabled = false;
    button.textContent = "이미지 저장";
  }
}

document.getElementById("saveHomeCharacterImageButton")?.addEventListener("click", () => void saveCurrentHomeCharacterImage());

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
  if (!gate || !content || !badge || !text) return;

  if (isAdmin) {
    gate.classList.add("hidden");
    content.classList.remove("hidden");
    badge.textContent = "관리자";
    return;
  }

  gate.classList.remove("hidden");
  content.classList.add("hidden");
  badge.textContent = currentUser ? "일반 계정" : "로그인 필요";
  text.textContent = currentUser
    ? "이 계정은 관리자로 지정되어 있지 않아요. 관리자 계정은 서버에서 1명만 고정 지정합니다."
    : "먼저 관리자 계정으로 로그인해주세요.";
}

function renderAdmin() {
  if (!isAdmin) return;
  document.getElementById("adminNormalSSR").value = generalSettings.ssr;
  document.getElementById("adminNormalSR").value = generalSettings.sr;
  document.getElementById("adminNormalR").value = generalSettings.r;
  document.getElementById("adminNormalExchange").value = generalSettings.exchangePt;
  const defaultHomeSelect = document.getElementById("adminDefaultHomeCharacter");
  if (defaultHomeSelect) {
    defaultHomeSelect.innerHTML = `<option value="">지정 안 함</option>` + characters.map((c) => `<option value="${c.id}">${escapeHTML(c.name)} · ${c.is_limited ? "LIMITED / " : ""}${escapeHTML(c.rarity)}</option>`).join("");
    defaultHomeSelect.value = generalSettings.defaultHomeCharacterId || "";
  }
  document.getElementById("adminLimitedPickup").value = limitedSettings.pickup;
  document.getElementById("adminLimitedSSR").value = limitedSettings.ssr;
  document.getElementById("adminLimitedSR").value = limitedSettings.sr;
  document.getElementById("adminLimitedR").value = limitedSettings.r;
  document.getElementById("adminLimitedExchange").value = limitedSettings.exchangeLpt;
  renderAdminCharacterList();
  renderV6AdminPanels();
}

document.getElementById("normalSettingsForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin) return;
  const value = {
    ssr: Number(document.getElementById("adminNormalSSR").value),
    sr: Number(document.getElementById("adminNormalSR").value),
    r: Number(document.getElementById("adminNormalR").value),
    exchangePt: Math.max(1, Math.floor(Number(document.getElementById("adminNormalExchange").value))),
    defaultHomeCharacterId: document.getElementById("adminDefaultHomeCharacter")?.value || null
  };
  if (!ratesEqual100([value.ssr, value.sr, value.r])) return setMessage("normalSettingsMessage", "SSR + SR + R 합계가 정확히 100%여야 해요.", "error");
  try {
    const { error } = await supabaseClient.from("site_settings").upsert({ key: "general_gacha", value });
    if (error) throw error;
    generalSettings = value;
    renderGacha();
    renderHomeCharacter();
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

function syncAdminCharacterDraftOrder() {
  const source = categoryList(currentAdminFilter).map((c) => c.id);
  if (!adminCharacterOrderDirty || adminCharacterDraftOrder.length !== source.length || adminCharacterDraftOrder.some((id) => !source.includes(id))) {
    adminCharacterDraftOrder = source;
    adminCharacterOrderDirty = false;
  }
}

function draftCharacterList() {
  syncAdminCharacterDraftOrder();
  return adminCharacterDraftOrder.map((id) => characters.find((c) => c.id === id)).filter(Boolean);
}

function moveCharacterDraft(id, direction) {
  syncAdminCharacterDraftOrder();
  const index = adminCharacterDraftOrder.indexOf(id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= adminCharacterDraftOrder.length) return;
  [adminCharacterDraftOrder[index], adminCharacterDraftOrder[nextIndex]] = [adminCharacterDraftOrder[nextIndex], adminCharacterDraftOrder[index]];
  adminCharacterOrderDirty = true;
  renderAdminCharacterList();
}

async function saveCharacterOrderV8() {
  if (!isAdmin || !adminCharacterOrderDirty) {
    if (!adminCharacterOrderDirty) setMessage("characterFormMessage", "바뀐 표시 순서가 없어요.", "success");
    return;
  }
  const button = document.getElementById("saveCharacterOrderButton");
  if (button) { button.disabled = true; button.textContent = "저장 중..."; }
  try {
    for (let i = 0; i < adminCharacterDraftOrder.length; i++) {
      const { error } = await supabaseClient.from("characters").update({ sort_order: i }).eq("id", adminCharacterDraftOrder[i]);
      if (error) throw error;
    }
    adminCharacterOrderDirty = false;
    await loadPublicData();
    setMessage("characterFormMessage", `${currentAdminFilter} 표시 순서를 저장했어요.`, "success");
  } catch (error) {
    alert(`순서 저장 실패: ${error.message || error}`);
  } finally {
    if (button) { button.disabled = false; button.textContent = "순서 저장"; }
  }
}

document.getElementById("saveCharacterOrderButton")?.addEventListener("click", () => void saveCharacterOrderV8());

function setupLongPressCharacterSort(listEl) {
  let timer = null;
  let dragged = null;
  let activePointer = null;

  const finish = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!dragged) return;
    dragged.classList.remove("sort-dragging");
    adminCharacterDraftOrder = [...listEl.querySelectorAll(".admin-character-row")].map((row) => row.dataset.characterId).filter(Boolean);
    adminCharacterOrderDirty = true;
    dragged = null;
    activePointer = null;
  };

  listEl.querySelectorAll(".character-drag-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      activePointer = event.pointerId;
      const row = handle.closest(".admin-character-row");
      timer = setTimeout(() => {
        dragged = row;
        row?.classList.add("sort-dragging");
        try { handle.setPointerCapture(activePointer); } catch {}
      }, 260);
    });

    handle.addEventListener("pointermove", (event) => {
      if (!dragged || event.pointerId !== activePointer) return;
      event.preventDefault();
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".admin-character-row");
      if (!target || target === dragged || target.parentElement !== listEl) return;
      const box = target.getBoundingClientRect();
      if (event.clientY < box.top + box.height / 2) listEl.insertBefore(dragged, target);
      else listEl.insertBefore(dragged, target.nextSibling);
    });

    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("pointerleave", () => { if (!dragged && timer) { clearTimeout(timer); timer = null; } });
  });
}

function renderAdminCharacterList() {
  const listEl = document.getElementById("adminCharacterList");
  if (!listEl || !isAdmin) return;
  const list = draftCharacterList();
  if (!list.length) {
    listEl.innerHTML = `<div class="card">이 분류에 등록된 캐릭터가 없어요.</div>`;
    return;
  }
  listEl.innerHTML = list.map((char, index) => `
    <div class="admin-character-row" data-character-id="${char.id}">
      <button type="button" class="character-drag-handle" aria-label="길게 눌러 순서 이동">☰</button>
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
  listEl.querySelectorAll("[data-move-up]").forEach((button) => button.addEventListener("click", () => moveCharacterDraft(button.dataset.moveUp, -1)));
  listEl.querySelectorAll("[data-move-down]").forEach((button) => button.addEventListener("click", () => moveCharacterDraft(button.dataset.moveDown, 1)));
  setupLongPressCharacterSort(listEl);
}


/* =========================================================
   V5 공통 - 게임 / 펫 / 카지노
========================================================= */

function ownedCharacters() {
  return characters.filter((char) => getOwnedCount(char.id) > 0);
}

function ownedSSRCharacters() {
  return characters.filter((char) => char.rarity === "SSR" && getOwnedCount(char.id) > 0);
}

function fullLimitBreakCount() {
  return characters.filter((char) => char.rarity === "SSR" && getOwnedCount(char.id) > 0 && getLimitBreakLevel(char.id) === 3).length;
}

function matchingRewardBonus() {
  return Math.min(0.20, fullLimitBreakCount() * 0.05);
}

function selectedCharacterRewardBonus(characterId) {
  if (!characterId) return 0;
  const char = characters.find((item) => item.id === characterId);
  return char?.rarity === "SSR" && getLimitBreakLevel(characterId) === 3 ? 0.20 : 0;
}

function applyPointBonus(base, bonus) {
  return Math.floor(base * (1 + bonus));
}

function characterOptionHTML(list, selectedId = "", practiceLabel = "연습 캐릭터") {
  if (!list.length) return `<option value="">${escapeHTML(practiceLabel)}</option>`;
  return list.map((char) => `<option value="${char.id}" ${char.id === selectedId ? "selected" : ""}>${escapeHTML(char.name)}${getLimitBreakLevel(char.id) === 3 ? " · ★★★ FULL" : ""}</option>`).join("");
}

function setSelectOptions(id, list, selectedId = "", practiceLabel = "연습 캐릭터") {
  const select = document.getElementById(id);
  if (!select) return;
  const current = selectedId || select.value;
  select.innerHTML = characterOptionHTML(list, current, practiceLabel);
  if (list.some((char) => char.id === current)) select.value = current;
}

function getSelectedCharacterFrom(id) {
  const value = document.getElementById(id)?.value || "";
  return characters.find((char) => char.id === value) || null;
}

function renderV5GameHub() {
  setSelectOptions("pangCharacterSelect", ownedSSRCharacters(), saveData.gameRecords.characterPang?.equippedSSR || "", "보유 SSR 없음");
  setSelectOptions("runnerCharacterSelect", ownedCharacters(), saveData.gameRecords.runner?.selectedCharacter || "", "연습 캐릭터");
  setSelectOptions("tetrisCharacterSelect", ownedCharacters(), saveData.gameRecords.tetris?.selectedCharacter || "", "연습 캐릭터");
  setSelectOptions("rhythmCharacterSelect", ownedCharacters(), saveData.gameRecords.rhythm?.selectedCharacter || "", "응원 캐릭터 없음");

  const pangSelect = document.getElementById("pangCharacterSelect");
  if (pangSelect && pangSelect.value && pangSelect.value !== saveData.gameRecords.characterPang?.equippedSSR) {
    saveData.gameRecords.characterPang.equippedSSR = pangSelect.value;
    saveLocalOnly();
  }

  renderMatchingStatus();
  renderPangStatus();
  renderRunnerStatus();
  renderTetrisStatus();
  renderRhythmStatus();
}

document.querySelectorAll("[data-game-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.gameView;
    if (view !== "runner") pauseRunnerForVisibility();
    if (view !== "rhythm") pauseRhythmForVisibility();
    if (view !== "tetris") pauseTetrisForVisibility();
    document.querySelectorAll("[data-game-view]").forEach((item) => item.classList.toggle("active", item === button));
    ["matching", "pang", "runner", "tetris", "rhythm"].forEach((name) => {
      document.getElementById(`gameView${name[0].toUpperCase()}${name.slice(1)}`)?.classList.toggle("hidden", name !== view);
    });
  });
});

/* =========================================================
   카드 짝 맞추기
========================================================= */

const MATCH_CONFIG = {
  easy: { pairs: 4, reward: 200, label: "쉬움" },
  normal: { pairs: 6, reward: 400, label: "보통" },
  hard: { pairs: 8, reward: 600, label: "어려움" }
};

let matchingDifficulty = "easy";
let matchingState = {
  active: false,
  cards: [],
  first: null,
  second: null,
  lock: false,
  matched: 0,
  tries: 0,
  startedAt: 0,
  timer: null
};

function matchingPoolForDifficulty(difficulty) {
  const need = MATCH_CONFIG[difficulty].pairs;
  const owned = ownedCharacters();
  if (owned.length >= need) return owned.slice().sort(() => Math.random() - .5).slice(0, need).map((char) => ({
    key: char.id,
    name: char.name,
    image: characterDisplayImage(char)
  }));

  if (difficulty !== "easy") return null;

  const practice = [
    { key: "practice-flower", name: "🌸", emoji: "🌸" },
    { key: "practice-star", name: "⭐", emoji: "⭐" },
    { key: "practice-clover", name: "🍀", emoji: "🍀" },
    { key: "practice-headphone", name: "🎧", emoji: "🎧" }
  ];
  return practice;
}

function renderMatchingStatus() {
  const bonus = matchingRewardBonus();
  const bonusEl = document.getElementById("matchingBonusText");
  if (bonusEl) bonusEl.textContent = `풀돌 보너스 +${Math.round(bonus * 100)}%`;

  const record = saveData.gameRecords.matching?.[matchingDifficulty] || {};
  const recordBox = document.getElementById("matchingRecordBox");
  if (recordBox) {
    recordBox.innerHTML = `난이도 ${MATCH_CONFIG[matchingDifficulty].label} · 최고 기록: <strong>${record.bestTime ? `${record.bestTime.toFixed(1)}초` : "-"}</strong> · 최소 시도: <strong>${record.bestTries ?? "-"}</strong>`;
  }
}

document.querySelectorAll("[data-match-difficulty]").forEach((button) => {
  button.addEventListener("click", () => {
    if (matchingState.active) return;
    matchingDifficulty = button.dataset.matchDifficulty;
    document.querySelectorAll("[data-match-difficulty]").forEach((item) => item.classList.toggle("active", item === button));
    document.getElementById("matchingPairs").textContent = `0 / ${MATCH_CONFIG[matchingDifficulty].pairs}`;
    document.getElementById("matchingBoard").innerHTML = "";
    setMessage("matchingMessage");
    renderMatchingStatus();
  });
});

function startMatchingGame() {
  if (matchingState.active) return;
  const pool = matchingPoolForDifficulty(matchingDifficulty);
  if (!pool) {
    setMessage("matchingMessage", `${MATCH_CONFIG[matchingDifficulty].label} 난이도는 보유 캐릭터 ${MATCH_CONFIG[matchingDifficulty].pairs}종이 필요해요.`, "error");
    return;
  }

  const cards = pool.flatMap((item) => [{ ...item, uid: safeUUID() }, { ...item, uid: safeUUID() }]).sort(() => Math.random() - .5);
  matchingState = { active: true, cards, first: null, second: null, lock: false, matched: 0, tries: 0, startedAt: performance.now(), timer: null };
  document.getElementById("matchingStartButton").disabled = true;
  setMessage("matchingMessage", "같은 카드를 찾아보세요.");
  renderMatchingBoard();
  updateMatchingHud();

  matchingState.timer = setInterval(updateMatchingHud, 100);
}

function renderMatchingBoard() {
  const board = document.getElementById("matchingBoard");
  if (!board) return;
  board.style.gridTemplateColumns = matchingDifficulty === "easy" ? "repeat(4, minmax(58px,1fr))" : matchingDifficulty === "normal" ? "repeat(4,minmax(55px,1fr))" : "repeat(4,minmax(50px,1fr))";
  board.innerHTML = matchingState.cards.map((card, index) => `
    <button class="match-card ${card.revealed ? "revealed" : ""} ${card.matched ? "matched" : ""}" data-match-card="${index}" ${card.matched ? "disabled" : ""}>
      <span class="match-card-inner">
        <span class="match-card-face match-card-front">M</span>
        <span class="match-card-face match-card-back">
          ${card.image ? `<img src="${escapeHTML(card.image)}" alt="${escapeHTML(card.name)}">` : `<span>${escapeHTML(card.emoji || card.name)}</span>`}
        </span>
      </span>
    </button>
  `).join("");

  board.querySelectorAll("[data-match-card]").forEach((button) => button.addEventListener("click", () => flipMatchingCard(Number(button.dataset.matchCard))));
}

function flipMatchingCard(index) {
  if (!matchingState.active || matchingState.lock) return;
  const card = matchingState.cards[index];
  if (!card || card.matched || card.revealed) return;

  card.revealed = true;
  renderMatchingBoard();

  if (matchingState.first === null) {
    matchingState.first = index;
    return;
  }

  matchingState.second = index;
  matchingState.tries += 1;
  updateMatchingHud();

  const first = matchingState.cards[matchingState.first];
  const second = matchingState.cards[matchingState.second];

  if (first.key === second.key) {
    first.matched = true;
    second.matched = true;
    matchingState.matched += 1;
    matchingState.first = null;
    matchingState.second = null;
    renderMatchingBoard();
    updateMatchingHud();
    if (matchingState.matched >= MATCH_CONFIG[matchingDifficulty].pairs) finishMatchingGame();
    return;
  }

  matchingState.lock = true;
  setTimeout(() => {
    first.revealed = false;
    second.revealed = false;
    matchingState.first = null;
    matchingState.second = null;
    matchingState.lock = false;
    renderMatchingBoard();
  }, 900);
}

function updateMatchingHud() {
  const elapsed = matchingState.startedAt ? (performance.now() - matchingState.startedAt) / 1000 : 0;
  document.getElementById("matchingTime").textContent = `${elapsed.toFixed(1)}초`;
  document.getElementById("matchingTries").textContent = matchingState.tries;
  document.getElementById("matchingPairs").textContent = `${matchingState.matched} / ${MATCH_CONFIG[matchingDifficulty].pairs}`;
}

function finishMatchingGame() {
  matchingState.active = false;
  clearInterval(matchingState.timer);
  const elapsed = (performance.now() - matchingState.startedAt) / 1000;
  const cfg = MATCH_CONFIG[matchingDifficulty];
  const bonus = matchingRewardBonus();
  const reward = applyPointBonus(cfg.reward, bonus);

  if (!saveData.gameRecords.matching[matchingDifficulty]) saveData.gameRecords.matching[matchingDifficulty] = {};
  const record = saveData.gameRecords.matching[matchingDifficulty];
  const newTimeRecord = !record.bestTime || elapsed < record.bestTime;
  const newTryRecord = record.bestTries == null || matchingState.tries < record.bestTries;
  if (newTimeRecord) record.bestTime = Number(elapsed.toFixed(2));
  if (newTryRecord) record.bestTries = matchingState.tries;
  addPoints(reward);

  document.getElementById("matchingStartButton").disabled = false;
  setMessage("matchingMessage", `완료! ${formatPoints(reward)}P 지급${bonus ? ` (풀돌 보너스 +${Math.round(bonus * 100)}%)` : ""}${newTimeRecord || newTryRecord ? " · 신기록!" : ""}`, "success");
  renderMatchingStatus();
}

document.getElementById("matchingStartButton")?.addEventListener("click", startMatchingGame);

/* =========================================================
   캐릭터 팡 PLUS
========================================================= */

const PANG_SIZE = 6;
const PANG_PRACTICE = ["🌸", "⭐", "🍀", "🎧", "🍮", "💚"];
const PANG_SPECIAL_ICON = { moon: "☾", star: "✦", sun: "☀", mirror: "◉", mega: "✹" };

let pangState = {
  active: false,
  board: [],
  selected: null,
  moves: 30,
  score: 0,
  combo: 0,
  busy: false,
  tool: null,
  usedTools: {},
  pointerStart: null
};

function pangTokens() {
  const owned = ownedCharacters().slice(0, 6).map((char) => ({
    key: char.id,
    image: characterDisplayImage(char),
    emoji: "",
    name: char.name
  }));
  while (owned.length < 6) {
    const emoji = PANG_PRACTICE[owned.length];
    owned.push({ key: `practice-${owned.length}`, image: "", emoji, name: emoji });
  }
  return owned;
}

function randomPangCell(tokens) {
  const token = randomChoice(tokens);
  return { key: token.key, image: token.image, emoji: token.emoji, name: token.name, special: null };
}

function createPangBoard() {
  const tokens = pangTokens();
  const board = [];
  for (let r = 0; r < PANG_SIZE; r++) {
    board[r] = [];
    for (let c = 0; c < PANG_SIZE; c++) {
      let cell;
      let tries = 0;
      do {
        cell = randomPangCell(tokens);
        tries += 1;
      } while (
        tries < 20 &&
        ((c >= 2 && board[r][c - 1]?.key === cell.key && board[r][c - 2]?.key === cell.key) ||
         (r >= 2 && board[r - 1]?.[c]?.key === cell.key && board[r - 2]?.[c]?.key === cell.key))
      );
      board[r][c] = cell;
    }
  }
  return board;
}

function renderPangStatus() {
  const select = document.getElementById("pangCharacterSelect");
  const equipped = select?.value || saveData.gameRecords.characterPang?.equippedSSR || "";
  const bonus = selectedCharacterRewardBonus(equipped);
  document.getElementById("pangBonusText").textContent = `장착 보너스 +${Math.round(bonus * 100)}%`;
  const char = characters.find((item) => item.id === equipped);
  document.getElementById("pangSelectedCharacter").textContent = char ? `${char.name}${getLimitBreakLevel(char.id) === 3 ? " · ★★★ FULL" : ""}` : "보유 SSR이 필요해요.";
  document.getElementById("pangRecordBox").innerHTML = `최고 점수: <strong>${formatPoints(saveData.gameRecords.characterPang?.highScore || 0)}</strong>`;
  document.getElementById("pangScore").textContent = formatPoints(pangState.score || 0);
  document.getElementById("pangMoves").textContent = pangState.moves ?? 30;
  document.getElementById("pangCombo").textContent = pangState.combo || 0;
}

document.getElementById("pangCharacterSelect")?.addEventListener("change", (event) => {
  if (pangState.active) {
    event.target.value = saveData.gameRecords.characterPang.equippedSSR || "";
    return setMessage("pangMessage", "게임 중에는 장착 캐릭터를 바꿀 수 없어요.", "error");
  }
  saveData.gameRecords.characterPang.equippedSSR = event.target.value || null;
  saveGame();
  renderPangStatus();
});

function renderPangBoard() {
  const boardEl = document.getElementById("pangBoard");
  if (!boardEl) return;
  if (!pangState.board.length) {
    boardEl.innerHTML = "";
    return;
  }
  boardEl.innerHTML = pangState.board.flatMap((row, r) => row.map((cell, c) => `
    <button class="pang-cell ${pangState.selected?.r === r && pangState.selected?.c === c ? "selected" : ""} ${cell.special === "mirror" ? "mirror" : ""} ${cell.special === "mega" ? "mega" : ""}" data-pang-r="${r}" data-pang-c="${c}">
      ${cell.image ? `<img src="${escapeHTML(cell.image)}" alt="${escapeHTML(cell.name)}">` : `<span class="pang-emoji">${escapeHTML(cell.emoji || "◆")}</span>`}
      ${cell.special ? `<span class="pang-special">${PANG_SPECIAL_ICON[cell.special]}</span>` : ""}
    </button>
  `)).join("");

  boardEl.querySelectorAll(".pang-cell").forEach((cellEl) => {
    const r = Number(cellEl.dataset.pangR);
    const c = Number(cellEl.dataset.pangC);
    cellEl.addEventListener("click", () => void handlePangCell(r, c));
    cellEl.addEventListener("pointerdown", (event) => {
      pangState.pointerStart = { r, c, x: event.clientX, y: event.clientY };
    });
    cellEl.addEventListener("pointerup", (event) => {
      const start = pangState.pointerStart;
      pangState.pointerStart = null;
      if (!start || !pangState.active || pangState.busy) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
      let nr = start.r, nc = start.c;
      if (Math.abs(dx) > Math.abs(dy)) nc += dx > 0 ? 1 : -1;
      else nr += dy > 0 ? 1 : -1;
      if (nr >= 0 && nr < PANG_SIZE && nc >= 0 && nc < PANG_SIZE) void pangSwapAndResolve(start.r, start.c, nr, nc);
    });
  });
}

function pangAdjacent(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

async function handlePangCell(r, c) {
  if (!pangState.active || pangState.busy) return;

  if (pangState.tool) {
    await usePangToolAt(pangState.tool, r, c);
    return;
  }

  const pos = { r, c };
  if (!pangState.selected) {
    pangState.selected = pos;
    renderPangBoard();
    return;
  }
  if (pangState.selected.r === r && pangState.selected.c === c) {
    pangState.selected = null;
    renderPangBoard();
    return;
  }
  if (!pangAdjacent(pangState.selected, pos)) {
    pangState.selected = pos;
    renderPangBoard();
    return;
  }

  const from = pangState.selected;
  pangState.selected = null;
  await pangSwapAndResolve(from.r, from.c, r, c);
}

function swapPangCells(r1, c1, r2, c2) {
  [pangState.board[r1][c1], pangState.board[r2][c2]] = [pangState.board[r2][c2], pangState.board[r1][c1]];
}

function findPangMatches() {
  const groups = [];
  const matched = new Set();

  for (let r = 0; r < PANG_SIZE; r++) {
    let c = 0;
    while (c < PANG_SIZE) {
      const key = pangState.board[r][c]?.key;
      let end = c + 1;
      while (end < PANG_SIZE && pangState.board[r][end]?.key === key) end++;
      if (key && end - c >= 3) {
        const cells = [];
        for (let x = c; x < end; x++) { cells.push({ r, c: x }); matched.add(`${r},${x}`); }
        groups.push({ axis: "h", cells });
      }
      c = end;
    }
  }

  for (let c = 0; c < PANG_SIZE; c++) {
    let r = 0;
    while (r < PANG_SIZE) {
      const key = pangState.board[r]?.[c]?.key;
      let end = r + 1;
      while (end < PANG_SIZE && pangState.board[end]?.[c]?.key === key) end++;
      if (key && end - r >= 3) {
        const cells = [];
        for (let x = r; x < end; x++) { cells.push({ r: x, c }); matched.add(`${x},${c}`); }
        groups.push({ axis: "v", cells });
      }
      r = end;
    }
  }

  for (let r = 0; r < PANG_SIZE - 1; r++) {
    for (let c = 0; c < PANG_SIZE - 1; c++) {
      const k = pangState.board[r][c]?.key;
      if (k && pangState.board[r][c + 1]?.key === k && pangState.board[r + 1][c]?.key === k && pangState.board[r + 1][c + 1]?.key === k) {
        const cells = [{r,c},{r,c:c+1},{r:r+1,c},{r:r+1,c:c+1}];
        cells.forEach((p) => matched.add(`${p.r},${p.c}`));
        groups.push({ axis: "box", cells });
      }
    }
  }

  return { groups, matched };
}

function pangSpecialForGroup(group, intersections) {
  if (group.cells.length >= 7) return "mega";
  if (group.cells.length >= 5 && (group.axis === "h" || group.axis === "v")) return "mirror";
  if (group.cells.length >= 5) return "sun";
  if (group.cells.some((p) => intersections.has(`${p.r},${p.c}`))) return "sun";
  if (group.cells.length === 4 && group.axis === "box") return "moon";
  if (group.cells.length === 4) return "star";
  return null;
}

function pangExpandedRemoval(initial) {
  const remove = new Set(initial);
  const queue = [...remove];
  while (queue.length) {
    const key = queue.shift();
    const [r, c] = key.split(",").map(Number);
    const cell = pangState.board[r]?.[c];
    if (!cell?.special) continue;

    const add = (rr, cc) => {
      if (rr < 0 || rr >= PANG_SIZE || cc < 0 || cc >= PANG_SIZE) return;
      const k = `${rr},${cc}`;
      if (!remove.has(k)) { remove.add(k); queue.push(k); }
    };

    if (cell.special === "star") {
      for (let x = 0; x < PANG_SIZE; x++) { add(r, x); add(x, c); }
    } else if (cell.special === "sun") {
      for (let rr = r - 2; rr <= r + 2; rr++) for (let cc = c - 2; cc <= c + 2; cc++) add(rr, cc);
    } else if (cell.special === "moon") {
      const candidates = [];
      for (let rr = 0; rr < PANG_SIZE; rr++) for (let cc = 0; cc < PANG_SIZE; cc++) if (!remove.has(`${rr},${cc}`)) candidates.push({rr,cc});
      candidates.sort(() => Math.random() - .5).slice(0, 5).forEach((p) => add(p.rr,p.cc));
    } else if (cell.special === "mirror") {
      const targetKey = cell.key;
      for (let rr = 0; rr < PANG_SIZE; rr++) for (let cc = 0; cc < PANG_SIZE; cc++) if (pangState.board[rr][cc]?.key === targetKey) add(rr,cc);
    } else if (cell.special === "mega") {
      for (let rr = 0; rr < PANG_SIZE; rr++) for (let cc = 0; cc < PANG_SIZE; cc++) add(rr,cc);
    }
  }
  return remove;
}

async function resolvePangMatches() {
  let cascade = 0;
  while (true) {
    const { groups, matched } = findPangMatches();
    if (!matched.size) break;

    cascade++;
    pangState.combo = cascade;

    const membership = new Map();
    groups.forEach((g, gi) => g.cells.forEach((p) => {
      const k = `${p.r},${p.c}`;
      if (!membership.has(k)) membership.set(k, []);
      membership.get(k).push(gi);
    }));
    const intersections = new Set([...membership.entries()].filter(([, arr]) => arr.length > 1).map(([k]) => k));

    const specialPlacements = [];
    groups.forEach((group) => {
      const special = pangSpecialForGroup(group, intersections);
      if (!special) return;
      const anchor = group.cells[Math.floor(group.cells.length / 2)];
      specialPlacements.push({ ...anchor, special, cell: { ...pangState.board[anchor.r][anchor.c] } });
    });
    if (matched.size >= 7 && !specialPlacements.some((x) => x.special === "mega")) {
      const firstKey = [...matched][0];
      const [mr, mc] = firstKey.split(",").map(Number);
      specialPlacements.push({ r: mr, c: mc, special: "mega", cell: { ...pangState.board[mr][mc] } });
    }

    const expanded = pangExpandedRemoval(matched);
    const removedCount = expanded.size;

    pangState.score += removedCount * 50 + Math.max(0, cascade - 1) * removedCount * 25;
    renderPangStatus();

    const cellEls = document.querySelectorAll(".pang-cell");
    expanded.forEach((key) => {
      const [r, c] = key.split(",").map(Number);
      const idx = r * PANG_SIZE + c;
      cellEls[idx]?.classList.add("popping");
    });

    if (removedCount >= 12 || specialPlacements.some((x) => x.special === "mega")) {
      document.body.classList.add("game-shake");
      document.getElementById("pangFlash")?.classList.add("on");
      setTimeout(() => {
        document.body.classList.remove("game-shake");
        document.getElementById("pangFlash")?.classList.remove("on");
      }, 300);
    }

    await new Promise((resolve) => setTimeout(resolve, 220));

    expanded.forEach((key) => {
      const [r, c] = key.split(",").map(Number);
      pangState.board[r][c] = null;
    });

    specialPlacements.forEach((placement) => {
      if (!pangState.board[placement.r][placement.c]) {
        pangState.board[placement.r][placement.c] = { ...placement.cell, special: placement.special };
      }
    });

    const tokens = pangTokens();
    for (let c = 0; c < PANG_SIZE; c++) {
      const column = [];
      for (let r = PANG_SIZE - 1; r >= 0; r--) if (pangState.board[r][c]) column.push(pangState.board[r][c]);
      for (let r = PANG_SIZE - 1, i = 0; r >= 0; r--, i++) pangState.board[r][c] = column[i] || randomPangCell(tokens);
    }

    renderPangBoard();
    await new Promise((resolve) => setTimeout(resolve, 130));
  }
  if (pangState.active && !pangHasPossibleMove()) {
    pangState.board = pangState.board.flat().sort(() => Math.random() - .5).reduce((rows, cell, i) => {
      if (i % PANG_SIZE === 0) rows.push([]);
      rows.at(-1).push(cell);
      return rows;
    }, []);
    renderPangBoard();
    setMessage("pangMessage", "가능한 이동이 없어 자동 셔플했어요.");
  }
  return cascade > 0;
}

function pangHasPossibleMove() {
  for (let r = 0; r < PANG_SIZE; r++) {
    for (let c = 0; c < PANG_SIZE; c++) {
      for (const [dr, dc] of [[0,1],[1,0]]) {
        const nr=r+dr,nc=c+dc;
        if(nr>=PANG_SIZE||nc>=PANG_SIZE)continue;
        swapPangCells(r,c,nr,nc);
        const has=findPangMatches().matched.size>0;
        swapPangCells(r,c,nr,nc);
        if(has)return true;
      }
    }
  }
  return false;
}

function showPangComboLabel(text){
  let el=document.getElementById("pangComboLabelV7");
  if(!el){
    el=document.createElement("div");
    el.id="pangComboLabelV7";
    el.className="pang-combo-label";
    document.body.appendChild(el);
  }
  el.textContent=text;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
}

function pangAllPositions(){
  const set=new Set();
  for(let r=0;r<PANG_SIZE;r++)for(let c=0;c<PANG_SIZE;c++)set.add(`${r},${c}`);
  return set;
}

function pangAddArea(set,r,c,radius){
  for(let rr=r-radius;rr<=r+radius;rr++)for(let cc=c-radius;cc<=c+radius;cc++){
    if(rr>=0&&rr<PANG_SIZE&&cc>=0&&cc<PANG_SIZE)set.add(`${rr},${cc}`);
  }
}

function pangAddCross(set,r,c,thickness=0){
  for(let d=-thickness;d<=thickness;d++){
    const rr=r+d,cc=c+d;
    if(rr>=0&&rr<PANG_SIZE)for(let x=0;x<PANG_SIZE;x++)set.add(`${rr},${x}`);
    if(cc>=0&&cc<PANG_SIZE)for(let x=0;x<PANG_SIZE;x++)set.add(`${x},${cc}`);
  }
}

function pangRandomTargets(count, excluded=new Set()){
  const all=[];
  for(let r=0;r<PANG_SIZE;r++)for(let c=0;c<PANG_SIZE;c++){
    const key=`${r},${c}`;
    if(!excluded.has(key))all.push({r,c});
  }
  all.sort(()=>Math.random()-.5);
  return all.slice(0,count);
}

async function resolvePangSpecialSwap(a,b,r1,c1,r2,c2){
  const sa=a?.special||null,sb=b?.special||null;
  if(!sa&&!sb)return false;

  const removal=new Set();
  let label="SPECIAL PANG!";

  if(sa==="mega"||sb==="mega"){
    pangAllPositions().forEach((x)=>removal.add(x));
    label="MEGA PANG!";
  }else if(sa==="mirror"&&sb==="mirror"){
    pangAllPositions().forEach((x)=>removal.add(x));
    label="ALL PANG!";
  }else if(sa==="mirror"||sb==="mirror"){
    const mirrorIsA=sa==="mirror";
    const other=mirrorIsA?b:a;
    const otherSpecial=other?.special||null;
    const targetKey=other?.key;
    if(otherSpecial){
      for(let r=0;r<PANG_SIZE;r++)for(let c=0;c<PANG_SIZE;c++){
        const cell=pangState.board[r][c];
        if(cell?.key===targetKey){
          cell.special=otherSpecial;
          removal.add(`${r},${c}`);
        }
      }
      removal.add(`${r1},${c1}`);removal.add(`${r2},${c2}`);
      label=`MIRROR × ${PANG_SPECIAL_ICON[otherSpecial]||"SPECIAL"}`;
    }else{
      for(let r=0;r<PANG_SIZE;r++)for(let c=0;c<PANG_SIZE;c++){
        if(pangState.board[r][c]?.key===targetKey)removal.add(`${r},${c}`);
      }
      removal.add(`${r1},${c1}`);removal.add(`${r2},${c2}`);
      label="MIRROR PANG!";
    }
  }else{
    const pair=[sa,sb].sort().join("+");
    removal.add(`${r1},${c1}`);removal.add(`${r2},${c2}`);

    if(pair==="star+star"){
      pangAddCross(removal,r1,c1,0);
      pangAddCross(removal,r2,c2,0);
      label="DOUBLE STAR!";
    }else if(pair==="moon+moon"){
      pangRandomTargets(10,removal).forEach(({r,c})=>removal.add(`${r},${c}`));
      label="DOUBLE MOON!";
    }else if(pair==="sun+sun"){
      pangAllPositions().forEach((x)=>removal.add(x));
      label="DOUBLE SUN!";
    }else if(pair==="moon+star"){
      const target=pangRandomTargets(1,removal)[0]||{r:r2,c:c2};
      pangAddCross(removal,target.r,target.c,0);
      pangRandomTargets(4,removal).forEach(({r,c})=>removal.add(`${r},${c}`));
      label="MOON STAR!";
    }else if(pair==="moon+sun"){
      const target=pangRandomTargets(1,removal)[0]||{r:r2,c:c2};
      pangAddArea(removal,target.r,target.c,2);
      label="MOON SUN!";
    }else if(pair==="star+sun"){
      pangAddCross(removal,r2,c2,1);
      pangAddArea(removal,r2,c2,1);
      label="SUPER CROSS!";
    }else{
      return false;
    }
  }

  const expanded=pangExpandedRemoval(removal);
  pangState.score+=expanded.size*80;
  showPangComboLabel(label);
  if(expanded.size>=10){
    document.body.classList.add("game-shake");
    document.getElementById("pangFlash")?.classList.add("on");
    setTimeout(()=>{
      document.body.classList.remove("game-shake");
      document.getElementById("pangFlash")?.classList.remove("on");
    },320);
  }

  expanded.forEach((key)=>{
    const [r,c]=key.split(",").map(Number);
    pangState.board[r][c]=null;
  });

  const tokens=pangTokens();
  for(let c=0;c<PANG_SIZE;c++){
    const col=[];
    for(let r=PANG_SIZE-1;r>=0;r--)if(pangState.board[r][c])col.push(pangState.board[r][c]);
    for(let r=PANG_SIZE-1,i=0;r>=0;r--,i++)pangState.board[r][c]=col[i]||randomPangCell(tokens);
  }

  renderPangBoard();
  await new Promise((resolve)=>setTimeout(resolve,180));
  await resolvePangMatches();
  return true;
}

async function pangSwapAndResolve(r1, c1, r2, c2) {
  if (!pangState.active || pangState.busy || pangState.moves <= 0) return;
  pangState.busy = true;

  const a = pangState.board[r1][c1];
  const b = pangState.board[r2][c2];

  swapPangCells(r1,c1,r2,c2);
  renderPangBoard();

  let valid = await resolvePangSpecialSwap(a,b,r1,c1,r2,c2);
  if (!valid) {
    valid = await resolvePangMatches();
  }

  if (!valid) {
    swapPangCells(r1,c1,r2,c2);
    renderPangBoard();
    setMessage("pangMessage", "매치가 만들어지는 이동만 가능해요.", "error");
  } else {
    pangState.moves -= 1;
    renderPangStatus();
    setMessage("pangMessage", pangState.combo > 1 ? `${pangState.combo} CHAIN!` : "");
    if (pangState.moves <= 0) finishPangGame(false);
  }

  pangState.busy = false;
}

function startPangGame() {
  const ssr = ownedSSRCharacters();
  if (!ssr.length) {
    setMessage("pangMessage", "도감에 보유 중인 SSR이 있어야 시작할 수 있어요.", "error");
    return;
  }
  const selected = document.getElementById("pangCharacterSelect").value;
  if (!selected) {
    setMessage("pangMessage", "장착할 SSR을 선택해주세요.", "error");
    return;
  }
  saveData.gameRecords.characterPang.equippedSSR = selected;
  pangState = {
    active: true,
    board: createPangBoard(),
    selected: null,
    moves: 30,
    score: 0,
    combo: 0,
    busy: false,
    tool: null,
    usedTools: {},
    pointerStart: null
  };
  saveGame();
  document.getElementById("pangCharacterSelect").disabled = true;
  document.getElementById("pangStartButton").disabled = true;
  document.getElementById("pangQuitButton").disabled = false;
  document.querySelectorAll("[data-pang-tool]").forEach((button) => { button.disabled = false; button.classList.remove("active"); });
  setMessage("pangMessage", "3개 이상 연결해보세요.");
  renderPangBoard();
  renderPangStatus();
}

function pangRewardForScore(score) {
  if (score >= 12000) return 600;
  if (score >= 8000) return 450;
  if (score >= 5000) return 300;
  if (score >= 3000) return 200;
  return 100;
}

function finishPangGame(quit = false) {
  if (!pangState.active) return;
  pangState.active = false;
  const equipped = saveData.gameRecords.characterPang.equippedSSR;
  const bonus = selectedCharacterRewardBonus(equipped);
  const base = quit ? 0 : pangRewardForScore(pangState.score);
  const reward = applyPointBonus(base, bonus);

  saveData.gameRecords.characterPang.highScore = Math.max(saveData.gameRecords.characterPang.highScore || 0, pangState.score);
  if (reward) addPoints(reward); else saveGame();

  document.getElementById("pangCharacterSelect").disabled = false;
  document.getElementById("pangStartButton").disabled = false;
  document.getElementById("pangQuitButton").disabled = true;
  document.querySelectorAll("[data-pang-tool]").forEach((button) => button.disabled = true);

  setMessage("pangMessage", quit ? "포기했어요. 보상은 지급되지 않아요." : `게임 종료! ${formatPoints(reward)}P 지급${bonus ? " · 풀돌 +20%" : ""}`, quit ? "error" : "success");
  renderPangStatus();
}

document.getElementById("pangStartButton")?.addEventListener("click", startPangGame);
document.getElementById("pangQuitButton")?.addEventListener("click", () => finishPangGame(true));

document.querySelectorAll("[data-pang-tool]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!pangState.active || pangState.busy) return;
    const tool = button.dataset.pangTool;
    if (pangState.usedTools[tool]) return;
    if (tool === "shuffle") {
      pangState.usedTools.shuffle = true;
      pangState.board = pangState.board.flat().sort(() => Math.random() - .5).reduce((rows, cell, i) => {
        if (i % PANG_SIZE === 0) rows.push([]);
        rows.at(-1).push(cell);
        return rows;
      }, []);
      renderPangBoard();
      button.disabled = true;
      setMessage("pangMessage", "보드를 셔플했어요.");
      return;
    }
    pangState.tool = pangState.tool === tool ? null : tool;
    document.querySelectorAll("[data-pang-tool]").forEach((item) => item.classList.toggle("active", item.dataset.pangTool === pangState.tool));
    setMessage("pangMessage", pangState.tool ? "퍼즐판에서 사용할 위치를 선택하세요." : "");
  });
});

async function usePangToolAt(tool, r, c) {
  if (pangState.usedTools[tool] || pangState.busy) return;
  pangState.busy = true;
  const remove = new Set();

  if (tool === "slingshot") remove.add(`${r},${c}`);
  if (tool === "row") for (let x=0;x<PANG_SIZE;x++) remove.add(`${r},${x}`);
  if (tool === "col") for (let x=0;x<PANG_SIZE;x++) remove.add(`${x},${c}`);
  if (tool === "hammer") for (let rr=r-1;rr<=r+1;rr++) for (let cc=c-1;cc<=c+1;cc++) if(rr>=0&&rr<PANG_SIZE&&cc>=0&&cc<PANG_SIZE) remove.add(`${rr},${cc}`);

  const expanded = pangExpandedRemoval(remove);
  pangState.score += expanded.size * 40;
  expanded.forEach((key) => {
    const [rr,cc]=key.split(",").map(Number);
    pangState.board[rr][cc] = null;
  });
  const tokens=pangTokens();
  for(let cc=0;cc<PANG_SIZE;cc++){ const col=[]; for(let rr=PANG_SIZE-1;rr>=0;rr--) if(pangState.board[rr][cc]) col.push(pangState.board[rr][cc]); for(let rr=PANG_SIZE-1,i=0;rr>=0;rr--,i++) pangState.board[rr][cc]=col[i]||randomPangCell(tokens);}
  pangState.usedTools[tool] = true;
  pangState.tool = null;
  document.querySelectorAll("[data-pang-tool]").forEach((item) => { item.classList.remove("active"); if (item.dataset.pangTool === tool) item.disabled = true; });
  renderPangBoard();
  await resolvePangMatches();
  renderPangStatus();
  pangState.busy = false;
}

/* =========================================================
   캐릭터 점프
========================================================= */

let runnerState = {
  active: false,
  paused: false,
  raf: 0,
  last: 0,
  elapsed: 0,
  score: 0,
  speed: 1,
  player: { x: 80, y: 220, vy: 0, jumps: 0, grounded: true },
  obstacles: [],
  holes: [],
  spawnTimer: 0,
  selectedId: null,
  image: null
};

function renderRunnerStatus() {
  const select = document.getElementById("runnerCharacterSelect");
  const id = select?.value || saveData.gameRecords.runner?.selectedCharacter || "";
  document.getElementById("runnerBonusText").textContent = `선택 보너스 +${Math.round(selectedCharacterRewardBonus(id) * 100)}%`;
  document.getElementById("runnerHighScore").textContent = formatPoints(saveData.gameRecords.runner?.highScore || 0);
}

document.getElementById("runnerCharacterSelect")?.addEventListener("change", (event) => {
  if (runnerState.active) {
    event.target.value = saveData.gameRecords.runner.selectedCharacter || "";
    return;
  }
  saveData.gameRecords.runner.selectedCharacter = event.target.value || null;
  saveGame();
  renderRunnerStatus();
});

function runnerCanvasContext() {
  const canvas = document.getElementById("runnerCanvas");
  return { canvas, ctx: canvas?.getContext("2d") };
}

function runnerGroundAt(x) {
  return runnerState.holes.some((hole) => x >= hole.x && x <= hole.x + hole.w) ? 999 : 270;
}

function startRunnerGame() {
  if (runnerState.active) return;
  const selectedId = document.getElementById("runnerCharacterSelect").value || "";
  saveData.gameRecords.runner.selectedCharacter = selectedId || null;
  saveGame();

  runnerState = {
    active: true, paused: false, raf: 0, last: performance.now(), elapsed: 0, score: 0, speed: 1,
    player: { x: 80, y: 220, vy: 0, jumps: 0, grounded: true },
    obstacles: [], holes: [], spawnTimer: 0, selectedId, image: null
  };

  const char = characters.find((c) => c.id === selectedId);
  const url = characterDisplayImage(char);
  if (url) {
    const img = new Image();
    img.src = url;
    runnerState.image = img;
  }

  document.getElementById("runnerStartButton").disabled = true;
  document.getElementById("runnerPauseButton").disabled = false;
  document.getElementById("runnerQuitButton").disabled = false;
  setMessage("runnerMessage", "Space / ↑ / 화면 버튼으로 점프!");
  runnerLoop(performance.now());
}

function runnerJumpPress() {
  if (!runnerState.active || runnerState.paused) return;
  const p = runnerState.player;
  if (p.grounded) {
    p.vy = -520;
    p.grounded = false;
    p.jumps = 1;
  } else if (p.jumps < 2) {
    p.vy = -470;
    p.jumps = 2;
  }
}

function runnerJumpRelease() {
  if (!runnerState.active) return;
  if (runnerState.player.vy < -250) runnerState.player.vy = -250;
}

function runnerLoop(now) {
  if (!runnerState.active) return;
  if (runnerState.paused) { runnerState.last = now; runnerState.raf = requestAnimationFrame(runnerLoop); return; }

  const dt = Math.min(.035, (now - runnerState.last) / 1000);
  runnerState.last = now;
  runnerState.elapsed += dt;
  runnerState.speed = Math.min(2.8, 1 + runnerState.elapsed / 55);
  runnerState.score = Math.floor(runnerState.elapsed * 100 + runnerState.obstacles.filter((o) => o.passed).length * 50);

  const p = runnerState.player;
  p.vy += 1350 * dt;
  p.y += p.vy * dt;

  const ground = runnerGroundAt(p.x + 18);
  if (ground < 900 && p.y >= ground - 48) {
    p.y = ground - 48; p.vy = 0; p.grounded = true; p.jumps = 0;
  } else if (ground >= 900) {
    p.grounded = false;
  }

  runnerState.spawnTimer -= dt;
  if (runnerState.spawnTimer <= 0) {
    const isHole = Math.random() < .16;
    if (isHole) runnerState.holes.push({ x: 780, w: 70 + Math.random() * 45 });
    else runnerState.obstacles.push({ x: 780, y: 230, w: 28 + Math.random() * 28, h: 40 + Math.random() * 28, passed: false });
    runnerState.spawnTimer = Math.max(.55, 1.35 - runnerState.speed * .16) + Math.random() * .55;
  }

  const move = 270 * runnerState.speed * dt;
  runnerState.obstacles.forEach((o) => {
    o.x -= move;
    if (!o.passed && o.x + o.w < p.x) o.passed = true;
  });
  runnerState.holes.forEach((h) => h.x -= move);
  runnerState.obstacles = runnerState.obstacles.filter((o) => o.x + o.w > -20);
  runnerState.holes = runnerState.holes.filter((h) => h.x + h.w > -20);

  const hitObstacle = runnerState.obstacles.some((o) => p.x + 34 > o.x && p.x < o.x + o.w && p.y + 46 > o.y && p.y < o.y + o.h);
  const fell = p.y > 340;
  if (hitObstacle || fell) {
    finishRunnerGame(false);
    return;
  }

  drawRunner();
  document.getElementById("runnerScore").textContent = formatPoints(runnerState.score);
  document.getElementById("runnerSpeed").textContent = `${runnerState.speed.toFixed(1)}×`;
  runnerState.raf = requestAnimationFrame(runnerLoop);
}

function drawRunner() {
  const { canvas, ctx } = runnerCanvasContext();
  if (!ctx) return;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  const grad = ctx.createLinearGradient(0,0,0,canvas.height);
  grad.addColorStop(0,"#e3fff5"); grad.addColorStop(1,"#ffffff");
  ctx.fillStyle = grad; ctx.fillRect(0,0,canvas.width,canvas.height);

  ctx.fillStyle = "#b9ead9";
  ctx.fillRect(0,270,canvas.width,50);
  runnerState.holes.forEach((h) => { ctx.fillStyle = "#fff"; ctx.fillRect(h.x,268,h.w,55); });

  ctx.fillStyle = "#5fcda8";
  runnerState.obstacles.forEach((o) => ctx.fillRect(o.x,o.y,o.w,o.h));

  const p = runnerState.player;
  if (runnerState.image?.complete) {
    ctx.save();
    ctx.beginPath(); ctx.roundRect(p.x,p.y,44,48,10); ctx.clip();
    ctx.drawImage(runnerState.image,p.x,p.y,44,48);
    ctx.restore();
  } else {
    ctx.fillStyle="#2eb58a"; ctx.beginPath(); ctx.roundRect(p.x,p.y,44,48,10); ctx.fill();
    ctx.fillStyle="#fff"; ctx.font="24px sans-serif"; ctx.fillText("★",p.x+10,p.y+32);
  }
}

function runnerReward(score) {
  if (score >= 3000) return 700;
  if (score >= 2000) return 500;
  if (score >= 1000) return 350;
  if (score >= 500) return 200;
  return 100;
}

function finishRunnerGame(quit = false) {
  if (!runnerState.active) return;
  runnerState.active = false;
  cancelAnimationFrame(runnerState.raf);
  const bonus = selectedCharacterRewardBonus(runnerState.selectedId);
  const reward = quit ? 0 : applyPointBonus(runnerReward(runnerState.score), bonus);
  saveData.gameRecords.runner.highScore = Math.max(saveData.gameRecords.runner.highScore || 0, runnerState.score);
  if (reward) addPoints(reward); else saveGame();
  document.getElementById("runnerStartButton").disabled = false;
  document.getElementById("runnerPauseButton").disabled = true;
  document.getElementById("runnerQuitButton").disabled = true;
  document.getElementById("runnerPauseButton").textContent = "일시정지";
  setMessage("runnerMessage", quit ? "포기했어요. 보상 없음." : `게임 오버! ${formatPoints(reward)}P 지급${bonus ? " · 풀돌 +20%" : ""}`, quit ? "error" : "success");
  renderRunnerStatus();
}

function toggleRunnerPause() {
  if (!runnerState.active) return;
  runnerState.paused = !runnerState.paused;
  document.getElementById("runnerPauseButton").textContent = runnerState.paused ? "계속하기" : "일시정지";
}

function pauseRunnerForVisibility() {
  if (runnerState.active && !runnerState.paused) {
    runnerState.paused = true;
    const btn = document.getElementById("runnerPauseButton");
    if (btn) btn.textContent = "계속하기";
  }
}

document.getElementById("runnerStartButton")?.addEventListener("click", startRunnerGame);
document.getElementById("runnerPauseButton")?.addEventListener("click", toggleRunnerPause);
document.getElementById("runnerQuitButton")?.addEventListener("click", () => finishRunnerGame(true));
document.getElementById("runnerJumpButton")?.addEventListener("pointerdown", runnerJumpPress);
document.getElementById("runnerJumpButton")?.addEventListener("pointerup", runnerJumpRelease);
document.getElementById("runnerCanvas")?.addEventListener("pointerdown", runnerJumpPress);
document.getElementById("runnerCanvas")?.addEventListener("pointerup", runnerJumpRelease);

document.addEventListener("keydown", (event) => {
  if (!runnerState.active || runnerState.paused) return;
  if (event.code === "Space" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!event.repeat) runnerJumpPress();
  }
});
document.addEventListener("keyup", (event) => {
  if (event.code === "Space" || event.key === "ArrowUp") runnerJumpRelease();
});

/* =========================================================
   테트리스
========================================================= */

const TETRIS_COLS = 10;
const TETRIS_ROWS = 22;
const TETRIS_VISIBLE_START = 2;
const TETRIS_SHAPES = {
  I: [[0,1],[1,1],[2,1],[3,1]],
  O: [[1,0],[2,0],[1,1],[2,1]],
  T: [[1,0],[0,1],[1,1],[2,1]],
  S: [[1,0],[2,0],[0,1],[1,1]],
  Z: [[0,0],[1,0],[1,1],[2,1]],
  J: [[0,0],[0,1],[1,1],[2,1]],
  L: [[2,0],[0,1],[1,1],[2,1]]
};
const TETRIS_COLORS = { I:"#54d7e8",O:"#f5d86b",T:"#ac7ff0",S:"#73d57c",Z:"#ef7272",J:"#6e94ef",L:"#f0a35f" };

let tetrisState = {
  active:false, paused:false, board:[], current:null, queue:[], bag:[], hold:null, canHold:true,
  score:0, lines:0, level:1, combo:-1, b2b:false, lastDrop:0, lastAction:"", lockStart:null, lockResets:0,
  raf:0, selectedId:null, stats:{tspin:0,tetris:0,pc:0}, touch:null
};

function emptyTetrisBoard() { return Array.from({length:TETRIS_ROWS},()=>Array(TETRIS_COLS).fill(null)); }

function refillTetrisBag() {
  const bag = Object.keys(TETRIS_SHAPES).sort(() => Math.random() - .5);
  tetrisState.bag.push(...bag);
}

function ensureTetrisQueue() {
  while (tetrisState.queue.length < 6) {
    if (!tetrisState.bag.length) refillTetrisBag();
    tetrisState.queue.push(tetrisState.bag.shift());
  }
}

function rotatePoint([x,y], rotation, type) {
  if (type === "O") return [x,y];
  let px = x, py = y;
  const cx = type === "I" ? 1.5 : 1, cy = type === "I" ? 1.5 : 1;
  for (let i=0;i<rotation;i++) {
    const dx=px-cx, dy=py-cy;
    px = cx - dy; py = cy + dx;
  }
  return [Math.round(px),Math.round(py)];
}

function tetrisCells(piece, x=piece.x, y=piece.y, rot=piece.rot) {
  return TETRIS_SHAPES[piece.type].map((p)=>rotatePoint(p,rot,piece.type)).map(([px,py])=>[x+px,y+py]);
}

function tetrisValid(piece,x=piece.x,y=piece.y,rot=piece.rot) {
  return tetrisCells(piece,x,y,rot).every(([cx,cy]) => cx>=0&&cx<TETRIS_COLS&&cy<TETRIS_ROWS&&(cy<0||!tetrisState.board[cy][cx]));
}

function spawnTetrisPiece() {
  ensureTetrisQueue();
  const type = tetrisState.queue.shift();
  ensureTetrisQueue();
  const piece = { type, x:3, y:0, rot:0 };
  tetrisState.current = piece;
  tetrisState.canHold = true;
  tetrisState.lockStart = null; tetrisState.lockResets=0; tetrisState.lastAction="spawn"; tetrisState.lastRotation=null;
  if (!tetrisValid(piece)) finishTetrisGame(false);
}

function tetrisGhostY() {
  if (!tetrisState.current) return 0;
  let y=tetrisState.current.y;
  while(tetrisValid(tetrisState.current,tetrisState.current.x,y+1,tetrisState.current.rot)) y++;
  return y;
}

function tryTetrisMove(dx,dy) {
  const p=tetrisState.current;
  if(!p||!tetrisState.active||tetrisState.paused)return false;
  if(tetrisValid(p,p.x+dx,p.y+dy,p.rot)){
    p.x+=dx;p.y+=dy;tetrisState.lastAction=dy>0?"soft":"move";
    tetrisState.lastRotation=null;
    if(tetrisState.lockStart && tetrisState.lockResets<15){tetrisState.lockStart=performance.now();tetrisState.lockResets++;}
    return true;
  }
  return false;
}

const SRS_JLSTZ = {
  "0>1":[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  "1>0":[[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  "1>2":[[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  "2>1":[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  "2>3":[[0,0],[1,0],[1,-1],[0,2],[1,2]],
  "3>2":[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  "3>0":[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  "0>3":[[0,0],[1,0],[1,-1],[0,2],[1,2]]
};

const SRS_I = {
  "0>1":[[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  "1>0":[[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  "1>2":[[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
  "2>1":[[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  "2>3":[[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  "3>2":[[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  "3>0":[[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  "0>3":[[0,0],[-1,0],[2,0],[-1,-2],[2,1]]
};

function srsKickTests(type, from, to) {
  if (type === "O") return [[0,0]];
  const key = `${from}>${to}`;
  return type === "I" ? (SRS_I[key] || [[0,0]]) : (SRS_JLSTZ[key] || [[0,0]]);
}

function rotateTetris(dir) {
  const p=tetrisState.current;
  if(!p||!tetrisState.active||tetrisState.paused)return false;
  const from=p.rot;
  const next=(from+(dir>0?1:3))%4;
  const tests=srsKickTests(p.type,from,next);
  for(let i=0;i<tests.length;i++){
    const [kx,ky]=tests[i];
    if(tetrisValid(p,p.x+kx,p.y+ky,next)){
      p.x+=kx;p.y+=ky;p.rot=next;
      tetrisState.lastAction="rotate";
      tetrisState.lastRotation={from,to:next,kickIndex:i};
      if(tetrisState.lockStart&&tetrisState.lockResets<15){tetrisState.lockStart=performance.now();tetrisState.lockResets++;}
      return true;
    }
  }
  return false;
}

function holdTetris() {
  if(!tetrisState.active||tetrisState.paused||!tetrisState.current||!tetrisState.canHold)return;
  const currentType=tetrisState.current.type;
  if(tetrisState.hold){
    const swap=tetrisState.hold;
    tetrisState.hold=currentType;
    tetrisState.current={type:swap,x:3,y:0,rot:0};
    if(!tetrisValid(tetrisState.current)) return finishTetrisGame(false);
  } else {
    tetrisState.hold=currentType;
    spawnTetrisPiece();
  }
  tetrisState.canHold=false;
  renderTetrisSide();
}

function tetrisCornerOccupied(x,y){
  return x<0||x>=TETRIS_COLS||y>=TETRIS_ROWS||(y>=0&&Boolean(tetrisState.board[y][x]));
}

function detectTSpin(piece, cleared) {
  if(piece.type!=="T"||!tetrisState.lastRotation)return null;
  const cx=piece.x+1, cy=piece.y+1;
  const tl=tetrisCornerOccupied(cx-1,cy-1);
  const tr=tetrisCornerOccupied(cx+1,cy-1);
  const bl=tetrisCornerOccupied(cx-1,cy+1);
  const br=tetrisCornerOccupied(cx+1,cy+1);
  const occupied=[tl,tr,bl,br].filter(Boolean).length;
  if(occupied<3)return null;

  let front;
  if(piece.rot===0) front=[tl,tr];
  else if(piece.rot===1) front=[tr,br];
  else if(piece.rot===2) front=[bl,br];
  else front=[tl,bl];

  const full=front[0]&&front[1]||tetrisState.lastRotation.kickIndex===4;
  return {
    mini: !full,
    cleared
  };
}

function lockTetrisPiece() {
  const piece={...tetrisState.current};
  tetrisCells(piece).forEach(([x,y])=>{ if(y>=0&&y<TETRIS_ROWS)tetrisState.board[y][x]=piece.type; });

  const full=[];
  for(let r=0;r<TETRIS_ROWS;r++) if(tetrisState.board[r].every(Boolean)) full.push(r);

  const tspin=detectTSpin(piece,full.length);
  full.forEach((r)=>{tetrisState.board.splice(r,1);tetrisState.board.unshift(Array(TETRIS_COLS).fill(null));});

  const cleared=full.length;
  tetrisState.lines+=cleared;
  tetrisState.level=Math.floor(tetrisState.lines/10)+1;

  let base=0, difficult=false;
  if(tspin){
    if(tspin.mini){
      base=({0:100,1:200,2:400})[cleared]||0;
      tetrisState.stats.tspinMini=(tetrisState.stats.tspinMini||0)+1;
    }else{
      base=({0:400,1:800,2:1200,3:1600})[cleared]||0;
      tetrisState.stats.tspin++;
    }
    difficult=cleared>0;
  }else{
    base=({0:0,1:100,2:300,3:500,4:800})[cleared]||0;
    difficult=cleared===4;
    if(cleared===4)tetrisState.stats.tetris++;
  }

  if(cleared>0){
    tetrisState.combo++;
    if(tetrisState.combo>=1) base += 50*tetrisState.combo;
  }else tetrisState.combo=-1;

  if(difficult){
    if(tetrisState.b2b) base=Math.floor(base*1.5);
    tetrisState.b2b=true;
  }else if(cleared>0)tetrisState.b2b=false;

  tetrisState.score += base*tetrisState.level;

  const perfect=tetrisState.board.every((row)=>row.every((cell)=>!cell));
  if(perfect && cleared){
    const pc=({1:800,2:1200,3:1800,4:2000})[cleared]||0;
    tetrisState.score += pc*tetrisState.level;
    tetrisState.stats.pc++;
  }

  spawnTetrisPiece();
  renderTetrisHud();
}

function hardDropTetris() {
  if(!tetrisState.active||tetrisState.paused||!tetrisState.current)return;
  let d=0;
  const preservedRotation=tetrisState.lastRotation;
  while(tryTetrisMove(0,1))d++;
  tetrisState.lastRotation=preservedRotation;
  tetrisState.score+=d*2;
  tetrisState.lastAction="hard";
  lockTetrisPiece();
}

function tetrisDropInterval() {
  return Math.max(45,850*Math.pow(.82,tetrisState.level-1));
}

function tetrisLoop(now) {
  if(!tetrisState.active)return;
  if(!tetrisState.paused){
    if(!tetrisState.lastDrop)tetrisState.lastDrop=now;
    if(now-tetrisState.lastDrop>=tetrisDropInterval()){
      if(!tryTetrisMove(0,1)){
        if(!tetrisState.lockStart)tetrisState.lockStart=now;
        if(now-tetrisState.lockStart>=500) lockTetrisPiece();
      }else tetrisState.lockStart=null;
      tetrisState.lastDrop=now;
    } else if(tetrisState.current && !tetrisValid(tetrisState.current,tetrisState.current.x,tetrisState.current.y+1,tetrisState.current.rot)){
      if(!tetrisState.lockStart)tetrisState.lockStart=now;
      if(now-tetrisState.lockStart>=500) lockTetrisPiece();
    } else tetrisState.lockStart=null;
    drawTetris();
  }
  tetrisState.raf=requestAnimationFrame(tetrisLoop);
}

function drawTetris() {
  const canvas=document.getElementById("tetrisCanvas"),ctx=canvas?.getContext("2d");
  if(!ctx)return;
  const cw=canvas.width/TETRIS_COLS,ch=canvas.height/20;
  ctx.fillStyle="#10211c";ctx.fillRect(0,0,canvas.width,canvas.height);

  for(let r=TETRIS_VISIBLE_START;r<TETRIS_ROWS;r++){
    for(let c=0;c<TETRIS_COLS;c++){
      const val=tetrisState.board[r][c];
      ctx.strokeStyle="rgba(255,255,255,.05)";ctx.strokeRect(c*cw,(r-TETRIS_VISIBLE_START)*ch,cw,ch);
      if(val){ctx.fillStyle=TETRIS_COLORS[val];ctx.fillRect(c*cw+1,(r-TETRIS_VISIBLE_START)*ch+1,cw-2,ch-2);}
    }
  }

  if(tetrisState.current){
    const ghost=tetrisGhostY();
    ctx.globalAlpha=.25;ctx.fillStyle=TETRIS_COLORS[tetrisState.current.type];
    tetrisCells(tetrisState.current,tetrisState.current.x,ghost,tetrisState.current.rot).forEach(([x,y])=>{if(y>=TETRIS_VISIBLE_START)ctx.fillRect(x*cw+2,(y-TETRIS_VISIBLE_START)*ch+2,cw-4,ch-4);});
    ctx.globalAlpha=1;ctx.fillStyle=TETRIS_COLORS[tetrisState.current.type];
    tetrisCells(tetrisState.current).forEach(([x,y])=>{if(y>=TETRIS_VISIBLE_START)ctx.fillRect(x*cw+1,(y-TETRIS_VISIBLE_START)*ch+1,cw-2,ch-2);});
  }
}

function renderTetrisSide(){
  document.getElementById("tetrisHoldPreview").textContent=tetrisState.hold||"-";
  document.getElementById("tetrisNextList").innerHTML=tetrisState.queue.slice(0,5).map((x)=>`<div class="tetris-next-item">${x}</div>`).join("");
  document.getElementById("tetrisMobileNext").textContent=`NEXT · ${tetrisState.queue.slice(0,5).join(" ")||"-"}`;
}

function renderTetrisHud(){
  document.getElementById("tetrisScore").textContent=formatPoints(tetrisState.score||0);
  document.getElementById("tetrisLines").textContent=tetrisState.lines||0;
  document.getElementById("tetrisLevel").textContent=tetrisState.level||1;
  document.getElementById("tetrisCombo").textContent=tetrisState.combo>=0?tetrisState.combo:"-";
  renderTetrisSide();
}

function renderTetrisStatus(){
  const id=document.getElementById("tetrisCharacterSelect")?.value||saveData.gameRecords.tetris?.selectedCharacter||"";
  document.getElementById("tetrisBonusText").textContent=`선택 보너스 +${Math.round(selectedCharacterRewardBonus(id)*100)}%`;
  document.getElementById("tetrisRecordBox").innerHTML=`최고 점수 <strong>${formatPoints(saveData.gameRecords.tetris?.highScore||0)}</strong> · 최고 라인 <strong>${saveData.gameRecords.tetris?.bestLines||0}</strong> · T-SPIN ${saveData.gameRecords.tetris?.tSpinCount||0} · MINI ${saveData.gameRecords.tetris?.tSpinMiniCount||0} · TETRIS ${saveData.gameRecords.tetris?.tetrisCount||0} · PERFECT CLEAR ${saveData.gameRecords.tetris?.perfectClearCount||0}`;
}

document.getElementById("tetrisCharacterSelect")?.addEventListener("change",(e)=>{
  if(tetrisState.active){e.target.value=saveData.gameRecords.tetris.selectedCharacter||"";return;}
  saveData.gameRecords.tetris.selectedCharacter=e.target.value||null;saveGame();renderTetrisStatus();
});

function startTetrisGame(){
  if(tetrisState.active) cancelAnimationFrame(tetrisState.raf);
  const selectedId=document.getElementById("tetrisCharacterSelect").value||"";
  saveData.gameRecords.tetris.selectedCharacter=selectedId||null;saveGame();
  tetrisState={
    active:true,paused:false,board:emptyTetrisBoard(),current:null,queue:[],bag:[],hold:null,canHold:true,
    score:0,lines:0,level:1,combo:-1,b2b:false,lastDrop:performance.now(),lastAction:"",lockStart:null,lockResets:0,
    raf:0,selectedId,stats:{tspin:0,tspinMini:0,tetris:0,pc:0},touch:null
  };
  ensureTetrisQueue();spawnTetrisPiece();renderTetrisHud();drawTetris();
  document.getElementById("tetrisStartButton").disabled=true;
  document.getElementById("tetrisPauseButton").disabled=false;
  document.getElementById("tetrisRestartButton").disabled=false;
  document.getElementById("tetrisQuitButton").disabled=false;
  document.getElementById("tetrisOverlay").classList.add("hidden");
  setMessage("tetrisMessage","");
  tetrisState.raf=requestAnimationFrame(tetrisLoop);
}

function tetrisReward(score){
  if(score>=30000)return 1200;if(score>=20000)return 900;if(score>=10000)return 600;if(score>=5000)return 350;if(score>=2000)return 200;if(score>=1000)return 100;return 0;
}

function finishTetrisGame(quit=false){
  if(!tetrisState.active)return;
  tetrisState.active=false;cancelAnimationFrame(tetrisState.raf);
  const bonus=selectedCharacterRewardBonus(tetrisState.selectedId);
  const reward=quit?0:applyPointBonus(tetrisReward(tetrisState.score),bonus);
  const rec=saveData.gameRecords.tetris;
  rec.highScore=Math.max(rec.highScore||0,tetrisState.score);
  rec.bestLines=Math.max(rec.bestLines||0,tetrisState.lines);
  rec.tSpinCount=(rec.tSpinCount||0)+tetrisState.stats.tspin;
  rec.tSpinMiniCount=(rec.tSpinMiniCount||0)+(tetrisState.stats.tspinMini||0);
  rec.tetrisCount=(rec.tetrisCount||0)+tetrisState.stats.tetris;
  rec.perfectClearCount=(rec.perfectClearCount||0)+tetrisState.stats.pc;
  if(reward)addPoints(reward);else saveGame();
  document.getElementById("tetrisStartButton").disabled=false;
  document.getElementById("tetrisPauseButton").disabled=true;
  document.getElementById("tetrisRestartButton").disabled=true;
  document.getElementById("tetrisQuitButton").disabled=true;
  const overlay=document.getElementById("tetrisOverlay");
  overlay.textContent=quit?"QUIT":"GAME OVER";overlay.classList.remove("hidden");
  setMessage("tetrisMessage",quit?"포기했어요. 보상 없음.":`게임 오버! ${formatPoints(reward)}P 지급${bonus?" · 풀돌 +20%":""}`,quit?"error":"success");
  renderTetrisStatus();
}

function toggleTetrisPause(){
  if(!tetrisState.active)return;
  tetrisState.paused=!tetrisState.paused;
  document.getElementById("tetrisPauseButton").textContent=tetrisState.paused?"계속하기":"일시정지";
  document.getElementById("tetrisMobilePause").textContent=tetrisState.paused?"PLAY":"PAUSE";
  const overlay=document.getElementById("tetrisOverlay");
  if(tetrisState.paused){overlay.textContent="PAUSE";overlay.classList.remove("hidden");}else overlay.classList.add("hidden");
}
function pauseTetrisForVisibility(){if(tetrisState.active&&!tetrisState.paused)toggleTetrisPause();}

document.getElementById("tetrisStartButton")?.addEventListener("click",startTetrisGame);
document.getElementById("tetrisRestartButton")?.addEventListener("click",startTetrisGame);
document.getElementById("tetrisPauseButton")?.addEventListener("click",toggleTetrisPause);
document.getElementById("tetrisMobilePause")?.addEventListener("click",toggleTetrisPause);
document.getElementById("tetrisQuitButton")?.addEventListener("click",()=>finishTetrisGame(true));
document.getElementById("tetrisMobileHold")?.addEventListener("click",holdTetris);

document.addEventListener("keydown",(event)=>{
  if(!tetrisState.active)return;
  if(["ArrowLeft","ArrowRight","ArrowDown","ArrowUp"," ","x","X","z","Z","c","C","Shift","p","P","Escape"].includes(event.key)||event.code==="Space")event.preventDefault();
  if(event.key==="p"||event.key==="P"||event.key==="Escape"){toggleTetrisPause();return;}
  if(tetrisState.paused)return;
  if(event.key==="ArrowLeft")tryTetrisMove(-1,0);
  else if(event.key==="ArrowRight")tryTetrisMove(1,0);
  else if(event.key==="ArrowDown"){if(tryTetrisMove(0,1))tetrisState.score+=1;}
  else if(event.key==="ArrowUp"||event.key==="x"||event.key==="X")rotateTetris(1);
  else if(event.key==="z"||event.key==="Z")rotateTetris(-1);
  else if(event.code==="Space")hardDropTetris();
  else if(event.key==="c"||event.key==="C"||event.key==="Shift")holdTetris();
  renderTetrisHud();
});

const tetrisCanvas=document.getElementById("tetrisCanvas");
tetrisCanvas?.addEventListener("pointerdown",(e)=>{tetrisState.touch={x:e.clientX,y:e.clientY,t:performance.now()};});
tetrisCanvas?.addEventListener("pointerup",(e)=>{
  if(!tetrisState.active||tetrisState.paused||!tetrisState.touch)return;
  const s=tetrisState.touch;tetrisState.touch=null;
  const dx=e.clientX-s.x,dy=e.clientY-s.y,dt=performance.now()-s.t;
  if(Math.abs(dx)<18&&Math.abs(dy)<18){
    const now=performance.now();
    if(tetrisState._lastTap && now-tetrisState._lastTap<260){
      clearTimeout(tetrisState._tapTimer);
      tetrisState._lastTap=0;
      rotateTetris(-1);
    }else{
      tetrisState._lastTap=now;
      tetrisState._tapTimer=setTimeout(()=>{ if(tetrisState.active&&!tetrisState.paused) rotateTetris(1); },230);
    }
    return;
  }
  if(Math.abs(dx)>Math.abs(dy)){
    const steps=Math.max(1,Math.round(Math.abs(dx)/32));
    for(let i=0;i<steps;i++)tryTetrisMove(dx>0?1:-1,0);
  }else if(dy>0){
    if(dt<220&&dy>70)hardDropTetris();
    else {const steps=Math.max(1,Math.round(dy/28));for(let i=0;i<steps;i++){if(tryTetrisMove(0,1))tetrisState.score+=1;}}
  }
  renderTetrisHud();
});

/* =========================================================
   리듬 탭
========================================================= */

const RHYTHM_KEYS=["d","f","j","k"];
const RHYTHM_INTERVAL={EASY:1000,NORMAL:500,HARD:375,SPECIAL:250};
let rhythmState={
  active:false,paused:false,pausedAt:0,raf:0,startAt:0,duration:60000,notes:[],score:0,combo:0,maxCombo:0,hp:100,
  judgments:{perfect:0,great:0,good:0,miss:0},selectedId:null,difficulty:"NORMAL",lastJudge:"",audioCtx:null
};

function rhythmLocalNumber(key, fallback, min, max){
  const raw=Number(localStorage.getItem(key));
  return Number.isFinite(raw)?Math.max(min,Math.min(max,raw)):fallback;
}
function getRhythmFallSpeed(){return rhythmLocalNumber(RHYTHM_SPEED_KEY,Number(saveData.gameRecords.rhythm?.fallSpeed||1),.5,8);}
function getRhythmTimingOffset(){return rhythmLocalNumber(RHYTHM_OFFSET_KEY,Number(saveData.gameRecords.rhythm?.timingOffset||0),-200,200);}
function setRhythmFallSpeed(value){localStorage.setItem(RHYTHM_SPEED_KEY,String(Math.max(.5,Math.min(8,Number(value)||1))));}
function setRhythmTimingOffset(value){localStorage.setItem(RHYTHM_OFFSET_KEY,String(Math.max(-200,Math.min(200,Math.round(Number(value)||0)))));}

function renderRhythmStatus(){
  const rec=saveData.gameRecords.rhythm||{};
  const speed=getRhythmFallSpeed(),offset=getRhythmTimingOffset();
  const speedInput=document.getElementById("rhythmSpeedInput"),offsetInput=document.getElementById("rhythmOffsetInput");
  if(speedInput&&!rhythmState.active)speedInput.value=speed;
  if(offsetInput&&!rhythmState.active)offsetInput.value=offset;
  document.getElementById("rhythmSpeedLabel").textContent=`${Number(speedInput?.value||speed).toFixed(1)}×`;
  document.getElementById("rhythmOffsetLabel").textContent=`${Number(offsetInput?.value||offset)}ms`;
  const id=document.getElementById("rhythmCharacterSelect")?.value||rec.selectedCharacter||"";
  document.getElementById("rhythmBonusText").textContent=`응원 보너스 +${Math.round(selectedCharacterRewardBonus(id)*100)}%`;
}

document.getElementById("rhythmCharacterSelect")?.addEventListener("change",(e)=>{
  if(rhythmState.active){e.target.value=saveData.gameRecords.rhythm.selectedCharacter||"";return;}
  saveData.gameRecords.rhythm.selectedCharacter=e.target.value||null;saveGame();renderRhythmStatus();
});
document.getElementById("rhythmSpeedInput")?.addEventListener("input",(e)=>{
  setRhythmFallSpeed(Number(e.target.value));renderRhythmStatus();
});
document.getElementById("rhythmOffsetInput")?.addEventListener("input",(e)=>{
  setRhythmTimingOffset(Number(e.target.value));renderRhythmStatus();
});
document.getElementById("rhythmOffsetResetButton")?.addEventListener("click",()=>{
  setRhythmTimingOffset(0);document.getElementById("rhythmOffsetInput").value=0;renderRhythmStatus();
});

function makeRhythmChart(diff){
  const interval=RHYTHM_INTERVAL[diff];
  const notes=[];
  let lane=0;
  for(let t=3000;t<60000;t+=interval){
    if(diff==="SPECIAL"&&Math.random()<.12){notes.push({time:t-interval/2,lane:Math.floor(Math.random()*4),judged:false});}
    lane=(lane+1+Math.floor(Math.random()*3))%4;
    notes.push({time:t,lane,judged:false});
  }
  return notes;
}

function rhythmAccuracy(){
  const j=rhythmState.judgments,total=j.perfect+j.great+j.good+j.miss;
  if(!total)return 100;
  return ((j.perfect*100+j.great*70+j.good*40)/total).toFixed(1);
}
function rhythmGrade(acc){
  const a=Number(acc);return a>=95?"S":a>=85?"A":a>=70?"B":a>=50?"C":"D";
}
function renderRhythmHud(){
  const acc=rhythmAccuracy();
  document.getElementById("rhythmScore").textContent=formatPoints(rhythmState.score);
  document.getElementById("rhythmCombo").textContent=rhythmState.combo;
  document.getElementById("rhythmHp").textContent=rhythmState.hp;
  document.getElementById("rhythmAccuracy").textContent=`${acc}%`;
  document.getElementById("rhythmGrade").textContent=rhythmGrade(acc);
}

async function startRhythmGame(){
  if(rhythmState.active)return;
  const diff=document.getElementById("rhythmDifficultySelect").value;
  const selectedId=document.getElementById("rhythmCharacterSelect").value||"";
  const songId=document.getElementById("rhythmSongSelect")?.value||"";
  const song=rhythmSongs.find((item)=>item.id===songId)||null;
  saveData.gameRecords.rhythm.selectedCharacter=selectedId||null;
  saveData.gameRecords.rhythm.selectedSong=songId||null;
  saveGame();

  const customNotes=song?.charts?.[diff];
  const notes=Array.isArray(customNotes)&&customNotes.length
    ? customNotes.map((note)=>({time:Number(note.time)||0,lane:Number(note.lane)||0,judged:false}))
    : makeRhythmChart(diff);
  const duration=song?Math.max(5000,Number(song.duration||60)*1000):60000;
  const audioElement=song?new Audio(song.audio_url):null;
  if(audioElement){audioElement.preload="auto";audioElement.volume=1;try{await audioElement.play();audioElement.pause();audioElement.currentTime=0;}catch{}}

  rhythmState={active:true,paused:false,pausedAt:0,raf:0,startAt:0,duration,notes,score:0,combo:0,maxCombo:0,hp:100,judgments:{perfect:0,great:0,good:0,miss:0},selectedId,difficulty:diff,lastJudge:"",audioCtx:null,audioElement,songId};

  document.getElementById("rhythmStartButton").disabled=true;
  document.getElementById("rhythmQuitButton").disabled=false;
  setMessage("rhythmMessage",song?`${song.title} · 3초 후 시작!`:"3초 후 시작!");
  const count=document.getElementById("rhythmCountdown");count.classList.remove("hidden");
  for(const n of [3,2,1]){count.textContent=n;await new Promise(r=>setTimeout(r,650));}
  count.textContent="START";await new Promise(r=>setTimeout(r,350));count.classList.add("hidden");

  if(audioElement){try{audioElement.currentTime=0;await audioElement.play();}catch{setMessage("rhythmMessage","음원 재생이 차단됐어요. 게임은 계속 진행됩니다.","error");}}
  else{try{rhythmState.audioCtx=new (window.AudioContext||window.webkitAudioContext)();}catch{}}
  rhythmState.startAt=performance.now();
  rhythmState.raf=requestAnimationFrame(rhythmLoop);
}

function rhythmTime(){const offset=getRhythmTimingOffset();if(rhythmState.audioElement&&!rhythmState.audioElement.paused)return rhythmState.audioElement.currentTime*1000+offset;return performance.now()-rhythmState.startAt+offset;}

function playRhythmTick(){
  if(rhythmState.audioElement)return;
  const ac=rhythmState.audioCtx;if(!ac)return;
  const o=ac.createOscillator(),g=ac.createGain();o.frequency.value=650;g.gain.value=.025;o.connect(g);g.connect(ac.destination);o.start();o.stop(ac.currentTime+.04);
}

function hitRhythmLane(lane){
  if(!rhythmState.active||rhythmState.paused)return;
  const now=rhythmTime();
  let best=null,bestDelta=Infinity;
  rhythmState.notes.forEach((note)=>{
    if(note.judged||note.lane!==lane)return;
    const delta=Math.abs(note.time-now);
    if(delta<bestDelta){best=note;bestDelta=delta;}
  });
  if(!best||bestDelta>230){rhythmState.lastJudge="MISS";return;}
  best.judged=true;
  if(bestDelta<=65){rhythmState.judgments.perfect++;rhythmState.score+=100;rhythmState.lastJudge="PERFECT";}
  else if(bestDelta<=115){rhythmState.judgments.great++;rhythmState.score+=70;rhythmState.lastJudge="GREAT";}
  else {rhythmState.judgments.good++;rhythmState.score+=40;rhythmState.lastJudge="GOOD";}
  rhythmState.combo++;rhythmState.maxCombo=Math.max(rhythmState.maxCombo,rhythmState.combo);playRhythmTick();renderRhythmHud();
}

function rhythmLoop(){
  if(!rhythmState.active)return;
  if(rhythmState.paused){rhythmState.raf=requestAnimationFrame(rhythmLoop);return;}
  const now=rhythmTime();
  rhythmState.notes.forEach((note)=>{
    if(!note.judged&&now-note.time>230){note.judged=true;note.missed=true;rhythmState.judgments.miss++;rhythmState.combo=0;rhythmState.hp=Math.max(0,rhythmState.hp-10);rhythmState.lastJudge="MISS";}
  });
  renderRhythmHud();drawRhythm(now);
  if(rhythmState.hp<=0){finishRhythmGame(false,true);return;}
  if(now>=rhythmState.duration+500){finishRhythmGame(false,false);return;}
  rhythmState.raf=requestAnimationFrame(rhythmLoop);
}

function drawRhythm(now){
  const canvas=document.getElementById("rhythmCanvas"),ctx=canvas?.getContext("2d");if(!ctx)return;
  const w=canvas.width,h=canvas.height,laneW=w/4,judgeY=h-90,speed=getRhythmFallSpeed();
  ctx.fillStyle="#10201b";ctx.fillRect(0,0,w,h);
  for(let i=0;i<4;i++){ctx.fillStyle=i%2?"#17332a":"#142b24";ctx.fillRect(i*laneW,0,laneW,h);ctx.strokeStyle="rgba(255,255,255,.07)";ctx.strokeRect(i*laneW,0,laneW,h);}
  ctx.fillStyle="#58d3ad";ctx.fillRect(0,judgeY,w,4);
  ctx.fillStyle="rgba(255,255,255,.65)";ctx.font="bold 18px sans-serif";ctx.textAlign="center";RHYTHM_KEYS.forEach((k,i)=>ctx.fillText(k.toUpperCase(),i*laneW+laneW/2,h-28));
  const travel=1800/speed;
  rhythmState.notes.forEach((note)=>{
    if(note.judged)return;
    const delta=note.time-now;
    if(delta>travel||delta<-250)return;
    const y=judgeY-(delta/travel)*(judgeY-20);
    ctx.fillStyle="#7be3c2";ctx.beginPath();ctx.roundRect(note.lane*laneW+10,y-12,laneW-20,24,8);ctx.fill();
  });
  if(rhythmState.lastJudge){ctx.fillStyle=rhythmState.lastJudge==="MISS"?"#ff7986":"#fff";ctx.font="bold 28px sans-serif";ctx.fillText(rhythmState.lastJudge,w/2,100);}
}

function finishRhythmGame(quit=false,gameOver=false){
  if(!rhythmState.active)return;
  rhythmState.active=false;cancelAnimationFrame(rhythmState.raf);
  try{rhythmState.audioCtx?.close();}catch{}
  try{rhythmState.audioElement?.pause();if(rhythmState.audioElement)rhythmState.audioElement.currentTime=0;}catch{}
  const total=rhythmState.notes.length;
  const fullCombo=!gameOver&&!quit&&rhythmState.judgments.miss===0&&rhythmState.judgments.perfect+rhythmState.judgments.great+rhythmState.judgments.good===total;
  let base=0;if(!quit&&!gameOver){base=(["HARD","SPECIAL"].includes(rhythmState.difficulty)&&fullCombo)?2000:1000;}
  const bonus=selectedCharacterRewardBonus(rhythmState.selectedId),reward=applyPointBonus(base,bonus);
  saveData.gameRecords.rhythm.bestScore=Math.max(saveData.gameRecords.rhythm.bestScore||0,rhythmState.score);
  if(reward)addPoints(reward);else saveGame();
  document.getElementById("rhythmStartButton").disabled=false;document.getElementById("rhythmStartButton").textContent="게임 시작";document.getElementById("rhythmQuitButton").disabled=true;
  const msg=quit?"포기했어요. 보상 없음.":gameOver?"HP가 0이 되어 GAME OVER. 보상 없음.":`완주! ${formatPoints(reward)}P 지급${fullCombo?" · FULL COMBO!":""}${bonus?" · 풀돌 +20%":""}`;
  setMessage("rhythmMessage",msg,quit||gameOver?"error":"success");
}
function pauseRhythmForVisibility(){
  if(rhythmState.active&&!rhythmState.paused){
    rhythmState.paused=true;
    rhythmState.pausedAt=performance.now();
    try{rhythmState.audioElement?.pause();}catch{}
    const btn=document.getElementById("rhythmStartButton");
    if(btn){btn.disabled=false;btn.textContent="계속하기";}
    setMessage("rhythmMessage","화면을 벗어나 자동 일시정지됐어요. 계속하기를 눌러 재개하세요.");
  }
}

document.getElementById("rhythmStartButton")?.addEventListener("click",()=>{
  if(rhythmState.active&&rhythmState.paused){
    rhythmState.startAt += performance.now()-(rhythmState.pausedAt||performance.now());
    rhythmState.paused=false;
    rhythmState.pausedAt=0;
    try{rhythmState.audioElement?.play();}catch{}
    const btn=document.getElementById("rhythmStartButton");
    if(btn){btn.disabled=true;btn.textContent="게임 시작";}
    setMessage("rhythmMessage","계속합니다.");
    return;
  }
  void startRhythmGame();
});
document.getElementById("rhythmQuitButton")?.addEventListener("click",()=>finishRhythmGame(true,false));
document.querySelectorAll("[data-rhythm-lane]").forEach((button)=>button.addEventListener("pointerdown",()=>{
  const lane=Number(button.dataset.rhythmLane);button.classList.add("hit");setTimeout(()=>button.classList.remove("hit"),100);hitRhythmLane(lane);
}));
document.addEventListener("keydown",(e)=>{const lane=RHYTHM_KEYS.indexOf(e.key.toLowerCase());if(lane>=0&&rhythmState.active){e.preventDefault();hitRhythmLane(lane);}});

/* =========================================================
   펫
========================================================= */

const PET_STAGE_THRESHOLDS = [
  { name:"알", min:0, max:299, emoji:"🥚" },
  { name:"아기", min:300, max:1799, emoji:"🐣" },
  { name:"어린이", min:1800, max:6799, emoji:"🐥" },
  { name:"성인", min:6800, max:6800, emoji:"🦜" }
];
const PET_COOLDOWN = { feed:30*60*1000, wash:12*60*60*1000, play:30*60*1000, walk:2*60*60*1000, gift:30*60*1000 };
const PET_ACTION_EXP = { feed:30,wash:40,play:60,walk:150,gift:90 };

function createDefaultPet(){
  const now=Date.now();
  return { id:"mint-default", name:"민트", exp:0, affection:0, mood:80, hunger:0, dirt:0, bornAt:now, lastCare:now, lastPlay:now, lastWalk:now, lastUpdate:now, actionAt:{}, sick:false, dead:false, deathReason:null, completed:false };
}
function petStage(pet){return PET_STAGE_THRESHOLDS.find((s)=>pet.exp>=s.min&&pet.exp<=s.max)||PET_STAGE_THRESHOLDS.at(-1);}
function petDays(pet){return Math.max(1,Math.floor((Date.now()-pet.bornAt)/86400000)+1);}

function applyPetTime(){
  const p=saveData.pet;if(!p||p.dead||p.completed)return;
  const now=Date.now(),elapsed=Math.max(0,now-(p.lastUpdate||now)),hours=elapsed/3600000;
  p.hunger=Math.min(100,p.hunger+hours*(100/22));
  p.dirt=Math.min(100,p.dirt+hours*(100/22));
  if(now-(p.lastPlay||p.bornAt)>12*3600000)p.mood=Math.max(0,p.mood-hours*.7);
  if(now-(p.lastWalk||p.bornAt)>24*3600000)p.mood=Math.max(0,p.mood-hours*.8);
  if(now-(p.lastPlay||p.bornAt)>24*3600000&&now-(p.lastWalk||p.bornAt)>24*3600000)p.mood=0;
  if(now-(p.lastCare||p.bornAt)>=48*3600000)p.sick=true;
  if(now-(p.lastCare||p.bornAt)>=72*3600000){
    p.dead=true;
    if(p.mood<=0)p.deathReason="우울증";
    else if(p.hunger>=100)p.deathReason="굶주림";
    else if(p.sick)p.deathReason="질병";
    else p.deathReason="장기 방치";
  }
  p.lastUpdate=now;saveLocalOnly();
}

function petCooldownRemaining(action){
  const p=saveData.pet;if(!p)return 0;
  const last=p.actionAt?.[action]||0;return Math.max(0,PET_COOLDOWN[action]-(Date.now()-last));
}
function humanCooldown(ms){
  if(ms<=0)return "";
  const m=Math.ceil(ms/60000);if(m<60)return `${m}분`;
  const h=Math.floor(m/60),rm=m%60;return `${h}시간${rm?` ${rm}분`:""}`;
}
function petDialogueForState(){
  const p=saveData.pet;if(!p)return "";
  if(p.dead)return petDialogueV6("death", `... ${p.deathReason||"알 수 없는 이유"}로 무지개다리를 건넜어요.`);
  if(p.sick)return petDialogueV6("sick", "몸이 좋지 않은 것 같아...");
  const now=Date.now();
  const playGap=now-(p.lastPlay||p.bornAt);
  const walkGap=now-(p.lastWalk||p.bornAt);
  if(playGap>=24*3600000&&walkGap>=24*3600000)return petDialogueV6("neglected", "같이 놀고 산책도 가고 싶어...");
  if(p.hunger>=75&&p.dirt>=70)return petDialogueV6("both", "배도 고프고 씻고 싶어...");
  if(p.hunger>=75)return petDialogueV6("hunger", "꼬르륵... 배고파!");
  if(p.dirt>=70)return petDialogueV6("dirty", "꼬질꼬질해졌어...");
  if(p.mood<=30)return petDialogueV6("sad", "조금 외로운 것 같아.");
  if(playGap>=12*3600000)return petDialogueV6("want_play", "같이 놀아줘!");
  if(walkGap>=24*3600000)return petDialogueV6("want_walk", "산책 가고 싶어!");
  if(p.mood>=75&&p.hunger<50&&p.dirt<50)return petDialogueV6("happy", "오늘도 같이 놀자!");
  return petDialogueV6("idle", `${p.name||"펫"}이 당신을 바라보고 있어요.`);
}

function renderPet(){
  applyPetTime();
  const selectPanel=document.getElementById("petSelectPanel"),main=document.getElementById("petMainPanel");
  const p=saveData.pet;
  if(!p){
    selectPanel?.classList.remove("hidden");main?.classList.add("hidden");
    document.getElementById("petStagePill").textContent="알";
    renderPetTypeSelection();
    renderPetArchive();return;
  }
  selectPanel?.classList.add("hidden");main?.classList.remove("hidden");
  const stage=petStage(p),max=stage.name==="성인"?6800:(stage.name==="알"?300:stage.name==="아기"?1800:6800);
  document.getElementById("petStagePill").textContent=p.dead?"사망":stage.name;
  renderPetVisualV6(p, stage);
  document.getElementById("petName").textContent=p.name;
  document.getElementById("petDialogue").textContent=petDialogueForState();
  document.getElementById("petDaysText").textContent=`함께한 지 ${petDays(p)}일`;
  document.getElementById("petAlert").textContent=p.dead?`사망 원인: ${p.deathReason}`:p.sick?"🤒 아픈 상태예요. 돌봐주면 회복할 수 있어요.":"";

  const pct=(value,maxv=100)=>`${Math.max(0,Math.min(100,value/maxv*100))}%`;
  document.getElementById("petExpBar").style.width=pct(p.exp-(stage.name==="알"?0:stage.name==="아기"?300:stage.name==="어린이"?1800:6800),Math.max(1,max-(stage.name==="알"?0:stage.name==="아기"?300:stage.name==="어린이"?1800:6800)));
  document.getElementById("petAffectionBar").style.width=pct(p.affection);
  document.getElementById("petMoodBar").style.width=pct(p.mood);
  document.getElementById("petHungerBar").style.width=pct(p.hunger);
  document.getElementById("petDirtBar").style.width=pct(p.dirt);
  document.getElementById("petExpText").textContent=stage.name==="성인"?"6800 / 6800":`${Math.floor(p.exp)} / ${max}`;
  document.getElementById("petAffectionText").textContent=Math.floor(p.affection);
  document.getElementById("petMoodText").textContent=Math.floor(p.mood);
  document.getElementById("petHungerText").textContent=Math.floor(p.hunger);
  document.getElementById("petDirtText").textContent=Math.floor(p.dirt);

  document.querySelectorAll("[data-pet-action]").forEach((button)=>{
    const action=button.dataset.petAction,remain=petCooldownRemaining(action);
    button.disabled=p.dead||p.completed||remain>0||(action==="feed"&&p.hunger<10);
    const el=document.getElementById(`petCooldown${action[0].toUpperCase()}${action.slice(1)}`);
    if(el)el.textContent=remain?`쿨타임 ${humanCooldown(remain)}`:action==="feed"&&p.hunger<10?"배고픔 10 미만":"사용 가능";
  });
  renderPetArchive();
}

function renderPetArchive(){
  const el=document.getElementById("petArchiveGrid");if(!el)return;
  const list=saveData.completedPets||[];
  el.innerHTML=list.length?list.map((p)=>`<div class="pet-archive-card"><span>🦜</span><strong>${escapeHTML(p.name||"민트")}</strong><small>${new Date(p.completedAt).toLocaleDateString("ko-KR")} 완료</small></div>`).join(""):`<div class="card">아직 육성 완료한 펫이 없어요.</div>`;
}

function addPetExp(amount){
  const p=saveData.pet;if(!p)return;
  const beforeStage=petStage(p).name;
  p.exp=Math.min(6800,p.exp+amount);
  const afterStage=petStage(p).name;
  if(beforeStage!==afterStage){
    setMessage("petActionMessage",`${afterStage} 단계로 성장했어요!`,"success");
    const dialogue=document.getElementById("petDialogue");
    if(dialogue)dialogue.textContent=petDialogueV6(beforeStage==="알"?"hatch":"grow",beforeStage==="알"?"알에서 깨어났어!":`${afterStage} 단계로 성장했어!`);
  }
  if(p.exp>=6800&&!p.completed){
    p.completed=true;
    saveData.completedPets.push({id:p.id,name:p.name,completedAt:Date.now()});
    setTimeout(()=>{saveData.pet=null;saveGame();renderPet();},900);
  }
}

document.getElementById("chooseDefaultPetButton")?.addEventListener("click",()=>{const type=petTypes[0];saveData.pet=type?createPetFromTypeV6(type):createDefaultPet();saveGame();renderPet();});
document.getElementById("petChangeButton")?.addEventListener("click",()=>{
  if(!saveData.pet)return;
  if(!confirm("현재 육성 중인 기록이 사라져요. 새 알로 다시 시작할까요?"))return;
  saveData.pet=null;saveGame();renderPet();
});

function touchPetAtRatio(ratio=.5){
  const p=saveData.pet;if(!p||p.dead)return;
  document.getElementById("petDialogue").textContent=ratio<.35?petDialogueV6("touch_head","머리를 쓰다듬어주니 기분 좋아 보여!"):ratio<.60?petDialogueV6("touch_face","눈이 마주쳤다!"):petDialogueV6("touch_body","몸을 톡톡 건드리니 꼬물거린다.");
}

document.getElementById("petVisual")?.addEventListener("click",(event)=>{
  const rect=event.currentTarget.getBoundingClientRect(),ratio=(event.clientY-rect.top)/rect.height;
  touchPetAtRatio(ratio);
});
document.getElementById("petVisual")?.addEventListener("keydown",(event)=>{
  if(event.key==="Enter"||event.key===" "){
    event.preventDefault();
    touchPetAtRatio(.5);
  }
});

function ownedRGiftCards(){
  return characters
    .filter((c)=>c.rarity==="R"&&getOwnedCount(c.id)>0)
    .sort((a,b)=>a.name.localeCompare(b.name,"ko"));
}

function closePetGiftModal(){
  document.getElementById("petGiftModal")?.classList.add("hidden");
  if(document.querySelectorAll(".modal-backdrop:not(.hidden)").length===0)document.body.classList.remove("modal-open");
}

function renderPetGiftList(){
  const listEl=document.getElementById("petGiftList");
  if(!listEl)return;
  const q=(document.getElementById("petGiftSearchInput")?.value||"").trim().toLowerCase();
  const list=ownedRGiftCards().filter((c)=>!q||c.name.toLowerCase().includes(q));
  listEl.innerHTML=list.length?list.map((char)=>`
    <div class="pet-gift-card">
      ${characterDisplayImage(char)?`<img src="${escapeHTML(characterDisplayImage(char))}" alt="${escapeHTML(char.name)}">`:`<div class="pet-gift-fallback">R</div>`}
      <div><strong>${escapeHTML(char.name)}</strong><small>보유 ${getOwnedCount(char.id)}장</small></div>
      <button type="button" data-pet-gift-id="${char.id}">선물</button>
    </div>
  `).join(""):`<div class="card">조건에 맞는 보유 R 카드가 없어요.</div>`;
  listEl.querySelectorAll("[data-pet-gift-id]").forEach((button)=>button.addEventListener("click",()=>givePetRGift(button.dataset.petGiftId)));
}

function openPetGiftModal(){
  if(!ownedRGiftCards().length){alert("선물할 R 캐릭터 카드가 없어요.");return;}
  const input=document.getElementById("petGiftSearchInput");if(input)input.value="";
  setMessage("petGiftMessage","");
  renderPetGiftList();
  document.getElementById("petGiftModal")?.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function specificGiftDialogue(type,charId){
  const list=type?.dialogues?.gift_items?.[charId];
  return Array.isArray(list)&&list.length?randomChoice(list):null;
}

function givePetRGift(charId){
  const p=saveData.pet;
  const char=characters.find((c)=>c.id===charId);
  if(!p||p.dead||p.completed||!char||char.rarity!=="R"||getOwnedCount(charId)<1)return;
  if(petCooldownRemaining("gift")>0)return;
  const now=Date.now();
  const wasSick=Boolean(p.sick),wasMoodZero=p.mood<=0;
  saveData.characters[char.id]=getOwnedCount(char.id)-1;
  p.affection=Math.min(100,p.affection+10);
  p.mood=Math.min(100,p.mood+5);
  p.actionAt.gift=now;p.lastCare=now;p.sick=false;
  addPetExp(PET_ACTION_EXP.gift);
  saveGame();
  closePetGiftModal();
  renderEverything();
  const type=getPetTypeV6(p);
  const line=specificGiftDialogue(type,char.id)||petDialogueV6("gift",`${char.name} 선물 고마워!`);
  const dialogue=document.getElementById("petDialogue");
  if(dialogue)dialogue.textContent=wasSick||wasMoodZero?petDialogueV6("recover",line):line;
}

document.getElementById("closePetGiftModal")?.addEventListener("click",closePetGiftModal);
document.getElementById("petGiftModal")?.addEventListener("click",(e)=>{if(e.target.id==="petGiftModal")closePetGiftModal();});
document.getElementById("petGiftSearchInput")?.addEventListener("input",renderPetGiftList);

document.querySelectorAll("[data-pet-action]").forEach((button)=>button.addEventListener("click",()=>{
  const action=button.dataset.petAction,p=saveData.pet;if(!p||p.dead||p.completed||petCooldownRemaining(action)>0)return;
  const now=Date.now();

  if(action==="gift"){openPetGiftModal();return;}

  const wasSick=Boolean(p.sick),wasMoodZero=p.mood<=0;
  if(action==="feed"){if(p.hunger<10)return;p.hunger=Math.max(0,p.hunger-30);document.getElementById("petDialogue").textContent=petDialogueV6("feed", "냠냠! 맛있어!");}
  if(action==="wash"){p.dirt=0;document.getElementById("petDialogue").textContent=petDialogueV6("wash", "깨끗해졌어!");}
  if(action==="play"){p.affection=Math.min(100,p.affection+5);p.mood=Math.min(100,p.mood+25);p.lastPlay=now;document.getElementById("petDialogue").textContent=petDialogueV6("play", "더 놀자!");}
  if(action==="walk"){
    p.affection=Math.min(100,p.affection+8);p.mood=Math.min(100,p.mood+35);p.lastWalk=now;
    const roll=Math.random();
    if(roll<.25){
      const rPool=characters.filter((c)=>c.rarity==="R"&&!c.is_limited);
      const found=randomChoice(rPool);
      if(found){saveData.characters[found.id]=getOwnedCount(found.id)+1;document.getElementById("petDialogue").textContent=`산책 중 ${found.name} 카드를 발견했어!`;}
      else document.getElementById("petDialogue").textContent="산책은 즐거웠어!";
    }else if(roll<.62){
      const reward=50+Math.floor(Math.random()*651);addPoints(reward);document.getElementById("petDialogue").textContent=`산책 중 ${reward}P를 발견했어!`;
    }else document.getElementById("petDialogue").textContent=petDialogueV6("walk", "산책 다녀왔어!");
  }

  p.actionAt[action]=now;p.lastCare=now;p.sick=false;addPetExp(PET_ACTION_EXP[action]);saveGame();renderEverything();
  if(wasSick||wasMoodZero){
    const dialogue=document.getElementById("petDialogue");
    if(dialogue)dialogue.textContent=petDialogueV6("recover","다시 기운이 나는 것 같아!");
  }
}));

setInterval(()=>{if(saveData.pet)renderPet();},60000);

/* =========================================================
   카지노 공통 / 가위바위보 / 슬롯
========================================================= */

function renderCasino(){
  updatePointDisplays();
  renderBlackjack();
  renderDerby();
}

document.querySelectorAll("[data-casino-view]").forEach((button)=>button.addEventListener("click",()=>{
  const view=button.dataset.casinoView;
  document.querySelectorAll("[data-casino-view]").forEach((b)=>b.classList.toggle("active",b===button));
  ["rps","slots","blackjack","derby"].forEach((name)=>document.getElementById(`casinoView${name[0].toUpperCase()}${name.slice(1)}`)?.classList.toggle("hidden",name!==view));
}));

function validatedBet(inputId){
  const value=Math.floor(Number(document.getElementById(inputId)?.value));
  if(!Number.isSafeInteger(value)||value<1){alert("1P 이상 정수로 배팅해주세요.");return null;}
  if(value>saveData.points){alert("보유 포인트보다 많이 배팅할 수 없어요.");return null;}
  return value;
}
function cryptoRandomInt(max){
  if(window.crypto?.getRandomValues){const a=new Uint32Array(1);window.crypto.getRandomValues(a);return a[0]%max;}
  return Math.floor(Math.random()*max);
}
document.querySelectorAll("[data-allin]").forEach((button)=>button.addEventListener("click",()=>{
  const map={rps:"rpsBetInput",slots:"slotBetInput",blackjack:"blackjackBetInput",derby:"derbyBetInput"};
  const input=document.getElementById(map[button.dataset.allin]);if(input)input.value=Math.max(1,saveData.points);
}));

document.querySelectorAll("[data-rps-choice]").forEach((button)=>button.addEventListener("click",()=>{
  const bet=validatedBet("rpsBetInput");if(!bet)return;
  const choices=["scissors","rock","paper"],emoji={scissors:"✌️",rock:"✊",paper:"✋"};
  const user=button.dataset.rpsChoice,cpu=choices[cryptoRandomInt(3)];
  spendPoints(bet);
  let result,payout=0;
  if(user===cpu){result="무승부";payout=bet;}
  else if((user==="scissors"&&cpu==="paper")||(user==="rock"&&cpu==="scissors")||(user==="paper"&&cpu==="rock")){result="승리";payout=bet*2;}
  else result="패배";
  if(payout)addPoints(payout);
  document.getElementById("rpsResult").textContent=`나 ${emoji[user]} vs 컴퓨터 ${emoji[cpu]} · ${result} · ${payout?`${formatPoints(payout)}P 반환`:"0P"}`;
}));

const SLOT_SYMBOLS=["🍒","🍋","⭐","💎"];
document.getElementById("slotSpinButton")?.addEventListener("click",()=>{
  const bet=validatedBet("slotBetInput");if(!bet)return;
  spendPoints(bet);
  const reels=[0,0,0].map(()=>SLOT_SYMBOLS[cryptoRandomInt(SLOT_SYMBOLS.length)]);
  document.getElementById("slotReels").innerHTML=reels.map((s)=>`<span>${s}</span>`).join("");
  let mult=0;
  if(reels.every((x)=>x==="💎"))mult=10;
  else if(reels.every((x)=>x==="⭐"))mult=5;
  else if(reels.every((x)=>x==="🍒")||reels.every((x)=>x==="🍋"))mult=3;
  else if(new Set(reels).size===2)mult=1;
  const payout=bet*mult;if(payout)addPoints(payout);
  document.getElementById("slotResult").textContent=`${reels.join(" ")} · ${mult}배 · ${formatPoints(payout)}P 지급`;
});

/* =========================================================
   블랙잭
========================================================= */

function createDeck(){
  const suits=["♠","♥","♦","♣"],ranks=["A","2","3","4","5","6","7","8","9","10","J","Q","K"],deck=[];
  suits.forEach((s)=>ranks.forEach((r)=>deck.push({suit:s,rank:r})));
  for(let i=deck.length-1;i>0;i--){const j=cryptoRandomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}
  return deck;
}
function cardValue(card){if(["J","Q","K"].includes(card.rank))return 10;if(card.rank==="A")return 11;return Number(card.rank);}
function handScore(hand){let total=hand.reduce((s,c)=>s+cardValue(c),0),aces=hand.filter((c)=>c.rank==="A").length;while(total>21&&aces>0){total-=10;aces--;}return total;}
function cardHTML(card,hidden=false){if(hidden)return `<span class="playing-card back">?</span>`;return `<span class="playing-card ${["♥","♦"].includes(card.suit)?"red":""}">${card.rank}${card.suit}</span>`;}

function startBlackjack(){
  const bet=validatedBet("blackjackBetInput");if(!bet)return;
  spendPoints(bet);const deck=createDeck();
  saveData.blackjackPending={bet,deck,player:[deck.pop(),deck.pop()],dealer:[deck.pop(),deck.pop()],finished:false,doubled:false};saveGame();renderBlackjack();
  const p=saveData.blackjackPending;
  if(handScore(p.player)===21){
    if(handScore(p.dealer)===21) finishBlackjackRound("push");
    else finishBlackjackRound("player_blackjack");
  }
}
function renderBlackjack(){
  const p=saveData.blackjackPending;
  document.getElementById("blackjackStreakText").textContent=`연승 ${saveData.blackjackStreak||0}`;
  const actions=document.getElementById("blackjackActions"),betRow=document.getElementById("blackjackBetRow");
  if(!p){
    document.getElementById("dealerCards").innerHTML="";
    document.getElementById("playerCards").innerHTML="";
    document.getElementById("dealerScore").textContent="?";document.getElementById("playerScore").textContent="0";
    actions?.classList.add("hidden");betRow?.classList.remove("hidden");
    if(saveData.blackjackRecent)document.getElementById("blackjackResult").textContent=saveData.blackjackRecent;
    return;
  }
  document.getElementById("dealerCards").innerHTML=p.dealer.map((c,i)=>cardHTML(c,!p.finished&&i===1)).join("");
  document.getElementById("playerCards").innerHTML=p.player.map((c)=>cardHTML(c)).join("");
  document.getElementById("dealerScore").textContent=p.finished?handScore(p.dealer):cardValue(p.dealer[0]);
  document.getElementById("playerScore").textContent=handScore(p.player);
  actions?.class.toggle("hidden",p.finished);betRow?.class.toggle("hidden",!p.finished);
  if(!p.finished){
    document.getElementById("blackjackDoubleButton").disabled=p.player.length!==2||saveData.points<p.bet;
    document.getElementById("blackjackResult").textContent=`배팅 ${formatPoints(p.bet)}P · HIT / STAND / DOUBLE`;
  }
}
function blackjackHit(){
  const p=saveData.blackjackPending;if(!p||p.finished)return;
  p.player.push(p.deck.pop());saveGame();renderBlackjack();
  if(handScore(p.player)>21)finishBlackjackRound("player_bust");
}
function blackjackStand(){
  const p=saveData.blackjackPending;if(!p||p.finished)return;
  while(handScore(p.dealer)<17)p.dealer.push(p.deck.pop());
  const ps=handScore(p.player),ds=handScore(p.dealer);
  if(ds>21||ps>ds)finishBlackjackRound("win");
  else if(ps===ds)finishBlackjackRound("push");
  else finishBlackjackRound("lose");
}
function blackjackDouble(){
  const p=saveData.blackjackPending;if(!p||p.finished||p.player.length!==2||saveData.points<p.bet)return;
  spendPoints(p.bet);p.bet*=2;p.doubled=true;p.player.push(p.deck.pop());saveGame();
  if(handScore(p.player)>21)finishBlackjackRound("player_bust");else blackjackStand();
}
function finishBlackjackRound(type){
  const p=saveData.blackjackPending;if(!p)return;
  p.finished=true;
  let payout=0,label="";
  if(type==="player_blackjack"){payout=Math.floor(p.bet*2.5);label="NATURAL BLACKJACK!";saveData.blackjackStreak=(saveData.blackjackStreak||0)+1;}
  else if(type==="win"){payout=p.bet*2;label="승리!";saveData.blackjackStreak=(saveData.blackjackStreak||0)+1;}
  else if(type==="push"){payout=p.bet;label="PUSH"; }
  else {label=type==="player_bust"?"BUST":"패배";saveData.blackjackStreak=0;}
  if(payout)addPoints(payout);
  const text=`${label} · ${payout?`${formatPoints(payout)}P 반환`:"0P"}`;
  saveData.blackjackRecent=text;saveGame();renderBlackjack();
  document.getElementById("blackjackResult").textContent=text;
  setTimeout(()=>{saveData.blackjackPending=null;saveGame();renderBlackjack();},900);
}
document.getElementById("blackjackDealButton")?.addEventListener("click",startBlackjack);
document.getElementById("blackjackHitButton")?.addEventListener("click",blackjackHit);
document.getElementById("blackjackStandButton")?.addEventListener("click",blackjackStand);
document.getElementById("blackjackDoubleButton")?.addEventListener("click",blackjackDouble);
document.querySelectorAll("[data-bj-bet]").forEach((button)=>button.addEventListener("click",()=>{document.getElementById("blackjackBetInput").value=button.dataset.bjBet;}));

/* =========================================================
   NULL DERBY
========================================================= */

let derbyAnimationTimer=null;

function derbyEntrants(){
  const eligible=characters.filter((c)=>c.image_url||c.full_image_url);
  if(eligible.length<5)return [];
  return [...eligible].sort(()=>Math.random()-.5).slice(0,5);
}
function setupDerbyIfNeeded(){
  if(saveData.derbyPending)return;
  if(window._derbyEntrants?.length===5)return;
  window._derbyEntrants=derbyEntrants();
}
function renderDerby(){
  setupDerbyIfNeeded();
  const pending=saveData.derbyPending;
  const list=pending?.entrants?.map((id)=>characters.find((c)=>c.id===id)).filter(Boolean)||window._derbyEntrants||[];
  const racers=document.getElementById("derbyRacers");
  if(racers)racers.innerHTML=list.length?list.map((c)=>`<div class="derby-racer-card"><div class="art">${artHTML(c)}</div><strong>${escapeHTML(c.name)}</strong></div>`).join(""):`<div class="card">이미지가 있는 캐릭터 5명 이상이 필요해요.</div>`;

  ["derbyPick1","derbyPick2","derbyPick3"].forEach((id,idx)=>{
    const select=document.getElementById(id);if(!select)return;
    const cur=select.value;
    select.innerHTML=`<option value="">${idx+1}위 선택</option>`+list.map((c)=>`<option value="${c.id}">${escapeHTML(c.name)}</option>`).join("");
    if(list.some((c)=>c.id===cur))select.value=cur;
  });

  const track=document.getElementById("derbyTrack");
  if(track)track.innerHTML=list.map((c,i)=>`<div class="derby-runner" id="derbyRunner${i}" style="top:${10+i*38}px">${c.image_url?`<img src="${escapeHTML(characterDisplayImage(c))}">`:"🏇"}<span>${escapeHTML(c.name)}</span></div>`).join("");

  if(pending){
    document.getElementById("derbyStartButton").disabled=true;
    resumeDerbyAnimation();
  }else{
    document.getElementById("derbyStartButton").disabled=list.length<5;
    if(saveData.derbyRecent)document.getElementById("derbyResult").textContent=saveData.derbyRecent;
  }
}
function startDerby(){
  const list=window._derbyEntrants||[];if(list.length<5)return;
  const picks=[1,2,3].map((n)=>document.getElementById(`derbyPick${n}`).value);
  if(picks.some((x)=>!x)||new Set(picks).size!==3)return alert("1~3위는 서로 다른 캐릭터로 선택해주세요.");
  const bet=validatedBet("derbyBetInput");if(!bet)return;
  spendPoints(bet);
  const result=[...list.map((c)=>c.id)].sort(()=>Math.random()-.5);
  saveData.derbyPending={entrants:list.map((c)=>c.id),picks,bet,result,startedAt:Date.now(),finishAt:Date.now()+18000,settled:false};
  saveGame();renderDerby();document.getElementById("derbyResult").textContent="경기 시작! 초반 선두 경쟁이 치열합니다!";
}
function resumeDerbyAnimation(){
  if(derbyAnimationTimer)clearInterval(derbyAnimationTimer);
  const p=saveData.derbyPending;if(!p)return;
  const update=()=>{
    const now=Date.now(),progress=Math.max(0,Math.min(1,(now-p.startedAt)/18000));
    p.entrants.forEach((id,i)=>{
      const rank=p.result.indexOf(id),base=progress*(75-rank*1.8)+Math.sin(progress*20+i)*2;
      const el=document.getElementById(`derbyRunner${i}`);if(el)el.style.left=`${Math.max(2,Math.min(82,base))}%`;
    });
    const resultEl=document.getElementById("derbyResult");
    if(resultEl){
      if(progress<.35)resultEl.textContent="초반! 선수들이 자리를 잡습니다!";
      else if(progress<.75)resultEl.textContent="중반! 순위가 계속 뒤바뀝니다!";
      else resultEl.textContent="마지막 직선! 결승선을 향해 전력 질주!";
    }
    if(now>=p.finishAt){clearInterval(derbyAnimationTimer);derbyAnimationTimer=null;settleDerby();}
  };
  update();derbyAnimationTimer=setInterval(update,350);
}
function settleDerby(){
  const p=saveData.derbyPending;if(!p||p.settled)return;
  let mult=0;
  if(p.picks[0]===p.result[0]){mult=2;if(p.picks[1]===p.result[1]){mult=4;if(p.picks[2]===p.result[2])mult=8;}}
  const payout=p.bet*mult;
  if(payout){
    const next=saveData.points+payout;
    if(Number.isSafeInteger(next)) saveData.points=next;
  }
  const names=p.result.slice(0,3).map((id)=>characters.find((c)=>c.id===id)?.name||"?");
  saveData.derbyRecent=`결과 ${names.map((n,i)=>`${i+1}위 ${n}`).join(" · ")} · ${mult}배 · ${formatPoints(payout)}P 지급`;
  saveData.derbyPending=null;
  saveGame();
  updatePointDisplays();
  window._derbyEntrants=derbyEntrants();
  renderDerby();
}
document.getElementById("derbyStartButton")?.addEventListener("click",startDerby);
document.querySelectorAll("[data-derby-bet]").forEach((button)=>button.addEventListener("click",()=>{document.getElementById("derbyBetInput").value=button.dataset.derbyBet;}));



/* =========================================================
   V6 운영 / 공개 콘텐츠
========================================================= */

async function loadV6PublicData(){
  if(!supabaseClient)return;
  try{
    const [bannerRes,songRes,petRes,opsSettingRes]=await Promise.all([
      supabaseClient.from("event_banners").select("*").order("sort_order",{ascending:true}).order("created_at",{ascending:true}),
      supabaseClient.from("rhythm_songs").select("*").order("created_at",{ascending:false}),
      supabaseClient.from("pet_types").select("*").order("sort_order",{ascending:true}).order("created_at",{ascending:true}),
      supabaseClient.from("site_settings").select("key,value").in("key",["global_point_grant","banner_master"])
    ]);
    if(!bannerRes.error)eventBanners=(bannerRes.data||[]).filter((b)=>b.enabled||isAdmin);
    if(!songRes.error)rhythmSongs=(songRes.data||[]).filter((s)=>s.is_public||isAdmin);
    if(!petRes.error)petTypes=(petRes.data||[]).filter((p)=>p.is_public||isAdmin);
    if(!opsSettingRes.error){for(const row of (opsSettingRes.data||[])){if(row.key==="global_point_grant")globalPointGrantV6=row.value||null;if(row.key==="banner_master")bannerMasterEnabledV6=row.value?.enabled!==false;}}
    applyGlobalPointGrantV6();renderV6HomeBanners();renderRhythmSongSelector();renderPetTypeSelection();
  }catch(error){console.warn("V6 공개 데이터 로드 실패",error);}
}

function addRemoteFontV6(banner){
  if(!banner?.font_url||!banner?.font_family)return;
  const id=`font-${String(banner.id).replaceAll(/[^a-zA-Z0-9_-]/g,"")}`;
  if(document.getElementById(id))return;
  const style=document.createElement("style");style.id=id;
  style.textContent=`@font-face{font-family:'${String(banner.font_family).replaceAll("'","")}';src:url('${banner.font_url}');font-display:swap;}`;
  document.head.appendChild(style);
}

function renderV6HomeBanners(){
  const section=document.getElementById("homeEventBanner")?.closest(".home-section");if(section)section.style.display=bannerMasterEnabledV6?"":"none";if(!bannerMasterEnabledV6)return;
  const active=eventBanners.filter((b)=>b.enabled).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
  const banner=document.getElementById("homeEventBanner"),wrap=document.getElementById("homeBannerTextWrap"),title=document.getElementById("homeBannerTitle"),text=document.getElementById("homeBannerText"),image=document.getElementById("homeBannerImage"),dots=document.getElementById("homeBannerDots"),prev=document.getElementById("homeBannerPrev"),next=document.getElementById("homeBannerNext");
  if(!banner||!wrap||!title||!text||!image)return;
  if(bannerSlideTimer){clearInterval(bannerSlideTimer);bannerSlideTimer=null;}
  if(!active.length){
    banner.classList.remove("custom-banner");wrap.classList.remove("banner-pulse");wrap.removeAttribute("style");banner.style.backgroundImage="";title.style="";text.style="";image.style="";
    if(dots)dots.innerHTML="";prev?.classList.add("hidden");next?.classList.add("hidden");
    renderHomeBanner();return;
  }
  activeBannerIndex=((activeBannerIndex%active.length)+active.length)%active.length;
  const b=active[activeBannerIndex];addRemoteFontV6(b);
  banner.classList.add("custom-banner");banner.style.backgroundImage=b.image_url?`url('${b.image_url}')`:"linear-gradient(135deg,#c9f7e8,#f8fffc)";
  wrap.style.left=`${Number(b.x_pct??25)}%`;wrap.style.top=`${Number(b.y_pct??50)}%`;wrap.classList.toggle("banner-pulse",Boolean(b.pulse));
  title.textContent=b.text||"이벤트";title.style.fontSize=`${Number(b.font_size||32)}px`;title.style.color=b.neon_color||"#35c597";title.style.textShadow=`0 0 12px ${b.neon_color||"#35c597"}55`;title.style.fontFamily=b.font_family?`'${b.font_family}', sans-serif`:"";
  text.textContent="배너를 눌러 가챠로 이동하세요.";text.style.fontFamily=title.style.fontFamily;image.innerHTML="";
  if(dots)dots.innerHTML=active.map((_,i)=>`<button class="banner-dot ${i===activeBannerIndex?"active":""}" data-banner-dot="${i}" aria-label="배너 ${i+1}"></button>`).join("");
  dots?.querySelectorAll("[data-banner-dot]").forEach((el)=>el.addEventListener("click",()=>{activeBannerIndex=Number(el.dataset.bannerDot)||0;renderV6HomeBanners();}));
  const multi=active.length>1;prev?.classList.toggle("hidden",!multi);next?.classList.toggle("hidden",!multi);
  if(multi)bannerSlideTimer=setInterval(()=>{activeBannerIndex=(activeBannerIndex+1)%active.length;renderV6HomeBanners();},5000);
}

document.getElementById("homeBannerPrev")?.addEventListener("click",(e)=>{e.stopPropagation();const n=eventBanners.filter((b)=>b.enabled).length;if(n){activeBannerIndex=(activeBannerIndex-1+n)%n;renderV6HomeBanners();}});
document.getElementById("homeBannerNext")?.addEventListener("click",(e)=>{e.stopPropagation();const n=eventBanners.filter((b)=>b.enabled).length;if(n){activeBannerIndex=(activeBannerIndex+1)%n;renderV6HomeBanners();}});
document.getElementById("homeEventBanner")?.addEventListener("click",(e)=>{if(e.target.closest("button"))return;openPage("gacha");});

function renderRhythmSongSelector(){
  const select=document.getElementById("rhythmSongSelect");if(!select)return;
  const current=select.value||saveData.gameRecords.rhythm?.selectedSong||"";
  select.innerHTML=`<option value="">기본 비트 60초</option>`+rhythmSongs.filter((s)=>s.is_public).map((s)=>`<option value="${s.id}">${escapeHTML(s.title)} · ${escapeHTML(s.artist)}</option>`).join("");
  if(rhythmSongs.some((s)=>s.id===current))select.value=current;
  select.disabled=Boolean(rhythmState.active);
}
document.getElementById("rhythmSongSelect")?.addEventListener("change",(e)=>{if(rhythmState.active)return;saveData.gameRecords.rhythm.selectedSong=e.target.value||null;saveGame();});

function getPetTypeV6(pet=saveData.pet){return petTypes.find((t)=>t.id===pet?.typeId||t.id===pet?.id)||null;}
function randomPetLineV6(type,key,fallback){const list=type?.dialogues?.[key];return Array.isArray(list)&&list.length?randomChoice(list):fallback;}
function petDialogueV6(key,fallback){return randomPetLineV6(getPetTypeV6(),key,fallback);}
function createPetFromTypeV6(type){const now=Date.now();return{id:type.id,typeId:type.id,name:type.name,exp:0,affection:0,mood:80,hunger:0,dirt:0,bornAt:now,lastCare:now,lastPlay:now,lastWalk:now,lastUpdate:now,actionAt:{},sick:false,dead:false,deathReason:null,completed:false};}
function petImageKeyV6(p,stage){if(p.dead)return"grave";const prefix=stage.name==="알"?"egg":stage.name==="아기"?"baby":stage.name==="어린이"?"child":"adult";if(p.dirt>=70)return`${prefix}_dirty`;if(p.mood<=30)return`${prefix}_sad`;if(p.mood>=75&&p.hunger<50&&p.dirt<50)return`${prefix}_happy`;return`${prefix}_base`;}
function renderPetVisualV6(p,stage){const el=document.getElementById("petVisualEmoji");if(!el)return;const type=getPetTypeV6(p),images=type?.images||{},key=petImageKeyV6(p,stage);const base=stage.name==="알"?"egg_base":stage.name==="아기"?"baby_base":stage.name==="어린이"?"child_base":"adult_base";const url=images[key]||images[base]||(p.dead?images.grave:"");if(url)el.innerHTML=`<img src="${escapeHTML(url)}" alt="${escapeHTML(type?.name||p.name||"펫")}">`;else el.textContent=p.dead?"🪦":p.dirt>=70?"🧼":p.mood<=30?"🥺":stage.emoji;}
function renderPetTypeSelection(){const grid=document.getElementById("petTypeGrid");if(!grid||saveData.pet)return;const list=petTypes.filter((p)=>p.is_public);grid.innerHTML=list.length?list.map((type)=>{const image=type.images?.egg_base;return`<div class="pet-type-card"><div class="pet-type-art">${image?`<img src="${escapeHTML(image)}" alt="${escapeHTML(type.name)}">`:"🥚"}</div><h4>${escapeHTML(type.name)}</h4><p>${escapeHTML(type.description||"")}</p><button type="button" data-pet-type-select="${type.id}">이 알 선택</button></div>`;}).join(""):`<div class="card">현재 공개된 펫 알이 없어요.</div>`;grid.querySelectorAll("[data-pet-type-select]").forEach((button)=>button.addEventListener("click",()=>{const type=petTypes.find((p)=>p.id===button.dataset.petTypeSelect);if(!type)return;saveData.pet=createPetFromTypeV6(type);saveGame();renderPet();}));}

function applyGlobalPointGrantV6(){
  const g=globalPointGrantV6;if(!g?.id||!Number.isSafeInteger(Math.floor(Number(g.amount)))||Number(g.amount)<=0)return;
  if(saveData.lastGlobalGrantId===g.id)return;
  saveData.lastGlobalGrantId=g.id;
  const amount=Math.floor(Number(g.amount));
  const next=saveData.points+amount;if(!Number.isSafeInteger(next))return;
  saveData.points=next;saveGame();updatePointDisplays();
}

document.getElementById("adminSelfPointButton")?.addEventListener("click",()=>{const amount=Math.floor(Number(document.getElementById("adminSelfPointInput")?.value)||0);if(amount>0&&addPoints(amount))alert(`${formatPoints(amount)}P를 현재 관리자 세이브에 추가했어요.`);});
document.getElementById("adminGlobalPointButton")?.addEventListener("click",async()=>{if(!isAdmin)return;const amount=Math.floor(Number(document.getElementById("adminGlobalPointInput")?.value)||0);if(!Number.isSafeInteger(amount)||amount<=0)return setMessage("adminGlobalPointMessage","1 이상의 정수를 입력해주세요.","error");if(!confirm(`전체 방문자에게 ${formatPoints(amount)}P 1회 지급 공지를 만들까요?`))return;const value={id:safeUUID(),amount,createdAt:new Date().toISOString()};const{error}=await supabaseClient.from("site_settings").upsert({key:"global_point_grant",value});if(error)return setMessage("adminGlobalPointMessage",error.message,"error");globalPointGrantV6=value;applyGlobalPointGrantV6();setMessage("adminGlobalPointMessage",`전체 지급 공지 생성 완료 · ${formatPoints(amount)}P`,`success`);});
document.getElementById("bannerMasterInput")?.addEventListener("change",async(e)=>{if(!isAdmin)return;const enabled=e.target.checked;const{error}=await supabaseClient.from("site_settings").upsert({key:"banner_master",value:{enabled}});if(error){e.target.checked=!enabled;return alert(error.message);}bannerMasterEnabledV6=enabled;renderV6HomeBanners();});

/* =========================================================
   V6 계정 정지 / 관리자 작업 수령
========================================================= */
async function v6CheckAccountAndActions(){
  if(!supabaseClient||!currentUser||!cloudReady)return;
  try{
    const statusRes=await supabaseClient.rpc("get_my_account_status");
    if(!statusRes.error&&statusRes.data?.suspended){alert(`이 계정은 이용 정지 상태입니다.${statusRes.data.reason?`\n사유: ${statusRes.data.reason}`:""}`);await supabaseClient.auth.signOut();return;}
    const actionRes=await supabaseClient.rpc("claim_admin_actions");if(actionRes.error)throw actionRes.error;
    const actions=Array.isArray(actionRes.data)?actionRes.data:[];if(!actions.length)return;
    for(const action of actions){const p=action.payload||{};if(action.action_type==="point_delta"){const amount=Math.floor(Number(p.amount)||0);const next=saveData.points+amount;if(Number.isSafeInteger(next)&&next>=0)saveData.points=next;}else if(action.action_type==="point_set"){const amount=Math.floor(Number(p.amount)||0);if(Number.isSafeInteger(amount)&&amount>=0)saveData.points=amount;}else if(action.action_type==="character_grant"){const id=String(p.character_id||"");const qty=Math.max(1,Math.min(100,Math.floor(Number(p.quantity)||1)));if(id&&characters.some((c)=>c.id===id))saveData.characters[id]=getOwnedCount(id)+qty;}else if(action.action_type==="save_reset"){saveData=deepClone(DEFAULT_SAVE);}}
    saveLocalOnly();renderEverything();await saveCloudNow("관리자 지급/변경 반영");
  }catch(error){console.warn("관리자 작업 확인 실패",error);}
}
window.addEventListener("focus",()=>{void v6CheckAccountAndActions();});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)void v6CheckAccountAndActions();});
setInterval(()=>{void v6CheckAccountAndActions();},60000);
setTimeout(()=>{void v6CheckAccountAndActions();},2500);

/* =========================================================
   V6 관리자 유저 관리
========================================================= */
async function loadAdminUsersV6(){
  if(!isAdmin||!supabaseClient)return;
  setMessage("adminUserMessage","불러오는 중...");
  const candidates=["admin_list_users_v4","admin_list_users_v3","admin_list_users_v2","admin_list_users"];
  let lastError=null,data=null,used="";
  for(const fn of candidates){
    const res=await supabaseClient.rpc(fn);
    if(!res.error){data=res.data;used=fn;lastError=null;break;}
    lastError=res.error;
  }
  if(lastError){setMessage("adminUserMessage",lastError.message,"error");return;}
  adminUsers=Array.isArray(data)?data:[];
  setMessage("adminUserMessage",`${adminUsers.length}명 불러옴 · ${used.replace("admin_list_users_", "RPC ").replace("admin_list_users","RPC 기본")}`,"success");
  renderAdminUsersV6();
}
function userTs(v){return v?new Date(v).getTime():0;}
function renderAdminUsersV6(){const list=document.getElementById("adminUserList");if(!list)return;const q=(document.getElementById("adminUserSearch")?.value||"").trim().toLowerCase(),sort=document.getElementById("adminUserSort")?.value||"created_desc";let rows=adminUsers.filter((u)=>!q||String(u.email||"").toLowerCase().includes(q)||String(u.user_id||"").toLowerCase().includes(q));rows.sort((a,b)=>sort==="created_asc"?userTs(a.created_at)-userTs(b.created_at):sort==="login_desc"?userTs(b.last_sign_in_at)-userTs(a.last_sign_in_at):sort==="points_desc"?Number(b.points||0)-Number(a.points||0):userTs(b.created_at)-userTs(a.created_at));
  document.getElementById("adminStatTotal").textContent=adminUsers.length;document.getElementById("adminStatActive").textContent=adminUsers.filter((u)=>Date.now()-userTs(u.last_sign_in_at)<=7*86400000).length;document.getElementById("adminStatSuspended").textContent=adminUsers.filter((u)=>u.suspended).length;document.getElementById("adminStatNoSave").textContent=adminUsers.filter((u)=>!u.has_save).length;
  list.innerHTML=rows.length?rows.map((u)=>`<div class="admin-user-row"><div class="admin-user-main"><strong>${escapeHTML(u.email||"이메일 없음")}</strong><small>UID ${escapeHTML(u.user_id)}</small><span class="status-chip ${u.suspended?"suspended":!u.has_save?"nosave":""}">${u.suspended?"이용 정지":!u.has_save?"세이브 없음":"정상"}</span></div><div class="admin-user-meta"><div><small>포인트</small><b>${formatPoints(u.points||0)}P</b></div><div><small>캐릭터 종류</small><b>${u.character_count||0}</b></div><div><small>대기 작업</small><b>${u.pending_actions||0}</b></div><div><small>대기 포인트</small><b>${formatPoints(u.pending_points||0)}P</b></div><div><small>펫</small><b>${escapeHTML(u.pet_name||"-")}</b></div><span class="meta-badge ${u.email_confirmed?"ok":"warn"}">${u.email_confirmed?"이메일 인증 완료":"이메일 미인증"}</span><small>가입 ${u.created_at?new Date(u.created_at).toLocaleDateString("ko-KR"):"-"}</small><small>최근 로그인 ${u.last_sign_in_at?new Date(u.last_sign_in_at).toLocaleString("ko-KR"):"-"}</small><small>마지막 클라우드 저장 ${u.last_save_at?new Date(u.last_save_at).toLocaleString("ko-KR"):"-"}</small></div><div class="admin-user-actions"><button data-user-action="pointAdd" data-uid="${u.user_id}">포인트 지급</button><button data-user-action="pointSub" data-uid="${u.user_id}">차감</button><button data-user-action="pointSet" data-uid="${u.user_id}">잔액 설정</button><button data-user-action="charGrant" data-uid="${u.user_id}">캐릭터 지급</button><button class="warn" data-user-action="reset" data-uid="${u.user_id}">세이브 초기화</button><button class="${u.suspended?"":"warn"}" data-user-action="suspend" data-uid="${u.user_id}">${u.suspended?"정지 해제":"이용 정지"}</button><button class="danger" data-user-action="delete" data-uid="${u.user_id}">계정 삭제</button></div></div>`).join(""):`<div class="card">조건에 맞는 유저가 없어요.</div>`;
  list.querySelectorAll("[data-user-action]").forEach((button)=>button.addEventListener("click",()=>handleAdminUserActionV6(button.dataset.uid,button.dataset.userAction)));
}
async function queueAdminActionV6(uid,kind,payload){const{error}=await supabaseClient.rpc("admin_queue_action",{target_user:uid,kind,data:payload});if(error)throw error;await loadAdminUsersV6();}
async function handleAdminUserActionV6(uid,action){const user=adminUsers.find((u)=>u.user_id===uid);if(!user)return;try{if(action==="pointAdd"||action==="pointSub"||action==="pointSet"){const raw=prompt(action==="pointSet"?"설정할 포인트 잔액":"포인트 수량","100");if(raw===null)return;let amount=Math.floor(Number(raw));if(!Number.isSafeInteger(amount)||amount<0)return alert("0 이상의 정수를 입력해주세요.");if(action==="pointSub")amount=-amount;await queueAdminActionV6(uid,action==="pointSet"?"point_set":"point_delta",{amount});alert("대기 작업으로 등록했어요. 유저가 사이트를 열거나 복귀하면 자동 반영됩니다.");}
    else if(action==="charGrant"){const available=characters.map((c,i)=>`${i+1}. ${c.name} [${c.rarity}${c.is_limited?"/한정":""}]`).join("\n");const pick=prompt(`지급할 캐릭터 번호\n${available}`,"1");if(pick===null)return;const char=characters[Number(pick)-1];if(!char)return alert("올바른 번호를 선택해주세요.");const q=prompt("수량 1~100","1");if(q===null)return;const qty=Math.max(1,Math.min(100,Math.floor(Number(q)||1)));await queueAdminActionV6(uid,"character_grant",{character_id:char.id,quantity:qty});alert(`${char.name} ${qty}장 지급 대기 등록 완료.`);}
    else if(action==="reset"){if(!confirm(`${user.email}의 클라우드 세이브를 초기 상태로 되돌리는 작업을 등록할까요?`))return;await queueAdminActionV6(uid,"save_reset",{});alert("세이브 초기화 대기 작업을 등록했어요.");}
    else if(action==="suspend"){const next=!user.suspended;const reason=next?(prompt("이용 정지 사유 (선택)",user.suspend_reason||"")??""):null;const{error}=await supabaseClient.rpc("admin_set_suspended",{target_user:uid,new_state:next,new_reason:reason});if(error)throw error;await loadAdminUsersV6();}
    else if(action==="delete"){const confirmText=prompt(`계정 완전 삭제입니다.\n확인을 위해 아래 이메일 또는 UID를 그대로 입력하세요.\n${user.email||uid}`);if(confirmText===null)return;if(!confirm("Auth 계정과 연결 데이터가 삭제됩니다. 정말 진행할까요?"))return;const{error}=await supabaseClient.rpc("admin_delete_user",{target_user:uid,confirm_text:confirmText});if(error)throw error;await loadAdminUsersV6();}
  }catch(error){alert(error.message||"관리 작업에 실패했어요.");}}
document.getElementById("adminRefreshUsersButton")?.addEventListener("click",()=>void loadAdminUsersV6());document.getElementById("adminUserSearch")?.addEventListener("input",renderAdminUsersV6);document.getElementById("adminUserSort")?.addEventListener("change",renderAdminUsersV6);

/* =========================================================
   V6 Storage helpers
========================================================= */
function fileExtV6(file){return (file.name.split(".").pop()||"bin").replace(/[^a-z0-9]/gi,"").toLowerCase();}
async function uploadPublicFileV6(bucket,file,prefix){if(!file)return null;const path=`${prefix}/${safeUUID()}.${fileExtV6(file)}`;const{error}=await supabaseClient.storage.from(bucket).upload(path,file,{cacheControl:"3600",upsert:false});if(error)throw error;return supabaseClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;}
async function deleteStorageUrlV6(bucket,url){if(!url)return;try{const marker=`/${bucket}/`;const idx=url.indexOf(marker);if(idx<0)return;const path=decodeURIComponent(url.slice(idx+marker.length));await supabaseClient.storage.from(bucket).remove([path]);}catch{}}

/* =========================================================
   V6 배너 관리자
========================================================= */
let bannerPreviewObjectUrlV8=null;
let bannerPreviewFontUrlV8=null;
let bannerPreviewFontNameV8="";

function updateBannerEditorPreviewV8(){
  const preview=document.getElementById("bannerEditorPreview"),text=document.getElementById("bannerEditorPreviewText");
  if(!preview||!text)return;
  const x=Math.max(0,Math.min(100,Number(document.getElementById("bannerXInput")?.value)||0));
  const y=Math.max(0,Math.min(100,Number(document.getElementById("bannerYInput")?.value)||0));
  const size=Math.max(16,Math.min(80,Number(document.getElementById("bannerFontSizeInput")?.value)||32));
  const color=document.getElementById("bannerColorInput")?.value||"#35c597";
  text.textContent=document.getElementById("bannerTextInput")?.value.trim()||"이벤트 문구";
  text.style.left=`${x}%`;text.style.top=`${y}%`;text.style.fontSize=`${size}px`;text.style.color=color;text.style.textShadow=`0 0 12px ${color}66`;
  text.style.fontFamily=bannerPreviewFontNameV8?`'${bannerPreviewFontNameV8}', sans-serif`:"";
  const img=document.getElementById("bannerImageInput")?.files?.[0];
  const editId=document.getElementById("bannerEditId")?.value;
  const existing=eventBanners.find((b)=>b.id===editId);
  if(img){
    if(bannerPreviewObjectUrlV8)URL.revokeObjectURL(bannerPreviewObjectUrlV8);
    bannerPreviewObjectUrlV8=URL.createObjectURL(img);
    preview.style.backgroundImage=`url('${bannerPreviewObjectUrlV8}')`;
  }else preview.style.backgroundImage=existing?.image_url?`url('${existing.image_url}')`:"linear-gradient(135deg,#d8fff2,#ffffff)";
}

async function loadBannerPreviewFontV8(file){
  bannerPreviewFontNameV8="";
  if(!file){updateBannerEditorPreviewV8();return;}
  try{
    if(bannerPreviewFontUrlV8)URL.revokeObjectURL(bannerPreviewFontUrlV8);
    bannerPreviewFontUrlV8=URL.createObjectURL(file);
    bannerPreviewFontNameV8=`MintPreview_${safeUUID().replaceAll("-","")}`;
    const face=new FontFace(bannerPreviewFontNameV8,`url(${bannerPreviewFontUrlV8})`);
    await face.load();document.fonts.add(face);updateBannerEditorPreviewV8();
  }catch(error){console.warn("폰트 미리보기 실패",error);bannerPreviewFontNameV8="";updateBannerEditorPreviewV8();}
}

["bannerTextInput","bannerFontSizeInput","bannerXInput","bannerYInput","bannerColorInput"].forEach((id)=>document.getElementById(id)?.addEventListener("input",updateBannerEditorPreviewV8));
document.getElementById("bannerImageInput")?.addEventListener("change",updateBannerEditorPreviewV8);
document.getElementById("bannerFontInput")?.addEventListener("change",(e)=>void loadBannerPreviewFontV8(e.target.files?.[0]||null));
document.getElementById("bannerEditorPreview")?.addEventListener("click",(e)=>{
  const rect=e.currentTarget.getBoundingClientRect();
  const x=Math.round(((e.clientX-rect.left)/rect.width)*100),y=Math.round(((e.clientY-rect.top)/rect.height)*100);
  document.getElementById("bannerXInput").value=Math.max(0,Math.min(100,x));
  document.getElementById("bannerYInput").value=Math.max(0,Math.min(100,y));
  updateBannerEditorPreviewV8();
});

function resetBannerFormV6(){document.getElementById("bannerForm")?.reset();document.getElementById("bannerEditId").value="";document.getElementById("bannerFontSizeInput").value=32;document.getElementById("bannerXInput").value=25;document.getElementById("bannerYInput").value=50;document.getElementById("bannerColorInput").value="#35c597";document.getElementById("bannerEnabledInput").checked=true;document.getElementById("cancelBannerEditButton")?.classList.add("hidden");setMessage("bannerFormMessage","");bannerPreviewFontNameV8="";updateBannerEditorPreviewV8();}
function renderAdminBannerListV6(){const el=document.getElementById("adminBannerList");if(!el||!isAdmin)return;el.innerHTML=eventBanners.length?eventBanners.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map((b)=>`<div class="ops-list-row"><div class="ops-list-thumb">${b.image_url?`<img src="${escapeHTML(b.image_url)}">`:"BANNER"}</div><div class="ops-list-info"><strong>${escapeHTML(b.text||"문구 없음")}</strong><small>${b.enabled?"표시 중":"숨김"} · ${b.font_size}px · 위치 ${b.x_pct},${b.y_pct} · 순서 ${b.sort_order}</small></div><div class="ops-list-actions"><button data-banner-edit="${b.id}">수정</button><button class="danger" data-banner-delete="${b.id}">삭제</button></div></div>`).join(""):`<div class="card">등록 배너가 없어요.</div>`;el.querySelectorAll("[data-banner-edit]").forEach((button)=>button.addEventListener("click",()=>editBannerV6(button.dataset.bannerEdit)));el.querySelectorAll("[data-banner-delete]").forEach((button)=>button.addEventListener("click",()=>void deleteBannerV6(button.dataset.bannerDelete)));}
function editBannerV6(id){const b=eventBanners.find((x)=>x.id===id);if(!b)return;document.getElementById("bannerEditId").value=b.id;document.getElementById("bannerTextInput").value=b.text||"";document.getElementById("bannerFontSizeInput").value=b.font_size||32;document.getElementById("bannerXInput").value=b.x_pct??25;document.getElementById("bannerYInput").value=b.y_pct??50;document.getElementById("bannerColorInput").value=b.neon_color||"#35c597";document.getElementById("bannerSortInput").value=b.sort_order||0;document.getElementById("bannerPulseInput").checked=Boolean(b.pulse);document.getElementById("bannerEnabledInput").checked=Boolean(b.enabled);document.getElementById("cancelBannerEditButton")?.classList.remove("hidden");updateBannerEditorPreviewV8();document.getElementById("bannerForm")?.scrollIntoView({behavior:"smooth",block:"center"});}
async function deleteBannerV6(id){const b=eventBanners.find((x)=>x.id===id);if(!b||!confirm("이 배너를 삭제할까요?"))return;const{error}=await supabaseClient.from("event_banners").delete().eq("id",id);if(error)return alert(error.message);await Promise.all([deleteStorageUrlV6("banner-assets",b.image_url),deleteStorageUrlV6("banner-assets",b.font_url)]);await loadV6PublicData();renderAdminBannerListV6();}
document.getElementById("bannerForm")?.addEventListener("submit",async(e)=>{e.preventDefault();if(!isAdmin)return;const id=document.getElementById("bannerEditId").value,existing=eventBanners.find((b)=>b.id===id);const imageFile=document.getElementById("bannerImageInput").files?.[0],fontFile=document.getElementById("bannerFontInput").files?.[0];if(imageFile&&imageFile.size>10*1024*1024)return setMessage("bannerFormMessage","이미지는 10MB 이하만 가능해요.","error");if(fontFile&&fontFile.size>10*1024*1024)return setMessage("bannerFormMessage","폰트는 10MB 이하만 가능해요.","error");try{setMessage("bannerFormMessage","업로드/저장 중...");const imageUrl=imageFile?await uploadPublicFileV6("banner-assets",imageFile,"images"):existing?.image_url||null;const fontUrl=fontFile?await uploadPublicFileV6("banner-assets",fontFile,"fonts"):existing?.font_url||null;const fontFamily=fontFile?`MintBanner_${safeUUID().replaceAll("-","")}`:existing?.font_family||null;const payload={text:document.getElementById("bannerTextInput").value.trim(),font_size:Number(document.getElementById("bannerFontSizeInput").value)||32,x_pct:Number(document.getElementById("bannerXInput").value)||0,y_pct:Number(document.getElementById("bannerYInput").value)||0,neon_color:document.getElementById("bannerColorInput").value,pulse:document.getElementById("bannerPulseInput").checked,enabled:document.getElementById("bannerEnabledInput").checked,sort_order:Math.floor(Number(document.getElementById("bannerSortInput").value)||0),image_url:imageUrl,font_url:fontUrl,font_family:fontFamily};const res=id?await supabaseClient.from("event_banners").update(payload).eq("id",id):await supabaseClient.from("event_banners").insert(payload);if(res.error)throw res.error;if(existing&&imageFile)await deleteStorageUrlV6("banner-assets",existing.image_url);if(existing&&fontFile)await deleteStorageUrlV6("banner-assets",existing.font_url);resetBannerFormV6();await loadV6PublicData();renderAdminBannerListV6();setMessage("bannerFormMessage","저장 완료!","success");}catch(error){setMessage("bannerFormMessage",error.message,"error");}});document.getElementById("resetBannerFormButton")?.addEventListener("click",resetBannerFormV6);document.getElementById("cancelBannerEditButton")?.addEventListener("click",resetBannerFormV6);

/* =========================================================
   V6 리듬 음원 자동 분석 / 관리자
========================================================= */
async function analyzeRhythmAudioV6(file){const buf=await file.arrayBuffer();const ac=new (window.AudioContext||window.webkitAudioContext)();let audio;try{audio=await ac.decodeAudioData(buf.slice(0));}finally{try{await ac.close();}catch{}}const duration=audio.duration;if(duration<5||duration>600)throw new Error("음원 길이는 5초 이상 10분 이하여야 해요.");const ch=audio.getChannelData(0),sr=audio.sampleRate,windowSize=Math.max(256,Math.floor(sr*.025)),energies=[];for(let start=0;start<ch.length;start+=windowSize){let sum=0,end=Math.min(ch.length,start+windowSize);for(let i=start;i<end;i+=4)sum+=Math.abs(ch[i]);energies.push(sum/Math.max(1,Math.ceil((end-start)/4)));}const avg=energies.reduce((a,b)=>a+b,0)/Math.max(1,energies.length),peaks=[];let lastTime=-1;for(let i=1;i<energies.length-1;i++){const t=i*windowSize/sr;if(t<1.2||t>duration-.4)continue;const e=energies[i];if(e>avg*1.28&&e>=energies[i-1]&&e>=energies[i+1]&&t-lastTime>.12){peaks.push({t,e});lastTime=t;}}if(!peaks.length){for(let t=1.5;t<duration-.5;t+=.5)peaks.push({t,e:1});}const pick=(spacing,boost=false)=>{const notes=[];let last=-99;peaks.forEach((p,i)=>{if(p.t-last<spacing)return;notes.push({time:Math.round(p.t*1000),lane:(i+Math.floor(p.e*1000))%4});last=p.t;if(boost&&notes.length<2499&&i>0&&Math.random()<.25){const extra=p.t+spacing*.45;if(extra<duration-.3)notes.push({time:Math.round(extra*1000),lane:(i+2)%4});}});return notes.slice(0,2500).sort((a,b)=>a.time-b.time);};return{duration,charts:{EASY:pick(.75),NORMAL:pick(.38),HARD:pick(.26),SPECIAL:pick(.18,true)}};}
function renderAdminRhythmSongsV6(){const el=document.getElementById("adminRhythmSongList");if(!el||!isAdmin)return;el.innerHTML=rhythmSongs.length?rhythmSongs.map((s)=>`<div class="ops-list-row"><div class="ops-list-thumb">🎵</div><div class="ops-list-info"><strong>${escapeHTML(s.title)} · ${escapeHTML(s.artist)}</strong><small>${Number(s.duration||0).toFixed(1)}초 · E ${s.charts?.EASY?.length||0} / N ${s.charts?.NORMAL?.length||0} / H ${s.charts?.HARD?.length||0} / S ${s.charts?.SPECIAL?.length||0}</small></div><div class="ops-list-actions"><button class="danger" data-song-delete="${s.id}">삭제</button></div></div>`).join(""):`<div class="card">등록 노래가 없어요.</div>`;el.querySelectorAll("[data-song-delete]").forEach((b)=>b.addEventListener("click",()=>void deleteRhythmSongV6(b.dataset.songDelete)));}
async function deleteRhythmSongV6(id){const s=rhythmSongs.find((x)=>x.id===id);if(!s||!confirm(`${s.title}을 삭제할까요?`))return;const{error}=await supabaseClient.from("rhythm_songs").delete().eq("id",id);if(error)return alert(error.message);await deleteStorageUrlV6("rhythm-audio",s.audio_url);await loadV6PublicData();renderAdminRhythmSongsV6();}
document.getElementById("rhythmSongForm")?.addEventListener("submit",async(e)=>{e.preventDefault();if(!isAdmin)return;const file=document.getElementById("rhythmSongFileInput").files?.[0];if(!file)return;if(file.size>20*1024*1024)return setMessage("rhythmSongMessage","20MB 이하 파일만 가능해요.","error");try{setMessage("rhythmSongMessage","음원을 분석하고 있어요. 파일이 길면 잠시 걸릴 수 있어요...");const analyzed=await analyzeRhythmAudioV6(file);setMessage("rhythmSongMessage","업로드 중...");const audioUrl=await uploadPublicFileV6("rhythm-audio",file,"songs");const{error}=await supabaseClient.from("rhythm_songs").insert({title:document.getElementById("rhythmSongTitleInput").value.trim(),artist:document.getElementById("rhythmSongArtistInput").value.trim(),audio_url:audioUrl,duration:analyzed.duration,charts:analyzed.charts,is_public:true});if(error){await deleteStorageUrlV6("rhythm-audio",audioUrl);throw error;}e.currentTarget.reset();await loadV6PublicData();renderAdminRhythmSongsV6();setMessage("rhythmSongMessage","노래 등록과 4난이도 자동 채보 생성 완료!","success");}catch(error){setMessage("rhythmSongMessage",error.message,"error");}});

/* =========================================================
   V6 펫 타입 관리자
========================================================= */
const PET_DIALOGUE_KEYS=["feed","wash","play","walk","gift","hatch","grow","hunger","dirty","both","sick","want_play","want_walk","neglected","sad","recover","death","touch_head","touch_face","touch_body"];
function commitPetDialogueDraftV6(){const key=document.getElementById("petDialogueTypeSelect")?.dataset.currentKey||document.getElementById("petDialogueTypeSelect")?.value;if(!key)return;petDialogueDrafts[key]=(document.getElementById("petDialogueTextarea")?.value||"").split("\n").map((x)=>x.trim()).filter(Boolean);}
function loadPetDialogueTextareaV6(){const select=document.getElementById("petDialogueTypeSelect"),area=document.getElementById("petDialogueTextarea");if(!select||!area)return;select.dataset.currentKey=select.value;area.value=(petDialogueDrafts[select.value]||[]).join("\n");}
document.getElementById("petDialogueTypeSelect")?.addEventListener("change",(e)=>{const prev=e.currentTarget.dataset.currentKey;if(prev)petDialogueDrafts[prev]=(document.getElementById("petDialogueTextarea")?.value||"").split("\n").map((x)=>x.trim()).filter(Boolean);loadPetDialogueTextareaV6();});
function renderPetGiftItemAdminV7(){
  const select=document.getElementById("petGiftItemCharacterSelect");
  const area=document.getElementById("petGiftItemDialogueTextarea");
  if(!select||!area)return;
  const current=select.value;
  const rChars=characters.filter((c)=>c.rarity==="R").sort((a,b)=>a.name.localeCompare(b.name,"ko"));
  select.innerHTML=`<option value="">R 캐릭터 선택</option>`+rChars.map((c)=>`<option value="${c.id}">${escapeHTML(c.name)}</option>`).join("");
  if(rChars.some((c)=>c.id===current))select.value=current;
  area.value=select.value?(petGiftItemDialogueDrafts[select.value]||[]).join("\n"):"";
}

function savePetGiftItemDraftV7(){
  const select=document.getElementById("petGiftItemCharacterSelect");
  const area=document.getElementById("petGiftItemDialogueTextarea");
  const status=document.getElementById("petGiftItemDialogueStatus");
  if(!select?.value){if(status)status.textContent="R 캐릭터를 먼저 선택하세요.";return;}
  petGiftItemDialogueDrafts[select.value]=(area?.value||"").split("\n").map((x)=>x.trim()).filter(Boolean);
  if(status)status.textContent="임시 저장됨 · 아래 펫 저장 버튼을 눌러야 서버에 반영돼요.";
}

document.getElementById("petGiftItemCharacterSelect")?.addEventListener("change",(e)=>{
  const area=document.getElementById("petGiftItemDialogueTextarea");
  if(area)area.value=e.target.value?(petGiftItemDialogueDrafts[e.target.value]||[]).join("\n"):"";
});
document.getElementById("savePetGiftItemDialogueButton")?.addEventListener("click",savePetGiftItemDraftV7);
document.getElementById("clearPetGiftItemDialogueButton")?.addEventListener("click",()=>{
  const select=document.getElementById("petGiftItemCharacterSelect"),area=document.getElementById("petGiftItemDialogueTextarea"),status=document.getElementById("petGiftItemDialogueStatus");
  if(!select?.value)return;
  petGiftItemDialogueDrafts[select.value]=[];
  if(area)area.value="";
  if(status)status.textContent="이 카드의 전용 대사를 비웠어요. 펫 저장을 눌러 반영하세요.";
});

function resetPetTypeFormV6(){document.getElementById("petTypeForm")?.reset();document.getElementById("petTypeEditId").value="";document.getElementById("petTypePublicInput").checked=true;petDialogueDrafts={};petGiftItemDialogueDrafts={};loadPetDialogueTextareaV6();renderPetGiftItemAdminV7();document.getElementById("cancelPetTypeEditButton")?.classList.add("hidden");setMessage("petTypeMessage","");}
function renderAdminPetTypesV6(){const el=document.getElementById("adminPetTypeList");if(!el||!isAdmin)return;el.innerHTML=petTypes.length?petTypes.map((p)=>`<div class="ops-list-row"><div class="ops-list-thumb">${p.images?.egg_base?`<img src="${escapeHTML(p.images.egg_base)}">`:"🥚"}</div><div class="ops-list-info"><strong>${escapeHTML(p.name)}</strong><small>${p.is_public?"공개":"비공개"} · 순서 ${p.sort_order||0}</small></div><div class="ops-list-actions"><button data-pet-edit="${p.id}">수정</button><button class="danger" data-pet-delete="${p.id}">삭제</button></div></div>`).join(""):`<div class="card">등록 펫이 없어요.</div>`;el.querySelectorAll("[data-pet-edit]").forEach((b)=>b.addEventListener("click",()=>editPetTypeV6(b.dataset.petEdit)));el.querySelectorAll("[data-pet-delete]").forEach((b)=>b.addEventListener("click",()=>void deletePetTypeV6(b.dataset.petDelete)));}
function editPetTypeV6(id){const p=petTypes.find((x)=>x.id===id);if(!p)return;document.getElementById("petTypeEditId").value=p.id;document.getElementById("petTypeNameInput").value=p.name||"";document.getElementById("petTypeDescriptionInput").value=p.description||"";document.getElementById("petTypeSortInput").value=p.sort_order||0;document.getElementById("petTypePublicInput").checked=Boolean(p.is_public);petDialogueDrafts=deepClone(p.dialogues||{});petGiftItemDialogueDrafts=deepClone(p.dialogues?.gift_items||{});delete petDialogueDrafts.gift_items;loadPetDialogueTextareaV6();renderPetGiftItemAdminV7();document.getElementById("cancelPetTypeEditButton")?.classList.remove("hidden");document.getElementById("petTypeForm")?.scrollIntoView({behavior:"smooth",block:"center"});}
async function deletePetTypeV6(id){const p=petTypes.find((x)=>x.id===id);if(!p||!confirm("이 펫 종류를 삭제할까요? 기존 사용자의 해당 펫이 정상 표시되지 않을 수 있어요."))return;const{error}=await supabaseClient.from("pet_types").delete().eq("id",id);if(error)return alert(error.message);await Promise.all(Object.values(p.images||{}).map((url)=>deleteStorageUrlV6("pet-assets",url)));await loadV6PublicData();renderAdminPetTypesV6();}
function setupPetImageDropsV8(){
  document.querySelectorAll("[data-pet-image-key]").forEach((input)=>{
    const label=input.closest("label");if(!label)return;
    label.classList.add("pet-image-drop");
    let preview=label.querySelector(".pet-image-mini-preview");
    if(!preview){preview=document.createElement("div");preview.className="pet-image-mini-preview";preview.textContent="미리보기";label.appendChild(preview);}
    const refresh=()=>{const file=input.files?.[0];if(!file){preview.textContent="미리보기";return;}const url=URL.createObjectURL(file);preview.innerHTML=`<img src="${url}" alt="미리보기">`;};
    input.addEventListener("change",refresh);
    ["dragenter","dragover"].forEach((name)=>label.addEventListener(name,(e)=>{e.preventDefault();label.classList.add("drag-over");}));
    ["dragleave","drop"].forEach((name)=>label.addEventListener(name,(e)=>{e.preventDefault();label.classList.remove("drag-over");}));
    label.addEventListener("drop",(e)=>{const file=e.dataTransfer?.files?.[0];if(!file)return;if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type))return alert("PNG/JPG/WEBP/GIF 이미지만 가능해요.");const dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event("change"));});
  });
}
setupPetImageDropsV8();

document.getElementById("petTypeForm")?.addEventListener("submit",async(e)=>{e.preventDefault();if(!isAdmin)return;commitPetDialogueDraftV6();const id=document.getElementById("petTypeEditId").value,existing=petTypes.find((p)=>p.id===id);try{setMessage("petTypeMessage","이미지 업로드/저장 중...");const images={...(existing?.images||{})};for(const input of document.querySelectorAll("[data-pet-image-key]")){const file=input.files?.[0];if(!file)continue;if(file.size>10*1024*1024)throw new Error("펫 이미지는 각 10MB 이하만 가능해요.");const key=input.dataset.petImageKey,newUrl=await uploadPublicFileV6("pet-assets",file,`pets/${id||"new"}`);if(images[key])await deleteStorageUrlV6("pet-assets",images[key]);images[key]=newUrl;}if(!existing&&(!images.egg_base||!images.baby_base||!images.child_base||!images.adult_base))throw new Error("새 펫은 알/아기/어린이/성인 기본 이미지 4장이 필수예요.");const payload={name:document.getElementById("petTypeNameInput").value.trim(),description:document.getElementById("petTypeDescriptionInput").value.trim(),is_public:document.getElementById("petTypePublicInput").checked,sort_order:Math.floor(Number(document.getElementById("petTypeSortInput").value)||0),images,dialogues:{...petDialogueDrafts,gift_items:petGiftItemDialogueDrafts}};const res=id?await supabaseClient.from("pet_types").update(payload).eq("id",id):await supabaseClient.from("pet_types").insert(payload);if(res.error)throw res.error;resetPetTypeFormV6();await loadV6PublicData();renderAdminPetTypesV6();setMessage("petTypeMessage","펫 저장 완료!","success");}catch(error){setMessage("petTypeMessage",error.message,"error");}});document.getElementById("resetPetTypeFormButton")?.addEventListener("click",resetPetTypeFormV6);document.getElementById("cancelPetTypeEditButton")?.addEventListener("click",resetPetTypeFormV6);

function renderV6AdminPanels(){if(!isAdmin)return;renderPetGiftItemAdminV7();const bm=document.getElementById("bannerMasterInput");if(bm)bm.checked=bannerMasterEnabledV6;renderAdminBannerListV6();renderAdminRhythmSongsV6();renderAdminPetTypesV6();if(!adminUsers.length)void loadAdminUsersV6();}


/* =========================================================
   V5 시작 보조
========================================================= */

function recoverV5PendingGames(){
  if(saveData.derbyPending){
    if(Date.now()>=saveData.derbyPending.finishAt)settleDerby();
    else setTimeout(()=>renderDerby(),100);
  }
  if(saveData.blackjackPending?.finished){
    saveData.blackjackPending=null;
    saveGame();
  }else if(saveData.blackjackPending){
    renderBlackjack();
  }
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
    loadV6PublicData(),
    initAuth()
  ]);

  recoverV5PendingGames();
  renderEverything();
}

void boot();
