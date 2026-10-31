const cfg = window.EVENT_CONFIG || {};
const params = new URLSearchParams(location.search);
const DEMO = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || params.has("demo");

const ROWS = 12;
const BALLS = 5;
const DEFAULT_POINTS = [500, 120, 40, 15, 6, 2, 1, 2, 6, 15, 40, 120, 500];
const kstToday = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const nextKstMidnight = (ms) => Date.parse(kstToday(ms) + "T00:00:00+09:00") + 24 * 3600e3;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

let sb = null;
if (!DEMO) {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
}

const state = {
  session: null,
  status: null,
  offset: 0,
  playing: false,
  leaderboard: null,
  demoMe: null,
};

const serverNow = () => Date.now() + state.offset;

function randomPaths() {
  const buf = new Uint8Array(BALLS * ROWS);
  crypto.getRandomValues(buf);
  const paths = [];
  for (let b = 0; b < BALLS; b++) paths.push(Array.from({ length: ROWS }, (_, r) => buf[b * ROWS + r] & 1));
  return paths;
}

function summarize(paths, points) {
  const slots = paths.map((p) => p.reduce((a, v) => a + v, 0));
  return { paths, slots, total: slots.reduce((a, s) => a + points[s], 0) };
}

async function loadStatus() {
  if (DEMO) {
    state.status = {
      now: new Date().toISOString(),
      today: kstToday(Date.now()),
      reset_at: new Date(nextKstMidnight(Date.now())).toISOString(),
      count: state.demoMe ? 1 : 0,
      points: DEFAULT_POINTS,
      me: state.demoMe,
    };
  } else {
    const { data, error } = await sb.rpc("daily_status");
    if (error) throw error;
    state.status = data;
  }
  state.offset = new Date(state.status.now).getTime() - Date.now();
}

async function loadLeaderboard() {
  if (DEMO) {
    const names = ["호박귀신", "드라큘라", "마녀", "좀비", "유령", "늑대인간", "미라", "해골"];
    const rows = names.map((n, i) => ({ display_name: n, username: `demo_${i}`, total: summarize(randomPaths(), DEFAULT_POINTS).total, played_at: new Date(Date.now() - (i + 1) * 60e3).toISOString(), is_me: false }));
    if (state.demoMe) rows.push({ display_name: "나", username: "me", total: state.demoMe.total, played_at: state.demoMe.played_at, is_me: true });
    rows.sort((a, b) => b.total - a.total || new Date(a.played_at) - new Date(b.played_at));
    state.leaderboard = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    return;
  }
  const { data, error } = await sb.rpc("daily_leaderboard");
  if (error) throw error;
  state.leaderboard = data;
}

function userInfo() {
  if (DEMO) return { name: "데모 사용자", avatar: null };
  const m = state.session?.user?.user_metadata || {};
  return { name: m.custom_claims?.global_name || m.full_name || m.name || "디스코드 사용자", avatar: m.avatar_url || null };
}

