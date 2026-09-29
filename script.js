const SUPABASE_URL = "https://narkracwfchrlixvufpp.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_nHK7pXiqP5a3_GrMRw17qw_L0zdL70n";

const SAVE_KEY = "mintGachaSave_v1";
const LOCAL_BACKUP_KEY = "mintGachaLocalBackupBeforeCloud_v1";

const DEFAULT_SAVE = {
  version: 1,
  points: 3000,

  attendance: {
    lastClaimDate: null,
    streak: 0,
    maxSeenDate: null
  },

  characters: {},
  normalPity: 0,
  limitedPity: 0,
  limitedEventId: null,

  homeCharacters: [],
  homeIllustrationMode: {},
  ssrLimitBreak: {},

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


function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}


function mergeSave(defaultValue, loadedValue) {
  if (
    defaultValue === null ||
    typeof defaultValue !== "object" ||
    Array.isArray(defaultValue)
  ) {
    return loadedValue === undefined
      ? deepClone(defaultValue)
      : loadedValue;
  }

  const result = deepClone(defaultValue);

  if (
    loadedValue === null ||
    typeof loadedValue !== "object" ||
    Array.isArray(loadedValue)
  ) {
    return result;
  }

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

    if (!raw) {
      return deepClone(DEFAULT_SAVE);
    }

    const parsed = JSON.parse(raw);

    return mergeSave(DEFAULT_SAVE, parsed);
  } catch (error) {
    console.error("세이브 불러오기 실패:", error);
    return deepClone(DEFAULT_SAVE);
  }
}


let saveData = loadSave();

let supabaseClient = null;
let currentUser = null;
let cloudReady = false;
let cloudSaveTimer = null;
let safeSaveInterval = null;
let linkedUserId = null;
let authMode = "login";
let cloudBusy = false;


function setCloudUi(state, title, description) {
  const cloudStatusCard =
    document.getElementById("cloudStatusCard");

  const cloudStatusTitle =
    document.getElementById("cloudStatusTitle");

  const cloudStatusDescription =
    document.getElementById("cloudStatusDescription");

  const headerSyncStatus =
    document.getElementById("headerSyncStatus");

  const headerSyncText =
    document.getElementById("headerSyncText");

  if (cloudStatusCard) {
    cloudStatusCard.classList.remove(
      "connected",
      "saving",
      "error"
    );

    if (state) {
      cloudStatusCard.classList.add(state);
    }
  }

  if (cloudStatusTitle) {
    cloudStatusTitle.textContent = title;
  }

  if (cloudStatusDescription) {
    cloudStatusDescription.textContent =
      description;
  }

  if (headerSyncStatus) {
    headerSyncStatus.classList.remove(
      "connected",
      "saving",
      "error"
    );

    if (state) {
      headerSyncStatus.classList.add(state);
    }
  }

  if (headerSyncText) {
    headerSyncText.textContent = title;
  }
}


