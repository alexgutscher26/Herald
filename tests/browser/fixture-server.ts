import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Browser-test fixture origin.
 *
 * Serves exactly the files the host would fetch (`public/widget/v1.js` and
 * `v1.css`) plus a minimal host page and a stub embed. The stub answers the
 * same postMessage protocol as the real frame, so launcher behaviour is
 * exercised without a database or a Next build.
 */

const PORT = 4173;
const HOST = "127.0.0.1";
const root = process.cwd();

const hostPage = (search: URLSearchParams) => {
  const trigger = search.get("trigger") === "1";
  const inline = search.get("inline") === "1";
  const nonce = search.get("nonce");
  const theme = search.get("theme") ?? "auto";
  const position = search.get("position") ?? "bottom-right";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Widget fixture</title>
  </head>
  <body>
    <button id="page-before" type="button">Page before</button>
    ${
      trigger
        ? `<button id="custom-launcher" type="button">Feedback <span id="badge"></span></button>`
        : ""
    }
    ${inline ? `<div id="herald-container" style="height: 560px"></div>` : ""}
    <button id="page-after" type="button">Page after</button>
    <script
      async
      id="herald-widget"
      src="/widget/v1.js"
      ${nonce ? `nonce="${nonce}"` : ""}
      data-project="demo/demo"
      data-key="hpk_012345678901234567890123456789"
      data-position="${position}"
      data-theme="${theme}"
      ${trigger ? 'data-trigger="#custom-launcher"' : ""}
      ${nonce ? `data-nonce="${nonce}"` : ""}
    ></script>
    ${
      inline
        ? `<script>
             document.getElementById("herald-widget").addEventListener("load", function () {
               window.HeraldWidget.embed("#herald-container", { panel: "feedback" });
             });
           </script>`
        : ""
    }
  </body>
</html>`;
};

const embedPage = () => `<!doctype html>
<html lang="en">
  <body>
    <button id="inside" type="button">Inside the panel</button>
    <button id="close" type="button">Close</button>
    <script>
      var params = new URLSearchParams(location.search);
      var target = params.get("host");
      function send(payload) {
        if (!target) return;
        parent.postMessage(Object.assign({ source: "herald-widget" }, payload), target);
      }
      function state(unread) {
        send({
          type: "state",
          unread: unread,
          presence: { online: true },
          identified: false,
          accent: "#123456",
          accentFg: "#ffffff",
          theme: params.get("theme") || "auto",
          position: "top-left"
        });
      }
      state(2);
      addEventListener("message", function (event) {
        if (!event.data || event.data.source !== "herald-widget-host") return;
        if (event.data.type === "refresh") state(2);
      });
      addEventListener("keydown", function (event) {
        if (event.key === "Escape") send({ type: "close" });
      });
      document.getElementById("close").addEventListener("click", function () {
        send({ type: "close" });
      });
    </script>
  </body>
</html>`;

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/widget/v1.js") {
      const body = await readFile(path.join(root, "public/widget/v1.js"));
      return new Response(body, {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }

    if (url.pathname === "/widget/v1.css") {
      const body = await readFile(path.join(root, "public/widget/v1.css"));
      return new Response(body, {
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }

    if (url.pathname === "/host") {
      const nonce = url.searchParams.get("nonce");
      const enforceNonceCsp =
        url.searchParams.get("csp") === "1" && Boolean(nonce);
      return new Response(hostPage(url.searchParams), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          ...(enforceNonceCsp
            ? {
                "content-security-policy": `script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-src 'self'`,
              }
            : {}),
        },
      });
    }

    if (url.pathname === "/p/demo/demo/embed") {
      return new Response(embedPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`widget fixture on http://${HOST}:${server.port}`);
