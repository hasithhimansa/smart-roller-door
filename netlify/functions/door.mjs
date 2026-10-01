import crypto from "node:crypto";

/*
=========================================================
SMART ROLLER DOOR BACKEND
=========================================================

Frontend:
GitHub Pages

Backend:
Netlify Function

Cloud:
Blynk Cloud

Hardware:
ESP32

Environment variables:

BLYNK_AUTH_TOKEN
BLYNK_SERVER
APP_PASSWORD
SESSION_SECRET
ALLOWED_ORIGIN
=========================================================
*/

const COOKIE_NAME = "roller_session";
const SESSION_TIME = 12 * 60 * 60 * 1000;

/* =========================================================
   CORS
   ========================================================= */

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin":
            process.env.ALLOWED_ORIGIN || "*",

        "Access-Control-Allow-Credentials":
            "true",

        "Access-Control-Allow-Headers":
            "Content-Type",

        "Access-Control-Allow-Methods":
            "GET,POST,OPTIONS",

        "Content-Type":
            "application/json"
    };
}

/* =========================================================
   JSON RESPONSE
   ========================================================= */

function json(data, status = 200, extraHeaders = {}) {
    return new Response(
        JSON.stringify(data),
        {
            status,
            headers: {
                ...corsHeaders(),
                ...extraHeaders
            }
        }
    );
}

/* =========================================================
   CONSTANT-TIME STRING CHECK
   ========================================================= */

function safeEqual(a, b) {
    const aBuf =
        Buffer.from(String(a || ""));

    const bBuf =
        Buffer.from(String(b || ""));

    if (
        aBuf.length !== bBuf.length
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        aBuf,
        bBuf
    );
}

/* =========================================================
   CREATE SESSION
   ========================================================= */

function createSession() {

    const expires =
        Date.now() + SESSION_TIME;

    const payload =
        String(expires);

    const signature =
        crypto
            .createHmac(
                "sha256",
                process.env.SESSION_SECRET
            )
            .update(payload)
            .digest("hex");

    return (
        payload +
        "." +
        signature
    );
}

/* =========================================================
   VERIFY SESSION
   ========================================================= */

function verifySession(request) {

    const cookie =
        request.headers.get("cookie") || "";

    const match =
        cookie.match(
            new RegExp(
                COOKIE_NAME +
                "=([^;]+)"
            )
        );

    if (!match) {
        return false;
    }

    const token =
        match[1];

    const parts =
        token.split(".");

    if (
        parts.length !== 2
    ) {
        return false;
    }

    const expires =
        Number(parts[0]);

    if (
        !expires ||
        Date.now() > expires
    ) {
        return false;
    }

    const expected =
        crypto
            .createHmac(
                "sha256",
                process.env.SESSION_SECRET
            )
            .update(parts[0])
            .digest("hex");

    return safeEqual(
        parts[1],
        expected
    );
}

/* =========================================================
   BLYNK BASE URL
   ========================================================= */

function blynkBase() {

    let server =
        process.env.BLYNK_SERVER ||
        "https://blynk.cloud";

    server =
        server.replace(
            /\/+$/,
            ""
        );

    return server;
}

/* =========================================================
   BLYNK GET
   ========================================================= */

function blynkError(status, text) {
    const quotaExceeded =
        (status === 403 || status === 429) &&
        /messages\s+limit\s+reached/i.test(text);

    const error = new Error(
        quotaExceeded
            ? "Blynk's message quota has been reached. Remote control is unavailable. Check message usage in Blynk Console and wait for the quota to reset or upgrade your plan, then reload this page."
            : "Blynk request failed (HTTP " + status + ")."
    );

    error.code = quotaExceeded
        ? "BLYNK_MESSAGE_LIMIT"
        : "BLYNK_REQUEST_FAILED";
    error.status = quotaExceeded ? 503 : 502;

    return error;
}

async function blynkGet(path) {

    const token =
        process.env.BLYNK_AUTH_TOKEN;

    if (!token) {
        throw new Error(
            "BLYNK_AUTH_TOKEN is not configured."
        );
    }

    const separator =
        path.includes("?")
            ? "&"
            : "?";

    const url =
        blynkBase() +
        path +
        separator +
        "token=" +
        encodeURIComponent(token);

    const response =
        await fetch(
            url,
            {
                method: "GET",
                redirect: "follow"
            }
        );

    const text =
        await response.text();

    if (!response.ok) {

        throw blynkError(response.status, text);
    }

    return text;
}

/* =========================================================
   GET BLYNK DATAS
   
   IMPORTANT:
   Only ONE getAll request for normal status.
   ========================================================= */

async function getBlynkData() {

    const allText =
        await blynkGet(
            "/external/api/getAll"
        );

    let values;

    try {

        values =
            JSON.parse(allText);

    } catch {

        throw new Error(
            "Invalid response from Blynk getAll."
        );
    }

    return {

        command:
            values.v0 ?? 0,

        state:
            String(
                values.v1 ??
                "CLOSED"
            ).toUpperCase(),

        position:
            Number(
                values.v2 ?? 0
            ),

        nextDirection:
            String(
                values.v3 ??
                "OPEN"
            ).toUpperCase(),

        onlineDatastream:
            values.v4 ?? 0
    };
}

/* =========================================================
   CHECK ESP32 HARDWARE
   ========================================================= */

async function isHardwareConnected() {

    const onlineText =
        await blynkGet(
            "/external/api/isHardwareConnected"
        );

    return (
        onlineText
            .trim()
            .toLowerCase() ===
        "true"
    );
}