function renderAccountUi() {
  const loggedIn = Boolean(currentUser);

  const loginStatusBox =
    document.getElementById("loginStatusBox");

  const loginStatusText =
    document.getElementById("loginStatusText");

  const accountTitle =
    document.getElementById("accountTitle");

  const accountDescription =
    document.getElementById("accountDescription");

  const accountEmail =
    document.getElementById("accountEmail");

  const cloudBadge =
    document.getElementById("cloudBadge");

  const guestButtons =
    document.getElementById("guestAccountButtons");

  const loggedInButtons =
    document.getElementById("loggedInAccountButtons");


  if (loginStatusBox) {
    loginStatusBox.classList.toggle(
      "logged-in",
      loggedIn
    );
  }

  if (!loggedIn) {
    if (loginStatusText) {
      loginStatusText.textContent =
        "게스트 이용 중";
    }

    if (accountTitle) {
      accountTitle.textContent =
        "현재 게스트로 이용 중이에요.";
    }

    if (accountDescription) {
      accountDescription.textContent =
        "로그인하면 다른 기기에서도 내 데이터를 불러올 수 있어요.";
    }

    if (accountEmail) {
      accountEmail.textContent = "";
    }

    if (cloudBadge) {
      cloudBadge.textContent = "로컬 저장";
      cloudBadge.classList.remove("connected");
    }

    if (guestButtons) {
      guestButtons.classList.remove("hidden");
    }

    if (loggedInButtons) {
      loggedInButtons.classList.add("hidden");
    }

    setCloudUi(
      "",
      "게스트 · 로컬 저장",
      "현재 데이터는 이 브라우저의 localStorage에 저장돼요."
    );

    return;
  }


  if (loginStatusText) {
    loginStatusText.textContent =
      "계정 로그인 중";
  }

  if (accountTitle) {
    accountTitle.textContent =
      "계정과 연결되어 있어요.";
  }

  if (accountDescription) {
    accountDescription.textContent =
      "변경된 데이터는 자동으로 클라우드에 저장됩니다.";
  }

  if (accountEmail) {
    accountEmail.textContent =
      currentUser.email || "";
  }

  if (cloudBadge) {
    cloudBadge.textContent =
      cloudReady ? "클라우드 연결" : "연결 중";

    cloudBadge.classList.toggle(
      "connected",
      cloudReady
    );
  }

  if (guestButtons) {
    guestButtons.classList.add("hidden");
  }

  if (loggedInButtons) {
    loggedInButtons.classList.remove("hidden");
  }

  if (cloudReady) {
    setCloudUi(
      "connected",
      "클라우드 연결됨",
      "이 계정의 세이브를 불러왔고 자동 저장이 켜져 있어요."
    );
  } else {
    setCloudUi(
      "saving",
      "클라우드 연결 중",
      "계정 세이브를 확인하고 있어요."
    );
  }
}


function saveLocalOnly() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify(saveData)
    );

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
  return Math.max(0, Math.floor(Number(value) || 0))
    .toLocaleString("ko-KR");
}


function updatePointDisplay() {
  const pointDisplay =
    document.getElementById("pointDisplay");

  if (!pointDisplay) return;

  pointDisplay.textContent =
    `보유 포인트: ${formatPoints(saveData.points)}P`;
}


function renderAllGameUi() {
  updatePointDisplay();
  renderAttendance();
}


function addPoints(amount) {
  const safeAmount =
    Math.floor(Number(amount));

  if (!Number.isSafeInteger(safeAmount)) {
    return false;
  }

  const nextPoints =
    saveData.points + safeAmount;

  if (
    !Number.isSafeInteger(nextPoints) ||
    nextPoints < 0
  ) {
    return false;
  }

  saveData.points = nextPoints;

  saveGame();
  updatePointDisplay();

  return true;
}


/* ==============================
   페이지 이동
============================== */

const navButtons =
  document.querySelectorAll(
    "nav button[data-page]"
  );

const pages =
  document.querySelectorAll(".page");


function openPage(pageName) {
  pages.forEach((page) => {
    page.style.display = "none";
    page.classList.remove("active");
  });

  navButtons.forEach((button) => {
    button.classList.remove("active");
  });

  const targetPage =
    document.getElementById(pageName);

  if (targetPage) {
    targetPage.style.display = "block";
    targetPage.classList.add("active");
  }

  const targetButton =
    document.querySelector(
      `nav button[data-page="${pageName}"]`
    );

  if (targetButton) {
    targetButton.classList.add("active");
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}


navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});


const goGachaButton =
  document.getElementById("goGachaButton");

if (goGachaButton) {
  goGachaButton.addEventListener(
    "click",
    () => {
      openPage("gacha");
    }
  );
}


/* ==============================
   날짜 / 출석
============================== */

const ATTENDANCE_REWARDS = [
  400,
  600,
  800,
  1000,
  1300,
  1600,
  2500
];


