(() => {
  const SUPABASE_URL = "https://yfljdglnfqugoyavrujz.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_4_t4jUTaduHoCBVU4-AxbA_lv6iVkqg";
  const $ = (id) => document.getElementById(id);
  const authView = $("authView"), chatView = $("chatView");
  let supabaseClient, session, socket, currentUser, activePeer = null;
  let mode = "login", typingTimer, isTyping = false;
  const presence = new Map();

  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2600);
  }
  function authMessage(message) { $("authMessage").textContent = message || ""; }
  function setMode(next) {
    mode = next;
    $("loginTab").classList.toggle("active", mode === "login");
    $("signupTab").classList.toggle("active", mode === "signup");
    $("usernameLabel").classList.toggle("hidden", mode !== "signup");
    $("authSubmit").textContent = mode === "login" ? "Log in" : "Create account";
    $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
    authMessage("");
  }
  $("loginTab").onclick = () => setMode("login");
  $("signupTab").onclick = () => setMode("signup");

  async function init() {
    if (SUPABASE_URL.includes("YOUR_PROJECT") || SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) {
      authMessage("Setup required: add your Supabase URL and anon key in public/app.js.");
      return;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await supabaseClient.auth.getSession();
    if (data.session) await enterApp(data.session);
    supabaseClient.auth.onAuthStateChange(async (_event, nextSession) => {
      if (nextSession && !session) await enterApp(nextSession);
      if (!nextSession && session) showAuth();
    });
  }

  $("authForm").addEventListener("submit", async (event) => {
    event.preventDefault(); authMessage("Please wait…");
    const email = $("email").value.trim(), password = $("password").value;
    try {
      if (mode === "signup") {
        const username = $("username").value.trim().toLowerCase();
        if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Username must be 3–24 characters: letters, numbers or underscores.");
        const { data, error } = await supabaseClient.auth.signUp({
          email, password, options: { data: { username } }
        });
        if (error) throw error;
        if (!data.session) {
          authMessage("Account created. Check your email to confirm it, then log in.");
          return;
        }
        const { error: profileError } = await supabaseClient.from("profiles").insert({ id: data.user.id, username });
        if (profileError) {
          await supabaseClient.auth.signOut();
          throw new Error(profileError.code === "23505" ? "That username is already taken." : profileError.message);
        }
        await enterApp(data.session);
      } else {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await enterApp(data.session);
      }
    } catch (err) { authMessage(err.message || "Something went wrong."); }
  });

  async function enterApp(nextSession) {
    session = nextSession; currentUser = nextSession.user;
    let { data: profile, error } = await supabaseClient.from("profiles").select("username").eq("id", currentUser.id).maybeSingle();
    if (!profile && currentUser.user_metadata?.username) {
      const { data: created, error: createError } = await supabaseClient.from("profiles")
        .insert({ id: currentUser.id, username: String(currentUser.user_metadata.username).toLowerCase() })
        .select("username").single();
      if (!createError) profile = created;
      else error = createError;
    }
    if (error || !profile) {
      authMessage("Could not load your profile. Check that schema.sql was run and the username is available.");
      return;
    }
    $("myIdentity").textContent = "Signed in as @" + profile.username;
    authView.classList.add("hidden"); chatView.classList.remove("hidden");
    connectSocket();
  }
  function showAuth() {
    session = null; currentUser = null; activePeer = null;
    if (socket) socket.disconnect(); socket = null;
    chatView.classList.add("hidden"); authView.classList.remove("hidden");
  }
  $("logoutBtn").onclick = async () => { await supabaseClient.auth.signOut(); showAuth(); };

  function connectSocket() {
    if (socket) socket.disconnect();
    socket = io({ auth: { token: session.access_token } });
    socket.on("connect_error", (err) => toast(err.message || "Connection failed"));
    socket.on("presence", ({ userId, online }) => {
      presence.set(userId, online);
      if (activePeer?.id === userId) updatePresence();
      document.querySelectorAll(`[data-user-id="${userId}"] .presence-label`).forEach(el => el.textContent = online ? "Online" : "Offline");
    });
    socket.on("new-message", (message) => {
      if (activePeer && (message.sender_id === activePeer.id || message.receiver_id === activePeer.id)) {
        appendMessage(message);
      }
    });
    socket.on("typing", ({ from, isTyping: typing }) => {
      if (activePeer?.id === from) $("typingLine").textContent = typing ? "Typing…" : "";
    });
  }
  function updatePresence() {
    $("chatPresence").textContent = presence.get(activePeer.id) ? "Online" : "Offline";
  }

  let searchTimeout;
  $("userSearch").addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(searchUsers, 250);
  });
  async function searchUsers() {
    const term = $("userSearch").value.trim().toLowerCase();
    $("userResults").replaceChildren();
    if (term.length < 2) return;
    const { data, error } = await supabaseClient.from("profiles").select("id,username").ilike("username", `%${term}%`).neq("id", currentUser.id).limit(15);
    if (error) return toast("Could not search users.");
    if (!data.length) { $("userResults").textContent = "No users found."; return; }
    data.forEach(user => {
      const button = document.createElement("button"); button.className = "user-result"; button.dataset.userId = user.id;
      const avatar = document.createElement("span"); avatar.className = "avatar"; avatar.textContent = user.username[0].toUpperCase();
      const meta = document.createElement("span"); meta.className = "user-meta";
      const name = document.createElement("strong"); name.textContent = "@" + user.username;
      const status = document.createElement("span"); status.className = "presence-label"; status.textContent = presence.get(user.id) ? "Online" : "Tap to chat";
      meta.append(name, status); button.append(avatar, meta);
      button.onclick = () => openChat(user); $("userResults").append(button);
    });
  }

  async function openChat(peer) {
    activePeer = peer;
    $("emptyState").classList.add("hidden"); $("activeChat").classList.remove("hidden");
    $("chatName").textContent = "@" + peer.username;
    $("chatAvatar").textContent = peer.username[0].toUpperCase();
    $("messages").replaceChildren(); $("typingLine").textContent = "";
    updatePresence();
    const { data, error } = await supabaseClient.from("messages").select("id,sender_id,receiver_id,content,image_url,created_at")
      .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${peer.id}),and(sender_id.eq.${peer.id},receiver_id.eq.${currentUser.id})`)
      .order("created_at", { ascending: true }).limit(200);
    if (error) { toast("Could not load chat history."); return; }
    data.forEach(appendMessage);
  }

  function appendMessage(message) {
    if (!activePeer) return;
    const mine = message.sender_id === currentUser.id;
    const wrap = document.createElement("div"); wrap.className = "bubble " + (mine ? "mine" : "theirs");
    if (message.image_url) {
      const img = document.createElement("img"); img.src = message.image_url; img.alt = "Shared image"; img.loading = "lazy";
      img.onerror = () => { img.alt = "Image unavailable"; }; wrap.append(img);
    }
    if (message.content) { const content = document.createElement("div"); content.textContent = message.content; wrap.append(content); }
    const time = document.createElement("span"); time.className = "time";
    time.textContent = new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    wrap.append(time);
    const list = $("messages");
    // Avoid duplicate display when sender receives both acknowledgement and socket broadcast.
    if (message.id && list.querySelector(`[data-message-id="${message.id}"]`)) return;
    if (message.id) wrap.dataset.messageId = message.id;
    list.append(wrap); list.scrollTop = list.scrollHeight;
  }
  $("imageInput").addEventListener("change", () => {
  const file = $("imageInput").files[0];

  if (file) {
    toast("Image selected: " + file.name);
  }
});
  $("messageInput").addEventListener("input", () => {
    if (!activePeer || !socket?.connected) return;
    if (!isTyping) { isTyping = true; socket.emit("typing", { to: activePeer.id, isTyping: true }); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      isTyping = false; socket.emit("typing", { to: activePeer.id, isTyping: false });
    }, 900);
  });

  $("messageForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activePeer) return toast("Choose a person first.");
    const input = $("messageInput"), content = input.value.trim();
    const file = $("imageInput").files[0];
    if (!content && !file) return;
    if (file && (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024)) return toast("Choose an image up to 5 MB.");
    let imageUrl = null;
    const sendButton = document.querySelector(".send"); sendButton.disabled = true;
    try {
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        const objectPath = `${currentUser.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabaseClient.storage.from("chat-images").upload(objectPath, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        const { data } = supabaseClient.storage.from("chat-images").getPublicUrl(objectPath);
        imageUrl = data.publicUrl;
      }
      if (!socket?.connected) throw new Error("Not connected to chat server. Refresh and try again.");
      socket.emit("private-message", { receiverId: activePeer.id, content, imageUrl }, (result) => {
        if (!result?.ok) toast(result?.error || "Message failed.");
        else {
          input.value = ""; $("imageInput").value = "";
          if (isTyping) { isTyping = false; socket.emit("typing", { to: activePeer.id, isTyping: false }); }
        }
        sendButton.disabled = false;
      });
    } catch (err) { toast(err.message || "Could not send."); sendButton.disabled = false; }
  });

  init();
})();