/* =========================================================
   SEND DOOR PRESS
   ========================================================= */

async function sendDoorPress() {
    await blynkGet("/external/api/update?V0=1");

    return true;
}

/* =========================================================
   MAIN NETLIFY FUNCTION
   ========================================================= */

export default async function(request) {

    /* =====================================================
       CORS PREFLIGHT
       ===================================================== */

    if (
        request.method === "OPTIONS"
    ) {

        return new Response(
            null,
            {
                status: 204,
                headers:
                    corsHeaders()
            }
        );
    }

    try {

        const url =
            new URL(
                request.url
            );

        const queryAction =
            url.searchParams.get(
                "action"
            );

        /* =================================================
           LOGIN
           ================================================= */

        if (
            queryAction === "login"
        ) {

            if (
                request.method !==
                "POST"
            ) {

                return json(
                    {
                        error:
                            "Method not allowed"
                    },
                    405
                );
            }

            let body;

            try {

                body =
                    await request.json();

            } catch {

                return json(
                    {
                        error:
                            "Invalid JSON."
                    },
                    400
                );
            }

            const password =
                body.password;

            if (
                !process.env.APP_PASSWORD ||
                !process.env.SESSION_SECRET
            ) {

                return json(
                    {
                        error:
                            "Server authentication is not configured."
                    },
                    500
                );
            }

            if (
                !safeEqual(
                    password,
                    process.env.APP_PASSWORD
                )
            ) {

                return json(
                    {
                        error:
                            "Incorrect password."
                    },
                    401
                );
            }

            const session =
                createSession();

            return json(
                {
                    ok: true
                },
                200,
                {
                    "Set-Cookie":
                        COOKIE_NAME +
                        "=" +
                        session +
                        "; Max-Age=" +
                        Math.floor(
                            SESSION_TIME /
                            1000
                        ) +
                        "; Path=/; HttpOnly; Secure; SameSite=None"
                }
            );
        }

        /* =================================================
           LOGOUT
           ================================================= */

        if (
            queryAction === "logout"
        ) {

            if (
                request.method !==
                "POST"
            ) {

                return json(
                    {
                        error:
                            "Method not allowed"
                    },
                    405
                );
            }

            return json(
                {
                    ok: true
                },
                200,
                {
                    "Set-Cookie":
                        COOKIE_NAME +
                        "=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None"
                }
            );
        }

        /* =================================================
           SESSION
           ================================================= */

        if (
            queryAction === "session"
        ) {

            if (
                request.method !==
                "GET"
            ) {

                return json(
                    {
                        error:
                            "Method not allowed"
                    },
                    405
                );
            }

            return json(
                {
                    authenticated:
                        verifySession(
                            request
                        )
                }
            );
        }

        /* =================================================
           AUTHENTICATION
           ================================================= */

        if (
            !verifySession(request)
        ) {

            return json(
                {
                    error:
                        "Authentication required."
                },
                401
            );
        }

        /* =================================================
           STATUS
           
           One Blynk request only:
           getAll
           
           We use V4 as the displayed online
           datastream when available.
           ================================================= */

        if (
            request.method === "GET" &&
            (
                !queryAction ||
                queryAction === "status"
            )
        ) {

            const data =
                await getBlynkData();

            return json(
                {
                    deviceOnline:
                        Number(
                            data.onlineDatastream
                        ) === 1,

                    command:
                        data.command,

                    state:
                        data.state,

                    position:
                        data.position,

                    nextDirection:
                        data.nextDirection,

                    onlineDatastream:
                        data.onlineDatastream
                }
            );
        }

        /* =================================================
           PRESS COMMAND
           
           IMPORTANT:

           Only check hardware once,
           then send ONE V0 command.

           No "after" getAll request.
           ================================================= */

        if (
            request.method === "POST"
        ) {

            let body = {};

            try {

                body =
                    await request.json();

            } catch {

                body = {};
            }

            const action =
                queryAction ||
                body.action;

            if (
                action !== "press"
            ) {

                return json(
                    {
                        error:
                            "Unknown action."
                    },
                    400
                );
            }

            /* =============================================
               CHECK ESP32
               ============================================= */

            const deviceOnline =
                await isHardwareConnected();

            if (
                !deviceOnline
            ) {

                return json(
                    {
                        error:
                            "ESP32 is offline.",

                        deviceOnline:
                            false
                    },
                    409
                );
            }

            /* =============================================
               SEND V0 = 1
               ============================================= */

            await sendDoorPress();

            /*
               Do NOT call getBlynkStatus()
               here.

               The frontend will receive:
               ok:true

               and the next normal polling
               request will get the updated state.
            */

            return json(
                {
                    ok: true,

                    deviceOnline:
                        true
                }
            );
        }

        /* =================================================
           UNKNOWN ACTION
           ================================================= */

        return json(
            {
                error:
                    "Unknown action."
            },
            400
        );

    } catch (error) {

        console.error(
            "ROLLER DOOR ERROR:",
            error?.code || "INTERNAL_ERROR"
        );

        return json(
            {
                error:
                    error?.code ? error.message :
                    "Internal server error.",

                code:
                    error?.code || "INTERNAL_ERROR"
            },
            error?.status || 500
        );
    }
}

/* =========================================================
   NETLIFY ROUTING
   ========================================================= */

export const config = {
    path: "/api/door"
};
