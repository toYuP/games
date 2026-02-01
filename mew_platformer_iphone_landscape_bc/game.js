(() => {
  'use strict';

  // ===== Canvas =====
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const W = canvas.width;   // 960
  const H = canvas.height;  // 540

  // ===== HUD =====
  const coinEl = document.getElementById('coin');
  const scoreEl = document.getElementById('score');
  const msgEl = document.getElementById('msg');

  // ===== Sprite (character) =====
  const SPRITE = {
    url: 'assets/mew_spritesheet.png',
    frameW: 352,
    frameH: 512,
    cols: 4,
    // frame index layout in the provided sheet (4x2):
    // 0 idle, 1-3 run, 4 crouch, 5 crouch(move), 6 hurt, 7 win
  };
  const img = new Image();
  img.src = SPRITE.url;

  // ===== Utils =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

  function aabb(a, b) {
    return !(a.x + a.w <= b.x || a.x >= b.x + b.w || a.y + a.h <= b.y || a.y >= b.y + b.h);
  }

  // ===== Game constants =====
  const TILE = 48;                 // tile size (px)
  const GRAV = 1900;               // gravity
  const JUMP_V = -720;
  const MOVE_ACC = 3200;
  const MOVE_MAX = 320;
  const AIR_MAX = 340;
  const FRICTION = 2200;

  // Player size (roughly fits the character art)
  const P_W = 54;
  const P_H = 86;
  const CROUCH_H = 62;

  // Enemy size
  const E_W = 44;
  const E_H = 44;
  const ENEMY_STEP = 12; // smarter enemy: climb small steps

  // ===== Tile map =====
  // Edit this to build stages easily.
  // Legend:
  //  . empty
  //  # solid ground
  //  = solid platform (same as #, just readability)
  //  ? coin block (solid, 1 coin when hit from below)
  //  ^ spike (damage)
  //  E enemy spawn
  //  F goal flag
  //
  // Tips:
  // - Keep all rows the same length.
  // - The bottom rows should be ground (#) so falling off is possible if you cut holes.
  const MAP = [
    "....................................................................................................",
    "....................................................................................................",
    "....................................................................................................",
    "..................................................??...............................................",
    "..................................................==...............................................",
    ".............................E.....................==.............E.................................",
    "......................??...........................==...............................................",
    "......................==....................^^.....==............................??..................",
    "..........??..........==.............==............==.............==..............==.................",
    "..........==..........==.....==......==....==......==......==.....==.......==......==.............F..",
    "#######..#######..########..####..##########..########..#######..####..########..#######..############",
    "#######..#######..########..####..##########..########..#######..####..########..#######..############",
  ];

  const MAP_H = MAP.length;
  const MAP_W = MAP[0].length;
  const LEVEL_W = MAP_W * TILE;
  const LEVEL_H = MAP_H * TILE;

  // ===== Build world objects from map =====
  const blocks = []; // {x,y,w,h,used}
  const spikes = [];
  const enemies = [];
  let goal = {x: LEVEL_W - 2*TILE, y: (MAP_H-3)*TILE, w: 26, h: 120};

  // solids as tile grid
  const solidGrid = Array.from({length: MAP_H}, () => Array(MAP_W).fill(false));

  function inBounds(tx, ty) {
    return tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H;
  }
  function tileAt(tx, ty) {
    if (!inBounds(tx, ty)) return '.';
    return MAP[ty][tx];
  }
  function isSolidTileChar(ch) {
    return ch === '#' || ch === '=' || ch === '?';
  }
  function isSolidAtPx(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    return isSolidTileChar(tileAt(tx, ty));
  }
  function tilesToRects() {
    // simple rect-per-tile (fine for this size)
    const rects = [];
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const ch = tileAt(tx, ty);
        if (isSolidTileChar(ch)) {
          solidGrid[ty][tx] = true;
          rects.push({x: tx*TILE, y: ty*TILE, w: TILE, h: TILE, t: ch});
          if (ch === '?') blocks.push({x: tx*TILE, y: ty*TILE, w: TILE, h: TILE, used:false, tx, ty});
        } else if (ch === '^') {
          spikes.push({x: tx*TILE + 8, y: ty*TILE + (TILE-22), w: TILE-16, h: 22});
        } else if (ch === 'E') {
          enemies.push({x: tx*TILE + 2, y: ty*TILE + (TILE-E_H), w: E_W, h: E_H, vx: (Math.random()<0.5?-110:110), vy:0, onGround:false, alive:true});
        } else if (ch === 'F') {
          goal = {x: tx*TILE + (TILE-26)/2, y: ty*TILE - 120 + TILE, w: 26, h: 120};
        }
      }
    }
    return rects;
  }
  const solidRects = tilesToRects();

  function getSolids() {
    // coin blocks are already in solidRects; we just need solidRects for collision
    return solidRects;
  }

  // ===== Coins / score =====
  const coinPops = []; // {x,y,vy,t}
  let coinCount = 0;
  let score = 0;

  function addCoin(x, y) {
    coinCount++;
    score += 100;
    coinEl.textContent = String(coinCount);
    scoreEl.textContent = String(score);
    coinPops.push({x, y, vy: -220, t: 0.0});
  }

  // ===== Player =====
  const player = {
    x: 2*TILE,
    y: 6*TILE,
    vx: 0,
    vy: 0,
    w: P_W,
    h: P_H,
    crouch: false,
    onGround: false,
    facing: 1,
    state: 'play', // play, dead, clear
    animT: 0,
    hurtT: 0,
  };

  let camX = 0;

  function reset() {
    player.x = 2*TILE;
    player.y = 6*TILE;
    player.vx = 0;
    player.vy = 0;
    player.crouch = false;
    player.w = P_W;
    player.h = P_H;
    player.onGround = false;
    player.facing = 1;
    player.state = 'play';
    player.animT = 0;
    player.hurtT = 0;

    // reset blocks/enemies
    for (const b of blocks) b.used = false;
    for (const e of enemies) {
      e.alive = true;
      e.vy = 0;
      e.onGround = false;
    }

    coinPops.length = 0;
    coinCount = 0;
    score = 0;
    coinEl.textContent = "0";
    scoreEl.textContent = "0";
    msgEl.textContent = "";
  }

  // ===== Input =====
  const keys = new Map();
  function setKey(k, v) { keys.set(k, v); }

  window.addEventListener('keydown', (e) => {
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','KeyR'].includes(e.code)) e.preventDefault();
    setKey(e.code, true);
    if (e.code === 'KeyR') reset();
  }, {passive:false});

  window.addEventListener('keyup', (e) => setKey(e.code, false));

  // Touch buttons (iPhone landscape)
  for (const btn of document.querySelectorAll('.btn')) {
    const code = btn.dataset.key === 'Space' ? 'Space' : btn.dataset.key;
    const down = (ev) => { ev.preventDefault(); setKey(code, true); };
    const up = (ev) => { ev.preventDefault(); setKey(code, false); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerout', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ===== Collision helpers =====
  function collideRectWorld(r) {
    const solids = getSolids();
    for (const s of solids) {
      if (aabb(r, s)) return s;
    }
    return null;
  }

  function moveAndCollide(entity, dt, isPlayer=false) {
    // Horizontal
    entity.x += entity.vx * dt;

    let hit = collideRectWorld(entity);
    if (hit) {
      if (entity.vx > 0) entity.x = hit.x - entity.w;
      else if (entity.vx < 0) entity.x = hit.x + hit.w;
      entity.vx = 0;

      // Enemy smarter: try step-up when bumping into a small step
      if (!isPlayer) {
        for (let s = 1; s <= ENEMY_STEP; s++) {
          const test = {x: entity.x + sign(entity.vx||1), y: entity.y - s, w: entity.w, h: entity.h};
          if (!collideRectWorld(test)) {
            entity.y -= s;
            break;
          }
        }
      }
    }

    // Vertical
    entity.y += entity.vy * dt;
    entity.onGround = false;

    hit = collideRectWorld(entity);
    if (hit) {
      if (entity.vy > 0) {
        entity.y = hit.y - entity.h;
        entity.vy = 0;
        entity.onGround = true;
      } else if (entity.vy < 0) {
        entity.y = hit.y + hit.h;
        entity.vy = 0;

        // Player hits coin block from below
        if (isPlayer) {
          const px = entity.x + entity.w/2;
          const tx = Math.floor(px / TILE);
          const ty = Math.floor((hit.y + hit.h/2) / TILE);
          // Find matching block
          const b = blocks.find(bb => bb.tx === tx && bb.ty === ty);
          if (b && !b.used) {
            b.used = true;
            addCoin(b.x + TILE/2, b.y - 8);
          }
        }
      }
    }
  }

  // ===== Enemy smarter movement =====
  function enemyThink(e) {
    if (!e.alive) return;

    // Reverse on edge: if ground disappears in front
    if (e.onGround) {
      const dir = sign(e.vx) || 1;
      const aheadX = (dir > 0) ? (e.x + e.w + 2) : (e.x - 2);
      const footY = e.y + e.h + 2;
      if (!isSolidAtPx(aheadX, footY)) {
        e.vx *= -1;
      }
    }

    // Reverse on wall handled by collision; but if stuck, nudge
    if (Math.abs(e.vx) < 1) e.vx = (Math.random()<0.5?-110:110);
  }

  // ===== Main update =====
  let last = performance.now();

  function update(now) {
    const dt = clamp((now - last) / 1000, 0, 1/30);
    last = now;

    if (player.state === 'play') {
      // crouch
      const wantCrouch = keys.get('ArrowDown') === true;
      if (wantCrouch && !player.crouch && player.onGround) {
        player.crouch = true;
        const oldH = player.h;
        player.h = CROUCH_H;
        player.y += (oldH - player.h);
      } else if (!wantCrouch && player.crouch) {
        // try stand up if space
        const oldH = player.h;
        const test = {x: player.x, y: player.y - (P_H - oldH), w: player.w, h: P_H};
        if (!collideRectWorld(test)) {
          player.crouch = false;
          player.y -= (P_H - oldH);
          player.h = P_H;
        }
      }

      // horizontal input
      const left = keys.get('ArrowLeft') === true;
      const right = keys.get('ArrowRight') === true;

      const maxV = player.onGround ? MOVE_MAX : AIR_MAX;

      if (left && !right) {
        player.vx -= MOVE_ACC * dt;
        player.facing = -1;
      } else if (right && !left) {
        player.vx += MOVE_ACC * dt;
        player.facing = 1;
      } else {
        // friction
        const f = FRICTION * dt;
        if (player.vx > 0) player.vx = Math.max(0, player.vx - f);
        else if (player.vx < 0) player.vx = Math.min(0, player.vx + f);
      }
      player.vx = clamp(player.vx, -maxV, maxV);

      // jump
      const jump = (keys.get('Space') === true) || (keys.get('ArrowUp') === true);
      if (jump && player.onGround) {
        player.vy = JUMP_V;
        player.onGround = false;
      }

      // gravity
      player.vy += GRAV * dt;

      moveAndCollide(player, dt, true);

      // spikes / fall
      for (const s of spikes) {
        if (aabb(player, s)) {
          die();
          break;
        }
      }
      if (player.y > LEVEL_H + 300) die();

      // enemies update + interactions
      for (const e of enemies) {
        if (!e.alive) continue;

        enemyThink(e);
        e.vy += GRAV * dt;
        moveAndCollide(e, dt, false);

        // Clamp enemy speed a bit
        e.vx = clamp(e.vx, -140, 140);

        // interaction
        if (aabb(player, e)) {
          const playerBottom = player.y + player.h;
          const enemyTop = e.y;
          const falling = player.vy > 120;
          const stomp = falling && (playerBottom - enemyTop) < 18;
          if (stomp) {
            e.alive = false;
            player.vy = -420; // bounce
            score += 200;
            scoreEl.textContent = String(score);
          } else {
            die();
          }
        }
      }

      // goal
      if (aabb(player, goal)) {
        player.state = 'clear';
        msgEl.textContent = "CLEAR!  Rでリトライ";
      }

      // camera follow
      camX = clamp(player.x - W*0.38, 0, Math.max(0, LEVEL_W - W));

      // coin pops
      for (let i = coinPops.length-1; i >= 0; i--) {
        const p = coinPops[i];
        p.t += dt;
        p.y += p.vy * dt;
        p.vy += 600 * dt;
        if (p.t > 0.7) coinPops.splice(i, 1);
      }

      player.animT += dt;
    }

    render();
    requestAnimationFrame(update);
  }

  function die() {
    if (player.state !== 'play') return;
    player.state = 'dead';
    msgEl.textContent = "GAME OVER  Rでリトライ";
  }

  // ===== Render =====
  function drawTile(tx, ty, ch) {
    const x = tx*TILE - camX;
    const y = ty*TILE;
    if (x < -TILE || x > W+TILE) return;

    if (ch === '#') {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x, y, TILE, 6);
    } else if (ch === '=') {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y, TILE, 4);
    } else if (ch === '?') {
      // coin block
      const b = blocks.find(bb => bb.tx === tx && bb.ty === ty);
      ctx.fillStyle = (b && b.used) ? 'rgba(255,255,255,0.08)' : 'rgba(255,220,120,0.20)';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.strokeRect(x+2, y+2, TILE-4, TILE-4);
      ctx.fillStyle = (b && b.used) ? 'rgba(255,255,255,0.18)' : 'rgba(255,220,120,0.9)';
      ctx.font = '900 22px system-ui';
      ctx.fillText('?', x + TILE/2 - 6, y + TILE/2 + 8);
    }
  }

  function render() {
    ctx.clearRect(0,0,W,H);

    // parallax clouds-ish
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i=0;i<28;i++) {
      const cx = (i*420 - (camX*0.35 % 420));
      const cy = 70 + (i%5)*18;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 70, 18, 0, 0, Math.PI*2);
      ctx.fill();
    }

    // tiles
    for (let ty=0; ty<MAP_H; ty++) {
      const row = MAP[ty];
      for (let tx=0; tx<MAP_W; tx++) {
        const ch = row[tx];
        if (ch === '#' || ch === '=' || ch === '?') drawTile(tx, ty, ch);
        else if (ch === '^') {
          const x = tx*TILE - camX;
          const y = ty*TILE + TILE-22;
          ctx.fillStyle = 'rgba(255,90,120,0.85)';
          ctx.beginPath();
          ctx.moveTo(x+8, y+22);
          ctx.lineTo(x+TILE/2, y);
          ctx.lineTo(x+TILE-8, y+22);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // goal flag
    {
      const x = goal.x - camX;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(x, goal.y, 4, goal.h);
      ctx.fillStyle = 'rgba(120,220,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(x+4, goal.y+10);
      ctx.lineTo(x+4+40, goal.y+22);
      ctx.lineTo(x+4, goal.y+34);
      ctx.closePath();
      ctx.fill();
    }

    // enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      const x = e.x - camX;
      ctx.fillStyle = 'rgba(255,170,80,0.85)';
      ctx.fillRect(x, e.y, e.w, e.h);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x+10, e.y+14, 6, 6);
      ctx.fillRect(x+28, e.y+14, 6, 6);
    }

    // coin pops
    for (const p of coinPops) {
      const x = p.x - camX;
      ctx.fillStyle = 'rgba(255,220,120,0.95)';
      ctx.beginPath();
      ctx.arc(x, p.y, 8, 0, Math.PI*2);
      ctx.fill();
    }

    // player sprite
    drawPlayer();

    // edges (for debugging feel)
    // ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(-camX,0,2,LEVEL_H);

    // state overlay
    if (player.state !== 'play') {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(0,0,W,H);
    }
  }

  function drawPlayer() {
    const sx = player.x - camX;
    const sy = player.y;

    // Choose animation frame
    let frame = 0;
    if (player.state === 'clear') frame = 7;
    else if (player.state === 'dead') frame = 6;
    else if (player.crouch) frame = 4;
    else if (!player.onGround) frame = 1;
    else if (Math.abs(player.vx) > 30) {
      const t = player.animT;
      frame = 1 + Math.floor((t*10) % 3); // 1..3
    } else frame = 0;

    const fx = (frame % SPRITE.cols) * SPRITE.frameW;
    const fy = Math.floor(frame / SPRITE.cols) * SPRITE.frameH;

    // Draw with scale down
    const scale = 0.22; // tuned for this sheet
    const dw = SPRITE.frameW * scale;
    const dh = SPRITE.frameH * scale;

    ctx.save();
    ctx.translate(sx + player.w/2, sy + player.h/2);
    ctx.scale(player.facing, 1);
    ctx.drawImage(img, fx, fy, SPRITE.frameW, SPRITE.frameH, -dw/2, -dh/2, dw, dh);
    ctx.restore();
  }

  // Start
  reset();
  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(update);
  });
})();