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
// what a client may send first on a socket, besides "create"
const ENTRY = ["join", "watch", "peek"];

/**
 * Multiplayer session server: routes socket messages to Session instances
 */
export function startServer({ port = 3001, idleMs = IDLE_MS, maxSessions = MAX_SESSIONS } = {}) {
    const wss = new WebSocketServer({ port, path: "/mp", maxPayload: 64 * 1024 });
    const sessions = new Map();
    // the code of a finished game → its session, which plays on under a new code
    const retired = new Map();
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
        } while (sessions.has(code) || retired.has(code));
        return code;
    };

    // PLAY AGAIN: the session moves on to a new code, the old one keeps leading to it (for its results)
    const renew = (session) => {
        const code = newCode();
        sessions.delete(session.code);
        sessions.set(code, session);
        retired.set(session.code, session);
        // capped like the sessions, which also keeps newCode() far from the end of the code space:
        // under load the oldest finished games' links stop working first
        if (retired.size > maxSessions) {
            const [old, owner] = retired.entries().next().value;
            retired.delete(old);
            owner.past.delete(old);
        }
        return code;
    };

    const drop = (session) => {
        sessions.delete(session.code);
        session.past.forEach((_, code) => retired.delete(code));
    };

    // under load the longest idle session nobody is connected to makes room, so clients that walk away cannot lock others out
    // ponytail: one client holding maxSessions live sockets still fills the server; a per-IP cap needs the real client IP from the proxy chain
    const evictOrphan = () => {
        const oldest = [...sessions.values()].filter(s => s.isIdle(0)).sort((a, b) => a.lastActivity - b.lastActivity)[0];
        if (oldest) drop(oldest);
    };

    const route = (ws, msg) => {
        if (msg.type === "create" || ENTRY.includes(msg.type)) {
            // the client opens a new socket for every attempt: one per socket means spamming sessions or guessing codes costs a connection each
            if (ws.greeted) return send(ws, { type: "error", code: "INVALID" });
            ws.greeted = true;
        }
        if (msg.type === "create") {
            if (sessions.size >= maxSessions) evictOrphan();
            // bounds memory and keeps newCode() far from exhausting the 32^4 code space
            if (sessions.size >= maxSessions) return send(ws, { type: "error", code: "SERVER_BUSY" });
            const session = new Session(newCode(), { send, newCode: () => renew(session) });
            if (session.create(ws, msg)) {
                sessions.set(session.code, session);
                sessionOf.set(ws, session);
            }
            return;
        }
        if (ENTRY.includes(msg.type)) {
            const code = typeof msg.code === "string" ? msg.code.toUpperCase() : null;
            const session = sessions.get(code) ?? retired.get(code);
            if (!session) return send(ws, { type: "error", code: "SESSION_NOT_FOUND" });
            if (msg.type === "peek") return session.peek(ws, code, msg.token);
            // watching ignores the code: a big screen on an old link keeps following the session
            const ok = msg.type === "join" ? session.join(ws, msg, code) : session.watch(ws);
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
        for (const session of sessions.values()) {
            if (session.isIdle(idleMs)) drop(session);
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

// pm2 (fork mode, ESM) launches this file through its own wrapper, so process.argv[1]
// points at pm2 internals rather than this script: the argv check alone misses that case,
// so also trust pm_id, which pm2 sets on every process it manages
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun || process.env.pm_id !== undefined) {
    const { config } = await import("dotenv");
    config();
    const port = Number(process.env.MP_PORT) || 3001;
    startServer({ port });
    console.log(`SquadGuessr multiplayer server listening on :${port}/mp`);
}
