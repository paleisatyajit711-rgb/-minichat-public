require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");

const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.APP_ORIGIN || true;
const io = new Server(server, {
  cors: { origin: allowedOrigin, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://*.supabase.co", "blob:"],
      connectSrc: ["'self'", "https://*.supabase.co", "wss:", "ws:"]
    }
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => res.json({ ok: true, service: "MiniChat" }));

// Verify every Socket.IO connection with a Supabase access token.
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication required"));
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return next(new Error("Invalid or expired session"));
    socket.user = data.user;
    socket.accessToken = token;
    next();
  } catch (_err) {
    next(new Error("Could not authenticate"));
  }
});

const onlineSockets = new Map(); // user id -> Set(socket ids)
function emitPresence(userId) {
  io.emit("presence", { userId, online: (onlineSockets.get(userId)?.size || 0) > 0 });
}

io.on("connection", (socket) => {
  const userId = socket.user.id;
  if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
  onlineSockets.get(userId).add(socket.id);
  socket.join(`user:${userId}`);
  emitPresence(userId);

  socket.on("private-message", async (payload, ack = () => {}) => {
    try {
      const receiverId = String(payload?.receiverId || "");
      const content = String(payload?.content || "").trim();
      const imageUrl = payload?.imageUrl ? String(payload.imageUrl) : null;
      if (!/^[0-9a-f-]{36}$/i.test(receiverId) || receiverId === userId) {
        return ack({ ok: false, error: "Choose a valid recipient." });
      }
      if ((!content && !imageUrl) || content.length > 4000) {
        return ack({ ok: false, error: "Message must contain text or an image (up to 4,000 characters)." });
      }
      if (imageUrl && (!imageUrl.startsWith(process.env.SUPABASE_URL + "/storage/v1/object/public/chat-images/"))) {
        return ack({ ok: false, error: "Image URL is not from this chat's image storage." });
      }
      const userSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    global: {
      headers: {
        Authorization: `Bearer ${socket.accessToken}`
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

const { data, error } = await userSupabase
  .from("messages")
  .insert({
    sender_id: userId,
    receiver_id: receiverId,
    content: content || null,
    image_url: imageUrl
  })
  .select("id,sender_id,receiver_id,content,image_url,created_at")
  .single();
      if (error) {
        console.error("Message insert failed:", error.message);
        return ack({ ok: false, error: "Could not save message. Check the database setup." });
      }
      io.to(`user:${userId}`).to(`user:${receiverId}`).emit("new-message", data);
      ack({ ok: true, message: data });
    } catch (err) {
      console.error(err);
      ack({ ok: false, error: "Message could not be sent." });
    }
  });

  socket.on("typing", ({ to, isTyping } = {}) => {
    if (typeof to === "string" && /^[0-9a-f-]{36}$/i.test(to) && to !== userId) {
      io.to(`user:${to}`).emit("typing", { from: userId, isTyping: Boolean(isTyping) });
    }
  });

  socket.on("disconnect", () => {
    const sockets = onlineSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) onlineSockets.delete(userId);
    }
    emitPresence(userId);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`MiniChat listening on port ${port}`));
