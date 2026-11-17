/*
  Research globe on the homepage. Reads window.LAB_RESEARCH (assets/js/research-data.js) and draws
  a slowly turning night globe: land as a fine dot screen, countries with studies in cardinal, and
  raised arcs from Stanford to each place. Needs d3, topojson-client and world-110m.js from
  assets/vendor/. Colours come from the --globe-* tokens in styles.css.

  - On wide screens the globe fills the right of the opening field and runs off the edge; the card
    shows the place in the visible part nearest the front.
  - Each point links to that place's research page (place.href), or to its section on research.html.
  - Hovering or focusing a point pauses on it. Dragging turns the globe.
  - With reduced motion requested, the globe stays still unless the visitor turns it.
*/
(function () {
  "use strict";

  var DATA = window.LAB_RESEARCH;
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var SPEED = 0.0045;           // degrees per millisecond, about 80 s per turn
  var LEAD = -28;               // degrees: the "front" sits right of the globe centre, toward the text
  var HOLD_AFTER_SELECT = 9000;
  var HOLD_AFTER_DRAG = 3000;
  var DOT_STEP = 1.25;          // degrees between land dots
  var RAD = Math.PI / 180;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function placesOf(s) { return [s.place].concat(s.alsoPlaces || []); }
  function studiesAt(p) { return DATA.studies.filter(function (s) { return placesOf(s).indexOf(p.id) !== -1; }); }
  function nameOf(p) { return p.label || p.country; }
  function hrefOf(p) { return p.href || "research.html#place-" + p.id; }
  function linkTextOf(p) { return p.linkText || "See the research in " + nameOf(p); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function cart(lon, lat) {
    var l = lon * RAD, p = lat * RAD, c = Math.cos(p);
    return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
  }

  /* ---------- real Earth ----------
     A WebGL2 sphere shaded from the satellite image in window.LAB_EARTH: the colour image (with rivers
     drawn in) plus a relief image (red: elevation, green: water) that gives mountains their light and
     shadow. Without WebGL2 or the images, the function returns null and the dotted globe is drawn. */
  function createEarth(viewport, before, onReady) {
    var SRC = window.LAB_EARTH;
    if (!SRC || !window.WebGL2RenderingContext) return null;
    var c = el("canvas", "globe-earth");
    c.setAttribute("aria-hidden", "true");
    var gl = c.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    var VS = "#version 300 es\nvoid main(){vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.);gl_Position=vec4(p,0.,1.);}";
    var FS = "#version 300 es\nprecision highp float;\n" +
      "uniform sampler2D uColor,uRelief;uniform vec3 uC;uniform mat3 uM;out vec4 o;\n" +
      "const float PI=3.14159265;const vec3 L=normalize(vec3(.78,-.42,.46));const vec3 SKY=vec3(.56,.76,1.);\n" +
      "void main(){\n" +
      " vec2 p=(gl_FragCoord.xy-uC.xy)/uC.z;float r=length(p);float px=1.5/uC.z;\n" +
      " float glow=r>1.?exp(-(r-1.)*30.)*.42*(1.-smoothstep(1.03,1.06,r)):0.;\n" +
      " if(r>=1.+px&&glow<.002){o=vec4(0.);return;}\n" +
      " float edge=1.-smoothstep(1.-px,1.,r);\n" +
      " vec3 col=vec3(0.);\n" +
      " if(edge>0.){\n" +
      "  float d=sqrt(max(0.,1.-min(r*r,1.)));vec3 v=vec3(d,p.x,p.y);vec3 w=transpose(uM)*v;\n" +
      "  float u=atan(w.y,w.x)/(2.*PI)+.5;float t=.5-asin(clamp(w.z,-1.,1.))/PI;\n" +
      "  float u2=fract(u+.5)-.5;u=fwidth(u)<=fwidth(u2)+1e-6?u:u2;\n" +
      "  vec3 alb=texture(uColor,vec2(u,t)).rgb;vec3 rel=texture(uRelief,vec2(u,t)).rgb;\n" +
      "  float du=1./2048.,dv=1./1024.;\n" +
      "  float he=texture(uRelief,vec2(u+du,t)).r-texture(uRelief,vec2(u-du,t)).r;\n" +
      "  float hn=texture(uRelief,vec2(u,t-dv)).r-texture(uRelief,vec2(u,t+dv)).r;\n" +
      "  vec3 T=normalize(vec3(-w.y,w.x,1e-5));vec3 B=cross(w,T);\n" +
      "  float land=1.-smoothstep(.35,.65,rel.g);\n" +
      "  vec3 n=normalize(w-(he*T+hn*B)*BUMP*land);\n" +
      "  vec3 nv=uM*n;float diff=max(dot(nv,L),0.);\n" +
      "  float sea=1.-land;alb=mix(alb,alb*1.04+vec3(.012,.045,.095),sea);\n  col=alb*(.56+.8*diff);\n" +
      "  vec3 H=normalize(L+vec3(1.,0.,0.));col+=vec3(.9,.95,1.)*pow(max(dot(v,H),0.),70.)*.26*(1.-land);\n" +
      "  col=mix(col,SKY,pow(1.-d,2.6)*.62);\n" +
      " }\n" +
      " float a=edge+(1.-edge)*glow;o=vec4(col*edge+SKY*(1.-edge)*glow,a);\n" +
      "}";
    FS = FS.replace("BUMP", "9.");
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { throw new Error(gl.getShaderInfoLog(s)); } return s; }
    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) { return null; }
    gl.useProgram(prog);
    gl.bindVertexArray(gl.createVertexArray());
    gl.uniform1i(gl.getUniformLocation(prog, "uColor"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "uRelief"), 1);
    var uC = gl.getUniformLocation(prog, "uC"), uM = gl.getUniformLocation(prog, "uM");
    var aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    var pending = 2;
    var api = { ready: false, failed: false, canvas: c };
    function load(unit, src) {
      var img = new Image();
      img.onload = function () {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        if (--pending === 0) { api.ready = true; onReady(); }
      };
      img.onerror = function () { api.failed = true; onReady(); };
      img.src = src;
    }
    api.resize = function (w, h) { c.width = w; c.height = h; gl.viewport(0, 0, w, h); };
    api.draw = function (M, x, y, r) {
      if (!api.ready) return;
      gl.uniform3f(uC, x, c.height - y, r);
      gl.uniformMatrix3fv(uM, false, [M[0][0], M[0][1], M[0][2], M[1][0], M[1][1], M[1][2], M[2][0], M[2][1], M[2][2]]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    viewport.insertBefore(c, before);
    load(0, SRC.color);
    load(1, SRC.relief);
    return api;
  }

  function init(root) {
    var viewport = root.querySelector(".globe-viewport");
    var canvas = root.querySelector(".globe-canvas");
    var pointsBox = root.querySelector(".globe-points");
    var card = root.querySelector(".globe-card");

    if (!DATA || !window.d3 || !window.topojson || !window.WORLD_110M || !canvas || !canvas.getContext) {
      if (card) card.innerHTML = '<p class="globe-fallback">The globe could not load. The studies are listed on the <a href="research.html#publications">Research page</a>.</p>';
      return;
    }

    var css = getComputedStyle(root);
    var C = {};
    ["sea-hi", "sea", "land", "study", "active", "grid", "rim", "glow", "arc", "arc-active"].forEach(function (k) {
      C[k] = css.getPropertyValue("--globe-" + k).trim();
    });

    var ctx = canvas.getContext("2d");
    var world = topojson.feature(WORLD_110M, WORLD_110M.objects.countries);
    var places = DATA.places.filter(function (p) { return studiesAt(p).length; });
    var mapped = places.filter(function (p) { return !p.online; });
    var home = mapped.find(function (p) { return p.home; });

    /* ---------- land dots ----------
       Each country is painted once into an equirectangular index image with its own colour;
       sampling that image on a latitude-aware grid gives the dots and the country each belongs to. */
    var countryIndex = {};
    world.features.forEach(function (f, i) { countryIndex[f.properties.name] = i + 1; });
    var studyCountries = new Set(mapped.map(function (p) { return countryIndex[p.atlas || p.country]; }).filter(Boolean));
    var dots = (function () {
      var IW = 1440, IH = 720;
      var off = document.createElement("canvas");
      off.width = IW; off.height = IH;
      var oc = off.getContext("2d");
      var eq = d3.geoEquirectangular().scale(IW / (2 * Math.PI)).translate([IW / 2, IH / 2]);
      var p = d3.geoPath(eq, oc);
      world.features.forEach(function (f, i) {
        var id = i + 1;
        oc.beginPath(); p(f);
        oc.fillStyle = "rgb(" + (id & 255) + "," + ((id >> 8) & 255) + ",7)";
        oc.fill();
      });
      var img = oc.getImageData(0, 0, IW, IH).data;
      var out = [];
      for (var lat = -58; lat <= 82; lat += DOT_STEP) {
        var step = DOT_STEP / Math.max(0.2, Math.cos(lat * RAD));
        var jitter = (Math.round(lat / DOT_STEP) % 2) * step * 0.5;
        for (var lon = -180 + jitter; lon < 180; lon += step) {
          var x = Math.floor((lon + 180) / 360 * IW), y = Math.floor((90 - lat) / 180 * IH);
          var k = (y * IW + x) * 4;
          if (img[k + 2] !== 7 || img[k + 3] < 200) continue;
          var id = img[k] + (img[k + 1] << 8);
          out.push({ v: cart(lon, lat), c: id });
        }
      }
      return out;
    })();

    var projection = d3.geoOrthographic().clipAngle(90).precision(0.6);
    var path = d3.geoPath(projection, ctx);
    var graticule = d3.geoGraticule().step([20, 20])();
    var sphere = { type: "Sphere" };

    /* Raised arcs from Stanford: points along the great circle, lifted toward the middle. */
    var arcs = home ? mapped.filter(function (p) { return !p.home; }).map(function (p) {
      var a = cart(home.lon, home.lat), b = cart(p.lon, p.lat);
      var interp = d3.geoInterpolate([home.lon, home.lat], [p.lon, p.lat]);
      var dist = d3.geoDistance([home.lon, home.lat], [p.lon, p.lat]);
      var lift = 0.03 + 0.1 * (dist / Math.PI);
      var pts = [];
      for (var i = 0; i <= 64; i++) {
        var t = i / 64, ll = interp(t), v = cart(ll[0], ll[1]), h = 1 + lift * Math.sin(Math.PI * t);
        pts.push([v[0] * h, v[1] * h, v[2] * h]);
      }
      return { id: p.id, pts: pts, ab: [a, b] };
    }) : [];

    var state = {
      rot: [-4, -8, 0],
      featured: null,
      chosen: null,
      hover: null,
      holdUntil: 0,
      anim: null,
      drag: null,
      running: false,
      t: 0
    };
    var W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = 1, M = null;
    var earth = createEarth(viewport, canvas, function () { requestDraw(); });
    var hit = el("div", "globe-hit");
    viewport.insertBefore(hit, pointsBox);

    /* ---------- points ---------- */
    var points = {};
    mapped.forEach(function (p) {
      var a = el("a", "globe-point" + (p.home ? " is-home" : ""));
      a.href = hrefOf(p);
      a.dataset.place = p.id;
      a.setAttribute("aria-label", nameOf(p) + ", " + plural(studiesAt(p).length, "study", "studies") + ". " + linkTextOf(p));
      a.append(el("span", "dot"), el("span", "label", nameOf(p)));
      a.hidden = true;
      a.addEventListener("pointerenter", function () { state.hover = p.id; feature(p.id); });
      a.addEventListener("pointerleave", function () { state.hover = null; state.holdUntil = performance.now() + 1500; });
      a.addEventListener("focus", function () { choose(p.id, true); });
      pointsBox.append(a);
      points[p.id] = a;
    });

    /* ---------- card ---------- */
    var cardTimer = null;
    function renderCard(id) {
      var p = DATA.places.find(function (x) { return x.id === id; });
      card.textContent = "";
      if (!p) {
        card.append(el("h3", null, "Research around the world"));
        card.append(el("p", "more", "Select a point to go to the research in that place."));
        return;
      }
      var list = studiesAt(p);
      card.append(el("h3", null, nameOf(p)));
      card.append(el("p", "globe-card-sub", [p.headline || p.where, plural(list.length, "study", "studies")].filter(Boolean).join(", ")));
      var a = el("a", "text-link", linkTextOf(p));
      a.href = hrefOf(p);
      card.append(a);
    }
    function feature(id) {
      if (id === state.featured) return;
      state.featured = id;
      Object.keys(points).forEach(function (k) { points[k].classList.toggle("is-active", k === id); });
      if (REDUCED) { renderCard(id); requestDraw(); return; }
      card.classList.add("is-swapping");
      clearTimeout(cardTimer);
      cardTimer = setTimeout(function () { renderCard(id); card.classList.remove("is-swapping"); }, 180);
    }

    /* ---------- choosing and turning ---------- */
    function targetRotation(p) { return [-(p.lon + LEAD), clamp(-p.lat, -32, 32), 0]; }
    function choose(id, animate) {
      var p = DATA.places.find(function (x) { return x.id === id; });
      if (!p) return;
      state.chosen = id;
      state.holdUntil = performance.now() + HOLD_AFTER_SELECT;
      feature(id);
      if (p.online) return;
      var to = targetRotation(p);
      var from = state.rot.slice();
      to[0] = from[0] + (((to[0] - from[0]) % 360) + 540) % 360 - 180;
      if (!animate || REDUCED) { state.rot = to; requestDraw(); return; }
      state.anim = { from: from, to: to, start: performance.now(), dur: 1300 };
      start();
    }

    /* ---------- rotation matrix (d3's rotation applied to the cartesian basis) ---------- */
    function matrix(rot) {
      var r = d3.geoRotation(rot);
      var e = [[0, 0], [90, 0], [0, 90]].map(function (ll) { var q = r(ll); return cart(q[0], q[1]); });
      return e; // columns
    }
    function apply(m, v) {
      return [
        m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
        m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
        m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2]
      ];
    }

    /* ---------- drawing ---------- */
    function layout() {
      var r = viewport.getBoundingClientRect();
      W = r.width; H = r.height;
      if (!W || !H) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      if (getComputedStyle(viewport).position === "absolute") {
        // The globe sits on top of the band and rises above and below it, while still filling the band's left corners.
        var band = root.getBoundingClientRect().height, text = root.querySelector(".map-text");
        var room = text ? text.getBoundingClientRect().left - 40 : W;
        R = Math.min(band * 0.57, band / 2 + W * 0.0375); cy = H * 0.5;
        cx = Math.min(Math.sqrt(R * R - band * band / 4) * 0.96, room - R);
      } else { R = Math.min(W, H) * 0.47; cx = W * 0.5; cy = H * 0.5; }
      hit.style.cssText = "left:" + (cx - R) + "px;top:" + (cy - R) + "px;width:" + 2 * R + "px;height:" + 2 * R + "px";
      if (earth) earth.resize(canvas.width, canvas.height);
      projection.translate([cx, cy]).scale(R);
      draw();
    }

    function draw() {
      if (!W || !H) return;
      projection.rotate(state.rot);
      M = matrix(state.rot);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      var real = earth && !earth.failed;
      if (real) earth.draw(M, cx * dpr, cy * dpr, R * dpr);
      if (!real) {
      // atmosphere
      var glow = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * 1.06);
      glow.addColorStop(0, C.glow);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, 2 * Math.PI); ctx.fill();

      // sea
      var sea = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.45, R * 0.05, cx, cy, R);
      sea.addColorStop(0, C["sea-hi"]);
      sea.addColorStop(1, C.sea);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.fillStyle = sea; ctx.fill();

      ctx.beginPath(); path(graticule); ctx.strokeStyle = C.grid; ctx.lineWidth = 0.6; ctx.stroke();

      // land dots, grouped by colour so each colour is one fill
      var featuredCountry = null;
      var fp = state.featured && mapped.find(function (p) { return p.id === state.featured; });
      if (fp) featuredCountry = countryIndex[fp.atlas || fp.country] || null;
      var size = Math.max(1.1, R * 0.0052);
      var groups = { land: [], study: [], active: [] };
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i], v = apply(M, d.v);
        if (v[0] <= 0.06) continue;
        var g = d.c === featuredCountry ? "active" : studyCountries.has(d.c) ? "study" : "land";
        groups[g].push(cx + R * v[1], cy - R * v[2], v[0]);
      }
      [["land", C.land], ["study", C.study], ["active", C.active]].forEach(function (gc) {
        var arr = groups[gc[0]];
        ctx.fillStyle = gc[1];
        for (var j = 0; j < arr.length; j += 3) {
          var z = arr[j + 2], s = size * (0.55 + 0.45 * Math.sqrt(z));
          ctx.globalAlpha = 0.12 + 0.88 * Math.min(1, (z - 0.06) * 2.2);
          ctx.fillRect(arr[j] - s / 2, arr[j + 1] - s / 2, s, s);
        }
      });
      ctx.globalAlpha = 1;

      // rim
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.strokeStyle = C.rim; ctx.lineWidth = 1; ctx.stroke();
      }

      // raised arcs
      arcs.forEach(function (a) {
        var on = a.id === state.featured;
        ctx.beginPath();
        var pen = false;
        for (var k = 0; k < a.pts.length; k++) {
          var v = apply(M, a.pts[k]);
          var sx = v[1], sy = v[2];
          var visible = v[0] > -0.02;
          if (!visible) { pen = false; continue; }
          var X = cx + R * sx, Y = cy - R * sy;
          if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
        }
        ctx.strokeStyle = on ? C["arc-active"] : C.arc;
        ctx.lineWidth = on ? 1.3 : 1;
        ctx.setLineDash(on || REDUCED ? [] : [2, 5]);
        ctx.lineDashOffset = -state.t * 0.02;
        ctx.stroke();
      });
      ctx.setLineDash([]);

      placePoints();
    }

    function placePoints() {
      mapped.forEach(function (p) {
        var a = points[p.id];
        var v = apply(M, cart(p.lon, p.lat));
        if (v[0] < 0.12) { if (!a.hidden) a.hidden = true; return; }
        if (a.hidden) a.hidden = false;
        a.style.transform = "translate(" + (cx + R * v[1]).toFixed(1) + "px," + (cy - R * v[2]).toFixed(1) + "px)";
        a.style.opacity = Math.min(1, (v[0] - 0.12) / 0.3).toFixed(2);
      });
    }

    function nearestToFront() {
      var center = [-state.rot[0] - LEAD, -state.rot[1]], best = null, bestD = Math.PI / 2 - 0.2;
      mapped.forEach(function (p) {
        var d = d3.geoDistance([p.lon, p.lat], center);
        if (d < bestD) { bestD = d; best = p.id; }
      });
      return best;
    }

    /* ---------- animation loop ---------- */
    var last = 0, raf = 0, drawQueued = false, lastFeatureCheck = 0;
    function frame(now) {
      raf = 0;
      var dt = last ? Math.min(64, now - last) : 16;
      last = now;
      if (state.anim) {
        var t = Math.min(1, (now - state.anim.start) / state.anim.dur), k = ease(t);
        state.rot = state.anim.from.map(function (v, i) { return v + (state.anim.to[i] - v) * k; });
        if (t >= 1) state.anim = null;
      } else if (!REDUCED && !state.drag && !state.hover && now > state.holdUntil) {
        if (state.chosen) state.chosen = null;
        state.rot[0] -= dt * SPEED;
        state.rot[1] += (-16 - state.rot[1]) * 0.01;
      }
      if (!REDUCED) state.t += dt;
      draw();
      if (!state.chosen && !state.hover && now - lastFeatureCheck > 300) {
        lastFeatureCheck = now;
        var n = nearestToFront();
        if (n) feature(n);
      }
      if (state.running && (!REDUCED || state.anim || state.drag)) raf = requestAnimationFrame(frame);
    }
    function start() {
      state.running = true;
      if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
    }
    function stop() {
      state.running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }
    function requestDraw() {
      if (drawQueued) return;
      drawQueued = true;
      requestAnimationFrame(function () { drawQueued = false; draw(); });
    }

    /* ---------- dragging ---------- */
    hit.addEventListener("pointerdown", function (ev) {
      state.drag = { x: ev.clientX, y: ev.clientY, rot: state.rot.slice() };
      state.anim = null;
      hit.setPointerCapture(ev.pointerId);
      start();
    });
    hit.addEventListener("pointermove", function (ev) {
      if (!state.drag) return;
      var s = 90 / R;
      state.rot = [state.drag.rot[0] + (ev.clientX - state.drag.x) * s, clamp(state.drag.rot[1] - (ev.clientY - state.drag.y) * s, -55, 55), 0];
      if (REDUCED) requestDraw();
    });
    function endDrag() {
      if (!state.drag) return;
      state.drag = null;
      state.holdUntil = performance.now() + HOLD_AFTER_DRAG;
      var n = nearestToFront();
      if (n) feature(n);
    }
    hit.addEventListener("pointerup", endDrag);
    hit.addEventListener("pointercancel", endDrag);

    /* ---------- start ---------- */
    renderCard(null);
    layout();
    var first = nearestToFront();
    if (first) { state.featured = null; feature(first); }
    if (window.ResizeObserver) new ResizeObserver(layout).observe(viewport);
    else window.addEventListener("resize", layout);
    if (!REDUCED) {
      if (window.IntersectionObserver) {
        new IntersectionObserver(function (es) {
          es.forEach(function (e) { if (e.isIntersecting && !document.hidden) start(); else stop(); });
        }, { threshold: 0.05 }).observe(viewport);
      } else start();
      document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });
    }
  }

  function boot() { document.querySelectorAll("[data-research-globe]").forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
