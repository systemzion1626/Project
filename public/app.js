const chatWindow = document.getElementById("chatWindow");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const modelSelect = document.getElementById("modelSelect");
const kbList = document.getElementById("kbList");
const fileList = document.getElementById("fileList");
const kbForm = document.getElementById("kbForm");
const kbTitle = document.getElementById("kbTitle");
const kbContent = document.getElementById("kbContent");
const fileNameInput = document.getElementById("fileNameInput");
const saveAsFileButton = document.getElementById("saveAsFile");
const clearChatButton = document.getElementById("clearChat");
const toggleSidebarButton = document.getElementById("toggleSidebar");
const sidebar = document.getElementById("sidebar");
const loginPanel = document.getElementById("loginPanel");
const appPanel = document.getElementById("appPanel");
const loginForm = document.getElementById("loginForm");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const logoutButton = document.getElementById("logoutButton");

const sessionId = localStorage.getItem("sessionId") || crypto.randomUUID();
localStorage.setItem("sessionId", sessionId);
const tokenKey = "authToken";

let lastAssistantMessage = "";

const fetchJson = async (url, options = {}) => {
  const token = localStorage.getItem(tokenKey);
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    headers,
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
};

const addMessage = (role, content) => {
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = role === "assistant" ? marked.parse(content) : content;
  wrapper.appendChild(bubble);
  chatWindow.appendChild(wrapper);
  chatWindow.scrollTop = chatWindow.scrollHeight;
};

const refreshSidebar = async () => {
  const kbData = await fetchJson("/api/kb/list");
  kbList.innerHTML = "";
  kbData.items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item.title;
    kbList.appendChild(li);
  });

  const fileData = await fetchJson("/api/files/list");
  fileList.innerHTML = "";
  fileData.items.forEach((file) => {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = `/api/files/download?id=${file.id}`;
    link.textContent = file.name;
    link.setAttribute("download", file.name);
    li.appendChild(link);
    fileList.appendChild(li);
  });
};

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  addMessage("user", message);
  chatInput.value = "";

  try {
    const data = await fetchJson("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        message,
        model: modelSelect.value
      })
    });

    lastAssistantMessage = data.reply;
    addMessage("assistant", data.reply || "(无回复)");
  } catch (error) {
    addMessage("assistant", `错误：${error.message}`);
  }
});

kbForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = kbTitle.value.trim();
  const content = kbContent.value.trim();
  if (!title || !content) {
    return;
  }

  try {
    await fetchJson("/api/kb/save", {
      method: "POST",
      body: JSON.stringify({ title, content })
    });
    kbTitle.value = "";
    kbContent.value = "";
    await refreshSidebar();
  } catch (error) {
    alert(`保存失败：${error.message}`);
  }
});

saveAsFileButton.addEventListener("click", async () => {
  if (!lastAssistantMessage) {
    alert("暂无可保存的 AI 回复。");
    return;
  }
  const name = fileNameInput.value.trim() || "assistant.md";
  try {
    await fetchJson("/api/files/create", {
      method: "POST",
      body: JSON.stringify({ name, content: lastAssistantMessage })
    });
    fileNameInput.value = "";
    await refreshSidebar();
  } catch (error) {
    alert(`创建文件失败：${error.message}`);
  }
});

clearChatButton.addEventListener("click", () => {
  localStorage.removeItem("sessionId");
  location.reload();
});

toggleSidebarButton.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
  toggleSidebarButton.textContent = sidebar.classList.contains("collapsed")
    ? "展开"
    : "收起";
});

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    panels.forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

const showApp = () => {
  loginPanel.classList.add("hidden");
  appPanel.classList.remove("hidden");
};

const showLogin = (message = "") => {
  loginPanel.classList.remove("hidden");
  appPanel.classList.add("hidden");
  loginError.textContent = message;
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const username = loginUsername.value.trim();
  const password = loginPassword.value.trim();

  try {
    const data = await fetchJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    localStorage.setItem(tokenKey, data.token);
    loginPassword.value = "";
    showApp();
    await refreshSidebar();
  } catch (error) {
    showLogin(error.message);
  }
});

logoutButton.addEventListener("click", async () => {
  localStorage.removeItem(tokenKey);
  showLogin("已退出登录。");
});

const initialize = async () => {
  if (localStorage.getItem(tokenKey)) {
    try {
      await refreshSidebar();
      showApp();
    } catch (error) {
      localStorage.removeItem(tokenKey);
      showLogin("登录已失效，请重新登录。");
    }
  } else {
    showLogin();
  }
};

initialize();
