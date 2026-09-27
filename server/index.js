import { WebSocketServer } from "ws";
import { randomInt } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Session } from "./session.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const IDLE_MS = 30 * 60 * 1000;
const TICK_MS = 500;
const HEARTBEAT_MS = 30 * 1000;
const MAX_SESSIONS = 1000;
// far above any burst a real client needs; a client that stops reading must not make us queue replies forever
const MAX_BUFFERED = 64 * 1024;

/**
 * Multiplayer session server: routes socket messages to Session instances
 */
export function startServer({ port = 3001, idleMs = IDLE_MS, maxSessions = MAX_SESSIONS } = {}) {
    const wss = new WebSocketServer({ port, path: "/mp", maxPayload: 64 * 1024 });
    const sessions = new Map();
    const sessionOf = new WeakMap();

    // a broadcast hands the same msg object to every recipient: serialize it once
    const serialized = new WeakMap();
    const send = (ws, msg) => {
        if (ws.readyState !== ws.OPEN) return;
        if (ws.bufferedAmount > MAX_BUFFERED) return ws.terminate();
        if (!serialized.has(msg)) serialized.set(msg, JSON.stringify({ ...msg, serverNow: Date.now() }));
        ws.send(serialized.get(msg));
    };

    const newCode = () => {
        let code;
        do {
            code = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
        } while (sessions.has(code));
        return code;
    };

    // under load the longest idle session nobody is connected to makes room, so clients that walk away cannot lock others out
    // ponytail: one client holding maxSessions live sockets still fills the server; a per-IP cap needs the real client IP from the proxy chain
    const evictOrphan = () => {
        const oldest = [...sessions.values()].filter(s => s.isIdle(0)).sort((a, b) => a.lastActivity - b.lastActivity)[0];
        if (oldest) sessions.delete(oldest.code);
    };

    const route = (ws, msg) => {
        if (["create", "join", "watch"].includes(msg.type)) {
            // the client opens a new socket for every attempt: one per socket means spamming sessions or guessing codes costs a connection each
            if (ws.greeted) return send(ws, { type: "error", code: "INVALID" });
            ws.greeted = true;
        }
        if (msg.type === "create") {
            if (sessions.size >= maxSessions) evictOrphan();
            // bounds memory and keeps newCode() far from exhausting the 32^4 code space
            if (sessions.size >= maxSessions) return send(ws, { type: "error", code: "SERVER_BUSY" });
            const session = new Session(newCode(), { send });
            if (session.create(ws, msg)) {
                sessions.set(session.code, session);
                sessionOf.set(ws, session);
            }
            return;
        }
        if (msg.type === "join" || msg.type === "watch") {
            const session = typeof msg.code === "string" && sessions.get(msg.code.toUpperCase());
            if (!session) return send(ws, { type: "error", code: "SESSION_NOT_FOUND" });
            const ok = msg.type === "join" ? session.join(ws, msg) : session.watch(ws);
            if (ok) sessionOf.set(ws, session);
            return;
        }
        const session = sessionOf.get(ws);
        if (!session) return send(ws, { type: "error", code: "INVALID" });
        session.handle(ws, msg);
    };

    wss.on("connection", (ws) => {
        ws.isAlive = true;
        ws.on("pong", () => { ws.isAlive = true; });
        ws.on("message", (data) => {
            let msg;
            try {
                msg = JSON.parse(data);
            } catch {
                return send(ws, { type: "error", code: "INVALID" });
            }
            if (!msg || typeof msg !== "object" || Array.isArray(msg)) return send(ws, { type: "error", code: "INVALID" });
            try {
                route(ws, msg);
            } catch (err) {
                // one bad frame must never take the whole process (and every session in memory) down
                console.error(err);
                send(ws, { type: "error", code: "INVALID" });
            }
        });
        ws.on("close", () => sessionOf.get(ws)?.disconnect(ws));
        // oversized/malformed frames surface here; without a listener Node would crash the whole process
        ws.on("error", () => ws.terminate());
    });

    const ticker = setInterval(() => {
        for (const [code, session] of sessions) {
            if (session.isIdle(idleMs)) sessions.delete(code);
            else session.tick();
        }
    }, TICK_MS);

    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.isAlive) {
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            ws.ping();
        }
    }, HEARTBEAT_MS);

    wss.on("close", () => {
        clearInterval(ticker);
        clearInterval(heartbeat);
    });

    return wss;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const port = Number(process.env.MP_PORT) || 3001;
    startServer({ port });
    console.log(`SquadGuessr multiplayer server listening on :${port}/mp`);
}
