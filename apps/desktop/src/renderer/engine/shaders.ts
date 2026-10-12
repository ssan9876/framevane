/**
 * Framevane's own shaders (GLSL ES 3.0). Each defines `vec4 effect(vec2 uv)`; uv is 0…1 with y = 0 at the top.
 * Effect params arrive in uP[] in the order looks.ts lists them, in their UI units (mostly 0…100).
 * Sizes are relative to the picture height, so a look matches between the small preview and a 4K export.
 */

export const PRELUDE = `#version 300 es
precision highp float;
precision mediump sampler3D;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uInScale;
uniform vec2 uRes;
uniform float uTime;
uniform float uToCanvas;
uniform float uPremulIn;
uniform float uP[4];
#define PI 3.14159265
#define ASP (uRes.x / uRes.y)
vec4 tex(vec2 uv) { return texture(uTex, clamp(uv, 0.5 / uRes, 1.0 - 0.5 / uRes) * uInScale); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
/* a soft disc blur: radius r as a fraction of the height */
vec4 discBlur(vec2 uv, float r) {
  if (r <= 0.0) return tex(uv);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = 0; i < 48; i++) {
    float f = float(i) + 0.5; float rr = sqrt(f / 48.0); float th = f * 2.39996;
    float w = exp(-2.0 * rr * rr);
    acc += tex(uv + vec2(cos(th) / ASP, sin(th)) * rr * r) * w; ws += w;
  }
  return acc / ws;
}
`

/** Chroma key → filter → LUT → colour → vignette/grain, in one pass. */
export const GRADE_GLSL = `
uniform float uF[12];
uniform vec3 uFS;
uniform vec3 uFH;
uniform float uFMix;
uniform float uA[12];
uniform float uSharpen;
uniform float uVig;
uniform float uGrain;
uniform vec4 uChroma;
uniform vec3 uKey;
uniform float uSpill;
uniform sampler3D uLut;
uniform float uLutSize;
uniform float uLutMix;
uniform sampler2D uMatte;
uniform vec3 uCut; // on, invert, edge half-width

vec3 grade(vec3 c, float p[12], vec3 sh, vec3 hi) {
  c *= exp2(p[0] * 2.0);
  c = pow(max(c, 0.0), vec3(exp(-p[1] * 0.7)));
  c *= vec3(1.0 + p[5] * 0.3 + p[6] * 0.08, 1.0 + p[5] * 0.03 - p[6] * 0.25, 1.0 - p[5] * 0.3 + p[6] * 0.08);
  float L = luma(c);
  c += p[7] * 0.3 * smoothstep(0.45, 1.0, L) + p[8] * 0.3 * (1.0 - smoothstep(0.0, 0.55, L));
  c = (c - 0.5) * (p[2] >= 0.0 ? 1.0 + p[2] * 1.2 : 1.0 + p[2] * 0.8) + 0.5;
  L = luma(c);
  c = mix(vec3(L), c, 1.0 + p[3]);
  float s = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(L), c, 1.0 + p[4] * (1.0 - clamp(s, 0.0, 1.0)) * 1.2);
  c = mix(c, vec3(luma(c)), p[10]);
  L = clamp(luma(c), 0.0, 1.0);
  c += (sh - luma(sh)) * p[11] * (1.0 - L) * 1.4 + (hi - luma(hi)) * p[11] * L * 1.4;
  c = c * (1.0 - p[9] * 0.35) + p[9] * 0.18;
  return c;
}
vec2 cbcr(vec3 c) { return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b); }
/* how far a colour is from the key: hue angle (0…1) plus a penalty for being much greyer than the key, so a darker or
   lighter screen of the same hue still keys, and greys, skin and whites never do */
float keyDistance(vec3 c, vec3 key) {
  vec2 kc = cbcr(key); vec2 pc = cbcr(c);
  float km = length(kc); float pm = length(pc);
  float ang = acos(clamp(dot(kc, pc) / max(km * pm, 1e-5), -1.0, 1.0)) / PI;
  float sat = pm / max(km, 0.05);
  return ang + max(0.0, 0.45 - sat) * 0.8;
}

vec4 effect(vec2 uv) {
  vec4 s = tex(uv);
  vec3 c = s.rgb;
  float a = s.a;
  if (uCut.x > 0.5) {
    float m = smoothstep(0.5 - uCut.z, 0.5 + uCut.z, texture(uMatte, clamp(uv, 0.5 / uRes, 1.0 - 0.5 / uRes)).r);
    a *= uCut.y > 0.5 ? 1.0 - m : m;
  }
  if (uSharpen > 0.0) {
    vec2 px = 1.0 / uRes;
    vec3 b = (tex(uv + vec2(px.x, 0.0)).rgb + tex(uv - vec2(px.x, 0.0)).rgb + tex(uv + vec2(0.0, px.y)).rgb + tex(uv - vec2(0.0, px.y)).rgb) * 0.25;
    c += (c - b) * uSharpen * 2.5;
  }
  if (uChroma.x > 0.5) {
    float d = keyDistance(c, uKey);
    float k = smoothstep(uChroma.y, uChroma.y + uChroma.z, d);
    float y = luma(c); float ky = luma(uKey);
    float shadow = uChroma.w * clamp((ky - y) / max(ky, 0.05) * 2.0, 0.0, 1.0) * (1.0 - k);
    float spill = uSpill * (1.0 - smoothstep(uChroma.y, uChroma.y + uChroma.z + 0.25, d));
    c = mix(c, vec3(y), spill);
    c = mix(c, vec3(0.0), shadow / max(k + shadow, 1e-3));
    a *= clamp(k + shadow, 0.0, 1.0);
  }
  if (uFMix > 0.0) c = mix(c, grade(c, uF, uFS, uFH), uFMix);
  if (uLutMix > 0.0) {
    vec3 lc = clamp(c, 0.0, 1.0) * (uLutSize - 1.0) / uLutSize + 0.5 / uLutSize;
    c = mix(c, texture(uLut, lc).rgb, uLutMix);
  }
  c = grade(c, uA, vec3(0.5), vec3(0.5));
  if (uVig > 0.0) {
    vec2 d = (uv - 0.5) * vec2(ASP, 1.0);
    float r = length(d) / length(vec2(ASP, 1.0) * 0.5);
    c *= 1.0 - min(uVig, 1.5) * 0.8 * smoothstep(0.35, 1.0, r);
  }
  if (uGrain > 0.0) c += (hash(floor(uv * uRes) + fract(uTime * 24.0) * 91.7) - 0.5) * uGrain * 0.25;
  return vec4(c, a);
}
`

