/* ════════════════════════════════════════════════════════════════════
   SPACE DODGER  —  script.js
   Architecture:
     AudioManager     — Web Audio API sound synthesis
     StarfieldManager — Animated background stars
     Particle / ParticleSystem — Explosion + trail effects
     Asteroid         — Falling obstacle entity
     PowerUp          — Collectible boost item
     Ship             — Player-controlled spaceship
     Game             — Master controller (state machine + game loop)
════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── CONSTANTS ───────────────────────────────────────────────── */
const CANVAS_LOGICAL_W = 480;
const CANVAS_LOGICAL_H = 760;
const SHIP_W  = 44;
const SHIP_H  = 52;
const SHIP_SPEED_BASE = 5.2;
const ASTEROID_BASE_SPEED    = 2.1;
const ASTEROID_SPAWN_INTERVAL = 1400;
const SCORE_PER_SECOND        = 8;
const LEVEL_SCORE_STEP        = 200;
const POWERUP_TYPES    = ['shield', 'slow', 'boost'];
const POWERUP_DURATION = 6000;
const POWERUP_SPAWN_CHANCE = 0.0018;

/* ── UTILITY HELPERS ─────────────────────────────────────────── */
const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp    = (a, b, t)   => a + (b - a) * t;
const TAU     = Math.PI * 2;

function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/* ── AUDIO MANAGER ───────────────────────────────────────────── */
class AudioManager {
  constructor() {
    this.enabled = true;
    this._ctx = null;
    this._ambientGain = null;
    this._ambientStarted = false;
  }

  _getCtx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._ctx;
  }

  _tone(freq, type, duration, vol = 0.18, startDelay = 0) {
    if (!this.enabled) return;
    try {
      const ctx  = this._getCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startDelay);
      gain.gain.setValueAtTime(vol, ctx.currentTime + startDelay);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startDelay + duration);
      osc.start(ctx.currentTime + startDelay);
      osc.stop(ctx.currentTime + startDelay + duration + 0.05);
    } catch (_) {}
  }

  _noise(duration, vol = 0.25) {
    if (!this.enabled) return;
    try {
      const ctx    = this._getCtx();
      const bufLen = Math.floor(ctx.sampleRate * duration);
      const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data   = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const src  = ctx.createBufferSource();
      const gain = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      src.buffer = buf;
      filt.type = 'lowpass';
      filt.frequency.value = 400;
      src.connect(filt);
      filt.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      src.start();
    } catch (_) {}
  }

  startAmbient() {
    if (!this.enabled || this._ambientStarted) return;
    try {
      const ctx  = this._getCtx();
      this._ambientGain = ctx.createGain();
      this._ambientGain.connect(ctx.destination);
      this._ambientGain.gain.value = 0.04;
      const freqs = [55, 55.3, 110, 110.2];
      freqs.forEach(f => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        osc.connect(this._ambientGain);
        osc.start();
      });
      const lfo  = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = 0.18;
      lfoG.gain.value = 0.018;
      lfo.connect(lfoG);
      lfoG.connect(this._ambientGain.gain);
      lfo.start();
      this._ambientStarted = true;
    } catch (_) {}
  }

  stopAmbient() {
    if (this._ambientGain) {
      try { this._ambientGain.gain.value = 0; } catch (_) {}
    }
    this._ambientStarted = false;
    this._ctx = null;
  }

  resume() {
    try { if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume(); } catch (_) {}
  }

  playThrust()    { this._tone(220, 'sawtooth', 0.08, 0.04); }
  playExplosion() { this._noise(0.6, 0.3); this._tone(80, 'sawtooth', 0.4, 0.15); }
  playMilestone() {
    this._tone(660,  'sine', 0.12, 0.14, 0);
    this._tone(880,  'sine', 0.12, 0.14, 0.1);
    this._tone(1100, 'sine', 0.12, 0.14, 0.2);
  }
  playPowerup()  { this._tone(440, 'sine', 0.08, 0.12, 0); this._tone(660, 'sine', 0.12, 0.12, 0.07); }
  playLevelUp()  { [440, 550, 660, 880].forEach((f, i) => this._tone(f, 'square', 0.15, 0.10, i * 0.08)); }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) { this.startAmbient(); } else { this.stopAmbient(); }
    return this.enabled;
  }
}

