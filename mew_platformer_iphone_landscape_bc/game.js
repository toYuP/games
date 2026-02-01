(() => {
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

  // ====== 物理調整（ジャンプ低め：1回で届く高さに） ======
  const GRAVITY = 1.2;      // ←重めにしてキビキビ
  const JUMP_POWER = 12;    // ←低め（まだ高ければ 11）
  const MOVE_ACC = 0.9;
  const MAX_SPEED = 6.0;
  const FRICTION = 0.80;

  // ====== タイルマップ（編集しやすい） ======
  // . 空
  // # 地面（固い）
  // = 足場（固い）
  // ? コインブロック（下から叩くと1回コイン）
  // ^ トゲ
  // E 敵
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

  const TILE = 48; // タイルサイズ(px)
  const worldW = MAP[0].length * TILE;
  const worldH = MAP.length * TILE;

  // ====== ユーティリティ ======
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function aabb(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  // タイル取得
  function getTile(tx, ty) {
    if (ty < 0 || ty >= MAP.length) return "#"; // 外は壁扱い
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
    return ch === "#" || ch === "=" || ch === "?";
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
    // 走る向きを逆に：初期「左向き」
    facing: -1, // -1=左, 1=右
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
            vx: -1.2, // 左へ歩き始め
            vy: 0,
            alive: true
          });
          setTile(tx, ty, "."); // マップ上のEは消す
        }
      }
    }
  }
  spawnEnemiesFromMap();

  // ====== ゴール ======
  let goal = { x: worldW - TILE * 2, y: TILE * 10, w: 32, h: 96 };
