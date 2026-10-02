let command = "NONE";

let status = {
  state: "CLOSED",
  position: 0,
  nextDirection: "OPEN",
  online: false,
  lastCommand: "NONE",
  updatedAt: Date.now()
};

const DEVICE_KEY = process.env.DEVICE_KEY;
const APP_PASSWORD = process.env.APP_PASSWORD;

function json(data, statusCode = 200) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function authorized(request) {
  const key = request.headers.get("x-device-key");
  return key && DEVICE_KEY && key === DEVICE_KEY;
}

export default async function handler(request) {
  const url = new URL(request.url);

  // -----------------------------
  // DEVICE: GET COMMAND
  // -----------------------------
  if (request.method === "GET" && url.searchParams.get("device") === "1") {
    if (!authorized(request)) {
      return json({ error: "Unauthorized" }, 401);
    }

    status.online = true;

    return json({
      command,
      status
    });
  }

  // -----------------------------
  // DEVICE: UPDATE STATUS
  // -----------------------------
  if (request.method === "POST" && url.searchParams.get("device") === "1") {
    if (!authorized(request)) {
      return json({ error: "Unauthorized" }, 401);
    }

    try {
      const body = await request.json();

      status = {
        state: body.state ?? status.state,
        position: Number(body.position ?? status.position),
        nextDirection: body.nextDirection ?? status.nextDirection,
        online: true,
        lastCommand: body.lastCommand ?? status.lastCommand,
        updatedAt: Date.now()
      };

      command = "NONE";

      return json({
        ok: true,
        status
      });
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
  }

  // -----------------------------
  // WEBSITE: LOGIN
  // -----------------------------
  if (request.method === "POST") {
    try {
      const body = await request.json();

      if (body.action === "login") {
        if (
          APP_PASSWORD &&
          body.password === APP_PASSWORD
        ) {
          return json({
            ok: true,
            loggedIn: true
          });
        }

        return json({
          ok: false,
          error: "Wrong password"
        }, 401);
      }

      // -----------------------------
      // WEBSITE: PRESS BUTTON
      // -----------------------------
      if (body.action === "press") {
        command = "PRESS";

        return json({
          ok: true,
          command
        });
      }

    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
  }

  // -----------------------------
  // WEBSITE: GET STATUS
  // -----------------------------
  if (request.method === "GET") {
    const age = Date.now() - status.updatedAt;

    return json({
      ...status,
      online: age < 10000
    });
  }

  return json({
    error: "Method not allowed"
  }, 405);
}