export const EFFECT_GLSL: Record<string, string> = {
  blur: `vec4 effect(vec2 uv) { return discBlur(uv, uP[0] / 100.0 * 0.06); }`,

  glow: `vec4 effect(vec2 uv) {
  vec4 base = tex(uv); float a = uP[0] / 100.0; float th = uP[1] / 100.0 * 0.9;
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 40; i++) {
    float f = float(i) + 0.5; float rr = sqrt(f / 40.0); float th2 = f * 2.39996;
    vec3 s = tex(uv + vec2(cos(th2) / ASP, sin(th2)) * rr * 0.05).rgb;
    float w = exp(-2.5 * rr * rr);
    acc += s * smoothstep(th, th + 0.2, luma(s)) * w; ws += w;
  }
  return vec4(base.rgb + acc / ws * a * 2.5, base.a);
}`,

  vhs: `vec4 effect(vec2 uv) {
  float a = uP[0] / 100.0; float t = uTime;
  float wob = (noise(vec2(uv.y * 6.0, t * 2.0)) - 0.5) * 0.01 * a + sin(uv.y * 240.0 + t * 12.0) * 0.0007 * a;
  float band = 1.0 - smoothstep(0.0, 0.03, abs(fract(uv.y * 0.6 - t * 0.12) - 0.5));
  wob += band * 0.015 * a;
  vec2 u = uv + vec2(wob, 0.0);
  float off = 0.004 * a;
  vec3 c = vec3(tex(u + vec2(off, 0.0)).r, tex(u).g, tex(u - vec2(off, 0.0)).b);
  c = mix(c, vec3(luma(c)), 0.25 * a);
  c *= 1.0 - a * 0.15 * (0.5 + 0.5 * sin(uv.y * uRes.y * PI * 0.5));
  c += (hash(floor(uv * uRes * 0.5) + floor(t * 30.0)) - 0.5) * 0.12 * a + band * 0.08 * a;
  return vec4(c, tex(uv).a);
}`,

  'old-film': `vec4 effect(vec2 uv) {
  float a = uP[0] / 100.0; float fr = floor(uTime * 18.0);
  vec2 u = uv + vec2(0.0, (hash(vec2(fr, 1.0)) - 0.5) * 0.004 * a);
  vec3 c = tex(u).rgb; float L = luma(c);
  c = mix(c, vec3(L) * vec3(1.08, 0.93, 0.72) + 0.03, a);
  c *= 1.0 + (hash(vec2(fr, 7.0)) - 0.5) * 0.18 * a;
  float d = length(uv - 0.5) * 1.45; c *= 1.0 - a * 0.55 * smoothstep(0.45, 1.05, d);
  float xs = hash(vec2(fr, 3.0)); float scratch = step(0.55, hash(vec2(fr, 5.0))) * (1.0 - smoothstep(0.0, 0.0015, abs(uv.x - xs)));
  c = mix(c, vec3(0.85, 0.8, 0.7), scratch * 0.5 * a);
  float dust = step(0.9985, hash(floor(uv * vec2(160.0, 90.0)) + fr));
  c *= 1.0 - dust * 0.7 * a;
  c += (hash(floor(uv * uRes) + fr) - 0.5) * 0.1 * a;
  return vec4(c, tex(uv).a);
}`,

  'film-grain': `vec4 effect(vec2 uv) {
  vec4 s = tex(uv); float a = uP[0] / 100.0; float cell = mix(1.0, 4.0, uP[1] / 100.0) * uRes.y / 1080.0;
  float n = hash(floor(uv * uRes / max(cell, 1.0)) + fract(uTime * 24.0) * 113.0) - 0.5;
  return vec4(s.rgb + n * 0.28 * a * (1.0 - luma(s.rgb) * 0.5), s.a);
}`,

  scanlines: `vec4 effect(vec2 uv) {
  vec4 s = tex(uv); float a = uP[0] / 100.0; float period = mix(12.0, 3.0, uP[1] / 100.0) * uRes.y / 1080.0;
  float l = 0.5 + 0.5 * cos(uv.y * uRes.y / max(period, 1.5) * 2.0 * PI);
  return vec4(s.rgb * (1.0 - a * 0.55 * l), s.a);
}`,

  glitch: `vec4 effect(vec2 uv) {
  float a = uP[0] / 100.0; float sp = mix(2.0, 20.0, uP[1] / 100.0);
  float tt = floor(uTime * sp);
  float rows = mix(6.0, 36.0, hash(vec2(tt, 3.0)));
  float row = floor(uv.y * rows);
  float on = step(1.0 - a * 0.45, hash(vec2(row, tt)));
  vec2 u = uv + vec2((hash(vec2(row, tt + 1.0)) - 0.5) * 0.2 * a * on, 0.0);
  float sp2 = 0.012 * a * (0.4 + hash(vec2(tt, 9.0)));
  vec3 c = vec3(tex(u + vec2(sp2, 0.0)).r, tex(u).g, tex(u - vec2(sp2, 0.0)).b);
  float blk = step(0.97, hash(floor(uv * vec2(16.0, 9.0)) + tt)) * on;
  c = mix(c, 1.0 - c, blk);
  return vec4(c, tex(uv).a);
}`,

  'rgb-split': `vec4 effect(vec2 uv) {
  vec2 d = vec2(uP[0] / 100.0 * 0.025 / ASP, 0.0) + (uv - 0.5) * uP[0] / 100.0 * 0.02;
  vec4 g = tex(uv);
  return vec4(tex(uv + d).r, g.g, tex(uv - d).b, g.a);
}`,

  wave: `vec4 effect(vec2 uv) {
  float a = uP[0] / 100.0 * 0.03; float f = mix(4.0, 60.0, uP[1] / 100.0); float sp = mix(0.0, 10.0, uP[2] / 100.0);
  vec2 u = uv + vec2(sin(uv.y * f + uTime * sp) * a / ASP, cos(uv.x * f * 0.7 + uTime * sp * 0.8) * a * 0.4);
  return tex(u);
}`,

  shake: `vec4 effect(vec2 uv) {
  float a = uP[0] / 100.0; float sp = mix(1.0, 30.0, uP[1] / 100.0); float t = uTime * sp;
  vec2 off = (vec2(noise(vec2(t, 1.3)), noise(vec2(t, 7.9))) - 0.5) * 0.08 * a;
  float ang = (noise(vec2(t, 13.1)) - 0.5) * 0.06 * a;
  vec2 p = (uv - 0.5) * vec2(ASP, 1.0) / (1.0 + 0.09 * a);
  p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  return tex(p / vec2(ASP, 1.0) + 0.5 + off);
}`,

  'zoom-pulse': `vec4 effect(vec2 uv) {
  float a = uP[0] / 100.0; float bps = mix(0.5, 4.0, uP[1] / 100.0);
  float z = 1.0 + a * 0.3 * pow(abs(sin(uTime * PI * bps)), 6.0);
  return tex((uv - 0.5) / z + 0.5);
}`,

  bulge: `vec4 effect(vec2 uv) {
  float k = uP[0] / 100.0 * 0.8;
  vec2 p = (uv - 0.5) * vec2(ASP, 1.0); float R = 0.5 * min(ASP, 1.0) * 1.2; float r = length(p);
  if (r < R) { float s = r / R; p = p / max(r, 1e-5) * R * pow(s, 1.0 + k); }
  return tex(p / vec2(ASP, 1.0) + 0.5);
}`,

  mirror: `vec4 effect(vec2 uv) {
  int m = int(uP[0] + 0.5); vec2 u = uv;
  if (m == 0 || m == 3) u.x = u.x > 0.5 ? 1.0 - u.x : u.x;
  if (m == 1) u.x = u.x < 0.5 ? 1.0 - u.x : u.x;
  if (m == 2 || m == 3) u.y = u.y > 0.5 ? 1.0 - u.y : u.y;
  return tex(u);
}`,

  kaleidoscope: `vec4 effect(vec2 uv) {
  float n = max(3.0, floor(uP[0] + 0.5)); float spin = uP[1] / 100.0;
  vec2 p = (uv - 0.5) * vec2(ASP, 1.0);
  float r = length(p); float ang = atan(p.y, p.x) + uTime * spin;
  float seg = 2.0 * PI / n; ang = mod(ang, seg); ang = abs(ang - seg * 0.5);
  vec2 q = r * vec2(cos(ang), sin(ang)) / vec2(ASP, 1.0) + 0.5;
  q = 1.0 - abs(1.0 - mod(q, 2.0));
  return tex(q);
}`,

  pixelate: `vec4 effect(vec2 uv) {
  float cy = mix(0.004, 0.08, uP[0] / 100.0); vec2 cell = vec2(cy / ASP, cy);
  return tex((floor(uv / cell) + 0.5) * cell);
}`,

  halftone: `vec4 effect(vec2 uv) {
  float n = mix(160.0, 30.0, uP[0] / 100.0);
  vec2 p = uv * vec2(ASP, 1.0) * n;
  mat2 r = mat2(0.7071, -0.7071, 0.7071, 0.7071);
  vec2 q = r * p; vec2 cellC = floor(q) + 0.5;
  vec2 centre = (transpose(r) * cellC) / n / vec2(ASP, 1.0);
  vec4 s = tex(centre); float L = luma(s.rgb);
  float rad = 0.62 * sqrt(clamp(1.0 - L * 0.9, 0.0, 1.0));
  float d = length(q - cellC);
  float ink = 1.0 - smoothstep(rad - 0.08, rad + 0.08, d);
  return vec4(mix(vec3(0.97, 0.96, 0.92), s.rgb * 0.85, ink), tex(uv).a);
}`,

  sketch: `vec4 effect(vec2 uv) {
  vec2 px = 1.0 / uRes * max(1.0, uRes.y / 720.0);
  float tl = luma(tex(uv + px * vec2(-1.0, -1.0)).rgb), t = luma(tex(uv + px * vec2(0.0, -1.0)).rgb), tr = luma(tex(uv + px * vec2(1.0, -1.0)).rgb);
  float l = luma(tex(uv + px * vec2(-1.0, 0.0)).rgb), r = luma(tex(uv + px * vec2(1.0, 0.0)).rgb);
  float bl = luma(tex(uv + px * vec2(-1.0, 1.0)).rgb), b = luma(tex(uv + px * vec2(0.0, 1.0)).rgb), br = luma(tex(uv + px * vec2(1.0, 1.0)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br; float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float e = length(vec2(gx, gy));
  float pencil = 1.0 - smoothstep(0.05, 0.5, e);
  pencil *= 0.92 + 0.08 * hash(floor(uv * uRes));
  vec4 s = tex(uv);
  return vec4(mix(s.rgb, vec3(pencil) * vec3(0.98, 0.97, 0.93), uP[0] / 100.0), s.a);
}`,

  posterize: `vec4 effect(vec2 uv) {
  vec4 s = tex(uv); float n = max(2.0, floor(uP[0] + 0.5)) - 1.0;
  return vec4(floor(s.rgb * n + 0.5) / n, s.a);
}`,

  duotone: `vec4 effect(vec2 uv) {
  vec4 s = tex(uv);
  vec3 dark = hsv2rgb(vec3(uP[0] / 360.0, 0.75, 0.22)); vec3 light = hsv2rgb(vec3(uP[1] / 360.0, 0.5, 1.0));
  return vec4(mix(s.rgb, mix(dark, light, smoothstep(0.0, 1.0, luma(s.rgb))), uP[2] / 100.0), s.a);
}`,

  invert: `vec4 effect(vec2 uv) { vec4 s = tex(uv); return vec4(mix(s.rgb, 1.0 - s.rgb, uP[0] / 100.0), s.a); }`,

  'light-leak': `vec4 effect(vec2 uv) {
  vec4 s = tex(uv); float a = uP[0] / 100.0; float t = uTime * mix(0.05, 0.8, uP[1] / 100.0);
  vec2 p = uv * vec2(ASP, 1.0);
  vec2 c1 = vec2(ASP * (0.1 + 0.8 * noise(vec2(t, 2.0))), 0.15 + 0.7 * noise(vec2(t, 9.0)));
  vec2 c2 = vec2(ASP * (0.9 - 0.8 * noise(vec2(t + 5.0, 4.0))), 0.2 + 0.6 * noise(vec2(t + 3.0, 1.0)));
  vec3 leak = vec3(1.0, 0.45, 0.15) * exp(-dot(p - c1, p - c1) * 3.0) + vec3(1.0, 0.25, 0.45) * exp(-dot(p - c2, p - c2) * 4.0) * 0.8;
  return vec4(1.0 - (1.0 - s.rgb) * (1.0 - clamp(leak * a, 0.0, 1.0)), s.a);
}`,

  flash: `vec4 effect(vec2 uv) {
  vec4 s = tex(uv); float f = mix(0.5, 8.0, uP[1] / 100.0);
  float ph = fract(uTime * f); float fl = exp(-ph * 9.0);
  return vec4(mix(s.rgb, vec3(1.0), fl * uP[0] / 100.0), s.a);
}`,
}

