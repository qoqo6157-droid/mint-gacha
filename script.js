const SAVE_KEY = "mintGachaSave_v1";

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


function saveGame() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify(saveData)
    );
  } catch (error) {
    console.error("세이브 저장 실패:", error);
  }
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


function addPoints(amount) {
  const safeAmount = Math.floor(Number(amount));

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
  document.querySelectorAll("nav button[data-page]");

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
  goGachaButton.addEventListener("click", () => {
    openPage("gacha");
  });
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
    String(date.getMonth() + 1).padStart(2, "0");
  const day =
    String(date.getDate()).padStart(2, "0");

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
    newerDate.getTime() - olderDate.getTime();

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
    saveData.attendance.maxSeenDate = today;
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

  if (attendance.lastClaimDate === today) {
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
      `${alreadyClaimed ? attendance.streak : nextDay}일차`;
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

  if (attendance.lastClaimDate === today) {
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
   시작
============================== */

updateMaxSeenDate();
updatePointDisplay();
renderAttendance();
openPage("home");
