const jsonResponse = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    ...init
  });

const textResponse = (text, init = {}) =>
  new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    ...init
  });

const getSessionId = (request) =>
  request.headers.get("x-session-id") || "anonymous";

const safeJsonParse = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const ensureKv = (binding, name) => {
  if (!binding) {
    throw new Error(`Missing KV binding: ${name}`);
  }
};

const listFromKv = async (kv, key) => {
  const raw = await kv.get(key);
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const saveToKv = (kv, key, value) => kv.put(key, JSON.stringify(value));

const ADMIN_USERNAME = "Administrator";
const ADMIN_PASSWORD = "@Abcabcabc1";
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1000;

const getAuthState = async (kv) => {
  const raw = await kv.get("auth:state");
  if (!raw) {
    return { attempts: 0, lockUntil: 0 };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { attempts: 0, lockUntil: 0 };
  }
};

const saveAuthState = (kv, state) => saveToKv(kv, "auth:state", state);

const createToken = () => crypto.randomUUID();

const requireAuth = async (request, env) => {
  ensureKv(env.AI_AUTH, "AI_AUTH");
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await env.AI_AUTH.get(`session:${token}`);
  if (!session) {
    return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
};

const callOpenAI = async ({ apiKey, model, messages }) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
};

const detectFolder = (fileName) => {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!ext || ext === fileName.toLowerCase()) {
    return "misc";
  }
  const buckets = {
    docs: ["md", "txt", "pdf"],
    images: ["png", "jpg", "jpeg", "gif", "svg"],
    data: ["json", "csv", "xml"],
    code: ["js", "ts", "py", "java", "rb", "go", "rs"]
  };
  const entry = Object.entries(buckets).find(([, exts]) => exts.includes(ext));
  return entry ? entry[0] : "misc";
};

const sanitizeFileName = (name) =>
  name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "untitled.txt";

const handleLogin = async (request, env) => {
  ensureKv(env.AI_AUTH, "AI_AUTH");
  const payload = await safeJsonParse(request);
  const username = payload?.username?.trim();
  const password = payload?.password?.trim();

  if (!username || !password) {
    return jsonResponse({ error: "Username and password are required" }, { status: 400 });
  }

  const state = await getAuthState(env.AI_AUTH);
  const now = Date.now();
  if (state.lockUntil && now < state.lockUntil) {
    const minutes = Math.ceil((state.lockUntil - now) / 60000);
    return jsonResponse({ error: `Locked. Try again in ${minutes} minutes.` }, { status: 423 });
  }

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    const attempts = state.attempts + 1;
    const nextState = {
      attempts,
      lockUntil: attempts >= MAX_ATTEMPTS ? now + LOCKOUT_MS : 0
    };
    await saveAuthState(env.AI_AUTH, nextState);
    return jsonResponse({ error: "Invalid credentials" }, { status: 401 });
  }

  await saveAuthState(env.AI_AUTH, { attempts: 0, lockUntil: 0 });
  const token = createToken();
  await env.AI_AUTH.put(`session:${token}`, JSON.stringify({ username, createdAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 });
  return jsonResponse({ token });
};

const handleChat = async (request, env) => {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "Missing OPENAI_API_KEY" }, { status: 400 });
  }

  ensureKv(env.AI_MEMORY, "AI_MEMORY");
  const payload = await safeJsonParse(request);
  const message = payload?.message?.trim();
  const model = payload?.model || "gpt-4o-mini";

  if (!message) {
    return jsonResponse({ error: "Message is required" }, { status: 400 });
  }

  const sessionId = payload?.sessionId || getSessionId(request);
  const memoryKey = `memory:${sessionId}`;
  const memory = await listFromKv(env.AI_MEMORY, memoryKey);

  const messages = [
    {
      role: "system",
      content:
        "You are an assistant for an AI project. Use the provided knowledge base and memory to answer. When asked to classify knowledge, return a short folder label only."
    },
    ...memory,
    { role: "user", content: message }
  ];

  const reply = await callOpenAI({ apiKey, model, messages });
  const updatedMemory = [
    ...memory,
    { role: "user", content: message },
    { role: "assistant", content: reply }
  ].slice(-12);

  await saveToKv(env.AI_MEMORY, memoryKey, updatedMemory);

  return jsonResponse({ reply });
};