function localDateString(date = new Date()) {
  const year = date.getFullYear();

  const month =
    String(date.getMonth() + 1)
      .padStart(2, "0");

  const day =
    String(date.getDate())
      .padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function dateFromLocalString(value) {
  const [year, month, day] =
    value.split("-").map(Number);

  return new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0,
    0
  );
}


function dayDifference(older, newer) {
  const olderDate =
    dateFromLocalString(older);

  const newerDate =
    dateFromLocalString(newer);

  const milliseconds =
    newerDate.getTime() -
    olderDate.getTime();

  return Math.round(
    milliseconds / 86400000
  );
}


function isAttendanceDateLocked() {
  const today =
    localDateString();

  const maxSeen =
    saveData.attendance.maxSeenDate;

  return Boolean(
    maxSeen &&
    today < maxSeen
  );
}


function updateMaxSeenDate() {
  const today =
    localDateString();

  const current =
    saveData.attendance.maxSeenDate;

  if (!current || today > current) {
    saveData.attendance.maxSeenDate =
      today;

    saveGame();
  }
}


function getNextAttendanceDay() {
  const attendance =
    saveData.attendance;

  const today =
    localDateString();

  if (!attendance.lastClaimDate) {
    return 1;
  }

  if (
    attendance.lastClaimDate === today
  ) {
    return attendance.streak || 1;
  }

  const diff =
    dayDifference(
      attendance.lastClaimDate,
      today
    );

  if (diff === 1) {
    return attendance.streak >= 7
      ? 1
      : attendance.streak + 1;
  }

  return 1;
}


function renderAttendance() {
  const attendance =
    saveData.attendance;

  const today =
    localDateString();

  const status =
    document.getElementById(
      "attendanceStatus"
    );

  const button =
    document.getElementById(
      "attendanceButton"
    );

  const message =
    document.getElementById(
      "attendanceMessage"
    );

  const dayCards =
    document.querySelectorAll(
      ".attendance-day"
    );

  const locked =
    isAttendanceDateLocked();

  const alreadyClaimed =
    attendance.lastClaimDate === today;

  const nextDay =
    getNextAttendanceDay();


  dayCards.forEach((card) => {
    card.classList.remove(
      "today",
      "claimed"
    );

    const day =
      Number(card.dataset.day);

    if (alreadyClaimed) {
      if (day <= attendance.streak) {
        card.classList.add("claimed");
      }

      if (day === attendance.streak) {
        card.classList.add("today");
      }
    } else {
      if (
        attendance.lastClaimDate &&
        day < nextDay &&
        nextDay !== 1
      ) {
        card.classList.add("claimed");
      }

      if (day === nextDay) {
        card.classList.add("today");
      }
    }
  });


  if (status) {
    status.textContent =
      `${alreadyClaimed
        ? attendance.streak
        : nextDay}일차`;
  }


  if (!button || !message) {
    return;
  }


  if (locked) {
    button.disabled = true;
    button.textContent =
      "출석 잠금";

    message.textContent =
      "기기 날짜가 이전 기록보다 과거라 출석이 잠겼어요.";

    return;
  }


  if (alreadyClaimed) {
    button.disabled = true;
    button.textContent =
      "오늘 출석 완료";

    message.textContent =
      `오늘 ${formatPoints(
        ATTENDANCE_REWARDS[
          Math.max(
            0,
            attendance.streak - 1
          )
        ]
      )}P를 이미 받았어요.`;

    return;
  }


  button.disabled = false;
  button.textContent =
    "오늘 출석하기";

  message.textContent =
    `${nextDay}일차 보상 ${formatPoints(
      ATTENDANCE_REWARDS[nextDay - 1]
    )}P`;
}