export const TRANSITION_PRELUDE = `${PRELUDE}
uniform sampler2D uTexB;
uniform float uProg;
bool inside(vec2 uv) { return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0; }
vec4 ta(vec2 uv) { return inside(uv) ? tex(uv) : vec4(0.0); }
vec4 tb(vec2 uv) { return inside(uv) ? texture(uTexB, clamp(uv, 0.5 / uRes, 1.0 - 0.5 / uRes)) : vec4(0.0); }
float easeIO(float p) { return p < 0.5 ? 4.0 * p * p * p : 1.0 - pow(-2.0 * p + 2.0, 3.0) / 2.0; }
/* 1 where the sweep (position x along it, 0…1) has already passed at progress p */
float swept(float x, float p) { float w = 0.04; float t = mix(-w, 1.0 + w, p); return 1.0 - smoothstep(t - w, t + w, x); }
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
vec4 blurA(vec2 uv, float r) { vec4 acc = vec4(0.0); for (int i = 0; i < 24; i++) { float f = float(i) + 0.5; float rr = sqrt(f / 24.0); float th = f * 2.39996; acc += ta(clamp(uv + vec2(cos(th) / ASP, sin(th)) * rr * r, 0.0, 1.0)); } return acc / 24.0; }
vec4 blurB(vec2 uv, float r) { vec4 acc = vec4(0.0); for (int i = 0; i < 24; i++) { float f = float(i) + 0.5; float rr = sqrt(f / 24.0); float th = f * 2.39996; acc += tb(clamp(uv + vec2(cos(th) / ASP, sin(th)) * rr * r, 0.0, 1.0)); } return acc / 24.0; }
`

