/* Fern, the C1 wreath sprite (approved by Kai 2026-11-03). Source: the Unfurl card library (p2a-nature.js + p5b-character.js). fernC(variant,size,state,opts) returns SVG markup. */
(function(){
// ---------- Nature line art: the brand's drawing language ----------
// Everything is a stroke. Paths get a seeded wobble so they read hand-drawn, and the same drawing comes out every time.
const f1 = (n) => +n.toFixed(1);
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Catmull-Rom through the points, as cubic Béziers.
function smooth(P) {
  let d = `M${f1(P[0][0])} ${f1(P[0][1])}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
    d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
}
const jit = (P, a, r) => P.map(([x, y], i) => i === 0 || i === P.length - 1 ? [x, y] : [x + (r() - .5) * a, y + (r() - .5) * a]);
// A leaf from its base, pointing at angle ang (radians). Outline plus a midrib.
function leaf(x, y, len, ang, wid = .36, rib = true) {
  const tx = x + Math.cos(ang) * len, ty = y + Math.sin(ang) * len, mx = (x + tx) / 2, my = (y + ty) / 2;
  const nx = -Math.sin(ang) * len * wid, ny = Math.cos(ang) * len * wid;
  return `M${f1(x)} ${f1(y)} Q${f1(mx + nx)} ${f1(my + ny)} ${f1(tx)} ${f1(ty)} Q${f1(mx - nx)} ${f1(my - ny)} ${f1(x)} ${f1(y)}Z` +
    (rib ? ` M${f1(x)} ${f1(y)} L${f1(x + Math.cos(ang) * len * .78)} ${f1(y + Math.sin(ang) * len * .78)}` : '');
}
// A spiral that curls in from (x, y) heading at ang; dir 1 = clockwise.
function curl(x, y, ang, step, dir = 1, n = 16, turn = .42) {
  const P = [[x, y]];
  for (let i = 0; i < n; i++) { ang += dir * turn; step *= .88; x += Math.cos(ang) * step; y += Math.sin(ang) * step; P.push([x, y]); }
  return smooth(P);
}
// A fern frond: a bending stem with alternating leaflets that shrink toward the tip, ending in a fiddlehead curl.
function frond(x, y, len, ang, bend = .25, n = 9, o = {}) {
  const r = rng(o.seed || 7), pts = [], N = 24, leafMax = o.leaf || len * .22, side = o.side || 1;
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len, px = -Math.sin(ang), py = Math.cos(ang);
  const cx = (x + ex) / 2 + px * len * bend, cy = (y + ey) / 2 + py * len * bend;
  const at = (t) => [(1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t * t * ex, (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t * t * ey];
  const tan = (t) => Math.atan2(2 * (1 - t) * (cy - y) + 2 * t * (ey - cy), 2 * (1 - t) * (cx - x) + 2 * t * (ex - cx));
  for (let i = 0; i <= N; i++) pts.push(at(i / N));
  let d = smooth(jit(pts, len * .012, r));
  if (o.curl !== false) d += ' ' + curl(ex, ey, tan(1), len * .07, bend >= 0 ? 1 : -1, 14, .5);
  for (let i = 0; i < n; i++) {
    const t = .12 + i / n * .78, [lx, ly] = at(t), a = tan(t), s = i % 2 ? 1 : -1;
    if (o.oneSide && s !== side) continue;
    const L = leafMax * (1 - t * .75) * (.85 + r() * .3);
    d += ' ' + leaf(lx, ly, L, a + s * (o.spread || .95), o.wid || .32, o.rib !== false);
  }
  return d;
}
// A frond bent along a circle, from angle a0 to a1: two of these make a wreath.
function arcFrond(cx, cy, R, a0, a1, n, o = {}) {
  const r = rng(o.seed || 5), N = 24, P = [], dir = Math.sign(a1 - a0), tanAt = (a) => a + dir * Math.PI / 2;
  for (let i = 0; i <= N; i++) { const a = a0 + (a1 - a0) * i / N; P.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]); }
  let d = smooth(jit(P, R * .012, r)); const e = P[N];
  if (o.curl !== false) d += ' ' + curl(e[0], e[1], tanAt(a1), R * .07, dir, 12, .5);
  for (let k = 0; k < n; k++) {
    const t = .06 + k / n * .86, a = a0 + (a1 - a0) * t, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R, side = k % 2 ? 1 : -1;
    if (o.outside && side < 0) continue;
    const L = (o.leaf || 10) * (1 - t * .4) * (.85 + r() * .3);
    d += ' ' + leaf(x, y, L, tanAt(a) - dir * side * .85, o.wid || .38, o.rib !== false);
  }
  return d;
}
// A vine: a wavy stem from A to B with leaves on the crests and the odd tendril.
function vine(x0, y0, x1, y1, amp = 10, waves = 3, o = {}) {
  const r = rng(o.seed || 3), P = [], N = waves * 8, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  for (let i = 0; i <= N; i++) { const t = i / N, w = Math.sin(t * waves * Math.PI * 2) * amp; P.push([x0 + dx * t - uy * w, y0 + dy * t + ux * w]); }
  let d = smooth(jit(P, amp * .15, r));
  const base = Math.atan2(dy, dx);
  for (let k = 0; k < waves * 2; k++) {
    const t = (k + .25) / (waves * 2), w = Math.sin(t * waves * Math.PI * 2) * amp, x = x0 + dx * t - uy * w, y = y0 + dy * t + ux * w, s = k % 2 ? 1 : -1;
    if (o.tendrils && k % 3 === 2) d += ' ' + curl(x, y, base + s * 1.2, (o.leaf || 9) * .45, s, 12, .55);
    else d += ' ' + leaf(x, y, (o.leaf || 9) * (.8 + r() * .4), base + s * 1.05, .38);
  }
  return d;
}
// Stroke a path twice, slightly apart, so it reads as pen on paper.
const ink = (d, w = 1.4, extra = '') => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const scribble = (d, w = 1.4) => ink(d, w) + `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w * .55}" stroke-linecap="round" stroke-linejoin="round" opacity=".55" transform="translate(.9 -.7) rotate(.6)"/>`;

// Card backgrounds: one drawing per area family, kept to the edges so it never sits under a number.
const DECO_H = { r45: 450, r11: 360, r916: 640 };
function DECO(kind, r, seed = 1) {
  const H = DECO_H[r] || 450; let d = '';
  if (kind === 'frond') d = frond(372, H + 6, H * .62, -1.92, -.22, 11, { seed, leaf: 30 }) + ' ' + frond(392, H * .55, H * .32, -2.3, .2, 7, { seed: seed + 4, leaf: 18 });
  else if (kind === 'vine') d = vine(372, -8, 300, H * .62, 12, 3, { seed, leaf: 13, tendrils: true }) + ' ' + vine(250, -6, 372, 70, 6, 2, { seed: seed + 2, leaf: 9 });
  else if (kind === 'sprig') d = frond(380, H - 30, 150, -2.55, .18, 9, { seed, leaf: 26 }) + ' ' + frond(352, H + 10, 110, -1.75, -.15, 7, { seed: seed + 9, leaf: 18 }) + ' ' + frond(372, 30, 90, 2.6, -.2, 6, { seed: seed + 3, leaf: 14 });
  else if (kind === 'wreath') d = frond(180, H * .5 + 120, 200, -2.45, .62, 12, { seed, leaf: 20, curl: true }) + ' ' + frond(180, H * .5 + 120, 200, -.69, -.62, 12, { seed: seed + 1, leaf: 20 });
  return `<svg class="deco" viewBox="0 0 360 ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${scribble(d, 1.3)}</svg>`;
}
// A hand-drawn divider: a stem with a couple of leaves, the width of the content.
const VRULE = (seed = 2) => `<svg class="vrule" viewBox="0 0 312 12" aria-hidden="true">${ink(smooth(jit([[2, 7], [60, 5], [130, 7.5], [200, 5.5], [262, 7], [300, 5]], 2.4, rng(seed))) + ' ' + leaf(300, 5, 9, -.5, .4, false) + ' ' + leaf(262, 7, 7, -2.4, .4, false) + ' ' + curl(2, 7, 3.6, 2.2, -1, 10, .6), 1.1)}</svg>`;

// ---------- Badge and trophy assets ----------
// One frame (two fronds that meet under a ribbon) around one emblem. 160 × 160 units.
const EMBLEM = {
  best: // a cup with a fern engraved on it
    `<path d="M56 46 H104 V64 C104 82 94 94 80 94 C66 94 56 82 56 64 Z" class="e"/>` +
    `<path d="M56 52 C44 52 42 66 54 72 M104 52 C116 52 118 66 106 72"/><path d="M80 94 V106 M70 112 C70 107 90 107 90 112 Z M64 118 H96"/>` +
    `<path d="${frond(80, 88, 34, -1.57, .1, 6, { seed: 4, leaf: 8, rib: false })}" class="t"/>`,
  pr: // a barbell over a rising line
    `<path d="M48 70 H112" /><path d="M54 58 V82 M60 54 V86 M100 54 V86 M106 58 V82" class="e2"/><path d="M42 70 H48 M112 70 H118"/>` +
    `<path d="M52 104 C66 102 72 96 82 98 C92 100 98 90 110 86" class="t"/><path d="M104 84 L111 85.5 L108 92" class="t"/>`,
  streak: // a flame made of three leaves
    `<path d="${leaf(80, 108, 58, -1.57, .42, true)}" class="e"/><path d="${leaf(78, 106, 36, -2.05, .4, false)}" class="t"/><path d="${leaf(82, 106, 34, -1.1, .4, false)}" class="t"/>`,
  goal: // a flag on a hill
    `<path d="M40 108 C58 88 70 84 82 90 C94 96 106 88 122 108 Z" class="e"/><path d="M80 90 V42"/><path d="M80 44 C90 40 96 50 108 46 V64 C96 68 90 58 80 62" class="t"/>`,
  first: // a seedling breaking the soil
    `<path d="M44 104 C60 98 100 98 116 104" /><path d="M80 102 C80 88 79 78 80 66" /><path d="${leaf(80, 70, 30, -2.5, .45)}" class="e"/><path d="${leaf(80, 66, 30, -.6, .45)}" class="e"/>` +
    `<path d="M56 110 c4 -1 8 -1 12 0 M92 110 c4 -1 8 -1 12 0" class="t"/>`,
  sealed: // a leaf seal with a check
    `<path d="M80 40 C100 52 108 66 108 76 C108 94 96 104 80 104 C64 104 52 94 52 76 C52 66 60 52 80 40 Z" class="e"/><path d="M66 74 L76 84 L96 62" />`,
  milestone: // 100, set in Geist, in the wreath
    `<text x="80" y="84" text-anchor="middle" class="n">100</text><path d="M58 94 C70 98 90 98 102 94" class="t"/>`,
  savings: // a coin that sprouts
    `<circle cx="80" cy="84" r="22" class="e"/><path d="M80 74 V94 M74 78 C74 74 86 74 86 79 C86 84 74 83 74 89 C74 94 86 94 86 90"/><path d="M80 62 C80 54 80 50 82 44"/><path d="${leaf(81, 50, 18, -2.4, .45, false)}" class="t"/><path d="${leaf(81, 48, 18, -.5, .45, false)}" class="t"/>`,
};
const BADGE_NAME = { best: 'Personal best', pr: 'New record', streak: 'Streak', goal: 'Goal hit', first: 'First time', sealed: 'Day sealed', milestone: 'Milestone', savings: 'Savings goal' };
function BADGE(type, size = 120, o = {}) {
  const wreath = arcFrond(80, 74, 58, Math.PI / 2 + .22, Math.PI + 1.05, 12, { seed: 11, leaf: 15, wid: .38 }) + ' ' + arcFrond(80, 74, 58, Math.PI / 2 - .22, -1.05, 12, { seed: 12, leaf: 15, wid: .38 });
  const ribbon = `<path d="M72 128 C76 134 84 134 88 128 M74 131 L64 152 L71 149 L74 156 L80 136 L86 156 L89 149 L96 152 L86 131" class="rb"/>`;
  return `<svg class="badge-a" viewBox="0 0 160 160" style="width:${typeof size === 'number' ? size + 'px' : size};height:auto" role="img" aria-label="${BADGE_NAME[type]}">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <g style="color:var(--b-leaf,var(--mk))">${scribble(wreath, 1.6)}</g>
      <g stroke="var(--b-em,var(--life))" stroke-width="2.6" class="emb">${ribbon}<g transform="translate(80 74) scale(.86) translate(-80 -78)">${EMBLEM[type]}</g></g>
    </g></svg>`;
}
// ---------- Section 3, round 3: Fern as a character, grown from the wreath seal (C) ----------
// 64-unit box. Every part is a hand-drawn line from p2a-nature.js; every motion is transform, opacity or a stroke drawing on.
// Durations are multiplied by --spd so the page can play them at half speed to read.
const TT = (s) => `calc(${s}s * var(--spd, 1))`;
const AN = (name, s, o = '32px 34px', extra = '') => `animation:${name} ${TT(s)} ease-in-out infinite;transform-origin:${o};transform-box:view-box;${extra}`;
let cid = 0;

// The wreath: two fronds bending up from the bottom, each in its own group so they can lean, droop or draw on.
function wreathParts(small, R = 25, cy = 33) {
  const n = small ? 5 : 9, o = { leaf: small ? 7 : 6.5, wid: .42, rib: false, outside: small };
  return [arcFrond(32, cy, R, Math.PI / 2 + .32, Math.PI + 1.25, n, { ...o, seed: 41 }),
          arcFrond(32, cy, R, Math.PI / 2 - .32, -1.25, n, { ...o, seed: 42 })];
}
// The fiddlehead that sprouts from Fern's head: a short stem rolling into the logo's curl.
const sprout = (x, y, h = 8) => `M${x} ${y} C${x - .4} ${y - h * .45} ${x} ${y - h * .75} ${x + 1.8} ${y - h}` + ' ' + curl(x + 1.8, y - h, -.5, h * .3, 1, 12, .55).replace(/^M[^C]*/, '');
// C4's head: the stem rolls into a spiral that wraps the face, as in the logo's fiddlehead.
function spiralHead(small) {
  const P = [], N = 34;
  for (let i = 0; i <= N; i++) { const t = i / N, a = Math.PI / 2 - .14 + t * Math.PI * 2.2, r = 11 - t * 2.6; P.push([32 + Math.cos(a) * r, 24 + Math.sin(a) * r]); }
  let d = smooth(P);
  if (!small) [.18, .38, .58, .78].forEach((t, k) => { const a = Math.PI / 2 - .14 + t * Math.PI * 2.2, r = 11 - t * 2.6; d += ' ' + leaf(32 + Math.cos(a) * r, 24 + Math.sin(a) * r, 3.4 - k * .4, a + .5, .42, false); });
  return d;
}
const sproutOpen = (x, y, h = 8) => frond(x, y, h * 1.9, -1.5, -.1, 6, { seed: 51, leaf: h * .55, curl: false, wid: .42, rib: false });

// variant: sprite (C1) | sprout (C2) | face (C3). state: idle | listening | thinking | speaking | celebrating | consoling | arriving
// size: px, or any CSS length; o.small: force the small drawing; o.still: a frozen pose for share cards and print.
function fernC(variant, size, state = 'idle', o = {}) {
  const id = 'cg' + (++cid), small = o.small ?? (typeof size === 'number' && size < 32), still = !!o.still, sw = small ? 2.6 : size > 80 ? 1.5 : 1.9;
  // C1 keeps its wreath crown but no filled circle behind it (Kai, 3 Nov): the soft glow disc and the speaking halo are gone.
  const bare = variant === 'sprite', sadB = bare && state === 'consoling';
  // On a miss Fern wilts like a thirsty plant: body and wreath fade from fresh green to dry olive and straw, then the green comes back.
  const stop = (off, from, to, k) => `<stop offset="${off}" stop-color="var(${sadB ? to : from})"${sadB && !still ? ` style="animation:drain${k} ${TT(4)} ease-in-out infinite"` : ''}/>`;
  const grad = `<defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0">${stop(0, '--moss', '--f-sad1', 1)}${stop(.55, '--frond', '--f-sad2', 2)}${stop(1, '--sprout', '--f-sad3', 3)}</linearGradient></defs>`;
  const S = { fill: 'none', stroke: 'var(--fern-ink)', 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
  const arrive = state === 'arriving';

  // Wreath, per state: listening leans in, thinking draws itself on a loop, consoling droops, celebrating sheds leaves.
  // Below 32 px C1 pulls its wreath in tight round the orb and crops the box, so the face gets more of the pixels.
  const tight = small && variant === 'sprite', WR = tight ? 19.5 : 25, WY = tight ? 35 : 33;
  const [wl, wr] = wreathParts(small, WR, WY);
  const wStroke = `url(#${id})`;
  const wDraw = state === 'thinking' ? `pathLength="60" stroke-dasharray="60" style="animation:draw ${TT(2.4)} ease-in-out infinite"`
    : arrive ? `pathLength="60" stroke-dasharray="60" style="animation:eWreath ${TT(5)} ease-out infinite"` : '';
  const lean = { listening: ['lean', 'leanR'], speaking: ['swayS', 'swaySR'], consoling: ['droop', 'droopR'] }[state];
  const side = (d, k) => `<g style="${lean ? AN(lean[k], state === 'speaking' ? 1.2 : 2.4, '32px 58px') : ''}"><path d="${d}" fill="none" stroke="${wStroke}" stroke-width="${small ? 2 : 1.5}" stroke-linecap="round" stroke-linejoin="round" ${wDraw}/></g>`;
  // The two fronds' stems cross under the chin, as on the trophy badges.
  const ex0 = WR * Math.sin(.32), ey0 = WY + WR * Math.cos(.32), f = (n) => n.toFixed(1);
  const cross = `<path d="M${f(32 - ex0)} ${f(ey0)} Q${f(32 - ex0 * .2)} ${f(ey0 + 4.5)} ${f(32 + ex0 * .7)} ${f(ey0 + 2.9)} M${f(32 + ex0)} ${f(ey0)} Q${f(32 + ex0 * .2)} ${f(ey0 + 4.5)} ${f(32 - ex0 * .7)} ${f(ey0 + 2.9)}" fill="none" stroke="${wStroke}" stroke-width="${small ? 2 : 1.5}" stroke-linecap="round" ${wDraw}/>`;
  const wreath = side(wl, 0) + side(wr, 1) + cross;

  // Eyes and mouth, per state. Eyes are white on the orb (C1) and ink on mist (C2, C3).
  const onOrb = variant === 'sprite' || variant === 'curl', eye = onOrb ? '#fff' : 'var(--fern-ink)';
  const g = { sprite: { ex: 4.6, ey: 35, my: 40, r: 1.9 }, sprout: { ex: 2.8, ey: 26.5, my: 30, r: 1.3 }, face: { ex: 5.4, ey: 31, my: 38.5, r: 2.1 }, curl: { ex: 2.7, ey: 23.4, my: 27, r: 1.35 } }[variant];
  const happy = state === 'celebrating', sad = state === 'consoling';
  const eyeY = g.ey + (state === 'listening' ? -1.2 : sad ? .8 : 0);
  let eyes;
  if (happy) eyes = `<path d="M${32 - g.ex - 1.8} ${eyeY + .6} q1.8 -2.4 3.6 0 M${32 + g.ex - 1.8} ${eyeY + .6} q1.8 -2.4 3.6 0" fill="none" stroke="${eye}" stroke-width="${sw}" stroke-linecap="round"/>`;
  else if (sad && bare) {
    // Open eyes welling with a dewdrop (clear water, not blue), brows tilted up in the middle.
    const rx = g.r * (small ? 1.25 : 1.05), ry = g.r * (small ? 1.45 : 1.25);
    eyes = [-1, 1].map(k => { const x = 32 + k * g.ex; return `<ellipse cx="${x}" cy="${eyeY}" rx="${rx}" ry="${ry}" fill="${eye}"/><path d="M${x - rx} ${eyeY} a${rx} ${ry} 0 0 0 ${rx * 2} 0 z" fill="var(--f-dew)" opacity=".85" style="${AN('well', 4, `${x}px ${eyeY + ry}px`)}"/>`
      + (small ? '' : `<path d="M${x - k * 1.6} ${eyeY - ry - 3.1} L${x + k * 2.2} ${eyeY - ry - 1.5}" stroke="${eye}" stroke-width="${sw * .7}" stroke-linecap="round" fill="none"/>`); }).join('');
  } else if (sad) eyes = `<path d="M${32 - g.ex - 1.6} ${eyeY - .4} q1.6 1.6 3.2 0 M${32 + g.ex - 1.6} ${eyeY - .4} q1.6 1.6 3.2 0" fill="none" stroke="${eye}" stroke-width="${sw}" stroke-linecap="round"/>`;
  else {
    const motion = state === 'thinking' ? AN('glance', 3, `32px ${eyeY}px`) : arrive ? AN('eEyes', 5, `32px ${eyeY}px`) : AN('blink', 4.2, `32px ${eyeY}px`);
    eyes = `<g style="${motion}"><ellipse cx="${32 - g.ex}" cy="${eyeY}" rx="${g.r * .9 * (small ? 1.25 : 1)}" ry="${g.r * 1.1 * (small ? 1.25 : 1)}" fill="${eye}"/><ellipse cx="${32 + g.ex}" cy="${eyeY}" rx="${g.r * .9 * (small ? 1.25 : 1)}" ry="${g.r * 1.1 * (small ? 1.25 : 1)}" fill="${eye}"/></g>`;
  }
  const mw = variant === 'sprout' || variant === 'curl' ? 2 : 3.2;
  const mouth = state === 'speaking' ? `<ellipse cx="32" cy="${g.my + .4}" rx="${mw * .62}" ry="${mw * .42}" fill="${eye}" style="${AN('talk', .42, `32px ${g.my + .4}px`)}"/>`
    : `<path d="${happy ? `M${32 - mw} ${g.my - .6} q${mw} ${mw * 1.3} ${mw * 2} 0` : sad ? `M${32 - mw * .7} ${g.my + .8} q${mw * .7} -${mw * .45} ${mw * 1.4} 0` : state === 'thinking' ? `M${32 - mw * .45} ${g.my} h${mw * .9}` : `M${32 - mw * .8} ${g.my - .2} q${mw * .8} ${mw * .7} ${mw * 1.6} 0`}" fill="none" stroke="${eye}" stroke-width="${sw * .85}" stroke-linecap="round"/>`;
  const cheeks = !small && (variant === 'sprite' || variant === 'face') ? `<circle cx="${32 - g.ex - 3.2}" cy="${g.my - 1}" r="1.7" fill="${bare ? 'var(--f-blush)' : 'var(--sprout)'}" opacity="${happy ? .95 : sad ? .2 : .5}"/><circle cx="${32 + g.ex + 3.2}" cy="${g.my - 1}" r="1.7" fill="${bare ? 'var(--f-blush)' : 'var(--sprout)'}" opacity="${happy ? .95 : sad ? .2 : .5}"/>` : '';
  const face = eyes + mouth + cheeks;

  // The curl on Fern's head: draws on while thinking, unrolls into a frond on a win, bows on a miss.
  const curlAt = { sprite: [32, 21, 8], sprout: [32, 20.5, 6.5], face: [32, 13, 7], curl: [35, 16.5, 6.5] }[variant];
  const cOpen = `<path d="${sproutOpen(...curlAt)}" ${attrs(S)} style="animation:unfurlIn ${TT(3)} ease-in-out infinite;transform-origin:${curlAt[0]}px ${curlAt[1]}px;transform-box:view-box"/>`;
  const cPath = `<path d="${variant === 'curl' ? spiralHead(small) : sprout(...curlAt)}" ${attrs(S)} ${state === 'thinking' ? `pathLength="60" stroke-dasharray="60" style="animation:draw ${TT(2.4)} ease-in-out infinite"` : arrive ? `pathLength="60" stroke-dasharray="60" style="animation:eCurl ${TT(5)} ease-out infinite"` : ''}/>`;
  const curlG = happy && still ? cOpen.replace(/ style="[^"]*"/, '') : happy ? `<g style="animation:unfurl ${TT(3)} ease-in-out infinite">${cPath}</g>${cOpen}`
    : sad ? `<g transform="rotate(${variant === 'curl' ? '-10 32 34' : `${bare ? 38 : 16} ${curlAt[0]} ${curlAt[1]}`})">${cPath}</g>`
    : variant === 'curl' && state === 'idle' ? `<g style="${AN('swayS', 3.6, '32px 35px')}">${cPath}</g>`
    : state === 'listening' && bare ? `<g style="${AN('perk', 2.1, `${curlAt[0]}px ${curlAt[1]}px`)}">${cPath}</g>`
    : state === 'speaking' || state === 'idle' ? `<g style="${AN('swayS', state === 'idle' ? 3.6 : 1.2, `${curlAt[0]}px ${curlAt[1]}px`)}">${cPath}</g>` : cPath;

  // Arms are two leaflets: they rest, cup towards the ear while listening, gesture while speaking, go up on a win.
  const armPose = { idle: [0, 0], listening: bare ? [-26, 26] : [-30, 0], thinking: [0, 0], speaking: [0, 0], celebrating: [70, -70], consoling: bare ? [-34, 34] : [-14, 14], arriving: [0, 0] }[state];
  const armAt = { sprite: [[17.6, 38], [46.4, 38], 7.5], sprout: [[32, 37], [32, 37], 8], curl: [[32, 44], [32, 44], 8], face: null }[variant];
  let arms = '';
  if (armAt) {
    const [[lx, ly], [rx, ry], L] = armAt;
    const one = (x, y, ang, rot, anim) => `<g transform="rotate(${rot} ${x} ${y})"><g style="${anim ? AN(anim, 1.2, `${x}px ${y}px`) : ''}"><path d="${leaf(x, y, L, ang, .42, false)}" fill="var(${sadB ? '--f-sad3' : '--sprout'})" stroke="var(${sadB ? '--f-wilt-ink' : '--fern-ink'})" stroke-width="${sw * .75}" stroke-linejoin="round"${sadB && !still ? ` style="animation:wiltLeaf ${TT(4)} ease-in-out infinite"` : ''}/></g></g>`;
    arms = one(lx, ly, Math.PI - .35, armPose[0], state === 'speaking' ? 'wave' : happy ? 'waveUp' : '') + one(rx, ry, .35, armPose[1], happy ? 'waveUpR' : state === 'speaking' && bare ? 'waveR' : '');
  }

  // Body per variant.
  let body;
  if (variant === 'sprite') {
    body = `<circle cx="32" cy="35" r="14" fill="url(#${id})"/>`;
  } else if (variant === 'sprout') {
    body = `<path d="M32 33 C31.4 39 32.6 44 32 50 M32 50 q-2.6 .8 -4.6 3 M32 50 q2.6 .8 4.6 3" ${attrs(S)}/><circle cx="32" cy="27" r="7.4" fill="var(--fern-leaf)" stroke="var(--fern-ink)" stroke-width="${sw}"/>`;
  } else if (variant === 'curl') {
    body = `<path d="M32 55 C31.2 48 31.4 41 33.4 35 M32 55 q-2.6 .8 -4.6 3 M32 55 q2.6 .8 4.6 3" ${attrs(S)}/><circle cx="32" cy="24" r="7.4" fill="url(#${id})"/>`;
  } else {
    const brows = small ? '' : `<path d="${leaf(32 - g.ex - 2.4, g.ey - 4.6, 5, -.12, .4, false)} ${leaf(32 + g.ex + 2.4, g.ey - 4.6, 5, Math.PI + .12, .4, false)}" fill="var(--sprout)" stroke="var(--fern-ink)" stroke-width="${sw * .6}" ${sad ? `transform="translate(0 1)"` : state === 'listening' || happy ? `transform="translate(0 -1)"` : ''}/>`;
    body = `<circle cx="32" cy="33" r="20" fill="var(--fern-leaf)" opacity=".55"/>${brows}`;
  }

  // Ground glow for C1, the halo while speaking, and the leaves that lift on a win or fall on a miss.
  const glow = variant === 'curl' ? `<circle cx="32" cy="${variant === 'curl' ? 24 : 35}" r="${variant === 'curl' ? 12 : 17}" fill="var(--sprout)" opacity="${state === 'thinking' ? .45 : .22}" style="filter:blur(4px)"/>` : '';
  const halo = state === 'speaking' && !bare ? [0, .6].map(dl => `<circle cx="32" cy="33" r="27" fill="none" stroke="var(--sprout)" stroke-width="1.6" style="${AN('halo', 1.2, '32px 33px', `animation-delay:${dl}s;animation-timing-function:ease-out`)}"/>`).join('') : '';
  const lift = happy && !still ? [[-22, -20, -50, 14, 20], [22, -22, 60, 50, 20], [-24, 6, -90, 9, 40], [24, 4, 80, 55, 40], [-6, -28, 20, 22, 10]].map(([dx, dy, r, x, y], i) =>
    `<path d="${leaf(x, y, 5, -1.57, .42, false)}" fill="var(--sprout)" stroke="var(--fern-ink)" stroke-width=".8" style="--dx:${dx}px;--dy:${dy}px;--r:${r}deg;animation:leaf ${TT(1.8)} ease-out ${i * .14}s infinite;transform-box:view-box;transform-origin:${x}px ${y}px"/>`).join('') : '';
  const fall = sad ? `<path d="${leaf(13, 26, 5, 2.2, .42, false)}" fill="${bare ? 'var(--f-wilt)' : 'var(--sprout)'}" stroke="${bare ? 'var(--f-wilt-ink)' : 'var(--fern-ink)'}" stroke-width=".8" style="animation:fall ${TT(bare ? 4 : 3.2)} ease-in infinite;transform-box:view-box;transform-origin:13px 26px"/>` : '';
  const fall2 = sad && bare && !small ? `<path d="${leaf(51, 26, 5, Math.PI - 2.2, .42, false)}" fill="var(--f-wilt)" stroke="var(--f-wilt-ink)" stroke-width=".8" style="animation:fall ${TT(4)} ease-in ${TT(1.6)} infinite;transform-box:view-box;transform-origin:51px 26px;--fx:-5px"/>` : '';

  // Whole-body motion: breathe at rest, a hop on a win, a slow sink on a miss.
  const whole = happy ? AN('hop', 1.2, '32px 58px') : sad ? AN('sink', bare ? 4 : 3.2, '32px 58px') : arrive ? AN('eFade', 5) : AN(state === 'thinking' ? 'breatheFast' : 'breathe', state === 'thinking' ? 1 : 3.6, '32px 40px');
  // Mood accents in semantic colours, small and flat beside the body (Duolingo-style): they say the feeling before the face is read.
  const tw = (x, y, r, fill, dl, shape = 'star') => `<path d="${shape === 'star' ? `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z` : `M${x} ${y - r} L${x + r * .7} ${y} L${x} ${y + r} L${x - r * .7} ${y}Z`}" fill="${fill}" style="${AN('twinkle', 1.8, `${x}px ${y}px`, `animation-delay:${dl}s`)}"/>`;
  const big = bare && !small;
  let mood = '';
  if (big && happy) mood = tw(6, 9, 3.4, 'var(--f-joy)', 0) + tw(58, 6, 2.8, 'var(--f-joy)', .5) + tw(63, 24, 2.3, 'var(--f-love)', .25, 'gem') + tw(1, 27, 2, 'var(--f-love)', .75, 'gem') + tw(46, 0, 1.8, 'var(--f-joy)', 1);
  // Listening is centred: water ripples spread on the ground under Fern, like a still pond taking in a sound.
  else if (big && state === 'listening') mood = [0, .7, 1.4].map(dl => `<ellipse cx="32" cy="63" rx="9" ry="1.8" fill="none" stroke="var(--f-water)" stroke-width="1.2" style="${AN('ripple', 2.1, '32px 63px', `animation-delay:${dl}s;animation-timing-function:ease-out`)}"/>`).join('');
  else if (big && state === 'thinking') // Thinking: fern spores drift up in mirrored pairs on both sides of the wreath (ferns spread by spores).
    mood = [[4, 22, 1.5, 0], [60, 22, 1.5, 0], [2, 12, 1.1, .6], [62, 12, 1.1, .6], [8, 4, 1.3, 1.2], [56, 4, 1.3, 1.2]].map(([x, y, r, dl]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--f-think)" style="${AN('spore', 1.8, `${x}px ${y}px`, `animation-delay:${dl}s`)}"/>`).join('');
  else if (big && state === 'speaking') // Speaking: the same three short lines on both sides of the wreath, pulsing together.
    mood = [1, -1].map(k => [[59.5, 26, 3, -2.4], [61, 32, 4, 0], [59.5, 38, 3, 2.4]].map(([x, y, dx, dy], i) => `<path d="M${32 + k * (x - 32)} ${y} l${k * dx} ${dy}" stroke="var(--frond)" stroke-width="1.6" stroke-linecap="round" style="${AN('ping', 1.2, '32px 32px', `animation-delay:${i * .12}s`)}"/>`).join('')).join('');
  else if (big && sad) mood = [-1, 1].map(k => `<path d="M${32 + k * g.ex - k * .4} ${eyeY + 2.6} q-1.5 2.4 0 3.4 q1.5 -1 0 -3.4Z" fill="var(--f-dew)" stroke="var(--f-dew-ink)" stroke-width=".5" style="${AN('tear', 4, `${32 + k * g.ex}px ${eyeY + 3}px`)}"/>`).join('');
  else if (big && arrive) mood = tw(6, 10, 2.6, 'var(--sprout)', .6) + tw(58, 8, 2.2, 'var(--sprout)', .9);
  const shadow = false ? `<ellipse cx="32" cy="52.5" rx="11" ry="1.7" fill="var(--f-shadow)" style="${happy ? AN('shadowHop', 1.2, '32px 52.5px') : sad ? AN('shadowSink', 4, '32px 52.5px') : ''}"/>` : '';
  const core = `<g style="${arrive ? AN('eBody', 5, '32px 35px') : ''}">${glow}${body}${arms}${face}</g>`;
  const dim = typeof size === 'number' ? `width="${size}" height="${size}"` : '';
  return `<svg class="av${still ? ' still' : ''}" ${dim} viewBox="${tight ? '6 10 52 52' : '0 0 64 64'}" role="img" aria-label="Fern, ${state}" style="overflow:visible;flex:none${dim ? '' : `;width:${size};height:${size}`}">${grad}${shadow}${halo}<g style="${whole}">${wreath}${core}${curlG}${sad ? mood : ''}</g>${sad ? '' : mood}${lift}${fall}${fall2}</svg>`;
}

  // Video adapter: HyperFrames seeks CSS animations, but needs finite iterations. Swap "infinite" for a count long enough for any clip.
  function fernSVG(size, state, o) { return fernC('sprite', size, state || 'idle', o || {}).replace(/ infinite/g, ' 60').replace(/animation:([^;"]+)/g, 'animation:$1 both'); }
  window.fernC = fernC; window.fernSVG = fernSVG;
  window.UNFURL_NATURE = { leaf: leaf, frond: frond, arcFrond: arcFrond, vine: vine, curl: curl, smooth: smooth, rng: rng, jit: jit };
  // Mount: <div data-fern="idle" data-size="320"></div>
  window.mountFern = function (root) { (root || document).querySelectorAll('[data-fern]').forEach(function (el) { el.innerHTML = fernSVG(+el.dataset.size || 200, el.dataset.fern, { still: el.dataset.still === 'true' }); }); };
})();