function claimAttendance() {
  if (isAttendanceDateLocked()) {
    renderAttendance();
    return;
  }

  const today =
    localDateString();

  const attendance =
    saveData.attendance;

  if (
    attendance.lastClaimDate === today
  ) {
    renderAttendance();
    return;
  }

  const nextDay =
    getNextAttendanceDay();

  const reward =
    ATTENDANCE_REWARDS[nextDay - 1];

  attendance.streak = nextDay;
  attendance.lastClaimDate = today;

  if (
    !attendance.maxSeenDate ||
    today > attendance.maxSeenDate
  ) {
    attendance.maxSeenDate = today;
  }

  if (!addPoints(reward)) {
    return;
  }

  saveGame();
  renderAttendance();
}


const attendanceButton =
  document.getElementById(
    "attendanceButton"
  );

if (attendanceButton) {
  attendanceButton.addEventListener(
    "click",
    claimAttendance
  );
}


/* ==============================
   로그인 / 회원가입 팝업
============================== */

const authModal =
  document.getElementById("authModal");

const authForm =
  document.getElementById("authForm");

const authModalTitle =
  document.getElementById(
    "authModalTitle"
  );

const authModalDescription =
  document.getElementById(
    "authModalDescription"
  );

const authEmailInput =
  document.getElementById(
    "authEmailInput"
  );

const authPasswordInput =
  document.getElementById(
    "authPasswordInput"
  );

const authPasswordConfirmField =
  document.getElementById(
    "authPasswordConfirmField"
  );

const authPasswordConfirmInput =
  document.getElementById(
    "authPasswordConfirmInput"
  );

const authSubmitButton =
  document.getElementById(
    "authSubmitButton"
  );

const authSwitchButton =
  document.getElementById(
    "authSwitchButton"
  );

const authMessage =
  document.getElementById("authMessage");


function setAuthMessage(
  message = "",
  state = ""
) {
  if (!authMessage) return;

  authMessage.textContent = message;

  authMessage.classList.remove(
    "error",
    "success"
  );

  if (state) {
    authMessage.classList.add(state);
  }
}


function setAuthMode(mode) {
  authMode =
    mode === "signup"
      ? "signup"
      : "login";

  setAuthMessage();

  if (
    authModalTitle &&
    authModalDescription &&
    authPasswordConfirmField &&
    authSubmitButton &&
    authSwitchButton
  ) {
    if (authMode === "signup") {
      authModalTitle.textContent =
        "회원가입";

      authModalDescription.textContent =
        "이메일과 비밀번호로 계정을 만들어요.";

      authPasswordConfirmField.classList
        .remove("hidden");

      authSubmitButton.textContent =
        "회원가입";

      authSwitchButton.textContent =
        "이미 계정이 있나요? 로그인";
    } else {
      authModalTitle.textContent =
        "로그인";

      authModalDescription.textContent =
        "이메일과 비밀번호로 로그인하세요.";

      authPasswordConfirmField.classList
        .add("hidden");

      authSubmitButton.textContent =
        "로그인";

      authSwitchButton.textContent =
        "계정이 없나요? 회원가입";
    }
  }

  if (authPasswordInput) {
    authPasswordInput.setAttribute(
      "autocomplete",
      authMode === "signup"
        ? "new-password"
        : "current-password"
    );
  }
}


function openAuthModal(mode) {
  if (!authModal) return;

  setAuthMode(mode);

  authModal.classList.remove("hidden");
  document.body.classList.add(
    "modal-open"
  );

  window.setTimeout(() => {
    authEmailInput?.focus();
  }, 40);
}


function closeAuthModal() {
  if (!authModal) return;

  authModal.classList.add("hidden");
  document.body.classList.remove(
    "modal-open"
  );

  setAuthMessage();

  if (authPasswordInput) {
    authPasswordInput.value = "";
  }

  if (authPasswordConfirmInput) {
    authPasswordConfirmInput.value = "";
  }
}


document
  .getElementById("openLoginButton")
  ?.addEventListener(
    "click",
    () => openAuthModal("login")
  );


document
  .getElementById("openSignupButton")
  ?.addEventListener(
    "click",
    () => openAuthModal("signup")
  );