/* ── STARFIELD ───────────────────────────────────────────────── */
class StarfieldManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.stars  = [];
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this._populate();
  }

  _populate() {
    const n = Math.floor((this.canvas.width * this.canvas.height) / 4200);
    this.stars = Array.from({ length: n }, () => ({
      x: rand(0, this.canvas.width),
      y: rand(0, this.canvas.height),
      r: rand(0.3, 1.6),
      spd: rand(0.08, 0.45),
      op:  rand(0.3, 1),
      twinkle: rand(0, TAU)
    }));
  }

  update(dt) {
    for (const s of this.stars) {
      s.y += s.spd * (dt / 16);
      s.twinkle += 0.03;
      if (s.y > this.canvas.height) { s.y = -2; s.x = rand(0, this.canvas.width); }
    }
  }

  draw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of this.stars) {
      const alpha = s.op * (0.7 + 0.3 * Math.sin(s.twinkle));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fillStyle = `rgba(200,230,255,${alpha})`;
      ctx.fill();
    }
  }
}

/*  PARTICLE  */
class Particle {
  constructor(x, y, vx, vy, color, life, size) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.color = color;
    this.life  = life;
    this.decay = rand(0.012, 0.028);
    this.size  = size;
    this.drag  = 0.96;
  }
  update() {
    this.x  += this.vx; this.y  += this.vy;
    this.vx *= this.drag; this.vy *= this.drag;
    this.vy += 0.06;
    this.life -= this.decay;
  }
  get alive() { return this.life > 0; }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle   = this.color;
    ctx.shadowBlur  = 8;
    ctx.shadowColor = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * this.life, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

class ParticleSystem {
  constructor() { this.particles = []; }

  explode(x, y, colorA = '#00f0ff', colorB = '#ff4060', count = 55) {
    for (let i = 0; i < count; i++) {
      const angle = rand(0, TAU), speed = rand(0.5, 5.5);
      const color = Math.random() < 0.5 ? colorA : colorB;
      this.particles.push(new Particle(x, y, Math.cos(angle)*speed, Math.sin(angle)*speed, color, 1, rand(1.5, 4.5)));
    }
  }

  trail(x, y, color = 'rgba(0,240,255,0.7)') {
    this.particles.push(new Particle(x + rand(-3,3), y, rand(-0.4,0.4), rand(0.6,1.8), color, 0.7, rand(1,2.5)));
  }

  update() { this.particles = this.particles.filter(p => { p.update(); return p.alive; }); }
  draw(ctx) { this.particles.forEach(p => p.draw(ctx)); }
}

/*  ASTEROID */
class Asteroid {
  constructor(lw, lh, speedMult = 1) {
    this.w  = randInt(22, 52);
    this.h  = this.w * rand(0.75, 1.25);
    this.x  = rand(this.w, lw - this.w);
    this.y  = -this.h - 10;
    this.vy = rand(ASTEROID_BASE_SPEED, ASTEROID_BASE_SPEED + 1.4) * speedMult;
    this.vx = rand(-0.5, 0.5);
    this.rot  = rand(0, TAU);
    this.rotV = rand(-0.04, 0.04);
    this.color   = `hsl(${randInt(10,50)},${randInt(15,35)}%,${randInt(35,55)}%)`;
    this.craterC = `hsl(${randInt(10,50)},${randInt(5,20)}%,${randInt(20,38)}%)`;
    const pts = randInt(6, 10);
    this.verts = Array.from({ length: pts }, (_, i) => ({
      a: (i / pts) * TAU, r: rand(0.6, 1.0)
    }));
    this.craters = Array.from({ length: randInt(1,3) }, () => ({
      ox: rand(-0.25,0.25), oy: rand(-0.25,0.25), r: rand(0.08,0.18)
    }));
    this.alive = true;
  }

  update(speedMult = 1) {
    this.x += this.vx;
    this.y += this.vy * speedMult;
    this.rot += this.rotV;
  }

  isOffScreen(lh) { return this.y > lh + this.h + 20; }
  hitRadius()     { return Math.min(this.w, this.h) * 0.38; }

  draw(ctx) {
    const hw = this.w / 2, hh = this.h / 2;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.scale(hw, hh);
    ctx.beginPath();
    this.verts.forEach((v, i) => {
      const nx = Math.cos(v.a) * v.r, ny = Math.sin(v.a) * v.r;
      i === 0 ? ctx.moveTo(nx, ny) : ctx.lineTo(nx, ny);
    });
    ctx.closePath();
    ctx.fillStyle   = this.color;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 0.04;
    ctx.fill();
    ctx.stroke();
    this.craters.forEach(c => {
      ctx.beginPath();
      ctx.arc(c.ox, c.oy, c.r, 0, TAU);
      ctx.fillStyle = this.craterC;
      ctx.fill();
    });
    ctx.restore();
  }
}

