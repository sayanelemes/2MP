/* CQA · фон «Аврора».
   Перенос компонента Aurora из React Bits (https://reactbits.dev/backgrounds/aurora, MIT + Commons Clause)
   на чистый WebGL2 без React. Цвета берутся из CSS-переменных --aurora-1…4 и меняются вместе с темой.
   Без WebGL2 остаётся CSS-фон .aurora__fallback. Только оформление. */
(function () {
  'use strict';

  var MAX_STOPS = 5;
  var MAX_LAYERS = 3;
  var INTRO_SECONDS = 2.4;

  var VERTEX = '#version 300 es\n' +
    'in vec2 aPosition;\n' +
    'void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }';

  var FRAGMENT = '#version 300 es\n' +
    'precision highp float;\nprecision highp int;\n' +
    'uniform vec2 uResolution;\nuniform float uTime;\nuniform vec3 uStops[' + MAX_STOPS + '];\nuniform int uStopCount;\n' +
    'uniform float uAmplitude;\nuniform float uBlend;\nuniform float uHeight;\nuniform float uScale;\nuniform float uGlow;\n' +
    'uniform float uBrightness;\nuniform int uLayers;\nuniform float uFlip;\nuniform vec3 uPointer;\nuniform float uReveal;\n' +
    'uniform float uOpacity;\nuniform float uLightMode;\nout vec4 outColor;\n' +
    'vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }\n' +
    'float snoise(vec2 v) {\n' +
    '  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);\n' +
    '  vec2 i = floor(v + dot(v, C.yy));\n  vec2 x0 = v - i + dot(i, C.xx);\n' +
    '  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);\n' +
    '  vec4 x12 = x0.xyxy + C.xxzz;\n  x12.xy -= i1;\n  i = mod(i, 289.0);\n' +
    '  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));\n' +
    '  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);\n' +
    '  m = m * m;\n  m = m * m;\n  vec3 x = 2.0 * fract(p * C.www) - 1.0;\n  vec3 h = abs(x) - 0.5;\n' +
    '  vec3 ox = floor(x + 0.5);\n  vec3 a0 = x - ox;\n  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);\n' +
    '  vec3 g;\n  g.x = a0.x * x0.x + h.x * x0.y;\n  g.yz = a0.yz * x12.xz + h.yz * x12.yw;\n  return 130.0 * dot(m, g);\n}\n' +
    'float smootherstep(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }\n' +
    'vec3 oklabToLinear(vec3 c) {\n' +
    '  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;\n  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;\n' +
    '  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;\n  l = l * l * l;\n  m = m * m * m;\n  s = s * s * s;\n' +
    '  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);\n}\n' +
    'vec3 toSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }\n' +
    'vec3 ramp(float t) {\n' +
    '  float x = clamp(t, 0.0, 1.0) * float(uStopCount - 1);\n  int i = int(min(floor(x), float(uStopCount - 2)));\n' +
    '  float f = x - float(i);\n  f = f * f * (3.0 - 2.0 * f);\n  vec3 lch = mix(uStops[i], uStops[i + 1], f);\n' +
    '  lch.x = mix(lch.x, min(lch.x, 0.7), uLightMode);\n' +
    '  return toSrgb(oklabToLinear(vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z))));\n}\n' +
    'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\n' +
    'void main() {\n' +
    '  vec2 frag = gl_FragCoord.xy;\n  float y = 1.0 - frag.y / uResolution.y;\n  y = mix(y, 1.0 - y, uFlip);\n' +
    '  float u = frag.x / uResolution.x;\n  float X = (frag.x - uResolution.x * 0.5) / uResolution.y;\n  float t = uTime;\n' +
    '  float reach = uPointer.z * exp(-pow((X - uPointer.x) / 0.38, 2.0));\n  vec3 glow = vec3(0.0);\n  float cover = 0.0;\n' +
    '  for (int k = 0; k < ' + MAX_LAYERS + '; k++) {\n' +
    '    if (k >= uLayers) break;\n    float layer = float(k);\n    float seed = layer * 13.7;\n    float pace = t * (1.0 - layer * 0.18);\n' +
    '    float warp = snoise(vec2(X * 0.45 * uScale + pace * 0.02 + seed, pace * 0.05 + seed));\n' +
    '    float wave = snoise(vec2(X * 0.75 * uScale + warp * 0.35 - pace * 0.03 + seed, pace * 0.07 - seed)) * 0.72\n' +
    '      + snoise(vec2(X * 1.6 * uScale + warp * 0.5 + pace * 0.04 - seed, pace * 0.1 + seed * 0.5)) * 0.28;\n' +
    '    float hem = uHeight + layer * 0.07 + wave * 0.15 * uAmplitude;\n    hem += reach * 0.08 * (layer < 0.5 ? 1.0 : 0.4);\n' +
    '    hem = mix(-0.25, hem, uReveal);\n    float soft = (0.04 + uBlend * 0.16) * (1.0 + layer * 0.9);\n    float rise = hem - y;\n' +
    '    float low = -soft - uGlow * 0.14;\n    float high = 0.26 + soft * 0.6;\n' +
    '    float body = pow(smootherstep(low, high, rise), 1.5 + uGlow * 0.6);\n' +
    '    float lobes = 0.86 + 0.14 * snoise(vec2(X * 0.9 * uScale - pace * 0.025 + seed, y * 0.3 + pace * 0.04));\n' +
    '    float alpha = body * lobes * (layer < 0.5 ? 1.0 : 0.32 / layer);\n' +
    '    alpha = clamp(alpha * (1.0 + reach * 0.25 * smootherstep(0.9, 0.0, abs(y - hem))), 0.0, 1.0);\n' +
    '    vec3 tint = ramp(u + 0.05 * sin(pace * 0.08 + layer * 2.3) + layer * 0.1 + max(rise, 0.0) * 0.05);\n' +
    '    glow = 1.0 - (1.0 - glow) * (1.0 - tint * alpha);\n    cover = 1.0 - (1.0 - cover) * (1.0 - alpha);\n  }\n' +
    '  float fade = smootherstep(0.0, 0.7, uReveal) * uOpacity;\n  float strength = clamp(uBrightness, 0.0, 2.0);\n' +
    '  glow *= fade * min(strength, 1.0);\n  cover *= fade * min(strength, 1.0);\n  glow = 1.0 - pow(1.0 - glow, vec3(max(strength, 1.0)));\n' +
    '  float dither = (hash(frag) - 0.5) / 255.0;\n' +
    '  if (uLightMode > 0.5) {\n    vec3 tint = cover > 0.0001 ? glow / cover : vec3(0.0);\n    cover *= smootherstep(0.0, 0.25, cover);\n' +
    '    float alpha = cover * 0.7;\n    outColor = vec4(tint * alpha + dither, clamp(alpha + dither, 0.0, 1.0));\n    return;\n  }\n' +
    '  outColor = vec4(glow + dither, clamp(cover + dither, 0.0, 1.0));\n}';

  /* Настройки фона: высота «занавеса», амплитуда волн и т. п. (как props компонента React Bits) */
  var SETTINGS = { amplitude: 1, blend: 0.6, speed: 0.5, height: 0.3, scale: 1, glow: 0.55, brightness: 0.7, layers: 3, opacity: 1 };

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function toOklch(rgb) {
    var lin = rgb.map(function (c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    var l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2]);
    var m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2]);
    var s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]);
    var lab = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
    return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
  }

  function unwrapHues(stops) {
    var known = stops.findIndex(function (st) { return st[1] > 0.02; });
    var previous = known === -1 ? 0 : stops[known][2];
    return stops.map(function (st) {
      var hue = st[1] > 0.02 ? st[2] : previous;
      while (hue - previous > Math.PI) hue -= Math.PI * 2;
      while (hue - previous < -Math.PI) hue += Math.PI * 2;
      previous = hue;
      return [st[0], st[1], hue];
    });
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
    gl.deleteShader(sh);
    return null;
  }

  function link(gl) {
    var vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    var program = gl.createProgram();
    if (!vs || !fs || !program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
    var uniforms = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
      var info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(program, info.name);
    }
    return { program: program, uniforms: uniforms };
  }

  /* Где WebGL-фон не включаем: телефоны, слабые устройства, программный рендер (без GPU).
     Там остаётся лёгкий CSS-фон — интерфейс не тормозит. */
  function lowPower() {
    if (window.matchMedia && window.matchMedia('(max-width: 820px)').matches) return true;
    if ((navigator.hardwareConcurrency || 8) <= 2) return true;
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return true;
    if (navigator.connection && navigator.connection.saveData) return true;
    return false;
  }

  function softwareRenderer(gl) {
    var dbg = gl.getExtension('WEBGL_debug_renderer_info');
    var name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  }

  function init() {
    var host = document.querySelector('.aurora');
    var canvas = host && host.querySelector('.aurora__canvas');
    if (!canvas) return;
    // На слабом железе оставляем неподвижный CSS-фон: ни WebGL, ни бесконечной анимации
    var settle = function () { host.classList.add('is-static'); };
    if (lowPower()) { settle(); return; }
    var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl || softwareRenderer(gl)) { settle(); return; }
    var prog = link(gl);
    if (!prog) return;
    host.classList.add('is-webgl');

    var u = prog.uniforms;
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var palette = new Float32Array(MAX_STOPS * 3);
    var stopCount = 2;
    var lightMode = 0;

    function parse(value) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#ffffff';
      probe.fillStyle = value;
      probe.fillRect(0, 0, 1, 1);
      var d = probe.getImageData(0, 0, 1, 1).data;
      return [d[0] / 255, d[1] / 255, d[2] / 255];
    }

    function readTheme() {
      var css = getComputedStyle(document.documentElement);
      var stops = ['--aurora-1', '--aurora-2', '--aurora-3', '--aurora-4', '--aurora-2']
        .map(function (name) { return css.getPropertyValue(name).trim(); })
        .filter(Boolean)
        .slice(0, MAX_STOPS);
      stopCount = Math.max(2, stops.length);
      palette.fill(0);
      unwrapHues(stops.map(function (st) { return toOklch(parse(st)); })).forEach(function (st, i) { palette.set(st, i * 3); });
      lightMode = document.documentElement.getAttribute('data-theme') === 'light' ? 1 : 0;
    }

    var FRAME_MS = 1000 / 30;            // фону хватает 30 кадров в секунду — вдвое меньше нагрузка на GPU
    var view = { w: 1, h: 1 };
    var pointer = { x: 0, y: 0, inside: false };
    var state = { clock: 0, px: 0, py: 0.5, reach: 0, reveal: reduce ? 1 : 0 };
    var quality = { scale: 0.5, samples: 0, total: 0, frozen: false };
    var visible = true;
    var raf = 0;
    var last = 0;

    function render() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog.program);
      gl.bindVertexArray(vao);
      gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      gl.uniform1f(u.uTime, state.clock);
      gl.uniform3fv(u.uStops, palette);
      gl.uniform1i(u.uStopCount, stopCount);
      gl.uniform1f(u.uAmplitude, SETTINGS.amplitude);
      gl.uniform1f(u.uBlend, SETTINGS.blend);
      gl.uniform1f(u.uHeight, SETTINGS.height);
      gl.uniform1f(u.uScale, SETTINGS.scale);
      gl.uniform1f(u.uGlow, SETTINGS.glow);
      gl.uniform1f(u.uBrightness, SETTINGS.brightness);
      gl.uniform1i(u.uLayers, SETTINGS.layers);
      gl.uniform1f(u.uFlip, 0);
      gl.uniform3f(u.uPointer, state.px, state.py, state.reach);
      gl.uniform1f(u.uReveal, 1 - Math.pow(1 - state.reveal, 3));
      gl.uniform1f(u.uOpacity, SETTINGS.opacity);
      gl.uniform1f(u.uLightMode, lightMode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* Самопроверка скорости: если кадры не успевают, снижаем качество, затем замираем на красивом кадре. */
    function checkQuality(dt) {
      if (quality.frozen || quality.samples >= 30) return;
      quality.samples++;
      quality.total += dt;
      if (quality.samples < 30) return;
      var avg = quality.total / quality.samples;
      if (avg > 1 / 20 && quality.scale > 0.34) {
        quality.scale = 0.33;
        SETTINGS.layers = 2;
        quality.samples = 0;
        quality.total = 0;
        resize();
      } else if (avg > 1 / 12) {
        quality.frozen = true;
        state.reveal = 1;
      }
    }

    function frame(now) {
      raf = 0;
      if (document.hidden || !visible) { last = 0; return; }
      if (last && now - last < FRAME_MS - 2) { raf = requestAnimationFrame(frame); return; }
      var dt = last ? clamp((now - last) / 1000, 0.0005, 0.1) : 1 / 30;
      last = now;
      if (reduce) { state.reveal = 1; render(); return; }
      checkQuality(dt);
      state.clock += dt * SETTINGS.speed;
      var follow = 1 - Math.exp(-dt / 0.6);
      if (pointer.inside) {
        state.px += ((pointer.x - view.w / 2) / view.h - state.px) * follow;
        state.py += (pointer.y / view.h - state.py) * follow;
      }
      state.reach += ((pointer.inside ? 1 : 0) - state.reach) * (1 - Math.exp(-dt / (pointer.inside ? 0.9 : 1.4)));
      if (state.reveal < 1) state.reveal = Math.min(1, state.reveal + dt / INTRO_SECONDS);
      render();
      if (quality.frozen) return;
      raf = requestAnimationFrame(frame);
    }

    function wake() { if (!raf && visible && !document.hidden && !quality.frozen) raf = requestAnimationFrame(frame); }

    function resize() {
      var ratio = Math.min(window.devicePixelRatio || 1, 2) * quality.scale;
      view.w = Math.max(1, host.clientWidth);
      view.h = Math.max(1, host.clientHeight);
      canvas.width = Math.max(1, Math.round(view.w * ratio));
      canvas.height = Math.max(1, Math.round(view.h * ratio));
      render();
      wake();
    }

    // Фон уезжает вместе со страницей — когда его не видно, не рисуем вообще.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries.some(function (en) { return en.isIntersecting; });
        if (visible) { last = 0; wake(); }
      }).observe(host);
    }

    window.addEventListener('pointermove', function (e) {
      if (quality.frozen || !visible) return;
      pointer.x = e.clientX;
      pointer.y = e.clientY + window.scrollY;
      if (!pointer.inside) { state.px = (pointer.x - view.w / 2) / view.h; state.py = pointer.y / view.h; }
      pointer.inside = true;
      wake();
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', function () { pointer.inside = false; });
    document.addEventListener('visibilitychange', function () { last = 0; wake(); });
    var resizeTimer = 0;
    window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150); });
    window.addEventListener('cqa:theme', function () { readTheme(); render(); });

    readTheme();
    resize();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