document
  .getElementById("closeAuthModal")
  ?.addEventListener(
    "click",
    closeAuthModal
  );


authModal?.addEventListener(
  "click",
  (event) => {
    if (event.target === authModal) {
      closeAuthModal();
    }
  }
);


document.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Escape" &&
      authModal &&
      !authModal.classList.contains(
        "hidden"
      )
    ) {
      closeAuthModal();
    }
  }
);


authSwitchButton?.addEventListener(
  "click",
  () => {
    setAuthMode(
      authMode === "login"
        ? "signup"
        : "login"
    );
  }
);


/* ==============================
   Supabase 연결
============================== */

function initSupabase() {
  if (
    !window.supabase ||
    !SUPABASE_URL ||
    !SUPABASE_PUBLISHABLE_KEY
  ) {
    setCloudUi(
      "error",
      "Supabase 연결 실패",
      "Supabase 라이브러리 또는 연결 정보를 확인해주세요."
    );

    return false;
  }

  supabaseClient =
    window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

  return true;
}


function currentPageUrl() {
  const url =
    new URL(window.location.href);

  url.hash = "";
  url.search = "";

  return url.toString();
}


authForm?.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    if (!supabaseClient) {
      setAuthMessage(
        "Supabase 연결이 준비되지 않았어요.",
        "error"
      );
      return;
    }

    const email =
      authEmailInput?.value
        .trim();

    const password =
      authPasswordInput?.value || "";

    const passwordConfirm =
      authPasswordConfirmInput
        ?.value || "";

    if (!email || !password) {
      setAuthMessage(
        "이메일과 비밀번호를 입력해주세요.",
        "error"
      );
      return;
    }

    if (
      authMode === "signup" &&
      password !== passwordConfirm
    ) {
      setAuthMessage(
        "비밀번호 확인이 일치하지 않아요.",
        "error"
      );
      return;
    }

    if (password.length < 6) {
      setAuthMessage(
        "비밀번호는 6자 이상 입력해주세요.",
        "error"
      );
      return;
    }

    if (authSubmitButton) {
      authSubmitButton.disabled = true;
      authSubmitButton.textContent =
        authMode === "signup"
          ? "가입 중..."
          : "로그인 중...";
    }

    try {
      if (authMode === "signup") {
        const { data, error } =
          await supabaseClient.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo:
                currentPageUrl()
            }
          });

        if (error) {
          throw error;
        }

        if (data.session) {
          setAuthMessage(
            "회원가입과 로그인이 완료됐어요.",
            "success"
          );

          window.setTimeout(
            closeAuthModal,
            550
          );
        } else {
          setAuthMessage(
            "회원가입 완료! 이메일로 온 인증 링크를 눌러주세요.",
            "success"
          );
        }
      } else {
        const { error } =
          await supabaseClient.auth
            .signInWithPassword({
              email,
              password
            });

        if (error) {
          throw error;
        }

        setAuthMessage(
          "로그인 완료!",
          "success"
        );

        window.setTimeout(
          closeAuthModal,
          450
        );
      }
    } catch (error) {
      console.error(
        "인증 처리 실패:",
        error
      );

      setAuthMessage(
        translateAuthError(error),
        "error"
      );
    } finally {
      if (authSubmitButton) {
        authSubmitButton.disabled = false;
        authSubmitButton.textContent =
          authMode === "signup"
            ? "회원가입"
            : "로그인";
      }
    }
  }
);


function translateAuthError(error) {
  const message =
    String(error?.message || "");

  if (
    message.includes(
      "Invalid login credentials"
    )
  ) {
    return "이메일 또는 비밀번호가 맞지 않아요.";
  }

  if (
    message.includes(
      "Email not confirmed"
    )
  ) {
    return "이메일 인증이 아직 완료되지 않았어요.";
  }

  if (
    message.includes(
      "User already registered"
    )
  ) {
    return "이미 가입된 이메일이에요.";
  }

  if (
    message.includes(
      "Password should be"
    )
  ) {
    return "비밀번호 조건을 확인해주세요.";
  }

  if (
    message.includes(
      "rate limit"
    ) ||
    message.includes(
      "Rate limit"
    )
  ) {
    return "요청이 너무 많아요. 잠시 후 다시 시도해주세요.";
  }

  return message ||
    "인증 처리 중 오류가 발생했어요.";
}


