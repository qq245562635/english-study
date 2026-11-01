(function () {
  "use strict";

  // ---------- 数据 ----------
  const WORDS = window.WORDS_RAW.trim().split("\n").map((line) => {
    const [w, pos, zh, ex, exZh] = line.split("|");
    return { w, pos, zh, ex, exZh };
  });
  const SCENES = window.SCENES_RAW.map((s) => ({
    ...s,
    lines: s.lines.trim().split("\n").map((line, i) => {
      const [en, zh, tip] = line.split("|");
      return { id: s.id + "-" + i, en, zh, tip: tip || "" };
    }),
  }));
  const ALL_PHRASES = SCENES.flatMap((s) => s.lines.map((l) => ({ ...l, scene: s })));

  // 复习间隔（天）：盒子越高，隔得越久
  const INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60];
  const MASTERED_BOX = 5;
  const REVIEW_CAP = 20;

  // ---------- 存储 ----------
  const KEY = "english-study-v1";
  const DEFAULT = {
    words: {},      // word -> { box, due, seen }
    phrases: {},    // phraseId -> 学会的日期
    days: {},       // 日期 -> { newWords, reviewed, phrases, done }
    readings: {},   // 短文 id -> { score, total, date, last }
    settings: { newPerDay: 5, phrasesPerDay: 3, rate: 0.9 },
  };
  let S = load();

  function normalize(d) {
    return { ...JSON.parse(JSON.stringify(DEFAULT)), ...d, settings: { ...DEFAULT.settings, ...((d && d.settings) || {}) } };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* 浏览器不允许存储时就用默认值 */ }
    return normalize({});
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 忽略 */ }
    Sync.schedule();
  }

  // ---------- 云端同步（部署在 Cloudflare 上时可用） ----------
  const Sync = (function () {
    const TOKEN_KEY = "english-study-sync-token";
    let available = false;   // 服务器是否存在并已配置
    let timer = null;
    let status = "";         // 给“我的”页面显示
    let lastOk = 0;
    const listeners = [];

    function token() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
    function setToken(t) {
      try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 忽略 */ }
    }
    function on() { return available && !!token(); }
    function setStatus(s) { status = s; listeners.forEach((f) => f()); }

    async function call(method, body, keepalive) {
      const res = await fetch("api/progress", {
        method,
        headers: { authorization: "Bearer " + token(), "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        keepalive: !!keepalive,
        cache: "no-store",
      });
      if (res.status === 401) throw new Error("unauthorized");
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    }
    function adopt(remote) {
      S = normalize(window.mergeProgress(S, remote));
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 忽略 */ }
    }
    function fail(e) {
      setStatus(e.message === "unauthorized" ? "同步密码不对" : navigator.onLine === false ? "没有网络，联网后会自动同步" : "同步失败，稍后会重试");
      return false;
    }
    async function pull() {
      if (!on()) return false;
      try {
        adopt(await call("GET"));
        lastOk = Date.now();
        setStatus("已同步");
        return true;
      } catch (e) { return fail(e); }
    }
    async function push(keepalive) {
      clearTimeout(timer); timer = null;
      if (!on()) return false;
      try {
        adopt(await call("PUT", S, keepalive));
        lastOk = Date.now();
        setStatus("已同步");
        return true;
      } catch (e) { return fail(e); }
    }
    function schedule() {
      if (!on()) return;
      setStatus("等待上传……");
      clearTimeout(timer);
      timer = setTimeout(() => push(), 2000);
    }
    async function init() {
      try {
        const r = await fetch("api/ping", { cache: "no-store" });
        const d = r.ok ? await r.json() : null;
        available = !!(d && d.configured);
      } catch (e) { available = false; }
      if (on()) await pull();
      setStatus(status);
      return available;
    }
    // 切到后台或关闭页面时，立刻把没传的记录传上去
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && timer) push(true);
      if (document.visibilityState === "visible" && on()) pull().then((ok) => ok && refresh());
    });
    window.addEventListener("online", () => on() && push());

    return {
      init, pull, push, schedule, on, token, setToken,
      get available() { return available; },
      get status() { return status; },
      get lastOk() { return lastOk; },
      onChange(f) { listeners.push(f); },
      async remove() { if (on()) await call("DELETE"); },
    };
  })();

  // ---------- 日期工具 ----------
  function dayStr(d) {
    const x = d || new Date();
    return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  }
  function addDays(str, n) {
    const [y, m, d] = str.split("-").map(Number);
    return dayStr(new Date(y, m - 1, d + n));
  }
  const today = () => dayStr();
  function todayRec() {
    const t = today();
    if (!S.days[t]) S.days[t] = { newWords: 0, reviewed: 0, phrases: 0, done: false };
    return S.days[t];
  }
  function streak() {
    let n = 0;
    let d = today();
    if (!(S.days[d] && S.days[d].done)) d = addDays(d, -1); // 今天还没完成不算断
    while (S.days[d] && S.days[d].done) { n++; d = addDays(d, -1); }
    return n;
  }

  // ---------- 发音 ----------
  let voice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const vs = speechSynthesis.getVoices().filter((v) => /^en[-_]US/i.test(v.lang));
    const pref = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Alex"];
    voice = pref.map((p) => vs.find((v) => v.name.includes(p))).find(Boolean) || vs[0] || null;
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  // 优先播放提前录好的真人风格录音（audio/），没有录音时才用浏览器自带发音
  const player = new Audio();
  player.preservesPitch = true;
  function speak(text, rate) {
    const file = window.AUDIO && window.AUDIO[text];
    if (file) {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      player.pause();
      player.src = "audio/" + file + ".mp3";
      // 录音本身是正常语速；设置里的“稍慢”等在此基础上调整
      player.playbackRate = Math.max(0.5, Math.min(1.1, (rate || S.settings.rate) + 0.1));
      player.play().catch(() => speakTTS(text, rate));
      return;
    }
    speakTTS(text, rate);
  }
  function speakTTS(text, rate) {
    if (!("speechSynthesis" in window)) { toast("这个浏览器不支持发音，建议用 Chrome 或 Safari"); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    if (voice) u.voice = voice;
    u.rate = rate || S.settings.rate;
    speechSynthesis.speak(u);
  }

  // ---------- 跟读识别 ----------
  const Recog = window.SpeechRecognition || window.webkitSpeechRecognition;
  function norm(s) {
    return s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  }
  function listen(target, onResult) {
    if (!Recog) { onResult(null); return; }
    const r = new Recog();
    r.lang = "en-US";
    r.interimResults = false;
    r.maxAlternatives = 3;
    r.onresult = (e) => {
      const alts = Array.from(e.results[0]).map((a) => a.transcript);
      const want = norm(target);
      let best = { said: alts[0] || "", score: 0, missing: want };
      alts.forEach((said) => {
        const got = new Set(norm(said));
        const missing = want.filter((w) => !got.has(w));
        const score = want.length ? (want.length - missing.length) / want.length : 0;
        if (score > best.score) best = { said, score, missing };
      });
      onResult(best);
    };
    r.onerror = (e) => onResult({ error: e.error });
    r.start();
    return r;
  }

  // ---------- 单词复习逻辑 ----------
  function wordState(w) { return S.words[w]; }
  function wordLevel(w) {
    const st = wordState(w);
    if (!st) return 0;           // 没学过
    if (st.box >= MASTERED_BOX) return 3; // 已掌握
    if (st.box >= 3) return 2;   // 熟悉
    return 1;                    // 学习中
  }
  const LEVEL_TEXT = ["未学", "学习中", "熟悉", "已掌握"];

  function dueWords() {
    const t = today();
    return WORDS.filter((x) => { const st = wordState(x.w); return st && st.due <= t; });
  }
  function newWordsLeftToday() {
    return Math.max(0, S.settings.newPerDay - todayRec().newWords);
  }
  function nextNewWords(n) {
    return WORDS.filter((x) => !wordState(x.w)).slice(0, n);
  }

  function grade(word, isNew, g) {
    // g: 0 不认识，1 模糊，2 认识
    const t = today();
    const rec = todayRec();
    let st = S.words[word];
    if (!st) { st = S.words[word] = { box: 0, due: t, seen: t }; }
    if (isNew) rec.newWords++; else rec.reviewed++;
    if (g === 0) st.box = 1;
    else if (g === 1) st.box = Math.max(1, Math.min(st.box, 2));
    else st.box = Math.min(INTERVALS.length - 1, st.box + 1);
    st.due = g === 0 ? t : addDays(t, INTERVALS[st.box]);
    st.last = Date.now();
    save();
  }

  // 标记为“早就会了”：直接算已掌握，60 天后才偶尔抽查一次，不占每天新词名额
  function markKnown(list) {
    const t = today();
    const top = INTERVALS.length - 1;
    list.forEach((w) => {
      S.words[w] = { box: top, due: addDays(t, INTERVALS[top]), seen: t, last: Date.now(), known: true };
    });
    save();
  }

  // ---------- 句子逻辑 ----------
  function todaysPhrases() {
    const t = today();
    const learnedToday = ALL_PHRASES.filter((p) => S.phrases[p.id] === t);
    const need = Math.max(0, S.settings.phrasesPerDay - learnedToday.length);
    const next = ALL_PHRASES.filter((p) => !S.phrases[p.id]).slice(0, need);
    return { learnedToday, next };
  }
  function markPhrase(id) {
    if (S.phrases[id]) return;
    S.phrases[id] = today();
    todayRec().phrases++;
    save();
  }

  function checkDayDone() {
    const rec = todayRec();
    const wordsDone = dueWords().length === 0 && (newWordsLeftToday() === 0 || nextNewWords(1).length === 0);
    const { next } = todaysPhrases();
    const phrasesDone = next.length === 0;
    if (wordsDone && phrasesDone && !rec.done) {
      rec.done = true;
      save();
      toast("🎉 今天的任务完成了！");
    }
    return { wordsDone, phrasesDone };
  }

  // ---------- 界面工具 ----------
  const view = document.getElementById("view");
  function h(html) { view.innerHTML = html; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  let toastTimer;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }
  function updateStreak() {
    document.getElementById("streakBadge").textContent = "🔥 " + streak() + " 天";
  }

  // 全局点击：所有带 data-say 的按钮都朗读
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-say]");
    if (b) { e.stopPropagation(); speak(b.getAttribute("data-say"), b.dataset.rate ? Number(b.dataset.rate) : undefined); }
  }, true);

  // ---------- 页面：今天 ----------
  function renderToday() {
    const { wordsDone, phrasesDone } = checkDayDone();
    const rec = todayRec();
    const due = dueWords().length;
    const newLeft = Math.min(newWordsLeftToday(), nextNewWords(S.settings.newPerDay).length);
    const { learnedToday, next } = todaysPhrases();
    const totalSteps = 2;
    const doneSteps = (wordsDone ? 1 : 0) + (phrasesDone ? 1 : 0);

    const hello = rec.done
      ? `<div class="card hero-done"><div class="big">🎉</div><h2>今天完成啦！</h2><p class="muted">已连续学习 ${streak()} 天。明天继续，坚持就是胜利。</p></div>`
      : `<div class="card"><h2>今天的 15 分钟</h2><p class="muted">先复习单词，再学新词，最后跟读几句美国职场常用句。每天做完就算打卡。</p>
         <div class="progress"><div style="width:${(doneSteps / totalSteps) * 100}%"></div></div></div>`;

    h(`${hello}
      <div class="card">
        <div class="task ${wordsDone ? "done" : ""}">
          <div class="check">${wordsDone ? "✓" : "1"}</div>
          <div class="info">
            <div class="title">单词卡片（约 8 分钟）</div>
            <div class="muted small">${wordsDone
              ? `今天复习 ${rec.reviewed} 次，新学 ${rec.newWords} 个`
              : `待复习 ${due} 个 · 新单词 ${newLeft} 个`}</div>
          </div>
          ${wordsDone ? "" : `<button class="btn primary" id="goWords">开始</button>`}
        </div>
        <div class="task ${phrasesDone ? "done" : ""}">
          <div class="check">${phrasesDone ? "✓" : "2"}</div>
          <div class="info">
            <div class="title">职场句子跟读（约 7 分钟）</div>
            <div class="muted small">${phrasesDone ? `今天学会 ${learnedToday.length} 句` : `还剩 ${next.length} 句`}</div>
          </div>
          ${phrasesDone ? "" : `<button class="btn primary" id="goPhrases">开始</button>`}
        </div>
      </div>
      ${(() => { const nr = READINGS.find((x) => !S.readings[x.id]); return nr ? `<div class="card"><div class="task" style="padding:0">
          <div class="check">📖</div>
          <div class="info"><div class="title">选做：读一篇短文（约 5 分钟）</div>
          <div class="muted small">${esc(nr.title)} · ${esc(nr.titleZh)}</div></div>
          <button class="btn" id="goRead">去读</button></div></div>` : ""; })()}
      ${rec.done ? `<div class="card"><h3>还想多学一点？</h3>
        <div class="row wrap"><button class="btn" id="moreWords">再学 5 个新单词</button>
        <button class="btn" id="morePhrases">再学 3 句</button></div></div>` : ""}
      ${Object.keys(S.words).length < 40 ? `<div class="card"><h3>单词太简单？</h3>
        <p class="muted small" style="margin:0 0 10px">新单词卡片上可以点“我认识，跳过”。也可以先用“快速筛词”把会的词一次性筛掉。</p>
        <button class="btn block" id="goSieve">⚡ 快速筛词</button></div>` : ""}
      <div class="card"><h3>💡 小建议</h3><p class="muted small">点 🔊 听美式发音，然后自己大声说出来。开口说比只看有用得多。</p></div>
    `);
    const g = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    g("goWords", () => startWordSession());
    g("goSieve", () => startSieve());
    g("goRead", () => { const nr = READINGS.find((x) => !S.readings[x.id]); if (nr) openReading(nr.id); });
    g("goPhrases", () => startPhraseSession());
    g("moreWords", () => startWordSession(5));
    g("morePhrases", () => startPhraseSession(3));
  }

  // ---------- 单词卡片流程 ----------
  function startWordSession(extraNew) {
    currentTab = "session";
    const reviews = dueWords().slice(0, REVIEW_CAP).map((x) => ({ ...x, isNew: false }));
    const nNew = extraNew != null ? extraNew : newWordsLeftToday();
    const news = nextNewWords(nNew).map((x) => ({ ...x, isNew: true }));
    const queue = [...reviews, ...news];
    if (!queue.length) { toast("现在没有要复习的单词"); renderToday(); return; }
    const total = queue.length;
    let doneCount = 0;
    let flipped = false;

    function show() {
      if (!queue.length) {
        checkDayDone();
        updateStreak();
        h(`<div class="card hero-done"><div class="big">👏</div><h2>单词完成！</h2>
          <p class="muted">做得好。接下来跟读几句职场英语吧。</p>
          <button class="btn primary block" id="next">继续：句子跟读</button>
          <p></p><button class="btn block" id="home">回到今天</button></div>`);
        document.getElementById("next").onclick = () => startPhraseSession();
        document.getElementById("home").onclick = () => go("today");
        return;
      }
      const c = queue[0];
      flipped = false;
      h(`<div class="counter">${doneCount} / ${total}</div>
        <div class="progress" style="margin-bottom:12px"><div style="width:${(doneCount / total) * 100}%"></div></div>
        <div class="card flash" id="card">
          <span class="tag ${c.isNew ? "new" : ""}">${c.isNew ? "新单词" : "复习"}</span>
          <div class="word">${esc(c.w)}</div>
          <div class="row" style="justify-content:center">
            <button class="icon-btn" data-say="${esc(c.w)}" aria-label="发音">🔊</button>
            <button class="icon-btn" data-say="${esc(c.w)}" data-rate="0.6" aria-label="慢速发音">🐢</button>
          </div>
          <div id="back" hidden>
            <div class="pos">${esc(c.pos)}</div>
            <div class="meaning">${esc(c.zh)}</div>
            <div class="example" style="margin-top:10px">
              <div class="row"><div class="en" style="flex:1">${esc(c.ex)}</div>
              <button class="icon-btn" data-say="${esc(c.ex)}" aria-label="朗读例句">🔊</button></div>
              <div class="muted small">${esc(c.exZh)}</div>
            </div>
          </div>
          <p class="muted small" id="hint">${c.isNew ? "先听发音、跟着读一遍，再点下面看意思" : "想一想它的意思，再点下面看答案"}</p>
        </div>
        <div id="actions">${c.isNew
          ? `<div class="row"><button class="btn" style="flex:1" id="known">我认识，跳过</button><button class="btn primary" style="flex:1" id="flip">看意思</button></div>`
          : `<button class="btn primary block" id="flip">看意思</button>`}</div>`);
      speak(c.w);
      document.getElementById("flip").onclick = flip;
      const kb = document.getElementById("known");
      if (kb) kb.onclick = skipKnown;
    }
    function flip() {
      if (flipped) return;
      flipped = true;
      const c = queue[0];
      document.getElementById("back").hidden = false;
      document.getElementById("hint").hidden = true;
      document.getElementById("actions").innerHTML = c.isNew
        ? `<button class="btn good block" data-g="2">记住了</button>`
        : `<div class="grid3"><button class="btn bad" data-g="0">不认识</button>
           <button class="btn warn" data-g="1">模糊</button><button class="btn good" data-g="2">认识</button></div>`;
      document.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => answer(Number(b.dataset.g))));
    }
    // 认识的新词直接标为已会，再补一个新词进来，保证每天学到的都是不会的
    function skipKnown() {
      const c = queue.shift();
      markKnown([c.w]);
      const inQueue = new Set(queue.map((x) => x.w));
      const more = WORDS.find((x) => !wordState(x.w) && !inQueue.has(x.w));
      if (more) queue.push({ ...more, isNew: true });
      else doneCount++;
      toast("已跳过：" + c.w);
      show();
    }
    function answer(g) {
      const c = queue.shift();
      // 新单词第一次看见：放进第 1 个盒子，明天复习
      grade(c.w, c.isNew, c.isNew ? 1 : g);
      if (!c.isNew && g === 0) queue.push({ ...c, again: true }); // 不认识的今天再来一次
      else doneCount++;
      show();
    }
    show();
  }

  // ---------- 句子跟读流程 ----------
  function phraseBlock(p, opts) {
    const learned = !!S.phrases[p.id];
    return `<div class="phrase ${learned ? "learned" : ""}" data-pid="${p.id}">
      <div class="row" style="align-items:flex-start">
        <div style="flex:1">
          <div class="en">${esc(p.en)}</div>
          <div class="zh">${esc(p.zh)}</div>
          ${p.tip ? `<div class="tip">💡 ${esc(p.tip)}</div>` : ""}
        </div>
        <button class="icon-btn" data-say="${esc(p.en)}" aria-label="发音">🔊</button>
      </div>
      <div class="row wrap" style="margin-top:8px">
        <button class="btn" data-say="${esc(p.en)}" data-rate="0.6">🐢 慢速</button>
        ${Recog ? `<button class="btn" data-rec="${p.id}">🎤 跟读打分</button>` : ""}
        ${opts && opts.learnBtn && !learned ? `<button class="btn good" data-learn="${p.id}">我会了</button>` : ""}
      </div>
      <div class="res"></div>
    </div>`;
  }
  function bindPhraseButtons(onLearn) {
    view.querySelectorAll("[data-rec]").forEach((b) => {
      b.onclick = () => {
        const p = ALL_PHRASES.find((x) => x.id === b.dataset.rec);
        const box = b.closest(".phrase").querySelector(".res");
        b.disabled = true;
        b.textContent = "🎤 请说……";
        listen(p.en, (r) => {
          b.disabled = false;
          b.textContent = "🎤 跟读打分";
          if (!r) return;
          if (r.error) {
            box.innerHTML = `<div class="result bad">${r.error === "not-allowed" ? "需要允许使用麦克风才能跟读打分" : "没听清，再试一次"}</div>`;
            return;
          }
          const pct = Math.round(r.score * 100);
          const cls = pct >= 85 ? "good" : pct >= 60 ? "warn" : "bad";
          const msg = pct >= 85 ? "很棒！" : pct >= 60 ? "不错，再练练没对上的词" : "多听几遍，慢慢说";
          const miss = r.missing.length ? `<br>没对上：<span class="hl-miss">${esc(r.missing.join(", "))}</span>` : "";
          box.innerHTML = `<div class="result ${cls}">${pct} 分 · ${msg}<br>你说的：${esc(r.said)}${miss}</div>`;
        });
      };
    });
    view.querySelectorAll("[data-learn]").forEach((b) => {
      b.onclick = () => { markPhrase(b.dataset.learn); onLearn && onLearn(); };
    });
  }

  function startPhraseSession(extra) {
    currentTab = "session";
    let list;
    if (extra) list = ALL_PHRASES.filter((p) => !S.phrases[p.id]).slice(0, extra);
    else list = todaysPhrases().next;
    if (!list.length) {
      h(`<div class="card hero-done"><div class="big">✅</div><h2>今天的句子学完了</h2>
        <button class="btn primary block" id="home">回到今天</button></div>`);
      document.getElementById("home").onclick = () => go("today");
      checkDayDone(); updateStreak();
      return;
    }
    let i = 0;
    function show() {
      if (i >= list.length) {
        checkDayDone(); updateStreak();
        go("today");
        return;
      }
      const p = list[i];
      h(`<div class="counter">第 ${i + 1} / ${list.length} 句 · ${p.scene.icon} ${esc(p.scene.title)}</div>
        <div class="card">${phraseBlock(p)}</div>
        <div class="card"><p class="muted small" style="margin:0">练习方法：① 听 2 遍 ② 看着句子跟读 3 遍 ③ 不看句子说 1 遍。${Recog ? "可以用 🎤 给自己打分。" : ""}</p></div>
        <button class="btn good block" id="learned">我会了，下一句</button>`);
      speak(p.en);
      bindPhraseButtons();
      document.getElementById("learned").onclick = () => { markPhrase(p.id); i++; show(); };
    }
    show();
  }

  // ---------- 页面：单词库 ----------
  let wordFilter = "all";
  let wordQuery = "";
  function renderWords() {
    const counts = [0, 0, 0, 0];
    WORDS.forEach((x) => counts[wordLevel(x.w)]++);
    const filters = [["all", "全部 " + WORDS.length], ["1", "学习中 " + counts[1]], ["2", "熟悉 " + counts[2]], ["3", "已掌握 " + counts[3]], ["0", "未学 " + counts[0]]];
    h(`${counts[0] ? `<div class="card"><h3>觉得单词太简单？</h3>
        <p class="muted small" style="margin:0 0 10px">用“快速筛词”一次看 30 个，只点出不会的，其余直接标为已会。几分钟就能跳到适合你的难度。</p>
        <button class="btn primary block" id="sieve">⚡ 快速筛词</button></div>` : ""}
      <input class="search" id="q" placeholder="搜索单词或中文" value="${esc(wordQuery)}">
      <div class="filters">${filters.map(([k, t]) => `<button data-f="${k}" class="${wordFilter === k ? "on" : ""}">${t}</button>`).join("")}</div>
      <div class="card wlist" id="list"></div>`);
    function fill() {
      const q = wordQuery.trim().toLowerCase();
      const items = WORDS.filter((x) =>
        (wordFilter === "all" || String(wordLevel(x.w)) === wordFilter) &&
        (!q || x.w.toLowerCase().includes(q) || x.zh.includes(q)));
      document.getElementById("list").innerHTML = items.length
        ? items.map((x) => {
            const lv = wordLevel(x.w);
            return `<div class="item"><button class="icon-btn" data-say="${esc(x.w)}" aria-label="发音">🔊</button>
              <div class="grow"><div class="w">${esc(x.w)} <span class="muted small">${esc(x.pos)}</span></div><div class="m">${esc(x.zh)}</div></div>
              <span class="pill s${lv}">${LEVEL_TEXT[lv]}</span></div>`;
          }).join("")
        : `<p class="muted">没有符合的单词</p>`;
    }
    fill();
    document.getElementById("q").oninput = (e) => { wordQuery = e.target.value; fill(); };
    const sb = document.getElementById("sieve");
    if (sb) sb.onclick = startSieve;
    view.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { wordFilter = b.dataset.f; renderWords(); }));
  }

  // ---------- 快速筛词 ----------
  const SIEVE_SIZE = 30;
  function startSieve() {
    currentTab = "session";
    let totalKnown = 0;
    let keptAside = new Set(); // 本轮标成“不会”的词，留给每天的新词学习
    function batch() {
      return WORDS.filter((x) => !wordState(x.w) && !keptAside.has(x.w)).slice(0, SIEVE_SIZE);
    }
    function show() {
      const list = batch();
      if (!list.length) { finish(); return; }
      const unknown = new Set();
      h(`<div class="card"><h2>⚡ 快速筛词</h2>
          <p class="muted small" style="margin:0">点一下<b>不认识</b>的词（会变成橙色）。认识的不用点。点 🔊 可以听发音。</p></div>
        <div class="card"><div class="chips">${list.map((x) => `<div class="chip" data-w="${esc(x.w)}">
            <button class="chip-word" data-pick="${esc(x.w)}">${esc(x.w)}</button>
            <button class="chip-say" data-say="${esc(x.w)}" aria-label="发音">🔊</button></div>`).join("")}</div></div>
        <button class="btn primary block" id="done"></button>
        <p></p><button class="btn block" id="stop">先到这里</button>
        <p class="muted small" style="text-align:center">已标为已会 ${totalKnown} 个</p>`);
      const doneBtn = document.getElementById("done");
      const label = () => { doneBtn.textContent = `其余 ${list.length - unknown.size} 个我都认识，下一组`; };
      label();
      view.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => {
        const w = b.dataset.pick;
        unknown.has(w) ? unknown.delete(w) : unknown.add(w);
        b.parentElement.classList.toggle("unknown", unknown.has(w));
        label();
      }));
      doneBtn.onclick = () => {
        const known = list.filter((x) => !unknown.has(x.w)).map((x) => x.w);
        markKnown(known);
        totalKnown += known.length;
        unknown.forEach((w) => keptAside.add(w));
        // 一组里不会的词超过一半，说明已经到你的水平了
        if (unknown.size >= list.length / 2) { finish(true); return; }
        show();
      };
      document.getElementById("stop").onclick = () => finish();
    }
    function finish(atLevel) {
      const next = nextNewWords(3).map((x) => x.w).join("、");
      h(`<div class="card hero-done"><div class="big">🎯</div><h2>${atLevel ? "找到你的起点了" : "筛词完成"}</h2>
        <p class="muted">这次标为已会 ${totalKnown} 个词。${next ? "接下来每天的新单词从 " + esc(next) + " 等开始。" : ""}</p>
        <button class="btn primary block" id="home">回到今天</button>
        <p></p><button class="btn block" id="list">看单词库</button></div>`);
      document.getElementById("home").onclick = () => go("today");
      document.getElementById("list").onclick = () => go("words");
    }
    show();
  }

  // ---------- 页面：阅读 ----------
  const READINGS = window.READINGS || [];
  function renderReading() {
    const done = READINGS.filter((r) => S.readings[r.id]).length;
    h(`<p class="muted small">简单的小故事和小新闻（为练习编写，不是真实新闻）。先读，再做题。不会的地方可以点开中文。</p>
      <p class="muted small">已读 ${done} / ${READINGS.length} 篇</p>
      ${READINGS.map((r) => {
        const rec = S.readings[r.id];
        return `<button class="card read-item" data-read="${r.id}">
          <div class="row"><span class="pill ${r.type === "故事" ? "s2" : "s1"}">${r.type}</span>
          <span class="muted small">${"★".repeat(r.level)}${"☆".repeat(3 - r.level)}</span>
          <span style="flex:1"></span>
          ${rec ? `<span class="pill ${rec.score === rec.total ? "s3" : "s1"}">${rec.score}/${rec.total}</span>` : `<span class="pill s0">未读</span>`}</div>
          <div class="read-title">${esc(r.title)}</div>
          <div class="muted small">${esc(r.titleZh)}</div></button>`;
      }).join("")}`);
    view.querySelectorAll("[data-read]").forEach((b) => (b.onclick = () => openReading(b.dataset.read)));
  }

  function openReading(id) {
    const r = READINGS.find((x) => x.id === id);
    if (!r) return;
    currentTab = "session";
    window.scrollTo(0, 0);
    const answers = new Array(r.questions.length).fill(null);
    let submitted = false;
    h(`<button class="btn" id="back">← 返回列表</button><p></p>
      <div class="card article">
        <div class="row"><span class="pill ${r.type === "故事" ? "s2" : "s1"}">${r.type}</span><span style="flex:1"></span>
          <button class="btn" id="playAll">▶️ 全文朗读</button></div>
        <h2 style="margin-top:10px">${esc(r.title)}</h2>
        ${r.paras.map((p, i) => `<div class="para">
          <div class="row" style="align-items:flex-start"><p class="en">${esc(p[0])}</p>
          <button class="icon-btn" data-say="${esc(p[0])}" aria-label="朗读这一段">🔊</button></div>
          <details><summary>看中文</summary><p class="zh">${esc(p[1])}</p></details></div>`).join("")}
      </div>
      <div class="card"><h3>📝 重点词</h3>
        ${r.words.map(([w, zh]) => `<div class="row" style="padding:4px 0"><button class="icon-btn" data-say="${esc(w)}" aria-label="发音">🔊</button>
          <b>${esc(w)}</b><span class="muted">${esc(zh)}</span></div>`).join("")}
      </div>
      <div class="card"><h3>✅ 阅读理解</h3>
        ${r.questions.map((q, qi) => `<div class="quiz" data-q="${qi}">
          <div class="q">${qi + 1}. ${esc(q.q)}</div>
          <details class="small"><summary>看题目中文</summary><span class="muted">${esc(q.qZh)}</span></details>
          ${q.options.map((o, oi) => `<button class="opt" data-q="${qi}" data-o="${oi}">${String.fromCharCode(65 + oi)}. ${esc(o)}</button>`).join("")}
          <div class="why" hidden></div></div>`).join("")}
        <button class="btn primary block" id="submit" disabled>提交答案</button>
        <div id="score"></div>
      </div>`);
    document.getElementById("back").onclick = () => go("reading");
    // 全文朗读：一段接一段
    document.getElementById("playAll").onclick = () => {
      let i = 0;
      const next = () => {
        if (i >= r.paras.length) { player.onended = null; return; }
        const file = window.AUDIO && window.AUDIO[r.paras[i][0]];
        if (!file) { speak(r.paras.map((p) => p[0]).join(" ")); player.onended = null; return; }
        speak(r.paras[i][0]);
        i++;
        player.onended = next;
      };
      next();
    };
    const submit = document.getElementById("submit");
    view.querySelectorAll(".opt").forEach((b) => (b.onclick = () => {
      if (submitted) return;
      const qi = Number(b.dataset.q);
      answers[qi] = Number(b.dataset.o);
      view.querySelectorAll(`.opt[data-q="${qi}"]`).forEach((x) => x.classList.toggle("picked", x === b));
      submit.disabled = answers.some((a) => a === null);
    }));
    submit.onclick = () => {
      submitted = true;
      submit.hidden = true;
      let score = 0;
      r.questions.forEach((q, qi) => {
        const ok = answers[qi] === q.answer;
        if (ok) score++;
        view.querySelectorAll(`.opt[data-q="${qi}"]`).forEach((x) => {
          const oi = Number(x.dataset.o);
          if (oi === q.answer) x.classList.add("right");
          else if (oi === answers[qi]) x.classList.add("wrong");
        });
        const why = view.querySelector(`.quiz[data-q="${qi}"] .why`);
        why.hidden = false;
        why.innerHTML = `${ok ? "✅ 答对了。" : "❌ 正确答案是 " + String.fromCharCode(65 + q.answer) + "。"}${esc(q.why)}`;
      });
      S.readings[r.id] = { score, total: r.questions.length, date: today(), last: Date.now() };
      save();
      const nextR = READINGS.find((x) => !S.readings[x.id]);
      document.getElementById("score").innerHTML = `<div class="result ${score === r.questions.length ? "good" : score ? "warn" : "bad"}">得分 ${score} / ${r.questions.length}。${score === r.questions.length ? "全对，太棒了！" : "看看上面的解析，再读一遍原文对应的句子。"}</div>
        <p></p><div class="row wrap"><button class="btn" id="retry">再做一次</button>${nextR ? `<button class="btn primary" id="nextR">下一篇</button>` : ""}</div>`;
      document.getElementById("retry").onclick = () => openReading(r.id);
      const nb = document.getElementById("nextR");
      if (nb) nb.onclick = () => openReading(nextR.id);
    };
  }

  // ---------- 页面：句子库 ----------
  let openScene = null;
  function renderPhrases() {
    h(`<p class="muted small">按场景分类的美国职场常用句。点开场景就能听、跟读。</p>
      ${SCENES.map((s) => {
        const learned = s.lines.filter((l) => S.phrases[l.id]).length;
        const open = openScene === s.id;
        return `<div class="card">
          <button class="scene-head" data-scene="${s.id}">
            <span class="emoji">${s.icon}</span><span class="name">${esc(s.title)}</span>
            <span class="pill ${learned === s.lines.length ? "s3" : learned ? "s2" : "s0"}">${learned}/${s.lines.length}</span>
            <span class="muted">${open ? "▲" : "▼"}</span>
          </button>
          ${open ? `<div class="scene-body">${s.lines.map((l) => phraseBlock({ ...l, scene: s }, { learnBtn: true })).join("")}</div>` : ""}
        </div>`;
      }).join("")}`);
    view.querySelectorAll("[data-scene]").forEach((b) => (b.onclick = () => {
      openScene = openScene === b.dataset.scene ? null : b.dataset.scene;
      renderPhrases();
    }));
    bindPhraseButtons(() => { checkDayDone(); updateStreak(); renderPhrases(); });
  }

  // ---------- 页面：我的 ----------
  function renderMe() {
    const learnedWords = Object.keys(S.words).length;
    const mastered = WORDS.filter((x) => wordLevel(x.w) === 3).length;
    const learnedPhrases = Object.keys(S.phrases).length;
    const cells = [];
    for (let k = 27; k >= 0; k--) {
      const d = addDays(today(), -k);
      const r = S.days[d];
      cells.push(`<div class="${r && r.done ? "on" : r && (r.newWords || r.reviewed || r.phrases) ? "part" : ""}" title="${d}"></div>`);
    }
    const st = S.settings;
    const opt = (vals, cur, fmt) => vals.map((v) => `<option value="${v}" ${v === cur ? "selected" : ""}>${fmt(v)}</option>`).join("");
    h(`<div class="card"><h2>我的进度</h2>
        <div class="stats">
          <div><div class="num">${streak()}</div><div class="lbl">连续天数</div></div>
          <div><div class="num">${learnedWords}</div><div class="lbl">学过的单词</div></div>
          <div><div class="num">${learnedPhrases}</div><div class="lbl">学会的句子</div></div>
        </div>
        <p class="muted small" style="margin:12px 0 0">已掌握单词 ${mastered} / ${WORDS.length} · 句子 ${learnedPhrases} / ${ALL_PHRASES.length}</p>
        <h3 style="margin-top:14px">最近 4 周</h3>
        <div class="cal">${cells.join("")}</div>
        <p class="muted small" style="margin:6px 0 0">深绿 = 完成当天任务，浅绿 = 学了一部分</p>
      </div>
      <div class="card"><h2>设置</h2>
        <div class="setting"><span>每天新单词</span><select id="sNew">${opt([3, 5, 8, 10], st.newPerDay, (v) => v + " 个")}</select></div>
        <div class="setting"><span>每天新句子</span><select id="sPh">${opt([2, 3, 5], st.phrasesPerDay, (v) => v + " 句")}</select></div>
        <div class="setting"><span>朗读速度</span><select id="sRate">${opt([0.7, 0.8, 0.9, 1], st.rate, (v) => ({ 0.7: "很慢", 0.8: "慢", 0.9: "稍慢", 1: "正常" }[v]))}</select></div>
        <div class="setting"><span>试听</span><button class="btn" data-say="Hi, nice to meet you. How's it going?">🔊 试听</button></div>
      </div>
      ${syncCard()}
      <div class="card"><h2>备份</h2>
        <p class="muted small">${Sync.on() ? "已开启云端同步，记录会自动保存。也可以再导出一份文件留作备份。" : "没开云端同步时，学习记录只保存在当前浏览器里。可以导出文件备份，或在新设备上导入。"}</p>
        <div class="row wrap">
          <button class="btn" id="exp">⬇️ 导出记录</button>
          <label class="btn">⬆️ 导入记录<input type="file" id="imp" accept="application/json" hidden></label>
        </div>
        <p></p>
        <button class="btn bad" id="reset">清空所有记录</button>
      </div>
      <p class="muted small" style="text-align:center">词库 ${WORDS.length} 词 · ${SCENES.length} 个场景 ${ALL_PHRASES.length} 句</p>`);
    const num = (id, key) => (document.getElementById(id).onchange = (e) => { S.settings[key] = Number(e.target.value); S.settingsAt = Date.now(); save(); toast("已保存"); });
    bindSync();
    num("sNew", "newPerDay"); num("sPh", "phrasesPerDay"); num("sRate", "rate");
    document.getElementById("exp").onclick = () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "english-study-" + today() + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    document.getElementById("imp").onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((txt) => {
        try {
          const d = JSON.parse(txt);
          if (!d.words || !d.days) throw new Error("bad");
          S = normalize(d);
          save(); updateStreak(); renderMe(); toast("导入成功");
        } catch (err) { toast("文件格式不对，导入失败"); }
      });
    };
    document.getElementById("reset").onclick = () => {
      if (confirm("确定要清空所有学习记录吗？" + (Sync.on() ? "云端的记录也会一起清空，" : "") + "这个操作不能撤销。")) {
        Sync.remove().catch(() => {}).then(() => {
          S = normalize({}); save(); updateStreak(); renderMe(); toast("已清空");
        });
      }
    };
  }

  // ---------- 云端同步卡片 ----------
  function syncCard() {
    if (!Sync.available) {
      return `<div class="card"><h2>☁️ 云端同步</h2><p class="muted small">在 Cloudflare 网址上打开这个网页，就能把学习记录保存到云端，换设备、清缓存都不会丢。</p></div>`;
    }
    if (!Sync.token()) {
      return `<div class="card"><h2>☁️ 云端同步</h2>
        <p class="muted small">输入你在 Cloudflare 里设置的同步密码。每台设备只需要输入一次。</p>
        <input class="search" id="syncPw" type="password" autocomplete="current-password" placeholder="同步密码">
        <button class="btn primary block" id="syncOn">开启同步</button></div>`;
    }
    const t = Sync.lastOk ? new Date(Sync.lastOk).toLocaleTimeString() : "";
    return `<div class="card"><h2>☁️ 云端同步 <span class="pill s3">已开启</span></h2>
      <p class="muted small" id="syncStatus">${esc(Sync.status || "")}${t && Sync.status === "已同步" ? "（" + t + "）" : ""}</p>
      <div class="row wrap"><button class="btn" id="syncNow">🔄 立即同步</button><button class="btn" id="syncOff">在这台设备上关闭</button></div></div>`;
  }
  function bindSync() {
    const g = (id) => document.getElementById(id);
    if (g("syncOn")) g("syncOn").onclick = async () => {
      const pw = g("syncPw").value.trim();
      if (!pw) { toast("请输入同步密码"); return; }
      Sync.setToken(pw);
      g("syncOn").disabled = true;
      const ok = await Sync.pull();
      if (!ok) { Sync.setToken(""); g("syncOn").disabled = false; toast(Sync.status || "开启失败"); return; }
      await Sync.push();
      toast("同步已开启，进度已合并");
      updateStreak(); renderMe();
    };
    if (g("syncNow")) g("syncNow").onclick = async () => {
      const ok = (await Sync.pull()) && (await Sync.push());
      toast(ok ? "同步完成" : Sync.status);
      updateStreak(); renderMe();
    };
    if (g("syncOff")) g("syncOff").onclick = () => {
      if (confirm("在这台设备上关闭同步？云端的记录会保留。")) { Sync.setToken(""); renderMe(); }
    };
  }
  Sync.onChange(() => {
    const el = document.getElementById("syncStatus");
    if (el) el.textContent = Sync.status + (Sync.status === "已同步" && Sync.lastOk ? "（" + new Date(Sync.lastOk).toLocaleTimeString() + "）" : "");
  });

  // 同步拉到新数据后，刷新当前页面（正在做单词卡片或跟读时不打断）
  let currentTab = "today";
  function refresh() {
    if (PAGES[currentTab]) PAGES[currentTab]();
    updateStreak();
  }

  // ---------- 导航 ----------
  const PAGES = { today: renderToday, words: renderWords, phrases: renderPhrases, reading: renderReading, me: renderMe };
  function go(tab) {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    player.pause();
    player.onended = null;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    window.scrollTo(0, 0);
    currentTab = tab;
    PAGES[tab]();
    updateStreak();
  }
  document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  go("today");
  Sync.init().then(() => refresh());
})();
