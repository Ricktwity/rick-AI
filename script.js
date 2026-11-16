(function () {
  var AVATAR = "https://res.cloudinary.com/dqqyvozdw/image/upload/v1794829406/Ixzzqilpwcoxhypl940a.jpg";
  var STARTERS = [
    "Why does my Python loop never stop?",
    "Explain this error: undefined is not a function",
    "What is recursion? Show me a simple example",
    "Help me debug my JavaScript code"
  ];
  var chat = document.getElementById("chat"), scroller = document.getElementById("scroller"),
      form = document.getElementById("form"), input = document.getElementById("input"),
      sendBtn = document.getElementById("send");
  var history = [], busy = false;

  // ---- storage helpers (wrapped: storage can be unavailable) ----
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // ---- theme ----
  var root = document.documentElement;
  var savedTheme = load("rick-theme"); if (savedTheme) root.setAttribute("data-theme", savedTheme);
  document.getElementById("theme").onclick = function () {
    var dark = root.getAttribute("data-theme") === "dark" ||
      (!root.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
    var next = dark ? "light" : "dark"; root.setAttribute("data-theme", next); save("rick-theme", next);
  };

  // ---- tiny markdown renderer (escapes HTML first, so it is safe) ----
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function inline(s) {
    return esc(s).replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  }
  function md(text) {
    var out = "", parts = text.split("```");
    parts.forEach(function (part, i) {
      if (i % 2 === 1) { // code block (an unclosed fence still renders while streaming)
        var nl = part.indexOf("\n"), lang = nl > -1 ? part.slice(0, nl).trim() : "", code = nl > -1 ? part.slice(nl + 1) : part;
        out += '<div class="codebox"><div class="codebar"><span>' + esc(lang || "code") +
          '</span><button type="button" data-copy>Copy</button></div><pre><code>' + esc(code.replace(/\n$/, "")) + "</code></pre></div>";
        return;
      }
      var list = null, para = [];
      function flushP() { if (para.length) { out += "<p>" + para.join("<br>") + "</p>"; para = []; } }
      function flushL() { if (list) { out += "</" + list + ">"; list = null; } }
      part.split("\n").forEach(function (line) {
        var h = line.match(/^#{1,4}\s+(.*)/), ul = line.match(/^\s*[-*]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/);
        if (h) { flushP(); flushL(); out += "<h3>" + inline(h[1]) + "</h3>"; }
        else if (ul || ol) { flushP(); var t = ul ? "ul" : "ol"; if (list !== t) { flushL(); out += "<" + t + ">"; list = t; }
          out += "<li>" + inline((ul || ol)[1]) + "</li>"; }
        else if (!line.trim()) { flushP(); flushL(); }
        else { flushL(); para.push(inline(line)); }
      });
      flushP(); flushL();
    });
    return out;
  }

  // ---- rendering ----
  function scrollDown() { scroller.scrollTop = scroller.scrollHeight; }
  function addMsg(role, html) {
    var row = document.createElement("div"); row.className = "msg " + role;
    var b = document.createElement("div"); b.className = "bubble";
    if (role === "bot") { var a = document.createElement("img"); a.className = "av"; a.src = AVATAR; a.alt = ""; row.appendChild(a); b.innerHTML = html; }
    else b.textContent = html;
    row.appendChild(b); chat.appendChild(row); scrollDown(); return b;
  }
  function showHero() {
    chat.innerHTML = '<div class="hero"><img src="' + AVATAR + '" alt="rick AI"><h1>Stuck on your code?</h1>' +
      "<p>I’m rick AI. Paste your code or error message and I’ll help you find the bug and understand why it happened.</p>" +
      '<div class="starters"></div></div>';
    var box = chat.querySelector(".starters");
    STARTERS.forEach(function (s) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = s;
      b.onclick = function () { send(s); }; box.appendChild(b);
    });
  }
  chat.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy]"); if (!btn) return;
    var code = btn.closest(".codebox").querySelector("code").textContent;
    var done = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, function () {}); 
  });

  // ---- sending + streaming ----
  async function send(text) {
    text = (text || "").trim(); if (!text || busy) return;
    busy = true; sendBtn.disabled = true;
    if (!history.length) chat.innerHTML = "";
    history.push({ role: "user", content: text });
    addMsg("user", text);
    input.value = ""; resize();
    var bubble = addMsg("bot", '<span class="dots"><i></i><i></i><i></i></span>');
    var reply = "";
    try {
      var res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }) });
      if (!res.ok) { var j = {}; try { j = await res.json(); } catch (e) {} throw new Error(j.error || "Request failed (" + res.status + ")."); }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = "";
      for (;;) {
        var r = await reader.read(); if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var lines = buf.split("\n"); buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].indexOf("data:") !== 0) continue;
          try {
            var ev = JSON.parse(lines[i].slice(5));
            if (ev.type === "content_block_delta" && ev.delta && ev.delta.text) { reply += ev.delta.text; bubble.innerHTML = md(reply); scrollDown(); }
            else if (ev.type === "error") throw new Error("The AI service had a problem. Please try again.");
          } catch (pe) { if (pe.message && pe.message.indexOf("AI service") > -1) throw pe; }
        }
      }
      if (!reply) throw new Error("No reply came back. Please try again.");
      history.push({ role: "assistant", content: reply });
      save("rick-chat", JSON.stringify(history.slice(-20)));
    } catch (err) {
      bubble.innerHTML = (reply ? md(reply) : "") + '<p class="err">' + esc(err.message || "Something went wrong.") + " Send your message again to retry.</p>";
      if (!reply) history.pop();
    }
    busy = false; sendBtn.disabled = false; input.focus(); scrollDown();
  }

  // ---- input behavior ----
  function resize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 180) + "px"; }
  input.addEventListener("input", resize);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); } });
  form.addEventListener("submit", function (e) { e.preventDefault(); send(input.value); });
  document.getElementById("new").onclick = function () { if (busy) return; history = []; save("rick-chat", "[]"); showHero(); input.focus(); };

  // ---- restore previous chat ----
  try {
    var prev = JSON.parse(load("rick-chat") || "[]");
    if (Array.isArray(prev) && prev.length) {
      history = prev;
      prev.forEach(function (m) { if (m.role === "user") addMsg("user", m.content); else addMsg("bot", md(m.content)); });
    } else showHero();
  } catch (e) { showHero(); }
})();