const handleSaveKb = async (request, env) => {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "Missing OPENAI_API_KEY" }, { status: 400 });
  }

  ensureKv(env.AI_KB, "AI_KB");
  const payload = await safeJsonParse(request);
  const title = payload?.title?.trim();
  const content = payload?.content?.trim();

  if (!title || !content) {
    return jsonResponse(
      { error: "Title and content are required" },
      { status: 400 }
    );
  }

  const folder = await callOpenAI({
    apiKey,
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "Classify the following knowledge into a short folder label. Respond with only the folder name."
      },
      { role: "user", content: `${title}\n${content}` }
    ]
  });

  const kb = await listFromKv(env.AI_KB, "kb");
  const entry = {
    id: Date.now().toString(),
    title,
    content,
    folder,
    createdAt: new Date().toISOString()
  };
  kb.unshift(entry);
  await saveToKv(env.AI_KB, "kb", kb);

  return jsonResponse({ entry });
};

const handleListKb = async (env) => {
  ensureKv(env.AI_KB, "AI_KB");
  const items = await listFromKv(env.AI_KB, "kb");
  return jsonResponse({ items });
};

const handleCreateFile = async (request, env) => {
  ensureKv(env.AI_FILES, "AI_FILES");
  const payload = await safeJsonParse(request);
  const name = payload?.name?.trim();
  if (!name) {
    return jsonResponse({ error: "File name is required" }, { status: 400 });
  }

  const safeName = sanitizeFileName(name);
  const folder = detectFolder(safeName);
  const id = crypto.randomUUID();
  const record = {
    id,
    name: safeName,
    folder,
    createdAt: new Date().toISOString()
  };

  await env.AI_FILES.put(`file:${id}`, payload?.content ?? "");

  const files = await listFromKv(env.AI_FILES, "files");
  files.unshift(record);
  await saveToKv(env.AI_FILES, "files", files);

  return jsonResponse({ file: record });
};

const handleListFiles = async (env) => {
  ensureKv(env.AI_FILES, "AI_FILES");
  const items = await listFromKv(env.AI_FILES, "files");
  return jsonResponse({ items });
};

const handleDownload = async (request, env) => {
  ensureKv(env.AI_FILES, "AI_FILES");
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return jsonResponse({ error: "Missing id" }, { status: 400 });
  }

  const content = await env.AI_FILES.get(`file:${id}`);
  if (content === null) {
    return jsonResponse({ error: "File not found" }, { status: 404 });
  }

  const files = await listFromKv(env.AI_FILES, "files");
  const entry = files.find((item) => item.id === id);
  const downloadName = entry?.name || `ai-file-${id}.txt`;

  return textResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename=${downloadName}`
    }
  });
};

const handleRequest = async (request, env) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    try {
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }
      const authError = await requireAuth(request, env);
      if (authError) {
        return authError;
      }
      if (url.pathname === "/api/chat" && request.method === "POST") {
        return await handleChat(request, env);
      }
      if (url.pathname === "/api/kb/save" && request.method === "POST") {
        return await handleSaveKb(request, env);
      }
      if (url.pathname === "/api/kb/list" && request.method === "GET") {
        return await handleListKb(env);
      }
      if (url.pathname === "/api/files/create" && request.method === "POST") {
        return await handleCreateFile(request, env);
      }
      if (url.pathname === "/api/files/list" && request.method === "GET") {
        return await handleListFiles(env);
      }
      if (url.pathname === "/api/files/download" && request.method === "GET") {
        return await handleDownload(request, env);
      }
    } catch (error) {
      return jsonResponse({ error: error.message }, { status: 500 });
    }
    return jsonResponse({ error: "Not found" }, { status: 404 });
  }

  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  return jsonResponse({ error: "ASSETS binding not configured" }, { status: 500 });
};

export default {
  fetch: handleRequest
};
