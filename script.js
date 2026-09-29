const navButtons = document.querySelectorAll("nav button[data-page]");
const pages = document.querySelectorAll(".page");

function openPage(pageName) {

  // 모든 화면 숨기기
  pages.forEach((page) => {
    page.style.display = "none";
    page.classList.remove("active");
  });

  // 모든 메뉴 선택 해제
  navButtons.forEach((button) => {
    button.classList.remove("active");
  });

  // 선택한 화면만 표시
  const targetPage = document.getElementById(pageName);

  if (targetPage) {
    targetPage.style.display = "block";
    targetPage.classList.add("active");
  }

  // 선택한 메뉴 표시
  const targetButton = document.querySelector(
    `nav button[data-page="${pageName}"]`
  );

  if (targetButton) {
    targetButton.classList.add("active");
  }
}


// 메뉴 버튼 클릭
navButtons.forEach((button) => {

  button.addEventListener("click", () => {

    const pageName = button.dataset.page;

    openPage(pageName);

  });

});


// 처음 사이트를 열면 홈 표시
openPage("home");