function fmtCountdown(ms) {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function updateChips() {
  const st = state.status;
  if (!st) return;
  $("chip-count").textContent = `오늘 ${st.count}명 참가`;
  const left = new Date(st.reset_at).getTime() - serverNow();
  $("chip-time").textContent = `초기화까지 ${fmtCountdown(left)}`;
}

function renderPanel() {
  const body = $("panel-body");
  const st = state.status;
  const loggedIn = DEMO || !!state.session;
  const me = st?.me;

  if (state.playing) return;

  if (!loggedIn) {
    body.innerHTML = `<p class="big">디스코드 계정으로 로그인하면 하루에 <b>한 번</b> 플레이할 수 있어요.</p><button class="btn discord" id="login">디스코드로 참가하기</button>`;
    $("login").onclick = signIn;
    return;
  }

  const u = userInfo();
  const header = `<div class="user">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<span style="font-size:30px">👻</span>`}<span class="name">${esc(u.name)}</span>${DEMO ? "" : `<button class="out" id="logout">로그아웃</button>`}</div>`;

  if (me) {
    const row = state.leaderboard?.find((r) => r.is_me);
    const rankLine = row ? `오늘 <b>${row.rank}등</b>` : "순위를 불러오는 중…";
    body.innerHTML = `${header}<p class="muted center">오늘 내 점수</p><div class="result-total">${me.total}점</div><p class="big center">${rankLine}</p><p class="muted center">내일 0시에 다시 도전할 수 있어요.</p><button class="btn ghost" id="replay">🎬 내 플레이 다시 보기</button>`;
    $("replay").onclick = () => runBoard(me, false);
  } else {
    body.innerHTML = `${header}<p class="big">공 5개가 떨어지고, 떨어진 칸의 점수를 모두 더해요. <b>하루에 한 번</b> 도전할 수 있어요.</p><button class="btn" id="play">🎃 공 떨어뜨리기</button>`;
    $("play").onclick = play;
  }
  const lo = $("logout");
  if (lo) lo.onclick = async () => { await sb.auth.signOut(); };
}

function renderLeaderboard() {
  const card = $("leaderboard");
  if (!state.leaderboard) { card.hidden = true; return; }
  card.hidden = false;
  const list = $("rank-list");
  if (!state.leaderboard.length) {
    list.innerHTML = `<li><span></span><span></span><span class="nm">아직 오늘 참가자가 없어요.</span><span></span></li>`;
    return;
  }
  const medal = (r) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : r);
  list.innerHTML = state.leaderboard.map((r) => `
    <li class="${r.is_me ? "me" : ""}">
      <span class="r">${medal(r.rank)}</span>
      ${r.avatar_url ? `<img src="${esc(r.avatar_url)}" alt="">` : `<span class="ph"></span>`}
      <span class="nm"><b>${esc(r.display_name)}</b><small>${esc(r.username || "")}</small></span>
      <span class="pt">${r.total}점</span>
    </li>`).join("");
}

function render() {
  $("demo-banner").hidden = !DEMO;
  updateChips();
  renderPanel();
  renderLeaderboard();
}

async function signIn() {
  const redirectTo = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOAuth({ provider: "discord", options: { redirectTo } });
  if (error) toast("로그인에 실패했어요: " + error.message);
}

const ERRORS = {
  ALREADY_PLAYED: "오늘은 이미 플레이했어요. 하루에 한 번만 가능해요.",
  NOT_LOGGED_IN: "먼저 로그인해 주세요.",
  NOT_DISCORD: "디스코드 계정으로 로그인해 주세요.",
};

async function play() {
  const btn = $("play");
  btn.disabled = true;
  btn.textContent = "운명을 정하는 중…";
  let result;
  try {
    if (DEMO) {
      result = { ...summarize(randomPaths(), DEFAULT_POINTS), played_at: new Date().toISOString() };
    } else {
      const { data, error } = await sb.rpc("daily_play");
      if (error) {
        const code = Object.keys(ERRORS).find((k) => String(error.message).includes(k));
        toast(code ? ERRORS[code] : "오류가 났어요: " + error.message);
        await refresh();
        return;
      }
      result = data;
    }
  } catch (e) {
    toast("네트워크 오류가 났어요. 다시 시도해 주세요.");
    btn.disabled = false;
    btn.textContent = "🎃 공 떨어뜨리기";
    return;
  }
  await runBoard(result, true);
  if (DEMO) state.demoMe = result;
  await refresh();
}

async function runBoard(result, fresh) {
  state.playing = true;
  const body = $("panel-body");
  body.innerHTML = `<p class="big center">${fresh ? "공이 떨어지고 있어요… 👀" : "다시 보는 중…"}</p>`;
  $("board-card").hidden = false;
  $("board-card").scrollIntoView({ behavior: "smooth", block: "center" });
  await board.run(result.paths, state.status?.points || DEFAULT_POINTS);
  state.playing = false;
  if (fresh) toast(`🎉 총 ${result.total}점!`);
  render();
}

class Board {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.points = DEFAULT_POINTS;
    this.balls = [];
    this.landed = [];
    this.flashes = new Map();
    this.slotFlash = new Map();
    this.score = 0;
    this.resize();
    window.addEventListener("resize", () => { this.resize(); this.draw(performance.now()); });
  }

  resize() {
    const w = this.c.parentElement.clientWidth - 0;
    const h = Math.round(w * 1.12);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.c.width = w * dpr;
    this.c.height = h * dpr;
    this.c.style.height = h + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
    this.dx = w / 14;
    this.cx = w / 2;
    this.slotH = Math.max(34, this.dx * 1.15);
    this.top = this.dx * 1.1;
    this.dy = (h - this.top - this.slotH - this.dx * 0.6) / ROWS;
    this.pegR = Math.max(2.5, this.dx * 0.11);
    this.ballR = Math.max(5, this.dx * 0.27);
  }

  pegXY(r, j) { return [this.cx + (j - r / 2) * this.dx, this.top + r * this.dy]; }
  slotX(i) { return this.cx + (i - (this.points.length - 1) / 2) * this.dx; }
  slotY() { return this.H - this.slotH; }

  waypoints(path) {
    const pts = [[this.cx, this.top - this.dy * 1.2, null]];
    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      const [x, y] = this.pegXY(r, i);
      pts.push([x, y - this.pegR - this.ballR, [r, i]]);
      i += path[r];
    }
    pts.push([this.slotX(i), this.slotY() + this.slotH * 0.55, ["slot", i]]);
    return { pts, slot: i };
  }

  run(paths, points) {
    this.points = points;
    this.balls = [];
    this.landed = [];
    this.flashes.clear();
    this.slotFlash.clear();
    this.score = 0;
    this.updateHud(0);
    const t0 = performance.now() + 300;
    const seg = 165;
    const gap = 1150;
    paths.forEach((p, b) => {
      const { pts, slot } = this.waypoints(p);
      this.balls.push({ pts, slot, start: t0 + b * gap, seg, done: false, hue: 20 + b * 8 });
    });
    return new Promise((resolve) => {
      const tick = (now) => {
        this.step(now);
        this.draw(now);
        if (this.balls.every((b) => b.done) && now > this.lastLand + 700) {
          this.draw(now + 2000);
          resolve();
        } else requestAnimationFrame(tick);
      };
      this.lastLand = Infinity;
      requestAnimationFrame(tick);
    });
  }

  step(now) {
    for (const b of this.balls) {
      if (b.done || now < b.start) continue;
      const k = (now - b.start) / b.seg;
      const idx = Math.floor(k);
      if (idx >= b.pts.length - 1) {
        b.done = true;
        this.landed.push(b);
        this.score += this.points[b.slot];
        this.slotFlash.set(b.slot, now);
        this.lastLand = now;
        this.updateHud(this.landed.length);
        if (navigator.vibrate) navigator.vibrate(this.points[b.slot] >= 40 ? [40, 40, 80] : 15);
        continue;
      }
      if (idx > (b.lastIdx ?? -1)) {
        const tag = b.pts[idx][2];
        if (tag && tag[0] !== "slot") this.flashes.set(tag.join(","), now);
        b.lastIdx = idx;
      }
    }
  }

  ballPos(b, now) {
    const k = Math.min((now - b.start) / b.seg, b.pts.length - 1 - 1e-6);
    const idx = Math.floor(k);
    const t = k - idx;
    const [x0, y0] = b.pts[idx];
    const [x1, y1] = b.pts[idx + 1];
    const lastSeg = idx === b.pts.length - 2;
    const hop = idx === 0 ? 0 : this.dy * (lastSeg ? 0.2 : 0.42);
    const x = x0 + (x1 - x0) * (idx === 0 ? t : Math.sin((t * Math.PI) / 2));
    const y = y0 + (y1 - y0) * t * t - Math.sin(Math.PI * t) * hop * (1 - t * 0.5);
    return [x, y];
  }

  slotColor(i, alpha = 1) {
    const mid = (this.points.length - 1) / 2;
    const d = Math.abs(i - mid) / mid;
    const hue = 275 - d * 245;
    const light = 38 + d * 18;
    return `hsla(${hue}, 90%, ${light}%, ${alpha})`;
  }

  draw(now) {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    for (let r = 0; r < ROWS; r++) {
      for (let j = -1; j <= r + 1; j++) {
        const [x, y] = this.pegXY(r, j);
        if (x < this.pegR * 2 || x > W - this.pegR * 2) continue;
        const f = this.flashes.get(`${r},${j}`);
        const glow = f ? Math.max(0, 1 - (now - f) / 350) : 0;
        ctx.beginPath();
        ctx.arc(x, y, this.pegR * (1 + glow * 0.8), 0, Math.PI * 2);
        ctx.fillStyle = glow > 0 ? `rgba(255, 190, 90, ${0.55 + glow * 0.45})` : "rgba(230, 215, 255, 0.55)";
        ctx.fill();
      }
    }

    const sy = this.slotY();
    const sw = this.dx * 0.92;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < this.points.length; i++) {
      const x = this.slotX(i);
      const f = this.slotFlash.get(i);
      const glow = f ? Math.max(0, 1 - (now - f) / 900) : 0;
      ctx.fillStyle = this.slotColor(i, 0.35 + glow * 0.65);
      roundRect(ctx, x - sw / 2, sy + (glow ? -glow * 4 : 0), sw, this.slotH, 6);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.max(9, Math.min(13, this.dx * 0.34))}px -apple-system, sans-serif`;
      ctx.fillText(String(this.points[i]), x, sy + this.slotH * 0.32);
    }

    const counts = {};
    for (const b of this.landed) {
      const n = (counts[b.slot] = (counts[b.slot] || 0) + 1);
      const x = this.slotX(b.slot);
      const y = sy + this.slotH * 0.72 - (n - 1) * this.ballR * 0.7;
      drawBall(ctx, x, y, this.ballR * 0.7);
    }

    for (const b of this.balls) {
      if (b.done || now < b.start) continue;
      const [x, y] = this.ballPos(b, now);
      drawBall(ctx, x, y, this.ballR);
    }
  }

  updateHud(n) {
    $("score").textContent = this.score;
    $("balls").textContent = "🎃".repeat(BALLS - n) + "·".repeat(n);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBall(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, "#ffe2a8");
  g.addColorStop(0.5, "#ff8a1f");
  g.addColorStop(1, "#b34700");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.shadowColor = "rgba(255, 138, 31, 0.7)";
  ctx.shadowBlur = r * 1.2;
  ctx.fill();
  ctx.shadowBlur = 0;
}

let board;

async function refresh() {
  try {
    await loadStatus();
    await loadLeaderboard();
  } catch (e) {
    $("panel-body").innerHTML = `<p class="big">서버에 연결하지 못했어요. 잠시 후 새로고침해 주세요.</p><p class="muted">${esc(e.message || e)}</p>`;
    return;
  }
  render();
}

async function init() {
  $("board-card").hidden = false;
  board = new Board($("board"));
  board.updateHud(0);
  board.draw(performance.now());
  $("board-card").hidden = true;

  if (!DEMO) {
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    sb.auth.onAuthStateChange((_e, session) => {
      const changed = (session?.user?.id || null) !== (state.session?.user?.id || null);
      state.session = session;
      if (changed) refresh();
    });
  }
  await refresh();

  if (!state.status?.me && !state.playing) {
    $("board-card").hidden = false;
    board.resize();
    board.draw(performance.now());
  }

  setInterval(() => {
    updateChips();
    if (state.status && !state.playing && serverNow() >= new Date(state.status.reset_at).getTime()) location.reload();
  }, 1000);
  setInterval(() => { if (!state.playing) refresh(); }, 20000);
}

init();