/* ==============================
   클라우드 세이브
============================== */

function createLocalBackupBeforeCloud(
  userId
) {
  try {
    const payload = {
      userId,
      backedUpAt:
        new Date().toISOString(),
      saveData:
        deepClone(saveData)
    };

    localStorage.setItem(
      LOCAL_BACKUP_KEY,
      JSON.stringify(payload)
    );

    return true;
  } catch (error) {
    console.error(
      "클라우드 적용 전 로컬 백업 실패:",
      error
    );

    return false;
  }
}


async function loadOrCreateCloudSave(
  user
) {
  if (
    !supabaseClient ||
    !user
  ) {
    return;
  }

  if (cloudBusy) {
    return;
  }

  cloudBusy = true;
  cloudReady = false;
  linkedUserId = user.id;
  renderAccountUi();

  setCloudUi(
    "saving",
    "클라우드 확인 중",
    "이 계정의 기존 세이브가 있는지 확인하고 있어요."
  );

  try {
    const {
      data,
      error
    } =
      await supabaseClient
        .from("user_saves")
        .select(
          "save_data, updated_at"
        )
        .eq(
          "user_id",
          user.id
        )
        .maybeSingle();

    if (error) {
      throw error;
    }


    if (data?.save_data) {
      createLocalBackupBeforeCloud(
        user.id
      );

      saveData =
        mergeSave(
          DEFAULT_SAVE,
          data.save_data
        );

      saveLocalOnly();

      cloudReady = true;

      renderAllGameUi();

      setCloudUi(
        "connected",
        "클라우드 불러오기 완료",
        "기존 서버 세이브를 이 브라우저에 적용했어요."
      );
    } else {
      const {
        error: insertError
      } =
        await supabaseClient
          .from("user_saves")
          .insert({
            user_id: user.id,
            save_data:
              deepClone(saveData)
          });

      if (insertError) {
        throw insertError;
      }

      cloudReady = true;

      setCloudUi(
        "connected",
        "첫 클라우드 저장 완료",
        "이 브라우저의 현재 세이브를 계정의 첫 서버 세이브로 올렸어요."
      );
    }


    renderAccountUi();
    startSafeSaveInterval();

  } catch (error) {
    console.error(
      "클라우드 세이브 연결 실패:",
      error
    );

    cloudReady = false;

    setCloudUi(
      "error",
      "클라우드 연결 실패",
      "로컬 세이브는 유지돼요. Supabase 테이블/RLS 설정을 확인해주세요."
    );

    renderAccountUi();
  } finally {
    cloudBusy = false;
  }
}


function scheduleCloudSave() {
  if (
    !currentUser ||
    !cloudReady ||
    !supabaseClient ||
    linkedUserId !== currentUser.id
  ) {
    return;
  }

  if (cloudSaveTimer) {
    clearTimeout(cloudSaveTimer);
  }

  cloudSaveTimer =
    window.setTimeout(
      () => {
        cloudSaveTimer = null;
        void saveCloudNow(
          "자동 저장"
        );
      },
      900
    );
}


