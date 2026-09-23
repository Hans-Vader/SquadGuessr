import { WebSocketServer } from "ws";
import { randomInt } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Session } from "./session.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const IDLE_MS = 30 * 60 * 1000;
const TICK_MS = 500;
const HEARTBEAT_MS = 30 * 1000;
const MAX_SESSIONS = 1000;

/**
 * Multiplayer session server: routes socket messages to Session instances
 */
export function startServer({ port = 3001, idleMs = IDLE_MS, maxSessions = MAX_SESSIONS } = {}) {
    const wss = new WebSocketServer({ port, path: "/mp", maxPayload: 64 * 1024 });
    const sessions = new Map();
    const sessionOf = new Map();

    // a broadcast hands the same msg object to every recipient: serialize it once
    const serialized = new WeakMap();
    const send = (ws, msg) => {
        if (ws.readyState !== ws.OPEN) return;
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

    const leaveCurrent = (ws) => {
        sessionOf.get(ws)?.disconnect(ws);
        sessionOf.delete(ws);
    };

    const route = (ws, msg) => {
        if (msg.type === "create") {
            leaveCurrent(ws);
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
            leaveCurrent(ws);
            const session = sessions.get(String(msg.code ?? "").toUpperCase());
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
            route(ws, msg);
        });
        ws.on("close", () => leaveCurrent(ws));
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
