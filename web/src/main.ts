import { elderIosMessage, errorMessage, helperJoinViewHtml, isIosElderAttempt } from "./join.ts";

const ELDER_USE_APP_MESSAGE = "כדי לקבל עזרה, פתחו את האפליקציה בטלפון האנדרואיד שלכם.";

// Same rule as isValidCodeFormat in @familyguide/shared/session, which cannot be
// bundled for the browser because that module imports node:crypto.
function isValidCodeFormat(code: string): boolean {
  return /^\d{6}$/.test(code);
}

const app = document.getElementById("app");

function showMessage(text: string): void {
  if (!app) return;
  const section = document.createElement("section");
  section.className = "screen";
  section.dir = "rtl";
  const p = document.createElement("p");
  p.className = "message";
  p.textContent = text;
  section.append(p);
  app.replaceChildren(section);
}

function showHelperJoin(): void {
  if (!app) return;
  app.innerHTML = helperJoinViewHtml();
  const form = document.getElementById("join-form") as HTMLFormElement | null;
  const input = document.getElementById("code-input") as HTMLInputElement | null;
  const error = document.getElementById("join-error");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = input?.value.trim() ?? "";
    if (error) error.textContent = isValidCodeFormat(code) ? "" : errorMessage("invalid");
  });
  input?.focus();
}

function showElder(): void {
  if (isIosElderAttempt(navigator.userAgent, "elder")) {
    showMessage(elderIosMessage());
  } else {
    showMessage(ELDER_USE_APP_MESSAGE);
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-role]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.role === "helper") showHelperJoin();
    else showElder();
  });
});