async function saveCloudNow(
  reason = "클라우드 저장"
) {
  if (
    !currentUser ||
    !cloudReady ||
    !supabaseClient ||
    linkedUserId !== currentUser.id
  ) {
    return false;
  }

  saveLocalOnly();

  setCloudUi(
    "saving",
    "저장 중...",
    `${reason}을 진행하고 있어요.`
  );

  try {
    const { error } =
      await supabaseClient
        .from("user_saves")
        .upsert(
          {
            user_id:
              currentUser.id,

            save_data:
              deepClone(saveData)
          },
          {
            onConflict: "user_id"
          }
        );

    if (error) {
      throw error;
    }

    setCloudUi(
      "connected",
      "자동 저장됨",
      `마지막 저장 ${new Date()
        .toLocaleTimeString(
          "ko-KR",
          {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          }
        )}`
    );

    return true;

  } catch (error) {
    console.error(
      "클라우드 저장 실패:",
      error
    );

    setCloudUi(
      "error",
      "클라우드 저장 실패",
      "로컬에는 저장됐어요. 네트워크 또는 Supabase 설정을 확인해주세요."
    );

    return false;
  }
}


function startSafeSaveInterval() {
  if (safeSaveInterval) {
    clearInterval(
      safeSaveInterval
    );
  }

  if (
    !currentUser ||
    !cloudReady
  ) {
    safeSaveInterval = null;
    return;
  }

  safeSaveInterval =
    window.setInterval(
      () => {
        void saveCloudNow(
          "30초 안전 저장"
        );
      },
      30000
    );
}


function stopCloudSaving() {
  if (cloudSaveTimer) {
    clearTimeout(
      cloudSaveTimer
    );

    cloudSaveTimer = null;
  }

  if (safeSaveInterval) {
    clearInterval(
      safeSaveInterval
    );

    safeSaveInterval = null;
  }
}


document
  .getElementById(
    "manualCloudSaveButton"
  )
  ?.addEventListener(
    "click",
    async () => {
      await saveCloudNow(
        "수동 저장"
      );
    }
  );


document
  .getElementById(
    "logoutButton"
  )
  ?.addEventListener(
    "click",
    async () => {
      if (!supabaseClient) {
        return;
      }

      if (cloudReady) {
        await saveCloudNow(
          "로그아웃 직전 저장"
        );
      }

      await supabaseClient.auth
        .signOut();
    }
  );


document.addEventListener(
  "visibilitychange",
  () => {
    if (
      document.hidden &&
      currentUser &&
      cloudReady
    ) {
      void saveCloudNow(
        "화면 숨김 안전 저장"
      );
    }
  }
);


window.addEventListener(
  "pagehide",
  () => {
    if (
      currentUser &&
      cloudReady
    ) {
      void saveCloudNow(
        "페이지 종료 안전 저장"
      );
    }
  }
);


/* ==============================
   인증 상태 감시
============================== */

async function handleSignedInUser(
  user
) {
  if (!user) {
    return;
  }

  currentUser = user;

  if (
    linkedUserId === user.id &&
    cloudReady
  ) {
    renderAccountUi();
    return;
  }

  await loadOrCreateCloudSave(
    user
  );

  renderAccountUi();
}


function handleSignedOut() {
  stopCloudSaving();

  currentUser = null;
  linkedUserId = null;
  cloudReady = false;
  cloudBusy = false;

  renderAccountUi();
}


async function initAuth() {
  if (!initSupabase()) {
    renderAccountUi();
    return;
  }

  const {
    data,
    error
  } =
    await supabaseClient.auth
      .getSession();

  if (error) {
    console.error(
      "세션 확인 실패:",
      error
    );
  }

  if (data?.session?.user) {
    await handleSignedInUser(
      data.session.user
    );
  } else {
    handleSignedOut();
  }


  supabaseClient.auth
    .onAuthStateChange(
      (event, session) => {
        const user =
          session?.user || null;

        if (
          event === "SIGNED_OUT" ||
          !user
        ) {
          handleSignedOut();
          return;
        }

        if (
          event === "SIGNED_IN" ||
          event === "INITIAL_SESSION" ||
          event === "USER_UPDATED"
        ) {
          window.setTimeout(
            () => {
              void handleSignedInUser(
                user
              );
            },
            0
          );
        }
      }
    );
}


/* ==============================
   시작
============================== */

updateMaxSeenDate();
renderAllGameUi();
renderAccountUi();
openPage("home");

void initAuth();