/* POWER-UP */
const POWERUP_META = {
  shield: { label: 'SHIELD',      icon: '🛡', color: '#00f0ff', glow: 'rgba(0,240,255,0.6)' },
  slow:   { label: 'SLOW MOTION', icon: '⏱', color: '#b060ff', glow: 'rgba(176,96,255,0.6)' },
  boost:  { label: '2× SCORE',    icon: '⚡', color: '#ffd060', glow: 'rgba(255,208,96,0.6)' }
};

class PowerUp {
  constructor(lw, type) {
    this.type  = type;
    this.meta  = POWERUP_META[type];
    this.size  = 22;
    this.x     = rand(this.size + 10, lw - this.size - 10);
    this.y     = -this.size - 10;
    this.vy    = rand(1.2, 2.0);
    this.rot   = 0;
    this.pulse = rand(0, TAU);
    this.alive = true;
  }

  update()            { this.y += this.vy; this.rot += 0.03; this.pulse += 0.08; }
  isOffScreen(lh)     { return this.y > lh + this.size + 20; }

  draw(ctx) {
    const { size, meta } = this;
    const pScale = 1 + 0.08 * Math.sin(this.pulse);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.scale(pScale, pScale);
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, TAU);
    ctx.fillStyle   = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.strokeStyle = meta.color;
    ctx.lineWidth   = 2.5;
    ctx.shadowBlur  = 16;
    ctx.shadowColor = meta.glow;
    ctx.stroke();
    ctx.font = `${size * 0.88}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur   = 0;
    ctx.fillText(meta.icon, 0, 1);
    ctx.restore();
  }
}

/*  SHIP  */
class Ship {
  constructor(lw, lh) {
    this.lw = lw; this.lh = lh;
    this.w  = SHIP_W; this.h = SHIP_H;
    this.x  = lw / 2;
    this.y  = lh - 80;
    this.vx = 0;
    this.shield = false; this.shieldTime = 0;
    this.pulseAngle = 0; this.thrustAnim = 0;
    this.invincible = false; this.invincTimer = 0;
  }

  update(keys, touchDX) {
    const speed = SHIP_SPEED_BASE;
    let moving  = false;
    if (keys['ArrowLeft'] || keys['KeyA'])  { this.vx = lerp(this.vx, -speed, 0.22); moving = true; }
    if (keys['ArrowRight'] || keys['KeyD']) { this.vx = lerp(this.vx, +speed, 0.22); moving = true; }
    if (touchDX !== 0)                       { this.vx = lerp(this.vx, touchDX * speed * 0.2, 0.3); moving = true; }
    if (!moving) this.vx = lerp(this.vx, 0, 0.18);
    this.x = clamp(this.x + this.vx, this.w / 2, this.lw - this.w / 2);
    this.pulseAngle += 0.06;
    this.thrustAnim  = (this.thrustAnim + 1) % 6;
    if (this.invincible) { this.invincTimer -= 16; if (this.invincTimer <= 0) this.invincible = false; }
  }

  activateShield(duration) {
    this.shield = true; this.shieldTime = duration;
    this.invincible = true; this.invincTimer = duration;
  }

  tickShield(dt) {
    if (this.shield) { this.shieldTime -= dt; if (this.shieldTime <= 0) this.shield = false; }
  }

  draw(ctx, particles) {
    const { x, y, w, h } = this;
    const halfW = w / 2, halfH = h / 2;

    // Thrust flame
    if (this.thrustAnim < 4) {
      const flameH = rand(8, 20);
      const flameGrad = ctx.createLinearGradient(x, y + halfH, x, y + halfH + flameH);
      flameGrad.addColorStop(0, 'rgba(0,240,255,0.9)');
      flameGrad.addColorStop(0.5, 'rgba(100,60,255,0.6)');
      flameGrad.addColorStop(1, 'rgba(100,60,255,0)');
      ctx.beginPath();
      ctx.moveTo(x - 7, y + halfH - 2);
      ctx.lineTo(x,     y + halfH + flameH);
      ctx.lineTo(x + 7, y + halfH - 2);
      ctx.closePath();
      ctx.fillStyle = flameGrad;
      ctx.fill();
      particles.trail(x - 5, y + halfH + 2, 'rgba(0,200,255,0.6)');
      particles.trail(x + 5, y + halfH + 2, 'rgba(150,80,255,0.6)');
    }

    // Shield ring
    if (this.shield) {
      const pulse = 1 + 0.06 * Math.sin(this.pulseAngle);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, (halfW + 14) * pulse, 0, TAU);
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth   = 2.5;
      ctx.shadowBlur  = 22;
      ctx.shadowColor = '#00f0ff';
      ctx.globalAlpha = 0.65;
      ctx.stroke();
      ctx.restore();
    }

    if (this.invincible && !this.shield) {
      if (Math.floor(Date.now() / 100) % 2 === 0) return;
    }

    ctx.save();
    ctx.translate(x, y);

    // Hull gradient
    const bodyGrad = ctx.createLinearGradient(-halfW, -halfH, halfW, halfH);
    bodyGrad.addColorStop(0, '#1a3a6e');
    bodyGrad.addColorStop(0.45, '#0d2550');
    bodyGrad.addColorStop(1, '#061830');
    ctx.beginPath();
    ctx.moveTo(0, -halfH);
    ctx.lineTo(halfW * 0.55, halfH * 0.3);
    ctx.lineTo(halfW, halfH);
    ctx.lineTo(-halfW, halfH);
    ctx.lineTo(-halfW * 0.55, halfH * 0.3);
    ctx.closePath();
    ctx.fillStyle   = bodyGrad;
    ctx.fill();
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth   = 1.5;
    ctx.shadowBlur  = 10;
    ctx.shadowColor = '#00f0ff';
    ctx.stroke();

    // Cockpit
    ctx.beginPath();
    ctx.ellipse(0, -halfH * 0.15, halfW * 0.25, halfH * 0.28, 0, 0, TAU);
    const cockpitGrad = ctx.createRadialGradient(0, -halfH*0.15, 0, 0, -halfH*0.15, halfW*0.25);
    cockpitGrad.addColorStop(0, 'rgba(0,240,255,0.95)');
    cockpitGrad.addColorStop(1, 'rgba(0,100,200,0.4)');
    ctx.fillStyle   = cockpitGrad;
    ctx.shadowBlur  = 14;
    ctx.shadowColor = 'rgba(0,240,255,0.8)';
    ctx.fill();

    // Wing accents
    ctx.shadowBlur = 0;
    const wAcc = ctx.createLinearGradient(-halfW, 0, -halfW*0.4, 0);
    wAcc.addColorStop(0, 'rgba(176,96,255,0.8)');
    wAcc.addColorStop(1, 'rgba(176,96,255,0)');
    ctx.fillStyle = wAcc;
    ctx.fillRect(-halfW, halfH*0.2, halfW*0.62, 5);
    const wAcc2 = ctx.createLinearGradient(halfW*0.4, 0, halfW, 0);
    wAcc2.addColorStop(0, 'rgba(176,96,255,0)');
    wAcc2.addColorStop(1, 'rgba(176,96,255,0.8)');
    ctx.fillStyle = wAcc2;
    ctx.fillRect(halfW*0.38, halfH*0.2, halfW*0.62, 5);

    ctx.restore();
  }

  collidesWithAsteroid(ast) {
    const dx = this.x - ast.x, dy = this.y - ast.y;
    return Math.sqrt(dx*dx + dy*dy) < ast.hitRadius() + this.w * 0.35;
  }

  collidesWithPowerup(pu) {
    return aabbOverlap(
      this.x - this.w/2, this.y - this.h/2, this.w, this.h,
      pu.x - pu.size, pu.y - pu.size, pu.size*2, pu.size*2
    );
  }
}

/* GAME  */
class Game {
  constructor() {
    this.bgCanvas   = document.getElementById('starfield');
    this.mainCanvas = document.getElementById('gameCanvas');
    this.ctx        = this.mainCanvas.getContext('2d');
    this.lw = CANVAS_LOGICAL_W;
    this.lh = CANVAS_LOGICAL_H;

    this.audio     = new AudioManager();
    this.starfield = new StarfieldManager(this.bgCanvas);
    this.particles = new ParticleSystem();

    this.state      = 'start';
    this.score      = 0;
    this.level      = 1;
    this.survivalMs = 0;
    this.lastScore  = 0;
    this.lastLevel  = 1;

    this.activePowerups = {};
    this.asteroids = [];
    this.powerups  = [];
    this.ship      = null;
    this.lastAsteroidSpawn = 0;

    this.keys    = {};
    this.touchDX = 0;
    this._lastTouchX = null;

    this.shakeAmt = 0;
    this.shakeDur = 0;

    this.storage = {
      highScore:   parseInt(localStorage.getItem('sd_highScore')   || '0'),
      gamesPlayed: parseInt(localStorage.getItem('sd_gamesPlayed') || '0'),
      bestTime:    parseInt(localStorage.getItem('sd_bestTime')    || '0')
    };

    // DOM refs
    this.$hud           = document.getElementById('hud');
    this.$startScreen   = document.getElementById('startScreen');
    this.$pauseScreen   = document.getElementById('pauseScreen');
    this.$gameOverScreen = document.getElementById('gameOverScreen');
    this.$hudScore      = document.getElementById('hudScore');
    this.$hudHigh       = document.getElementById('hudHigh');
    this.$hudLevel      = document.getElementById('hudLevel');
    this.$levelBadge    = document.getElementById('levelBadge');
    this.$powerupBar    = document.getElementById('powerupBar');
    this.$levelNotif    = document.getElementById('levelNotif');
    this.$levelNotifN   = document.getElementById('levelNotifNum');
    this.$soundIcon     = document.getElementById('soundIcon');

    this._rafId  = null;
    this._lastTS = 0;

    this._initDOM();
    this._initInput();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._updateStartStats();
    this._loop(0);
  }

  _resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const scale = Math.min(vw / this.lw, vh / this.lh);
    this.mainCanvas.width  = this.lw;
    this.mainCanvas.height = this.lh;
    this.mainCanvas.style.width    = `${this.lw * scale}px`;
    this.mainCanvas.style.height   = `${this.lh * scale}px`;
    this.mainCanvas.style.position = 'fixed';
    this.mainCanvas.style.top  = `${(vh - this.lh * scale) / 2}px`;
    this.mainCanvas.style.left = `${(vw - this.lw * scale) / 2}px`;
  }

  _initDOM() {
    document.getElementById('startBtn')  .addEventListener('click', () => this.startGame());
    document.getElementById('restartBtn').addEventListener('click', () => this.startGame());
    document.getElementById('menuBtn')   .addEventListener('click', () => this.goToMenu());
    document.getElementById('pauseBtn') .addEventListener('click', () => this.togglePause());
    document.getElementById('resumeBtn').addEventListener('click', () => this.togglePause());
    document.getElementById('quitBtn')  .addEventListener('click', () => this.goToMenu());
    document.getElementById('soundBtn') .addEventListener('click', () => this._toggleSound());
  }

  _toggleSound() {
    const on = this.audio.toggle();
    this.$soundIcon.innerHTML = on
      ? `<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>`
      : `<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>`;
  }

  _initInput() {
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyP' || e.code === 'Escape') this.togglePause();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });

    this.mainCanvas.addEventListener('touchstart', e => {
      e.preventDefault();
      this._lastTouchX = e.touches[0].clientX;
    }, { passive: false });
    this.mainCanvas.addEventListener('touchmove', e => {
      e.preventDefault();
      if (this._lastTouchX === null) return;
      this.touchDX = e.touches[0].clientX - this._lastTouchX;
      this._lastTouchX = e.touches[0].clientX;
    }, { passive: false });
    this.mainCanvas.addEventListener('touchend', e => {
      e.preventDefault();
      this.touchDX = 0; this._lastTouchX = null;
    }, { passive: false });
  }

  startGame() {
    this.score = 0; this.level = 1; this.survivalMs = 0;
    this.lastScore = 0; this.lastLevel = 1;
    this.asteroids = []; this.powerups = [];
    this.particles = new ParticleSystem();
    this.activePowerups = {};
    this.shakeAmt = 0;
    this.lastAsteroidSpawn = performance.now();
    this.ship = new Ship(this.lw, this.lh);
    this._updatePowerupBar();
    this._hide(this.$startScreen);
    this._hide(this.$gameOverScreen);
    this._hide(this.$pauseScreen);
    this._show(this.$hud);
    this.state = 'playing';
    this.audio.resume();
    this.audio.startAmbient();
    this._updateHUD();
  }

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      this._show(this.$pauseScreen);
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this._hide(this.$pauseScreen);
      this._lastTS = performance.now();
    }
  }

  goToMenu() {
    this.state = 'start';
    this._hide(this.$gameOverScreen);
    this._hide(this.$pauseScreen);
    this._hide(this.$hud);
    this._show(this.$startScreen);
    this._updateStartStats();
    this.asteroids = []; this.powerups = []; this.ship = null;
  }

  _endGame() {
    this.state = 'gameover';
    this.audio.playExplosion();
    this.storage.gamesPlayed++;if (this.score > this.storage.highScore) this.storage.highScore = Math.floor(this.score);
    if (this.survivalMs > this.storage.bestTime) this.storage.bestTime = this.survivalMs;
    localStorage.setItem('sd_highScore',   this.storage.highScore);
    localStorage.setItem('sd_gamesPlayed', this.storage.gamesPlayed);
    localStorage.setItem('sd_bestTime',    this.storage.bestTime);

    document.getElementById('goScore').textContent = Math.floor(this.score);
    document.getElementById('goHigh').textContent  = this.storage.highScore;
    document.getElementById('goLevel').textContent = this.level;
    document.getElementById('goTime').textContent  = this._formatTime(this.survivalMs);
    document.getElementById('goGames').textContent = this.storage.gamesPlayed;

    const newHigh = document.getElementById('newHighBanner');
    if (Math.floor(this.score) >= this.storage.highScore && this.score > 0) {
      this._show(newHigh); this.audio.playMilestone();
    } else {
      this._hide(newHigh);
    }
    this._hide(this.$hud);
    this._show(this.$gameOverScreen);
  }

  _loop(ts) {
    const dt = Math.min(ts - this._lastTS, 50);
    this._lastTS = ts;
    this.starfield.update(dt);
    this.starfield.draw();
    if (this.state === 'playing') this._update(dt, ts);
    this._draw();
    this._rafId = requestAnimationFrame(ts => this._loop(ts));
  }

  _update(dt, ts) {
    this.survivalMs += dt;
    const scoreRate = this.activePowerups.boost ? SCORE_PER_SECOND * 2 : SCORE_PER_SECOND;
    this.score += scoreRate * (dt / 1000);

    const newLevel = 1 + Math.floor(this.score / LEVEL_SCORE_STEP);
    if (newLevel > this.level) {
      this.level = newLevel;
      this._showLevelNotif(newLevel);
      this.audio.playLevelUp();
      const badge = this.$levelBadge;
      badge.classList.remove('bump');
      void badge.offsetWidth;
      badge.classList.add('bump');
    }

    const scoreMilestone = Math.floor(this.score / 100);
    if (scoreMilestone > Math.floor(this.lastScore / 100)) this.audio.playMilestone();
    this.lastScore = this.score;

    for (const type of POWERUP_TYPES) {
      if (this.activePowerups[type] && Date.now() > this.activePowerups[type]) {
        delete this.activePowerups[type];
        if (type === 'shield') this.ship.shield = false;
        this._updatePowerupBar();
      }
    }
    this.ship.tickShield(dt);

    const asteroidSpeedMult = this.activePowerups.slow ? 0.38 : 1 + (this.level - 1) * 0.15;
    const spawnInterval = Math.max(350, ASTEROID_SPAWN_INTERVAL - (this.level - 1) * 90);
    if (ts - this.lastAsteroidSpawn > spawnInterval) {
      this.asteroids.push(new Asteroid(this.lw, this.lh, asteroidSpeedMult));
      this.lastAsteroidSpawn = ts;
    }

    if (Math.random() < POWERUP_SPAWN_CHANCE) {
      this.powerups.push(new PowerUp(this.lw, POWERUP_TYPES[randInt(0, 2)]));
    }

    this.ship.update(this.keys, this.touchDX);
    this.touchDX *= 0.7;

    for (const ast of this.asteroids) {
      ast.update(asteroidSpeedMult);
      if (ast.alive && this.ship.collidesWithAsteroid(ast)) {
        if (this.ship.shield) {
          ast.alive = false;
          this.particles.explode(ast.x, ast.y, '#00f0ff', '#ffffff', 30);
          this.ship.shield = false;
          delete this.activePowerups['shield'];
          this._updatePowerupBar();
          this.audio.playExplosion();
        } else if (!this.ship.invincible) {
          ast.alive = false;
          this.particles.explode(this.ship.x, this.ship.y, '#00f0ff', '#ff4060', 80);
          this._shake(12, 400);
          this._endGame();
          return;
        }
      }
    }

    for (const pu of this.powerups) {
      pu.update();
      if (pu.alive && this.ship.collidesWithPowerup(pu)) {
        pu.alive = false;
        this._activatePowerup(pu.type);
        this.audio.playPowerup();
        this.particles.explode(pu.x, pu.y, pu.meta.color, '#ffffff', 24);
      }
    }

    this.asteroids = this.asteroids.filter(a => a.alive && !a.isOffScreen(this.lh));
    this.powerups  = this.powerups.filter(p => p.alive && !p.isOffScreen(this.lh));
    this.particles.update();

    if (this.shakeDur > 0) {
      this.shakeDur -= dt;
      this.shakeAmt *= 0.88;
      if (this.shakeDur <= 0) { this.shakeAmt = 0; this.shakeDur = 0; }
    }

    this._updateHUD();
    this._updatePowerupTimers();
  }

  _activatePowerup(type) {
    this.activePowerups[type] = Date.now() + POWERUP_DURATION;
    if (type === 'shield') this.ship.activateShield(POWERUP_DURATION);
    this._updatePowerupBar();
  }

  _draw() {
    const { ctx, lw, lh } = this;
    ctx.clearRect(0, 0, lw, lh);
    if (this.state === 'start') return;
    let sx = 0, sy = 0;
    if (this.shakeAmt > 0.5) { sx = rand(-this.shakeAmt, this.shakeAmt); sy = rand(-this.shakeAmt, this.shakeAmt); }
    ctx.save();
    ctx.translate(sx, sy);
    this.particles.draw(ctx);
    for (const ast of this.asteroids) ast.draw(ctx);
    for (const pu  of this.powerups)  pu.draw(ctx);
    if (this.ship && this.state !== 'gameover') this.ship.draw(ctx, this.particles);
    ctx.restore();
  }

  _updateHUD() {
    this.$hudScore.textContent = Math.floor(this.score);
this.$hudHigh.textContent  = Math.floor(Math.max(this.storage.highScore, Math.floor(this.score)));
    this.$hudLevel.textContent = this.level;
  }

  _updatePowerupBar() {
    this.$powerupBar.innerHTML = '';
    for (const type of POWERUP_TYPES) {
      if (!this.activePowerups[type]) continue;
      const meta = POWERUP_META[type];
      const chip = document.createElement('div');
      chip.className   = `pu-chip pu-chip--${type}`;
      chip.dataset.type = type;
      chip.innerHTML = `
        <span class="pu-icon">${meta.icon}</span>
        <span class="pu-label">${meta.label}</span>
        <div class="pu-timer"><div class="pu-timer-fill" style="width:100%"></div></div>
      `;
      this.$powerupBar.appendChild(chip);
    }
  }

  _updatePowerupTimers() {
    this.$powerupBar.querySelectorAll('.pu-chip').forEach(chip => {
      const expiry = this.activePowerups[chip.dataset.type];
      if (!expiry) return;
      const pct  = Math.max(0, (expiry - Date.now()) / POWERUP_DURATION) * 100;
      const fill = chip.querySelector('.pu-timer-fill');
      if (fill) fill.style.width = pct + '%';
    });
  }

  _updateStartStats() {
    document.getElementById('statHigh').textContent     = this.storage.highScore;
    document.getElementById('statGames').textContent    = this.storage.gamesPlayed;
    document.getElementById('statBestTime').textContent = this._formatTime(this.storage.bestTime);
  }

  _showLevelNotif(level) {
    this.$levelNotifN.textContent = level;
    this.$levelNotif.classList.remove('hidden');
    this.$levelNotif.style.animation = 'none';
    void this.$levelNotif.offsetWidth;
    this.$levelNotif.style.animation = '';
    setTimeout(() => this.$levelNotif.classList.add('hidden'), 2100);
  }

  _shake(amount, duration) { this.shakeAmt = amount; this.shakeDur = duration; }

  _show(el) { el.classList.remove('hidden'); }
  _hide(el) { el.classList.add('hidden'); }

  _formatTime(ms) {
    if (!ms) return '0s';
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
  }
}

/* ── BOOT ────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => { window.game = new Game(); });