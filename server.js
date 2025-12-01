// ==============================
// server.js — نسخه نهایی با امنیت کامل + پشتیبانی پروکسی
// ==============================

require("dotenv").config();


const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const TelegramBot = require("node-telegram-bot-api");

require("dotenv").config(); // برای خواندن .env

const app = express();
app.use(express.json());

// ====================================
// تنظیمات از طریق محیط (ENV)
// ====================================

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID);
const PROXY = process.env.SOCKS5_PROXY || null;

if (!TOKEN || !ADMIN_CHAT_ID) {
    console.error("❌ TELEGRAM_TOKEN یا ADMIN_CHAT_ID تنظیم نشده!");
    process.exit(1);
}

// ------------------------------------
// پیکربندی ربات با یا بدون پروکسی
// ------------------------------------
const botOptions = PROXY
    ? {
          polling: true,
          request: {
              proxy: PROXY
          }
      }
    : { polling: true };

const bot = new TelegramBot(TOKEN, botOptions);

bot.on("polling_error", (err) =>
    console.warn("⚠ Telegram polling error:", err?.message || err)
);

// ====================================
// Socket.io
// ====================================
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// دیتابیس موقت
const clientIdToSocket = {};
const adminMessageIdToClientId = {};
const pendingMessages = {};

// اتصال کاربر
io.on("connection", (socket) => {
    console.log("🔌 Socket connected:", socket.id);

    socket.on("register", ({ clientId }) => {
        if (!clientId) return;

        clientIdToSocket[clientId] = socket;
        socket.clientId = clientId;

        console.log("✔ Client registered:", clientId);

        // ارسال پیام‌ها اگر در انتظار بودند
        if (pendingMessages[clientId]) {
            pendingMessages[clientId].forEach((msg) =>
                socket.emit("admin_message", msg)
            );
            delete pendingMessages[clientId];
        }
    });

    socket.on("disconnect", () => {
        if (socket.clientId) delete clientIdToSocket[socket.clientId];
        console.log("⛔ Socket disconnected:", socket.id);
    });
});

// ====================================
// API ارسال پیام کاربر به تلگرام
// ====================================
app.post("/send", async (req, res) => {
    try {
        const { clientId, text } = req.body;

        if (!clientId || !text)
            return res.status(400).json({ ok: false, error: "clientId & text required" });

        const msg = await bot.sendMessage(
            ADMIN_CHAT_ID,
            `📩 پیام جدید از کاربر:\n🆔 ${clientId}\n\n${text}`
        );

        adminMessageIdToClientId[msg.message_id] = clientId;

        res.json({ ok: true });
    } catch (err) {
        console.error("❌ Error /send:", err?.message || err);
        res.status(500).json({ ok: false, error: err?.message || "internal error" });
    }
});

// ====================================
// دریافت پاسخ ادمین از تلگرام و ارسال به کاربر
// ====================================
bot.on("message", (msg) => {
    try {
        // فقط پیام‌های ادمین
        if (msg.chat.id !== ADMIN_CHAT_ID) return;
        if (!msg.reply_to_message) return;

        const repliedId = msg.reply_to_message.message_id;
        const clientId = adminMessageIdToClientId[repliedId];

        if (!clientId) return;

        const response = {
            text: msg.text || "",
            date: Date.now()
        };

        const socket = clientIdToSocket[clientId];

        if (socket) {
            socket.emit("admin_message", response);
            console.log("✔ Reply delivered to client:", clientId);
        } else {
            if (!pendingMessages[clientId]) pendingMessages[clientId] = [];
            pendingMessages[clientId].push(response);
            console.log("⚠ Client offline → stored message");
        }
    } catch (err) {
        console.error("❌ Error message handler:", err?.message || err);
    }
});

// ====================================
app.get("/ping", (_, res) => res.json({ ok: true }));

// ====================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
