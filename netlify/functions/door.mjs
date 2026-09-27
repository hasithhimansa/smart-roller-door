```javascript
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

Environment variables required:

BLYNK_AUTH_TOKEN
BLYNK_SERVER
APP_PASSWORD
SESSION_SECRET
ALLOWED_ORIGIN

Example:

BLYNK_SERVER=https://sgp1.blynk.cloud

IMPORTANT:
Use the Blynk server shown in the bottom-right
of your Blynk Console.

Do NOT put BLYNK_AUTH_TOKEN in GitHub.
=========================================================
*/


const COOKIE_NAME =
    "roller_session";

const SESSION_TIME =
    12 * 60 * 60 * 1000;


/* =========================================================
   CORS
   ========================================================= */

function corsHeaders(){

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
   RESPONSE
   ========================================================= */

function json(
    data,
    status = 200,
    extraHeaders = {}
){

    return new Response(
        JSON.stringify(data),
        {
            status,

            headers:{
                ...corsHeaders(),
                ...extraHeaders
            }
        }
    );
}


/* =========================================================
   CONSTANT-TIME STRING CHECK
   ========================================================= */

function safeEqual(a,b){

    const aBuf =
        Buffer.from(
            String(a || "")
        );

    const bBuf =
        Buffer.from(
            String(b || "")
        );


    if(
        aBuf.length !==
        bBuf.length
    ){

        return false;
    }


    return crypto.timingSafeEqual(
        aBuf,
        bBuf
    );
}


/* =========================================================
   SESSION TOKEN
   ========================================================= */

function createSession(){

    const expires =
        Date.now() +
        SESSION_TIME;


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

function verifySession(request){

    const cookie =
        request.headers.get(
            "cookie"
        ) || "";


    const match =
        cookie.match(
            new RegExp(
               `${COOKIE_NAME}=([^;]+)`
            )
        );


    if(!match)
        return false;


    const token =
        match[1];


    const parts =
        token.split(".");


    if(parts.length !== 2)
        return false;


    const expires =
        Number(parts[0]);


    if(
        !expires ||
        Date.now() > expires
    ){

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
   BLYNK URL
   ========================================================= */

function blynkBase(){

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

async function blynkGet(
    path
){

    const token =
        process.env.BLYNK_AUTH_TOKEN;


    if(!token){

        throw new Error(
            "BLYNK_AUTH_TOKEN is not configured."
        );
    }


    const separator =
        path.includes("?")
        ? "&"
        : "?";


    const url =
        `${blynkBase()}${path}` +
        `${separator}token=` +
        encodeURIComponent(token);


    const response =
        await fetch(
            url,
            {
                method:"GET",
                redirect:"follow"
            }
        );


    const text =
        await response.text();


    if(!response.ok){

        throw new Error(
            `Blynk HTTP ${response.status}: ${text}`
        );
    }


    return text;
}


/* =========================================================
   GET BLYNK STATUS
   ========================================================= */

async function getBlynkStatus(){

    /*
       Check actual Blynk hardware
       connection status.
    */

    const onlineText =
        await blynkGet(
            "/external/api/isHardwareConnected"
        );


    const deviceOnline =
        onlineText
            .trim()
            .toLowerCase() ===
            "true";


    /*
       Get V0, V1, V2, V3, V4.
    */

    const allText =
        await blynkGet(
            "/external/api/getAll"
        );


    let values;

    try{

        values =
            JSON.parse(allText);

    }catch{

        throw new Error(
            "Invalid response from Blynk getAll."
        );
    }


    return {

        deviceOnline,

        command:
            values.v0 ?? 0,

        state:
            values.v1 ?? "CLOSED",

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
   SEND DOOR PRESS
   ========================================================= */

async function sendDoorPress(){

    /*
       Blynk HTTPS API:

       /external/api/update?token=TOKEN&V0=1

       Token stays inside Netlify.
    */

    const token =
        process.env.BLYNK_AUTH_TOKEN;


    if(!token){

        throw new Error(
            "BLYNK_AUTH_TOKEN is not configured."
        );
    }


    const url =
        `${blynkBase()}` +
        `/external/api/update` +
        `?token=${encodeURIComponent(token)}` +
        `&V0=1`;


    const response =
        await fetch(
            url,
            {
                method:"GET",
                redirect:"follow"
            }
        );


    const text =
        await response.text();


    if(!response.ok){

        throw new Error(
            `Blynk command failed: ` +
            `${response.status} ${text}`
        );
    }


    return true;
}


/* =========================================================
   MAIN FUNCTION
   ========================================================= */

export default async function(
    request
){

    /* Preflight */

    if(
        request.method ===
        "OPTIONS"
    ){

        return new Response(
            null,
            {
                status:204,
                headers:corsHeaders()
            }
        );
    }


    try{

        const url =
            new URL(
                request.url
            );


        /* =================================================
           LOGIN
           ================================================= */

        if(
            url.searchParams.get(
                "action"
            ) === "login"
        ){

            if(
                request.method !==
                "POST"
            ){

                return json(
                    {
                        error:
                            "Method not allowed"
                    },
                    405
                );
            }


            const body =
                await request.json();


            const password =
                body.password;


            if(
                !process.env.APP_PASSWORD ||
                !process.env.SESSION_SECRET
            ){

                return json(
                    {
                        error:
                            "Server authentication is not configured."
                    },
                    500
                );
            }


            if(
                !safeEqual(
                    password,
                    process.env.APP_PASSWORD
                )
            ){

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
                    ok:true
                },
                200,
                {
                    "Set-Cookie":
                        `${COOKIE_NAME}=${session}; ` +
                        `Max-Age=${Math.floor(
                            SESSION_TIME / 1000
                        )}; ` +
                        `Path=/; ` +
                        `HttpOnly; ` +
                        `Secure; ` +
                        `SameSite=None`
                }
            );
        }


        /* =================================================
           AUTH CHECK
           ================================================= */

        if(
            !verifySession(request)
        ){

            return json(
                {
                    error:
                        "Authentication required."
                },
                401
            );
        }


        /* =================================================
           GET STATUS
           ================================================= */

        if(
            request.method === "GET"
        ){

            const status =
                await getBlynkStatus();


            return json(
                status
            );
        }


        /* =================================================
           POST COMMAND
           ================================================= */

        if(
            request.method === "POST"
        ){

            let body = {};

            try{

                body =
                    await request.json();

            }catch{

                body = {};
            }


            if(
                body.action !== "press"
            ){

                return json(
                    {
                        error:
                            "Unknown action."
                    },
                    400
                );
            }


            /*
               First check whether ESP32 is online.
            */

            const before =
                await getBlynkStatus();


            if(
                !before.deviceOnline
            ){

                return json(
                    {
                        error:
                            "ESP32 is offline.",
                        deviceOnline:false
                    },
                    409
                );
            }


            /*
               Send V0 = 1.
            */

            await sendDoorPress();


            /*
               Give Blynk/ESP32 a small amount
               of time to process the command.
            */

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        180
                    )
            );


            const after =
                await getBlynkStatus();


            return json(
                {
                    ok:true,
                    deviceOnline:
                        after.deviceOnline,

                    state:
                        after.state,

                    position:
                        after.position,

                    nextDirection:
                        after.nextDirection
                }
            );
        }


        return json(
            {
                error:
                    "Method not allowed."
            },
            405
        );


    }catch(error){

        console.error(
            "ROLLER DOOR ERROR:",
            error
        );


        return json(
            {
                error:
                    error.message ||
                    "Internal server error."
            },
            500
        );
    }
}


/* =========================================================
   NETLIFY ROUTING
   ========================================================= */

export const config = {
    path: "/api/door"
};
```