const push = (dx: string, dy: string) => `vec4 effect(vec2 uv) {
  float e = easeIO(uProg); vec2 d = vec2(${dx}, ${dy});
  return over(ta(uv + d * e), tb(uv + d * (e - 1.0)));
}`
const wipe = (x: string) => `vec4 effect(vec2 uv) { return mix(ta(uv), tb(uv), swept(${x}, uProg)); }`

export const TRANSITION_GLSL: Record<string, string> = {
  dissolve: `vec4 effect(vec2 uv) { return mix(ta(uv), tb(uv), uProg); }`,
  'dip-black': `vec4 effect(vec2 uv) { vec4 k = vec4(0.0, 0.0, 0.0, 1.0); return uProg < 0.5 ? mix(ta(uv), k, uProg * 2.0) : mix(k, tb(uv), uProg * 2.0 - 1.0); }`,
  'dip-white': `vec4 effect(vec2 uv) { vec4 k = vec4(1.0); return uProg < 0.5 ? mix(over(ta(uv), vec4(0.0, 0.0, 0.0, 1.0)), k, uProg * 2.0) : mix(k, over(tb(uv), vec4(0.0, 0.0, 0.0, 1.0)), uProg * 2.0 - 1.0); }`,
  'push-left': push('1.0', '0.0'),
  'push-right': push('-1.0', '0.0'),
  'push-up': push('0.0', '1.0'),
  'push-down': push('0.0', '-1.0'),
  'wipe-left': wipe('1.0 - uv.x'),
  'wipe-right': wipe('uv.x'),
  'wipe-diagonal': wipe('(uv.x + uv.y) * 0.5'),
  iris: wipe('length((uv - 0.5) * vec2(ASP, 1.0)) / length(vec2(ASP, 1.0) * 0.5)'),
  clock: `vec4 effect(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(ASP, 1.0);
  float a = fract(atan(p.x, -p.y) / (2.0 * PI) + 1.0);
  float m = 1.0 - smoothstep(uProg - 0.01, uProg + 0.01, a);
  if (uProg >= 1.0) m = 1.0;
  return mix(ta(uv), tb(uv), m);
}`,
  zoom: `vec4 effect(vec2 uv) {
  float p = uProg; vec2 c = uv - 0.5;
  vec4 a = vec4(0.0); vec4 b = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    float k = float(i) / 8.0;
    a += ta(c / (1.0 + p * 1.6 * (1.0 + k * 0.15)) + 0.5);
    b += tb(c / (1.0 + (1.0 - p) * 0.6 * (1.0 + k * 0.15)) + 0.5);
  }
  return mix(a / 8.0, b / 8.0, smoothstep(0.35, 0.65, p));
}`,
  blur: `vec4 effect(vec2 uv) { float r = sin(uProg * PI) * 0.04; return mix(blurA(uv, r), blurB(uv, r), smoothstep(0.3, 0.7, uProg)); }`,
  pixelate: `vec4 effect(vec2 uv) {
  float cy = max(1.0 / uRes.y, sin(uProg * PI) * 0.06); vec2 cell = vec2(cy / ASP, cy);
  vec2 q = (floor(uv / cell) + 0.5) * cell;
  return mix(ta(q), tb(q), step(0.5, uProg));
}`,
  glitch: `vec4 effect(vec2 uv) {
  float k = sin(uProg * PI); float tt = floor(uProg * 24.0);
  float row = floor(uv.y * 24.0);
  float off = (hash(vec2(row, tt)) - 0.5) * 0.25 * k * step(0.6, hash(vec2(row, tt + 3.0)));
  vec2 u = uv + vec2(off, 0.0);
  float useB = step(hash(vec2(row, tt + 7.0)) * 0.6 + 0.2, uProg);
  float s = 0.015 * k;
  vec4 a = vec4(ta(u + vec2(s, 0.0)).r, ta(u).g, ta(u - vec2(s, 0.0)).b, ta(u).a);
  vec4 b = vec4(tb(u + vec2(s, 0.0)).r, tb(u).g, tb(u - vec2(s, 0.0)).b, tb(u).a);
  return mix(a, b, useB);
}`,
}
