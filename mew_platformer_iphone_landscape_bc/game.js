(() => {
  // =========================
  // バージョン（ここだけ変えればOK）
  // =========================
  const GAME_VERSION = "v0.6.0";
  // v0.6.0 : 左向き初期 / ジャンプ高さ調整 / 空中横移動1.7倍 / 操作説明表示 / iPhone横向きUI

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // 画面サイズ追従（iPhone横向き想定）
  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    canvas.width = w;
    canvas.height = h;
  }
  window.addEventListener("resize", resize);
  resize();

  // ====== スプライト設定 ======
  const SPRITE = {
    url: "assets/mew_spritesheet.png",
    frameW: 352,
    frameH: 512,
    cols: 4,
    fps: 10
  };
  const img = new Image();
  img.src = SPRITE.url;

  // ====== 物理調整 ======
  const GRAVITY = 1.2;      // 重めでキビキビ
  const JUMP_POWER = 12;    // 1回ジャンプで届く高さ（まだ高ければ 11）
  const MOVE_ACC = 0.9;
  const MAX_SPEED = 6.0;
  const FRICTION = 0.80;

  // ★ジャンプ距離（空中の横移動）を1.7倍
  const AIR_CONTROL = 1.7;

  // ====== タイルマップ ======
  // . 空
  // # 地面（固い）
  // = 足場（固い）
  // ? コインブロック（下から叩くと1回コイン）
  // ^ トゲ
  // E 敵の出現位置（読み込み後消える）
  // F ゴール旗
  const MAP = [
    "........................................................................",
    "........................................................................",
    "........................................................................",
    "........................................................................",
    "....................?...................................................",
    "..............==..=====................................................",
    ".........................E..............................................",
    ".....==.................................................................",
    "....................?..............==...................................",
    "..................................................E.....................",
    "..................=====.................................................",
    ".........................................?..............................",
    "...........E.........................==..=====..........................",
    "..............................................................F.........",
    "####################....###############################....##############",
    "####################....###############################....##############",
  ];

  const TILE = 48;
  const worldW = MAP[0].length * TILE;
  const worldH = MAP.length * TILE;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function aabb(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function getTile(tx, ty) {
    if (ty < 0 || ty >= MAP.length) return "#";
    const row = MAP[ty];
    if (tx < 0 || tx >= row.length) return "#";
    return row[tx];
  }

  function setTile(tx, ty, ch) {
    if (ty < 0 || ty >= MAP.length) return;
    const row = MAP[ty];
    if (tx < 0 || tx >= row.length) return;
    MAP[ty] = row.substring(0, tx) + ch + row.substring(tx + 1);
  }

  function tileRect(tx, ty) {
    return { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
  }

  function isSolid(ch) {
    return ch === "#" || ch === "=" || ch === "?" || ch === "B";
  }

  // ====== プレイヤー ======
  const player = {
    x: TILE * 2,
    y: TILE * 6,
    w: 34,
    h: 44,
    vx: 0,
    vy: 0,
    onGround: false,
    crouch: false,
    facing: -1, // ★初期 左向き
    animT: 0,
    animFrame: 0
  };

  // ====== スコア ======
  let coins = 0;
  let score = 0;

  // ====== 敵 ======
  const enemies = [];
  function spawnEnemiesFromMap() {
    enemies.length = 0;
    for (let ty = 0; ty < MAP.length; ty++) {
      for (let tx = 0; tx < MAP[ty].length; tx++) {
        if (MAP[ty][tx] === "E") {
          enemies.push({
            x: tx * TILE + 8,
            y: ty * TILE + 8,
            w: 32,
            h: 32,
            vx: -1.2,
            vy: 0,
            alive: true
          });
          setTile(tx, ty, ".");
        }
      }
    }
  }
  spawnEnemiesFromMap();

  // ====== ゴール ======
  let goal = { x: worldW - TILE * 2, y: TILE * 10, w: 32, h: 96 };
  function findGoalFromMap() {
    for (let ty = 0; ty < MAP.length; ty++) {
      for (let tx = 0; tx < MAP[ty].length; tx++) {
        if (MAP[ty][tx] === "F") {
          goal = { x: tx * TILE + 8, y: (ty - 1) * TILE, w: 32, h: TILE * 2 };
          setTile(tx, ty, ".");
          return;
        }
      }
    }
  }
  findGoalFromMap();

  // ====== 入力 ======
  const input = { left:false, right:false, jump:false, down:false };
  const key = (e, v) => {
    if (e.code === "ArrowLeft") input.left = v;
    if (e.code === "ArrowRight") input.right = v;
    if (e.code === "ArrowDown") input.down = v;
    if (e.code === "ArrowUp" || e.code === "Space") input.jump = v;
    if (e.code === "KeyR" && v) reset();
  };
  window.addEventListener("keydown", (e)=>key(e,true));
  window.addEventListener("keyup", (e)=>key(e,false));

  // タッチボタン
  function bindBtn(id, prop) {
    const el = document.getElementById(id);
    const on = (ev) => { ev.preventDefault(); input[prop] = true; };
    const off = (ev) => { ev.preventDefault(); input[prop] = false; };
    el.addEventListener("touchstart", on, {passive:false});
    el.addEventListener("touchend", off, {passive:false});
    el.addEventListener("touchcancel", off, {passive:false});
    el.addEventListener("mousedown", on);
    el.addEventListener("mouseup", off);
    el.addEventListener("mouseleave", off);
  }
  bindBtn("btnLeft", "left");
  bindBtn("btnRight", "right");
  bindBtn("btnDown", "down");
  bindBtn("btnJump", "jump");

  // ====== ゲーム状態 ======
  let gameOver = false;
  let gameClear = false;

  function reset() {
    gameOver = false;
    gameClear = false;
    coins = 0;
    score = 0;

    player.x = TILE * 2;
    player.y = TILE * 6;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.crouch = false;
    player.facing = -1;
  }

  // ====== 衝突（タイル） ======
  function collideWithWorld(entity) {
    // X
    entity.x += entity.vx;
    let left = Math.floor(entity.x / TILE);
    let right = Math.floor((entity.x + entity.w) / TILE);
    let top = Math.floor(entity.y / TILE);
    let bottom = Math.floor((entity.y + entity.h - 1) / TILE);

    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        const ch = getTile(tx, ty);
        if (!isSolid(ch)) continue;
        const r = tileRect(tx, ty);
        if (aabb(entity, r)) {
          if (entity.vx > 0) entity.x = r.x - entity.w;
          else if (entity.vx < 0) entity.x = r.x + r.w;
          entity.vx = 0;
        }
      }
    }

    // Y
    entity.y += entity.vy;
    left = Math.floor(entity.x / TILE);
    right = Math.floor((entity.x + entity.w) / TILE);
    top = Math.floor(entity.y / TILE);
    bottom = Math.floor((entity.y + entity.h) / TILE);

    entity.onGround = false;

    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        const ch = getTile(tx, ty);
        if (!isSolid(ch) && ch !== "?") continue; // ? は特別扱い（使用前も固い）
        const r = tileRect(tx, ty);
        if (aabb(entity, r)) {
          if (entity.vy > 0) {
            entity.y = r.y - entity.h;
            entity.vy = 0;
            entity.onGround = true;
          } else if (entity.vy < 0) {
            entity.y = r.y + r.h;
            entity.vy = 0;

            // ? を下から叩くとコイン（1回）
            if (entity === player && ch === "?") {
              setTile(tx, ty, "B"); // 使用済みブロック
              coins += 1;
              score += 100;
            }
          }
        }
      }
    }
  }

  function isHazardAt(entity) {
    const left = Math.floor(entity.x / TILE);
    const right = Math.floor((entity.x + entity.w) / TILE);
    const top = Math.floor(entity.y / TILE);
    const bottom = Math.floor((entity.y + entity.h) / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        if (getTile(tx, ty) === "^") return true;
      }
    }
    return false;
  }

  // ====== 敵AI（穴回避＋壁反転＋小段差登り） ======
  function enemyAI(e) {
    if (!e.alive) return;

    const dir = e.vx >= 0 ? 1 : -1;

    // 穴回避：進行方向の足元（少し先）が空なら反転
    const footX = e.x + (dir === 1 ? e.w + 2 : -2);
    const footY = e.y + e.h + 2;
    const txAhead = Math.floor(footX / TILE);
    const tyFoot = Math.floor(footY / TILE);
    if (!isSolid(getTile(txAhead, tyFoot))) {
      e.vx *= -1;
    }

    // 小段差：前方が壁で、上が空なら少し持ち上げる。無理なら反転
    const headY = e.y + e.h - 12;
    const txWall = Math.floor((e.x + (dir === 1 ? e.w + 2 : -2)) / TILE);
    const tyHead = Math.floor(headY / TILE);
    const wallTile = getTile(txWall, tyHead);

    if (isSolid(wallTile) || wallTile === "?") {
      const tyAbove = tyHead - 1;
      const aboveTile = getTile(txWall, tyAbove);
      if (!isSolid(aboveTile) && aboveTile !== "?") {
        e.y -= 10;
      } else {
        e.vx *= -1;
      }
    }
  }

  // ====== カメラ ======
  const cam = { x: 0, y: 0 };
  function updateCamera() {
    cam.x = player.x + player.w/2 - canvas.width/2;
    cam.y = player.y + player.h/2 - canvas.height/2;

    cam.x = clamp(cam.x, 0, Math.max(0, worldW - canvas.width));
    cam.y = clamp(cam.y, 0, Math.max(0, worldH - canvas.height));
  }

  // ====== アニメ ======
  function updateAnim(dt) {
    const moving = Math.abs(player.vx) > 0.4 && player.onGround;
    if (moving) {
      player.animT += dt;
      const frame = Math.floor(player.animT * SPRITE.fps) % 4;
      player.animFrame = frame;
    } else {
      player.animFrame = 0;
      player.animT = 0;
    }
  }

  // ====== ループ ======
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if (!gameOver && !gameClear) update(dt);
    draw();

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function update(dt) {
    // しゃがみ
    player.crouch = input.down && player.onGround;
    const baseH = 44;
    const crouchH = 30;
    const oldH = player.h;
    player.h = player.crouch ? crouchH : baseH;
    if (!player.crouch && oldH !== player.h) {
      player.y -= (baseH - crouchH);
    }

    // 左右移動（★空中は横移動を1.7倍）
    const acc = player.onGround ? MOVE_ACC : MOVE_ACC * AIR_CONTROL;
    if (input.left)  player.vx -= acc;
    if (input.right) player.vx += acc;
    if (!input.left && !input.right) player.vx *= FRICTION;

    player.vx = clamp(player.vx, -MAX_SPEED, MAX_SPEED);

    // 向き
    if (player.vx > 0.2) player.facing = 1;
    if (player.vx < -0.2) player.facing = -1;

    // ジャンプ（1回）
    if (input.jump && player.onGround && !player.crouch) {
      player.vy = -JUMP_POWER;
      player.onGround = false;
    }

    // 重力
    player.vy += GRAVITY;

    // 衝突
    collideWithWorld(player);

    // 落下死
    if (player.y > worldH + 300) gameOver = true;

    // トゲ
    if (isHazardAt(player)) gameOver = true;

    // 敵
    for (const e of enemies) {
      if (!e.alive) continue;

      enemyAI(e);
      e.vy += GRAVITY;
      e.vx = clamp(e.vx, -2.0, 2.0);

      collideWithWorld(e);

      // プレイヤーと衝突
      if (aabb(player, e)) {
        const playerPrevBottom = (player.y - player.vy) + player.h;
        const enemyTop = e.y;
        const stomp = playerPrevBottom <= enemyTop + 6 && player.vy > 0;

        if (stomp) {
          e.alive = false;
          score += 200;
          player.vy = -8;
        } else {
          gameOver = true;
        }
      }
    }

    // ゴール
    if (aabb(player, goal)) gameClear = true;

    updateCamera();
    updateAnim(dt);
  }

  // ====== 描画 ======
  function draw() {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(-cam.x, -cam.y);

    // タイル描画
    for (let ty = 0; ty < MAP.length; ty++) {
      const row = MAP[ty];
      for (let tx = 0; tx < row.length; tx++) {
        const ch = row[tx];
        if (ch === ".") continue;

        const r = tileRect(tx, ty);

        if (ch === "#" || ch === "=") {
          ctx.fillStyle = (ch === "#") ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.06)";
          ctx.fillRect(r.x, r.y, r.w, r.h);
        } else if (ch === "?") {
          ctx.fillStyle = "rgba(255,255,0,0.18)";
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.strokeStyle = "rgba(255,255,255,0.20)";
          ctx.strokeRect(r.x+6, r.y+6, r.w-12, r.h-12);
        } else if (ch === "B") {
          ctx.fillStyle = "rgba(255,255,255,0.10)";
          ctx.fillRect(r.x, r.y, r.w, r.h);
        } else if (ch === "^") {
          ctx.fillStyle = "rgba(255,80,80,0.25)";
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.beginPath();
          ctx.moveTo(r.x + 8, r.y + r.h - 6);
          ctx.lineTo(r.x + r.w/2, r.y + 8);
          ctx.lineTo(r.x + r.w - 8, r.y + r.h - 6);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // ゴール旗
    ctx.fillStyle = "rgba(120,255,160,0.25)";
    ctx.fillRect(goal.x, goal.y, goal.w, goal.h);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(goal.x + goal.w/2 - 2, goal.y - 32, 4, goal.h + 32);

    // 敵
    for (const e of enemies) {
      if (!e.alive) continue;
      ctx.fillStyle = "rgba(255,140,80,0.28)";
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fillRect(e.x+6, e.y+10, 6, 6);
      ctx.fillRect(e.x+e.w-12, e.y+10, 6, 6);
    }

    // プレイヤー
    drawPlayer();

    ctx.restore();

    // HUD（左上）
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `${Math.max(14, Math.floor(canvas.height/45))}px system-ui, -apple-system`;
    ctx.textAlign = "left";
    ctx.fillText(`COIN ${coins}   SCORE ${score}`, 16, 28);

    // ★バージョン表示（右上：一番分かりやすい）
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "12px system-ui, -apple-system";
    ctx.textAlign = "right";
    ctx.fillText(GAME_VERSION, canvas.width - 12, 22);
    ctx.textAlign = "left";

    // 状態表示
    if (gameOver) {
      drawCenterText("GAME OVER", "R でリトライ");
    } else if (gameClear) {
      drawCenterText("CLEAR!", "R で最初から");
    }
  }

  function drawPlayer() {
    if (!img.complete || img.naturalWidth === 0) {
      ctx.fillStyle = "rgba(120,180,255,0.30)";
      ctx.fillRect(player.x, player.y, player.w, player.h);
      return;
    }

    const frame = player.animFrame;
    const sx = (frame % SPRITE.cols) * SPRITE.frameW;
    const sy = Math.floor(frame / SPRITE.cols) * SPRITE.frameH;

    const drawW = 84;
    const drawH = 120;
    const dx = player.x + player.w/2 - drawW/2;
    const dy = player.y + player.h - drawH;

    ctx.save();
    if (player.facing === -1) {
      ctx.translate(dx + drawW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, sx, sy, SPRITE.frameW, SPRITE.frameH, 0, dy, drawW, drawH);
    } else {
      ctx.drawImage(img, sx, sy, SPRITE.frameW, SPRITE.frameH, dx, dy, drawW, drawH);
    }
    ctx.restore();
  }

  function drawCenterText(title, sub) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = `bold ${Math.floor(canvas.height/10)}px system-ui, -apple-system`;
    ctx.fillText(title, canvas.width/2, canvas.height/2 - 10);

    ctx.font = `${Math.floor(canvas.height/28)}px system-ui, -apple-system`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(sub, canvas.width/2, canvas.height/2 + 45);

    // ★ここにもバージョン（ゲームオーバー/クリア時に確実に見える）
    ctx.font = "12px system-ui, -apple-system";
    ctx.fillStyle = "rgba(255,255,255,0.70)";
    ctx.fillText(GAME_VERSION, canvas.width/2, canvas.height/2 + 80);

    ctx.restore();
  }
})();
