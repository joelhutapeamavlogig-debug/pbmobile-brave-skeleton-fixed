(() => {
  'use strict';
  if (window.__pbVisualsFull) return;
  window.__pbVisualsFull = true;

  /*
   * Skeleton ESP + Chams — v1.4.0 (fixed)
   *
   * FIXES vs 1.3
   *  1. Bone lookup normalises names. The old lookup tried exactly four literal
   *     spellings per bone, so a rig renamed to "mixamorig:Head" or "Bone_head"
   *     produced zero lines and looked like the cheat was broken. The cache now
   *     strips prefixes/separators and compares case-insensitively.
   *  2. The enemy list is found by shape (an array of player-like objects with a
   *     rig), not by the single name g.bots.
   *  3. window.__pbDiag reports what the frame loop can see: whether window.G
   *     exists, how many players, how many bones paired, how many meshes tinted.
   */

  var A = { x: 0, y: 0, z: 0 }, B = { x: 0, y: 0, z: 0 };
  var _hpOut = { x: 0, y: 0, z: 0 }, _pDir = { x: 0, y: 0, z: 0 };

  var diag = {
    version: '1.4.0',
    gSeen: 0, gAt: 0,
    players: 0, paired: 0, lines: 0,
    chamsMeshes: 0,
    boneNames: [],      // first few raw names, so a renamed rig is obvious
    listKey: null
  };
  window.__pbDiag = diag;

  function wpos(b, out) {
    var e = b.matrixWorld.elements;
    out.x = e[12]; out.y = e[13]; out.z = e[14];
    return out;
  }

  function headPoint(p) {
    if (!p) return null;
    var by = p.c && p.c.byName;
    if (by) {
      var h = boneOf(by, 'Head');
      var g = boneOf(by, 'Bone_HeadGearAttach') || boneOf(by, 'HeadGearAttach');
      if (h && g) {
        wpos(h, A); wpos(g, B);
        _hpOut.x = (A.x + B.x) * .5; _hpOut.y = (A.y + B.y) * .5; _hpOut.z = (A.z + B.z) * .5;
        return _hpOut;
      }
      if (h || g) return wpos(h || g, _hpOut);
    }
    var mm = p.obj && p.obj.matrixWorld && p.obj.matrixWorld.elements;
    if (mm) { _hpOut.x = mm[12]; _hpOut.y = mm[13] + 1.55; _hpOut.z = mm[14]; return _hpOut; }
    return null;
  }

  function hasLineOfSight(g, cam, hp) {
    try {
      if (typeof g.cast !== 'function' || !cam.matrixWorld) return false;
      var me = cam.matrixWorld.elements, eye = { x: me[12], y: me[13], z: me[14] };
      var dx = hp.x - eye.x, dy = hp.y - eye.y, dz = hp.z - eye.z;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(dist > 0.5)) return false;
      _pDir.x = dx / dist; _pDir.y = dy / dist; _pDir.z = dz / dist;
      return !g.cast(eye, _pDir, dist - 0.35);
    } catch (_) { return false; }
  }

  /* ---------- rig normalisation ---------- */

  var RIG_CACHE = new WeakMap();

  function normBone(name) {
    // "mixamorig:LEFT_UpperArm" / "Bone_L_UpperArm" / "bip01_head" -> canonical
    var s = String(name).toLowerCase();
    s = s.replace(/^.*:/, '');                    // drop namespace prefix
    s = s.replace(/^(bip\d*_|bone_|def_)/, '');   // drop rig prefixes
    s = s.replace(/[^a-z0-9]/g, '');               // drop separators
    s = s.replace(/^left/, 'l').replace(/^right/, 'r');
    return s;
  }

  function rigMap(by) {
    var cached = RIG_CACHE.get(by);
    if (cached) return cached;
    var map = new Map();
    var names = [];
    try {
      for (var k in by) {
        var v = by[k];
        if (!v || !v.matrixWorld) continue;
        map.set(normBone(k), v);
        if (names.length < 6) names.push(k);
      }
    } catch (_) {}
    RIG_CACHE.set(by, map);
    if (names.length && diag.boneNames.length === 0) diag.boneNames = names;
    return map;
  }

  function boneOf(by, name) {
    if (!by) return null;
    var map = rigMap(by);
    var direct = map.get(normBone(name));
    if (direct) return direct;
    // fall back to a contains-match: some rigs append "End"/"Node" suffixes
    var want = normBone(name);
    var found = null;
    map.forEach(function (v, k) {
      if (found) return;
      if (k === want || k.indexOf(want) === 0 || k.indexOf(want) !== -1) found = v;
    });
    return found;
  }

  /* ---------- Skeleton ESP ---------- */

  var BE = { on: 0, wrap: null, host: null, hostAt: 0, last: 0, range: 60 };
  var BONE_PAIRS = [
    ['Head', 'Neck'], ['Neck', 'Spine3'], ['Spine3', 'Spine2'], ['Spine2', 'Spine1'], ['Spine1', 'Pelvis'],
    ['Spine3', 'L_Clavicle'], ['L_Clavicle', 'L_UpperArm'], ['L_UpperArm', 'L_Forearm'], ['L_Forearm', 'L_Hand'],
    ['Spine3', 'R_Clavicle'], ['R_Clavicle', 'R_UpperArm'], ['R_UpperArm', 'R_Forearm'], ['R_Forearm', 'R_Hand'],
    ['Pelvis', 'L_Thigh'], ['L_Thigh', 'L_Calf'], ['L_Calf', 'L_Foot'],
    ['Pelvis', 'R_Thigh'], ['R_Thigh', 'R_Calf'], ['R_Calf', 'R_Foot']
  ];

  function beInit() {
    if (BE.wrap && BE.wrap.parentNode) return true;
    var host = document.body || document.documentElement;
    if (!host) return false;
    var w = document.createElement('canvas');
    w.setAttribute('data-pb', '1');
    w.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147482999';
    host.appendChild(w);
    BE.wrap = w;
    BE.ctx = w.getContext('2d');
    return true;
  }
  function beClear() { if (BE.ctx && BE.wrap) BE.ctx.clearRect(0, 0, BE.wrap.width, BE.wrap.height); }

  function beHost() {
    var now = performance.now();
    if (BE.host && BE.host.parentNode && now - BE.hostAt < 400) return BE.host;
    BE.hostAt = now;
    var best = null, ba = 0, cs = document.getElementsByTagName('canvas');
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (c.getAttribute('data-pb')) continue;
      var r = c.getBoundingClientRect(), a = r.width * r.height;
      if (a > ba) { ba = a; best = c; }
    }
    BE.host = best || null;
    return BE.host;
  }

  function beProject(cam, r, b, out) {
    if (!BE._v) { try { BE._v = cam.position.clone(); } catch (e) { return false; } }
    var e = b.matrixWorld.elements;
    var d = BE._v.set(e[12], e[13], e[14]).project(cam);
    if (!(d.z > -1 && d.z < 1)) return false;
    out.x = r.left + (d.x * 0.5 + 0.5) * r.width;
    out.y = r.top + (-d.y * 0.5 + 0.5) * r.height;
    return true;
  }

  function playerList(g) {
    if (!g) return null;
    var keys = ['bots', 'players', 'entities', 'botsList'];
    for (var i = 0; i < keys.length; i++) {
      var v = g[keys[i]];
      if (Array.isArray(v) && v.length) {
        if (diag.listKey !== keys[i]) { diag.listKey = keys[i]; }
        return v;
      }
    }
    return null;
  }

  function beDraw(g) {
    if (!BE.on) { beClear(); return; }
    var cam = g.camera, list = playerList(g), self = g.P && g.P.s;
    if (!list || !cam || !self || self.dead) { beClear(); return; }
    if (!beInit()) return;
    var host = beHost();
    if (!host) { beClear(); return; }
    var r = host.getBoundingClientRect();
    if (!(r.width > 0)) { beClear(); return; }
    var dpr = Math.min(2, devicePixelRatio || 1);
    var w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (BE.wrap.width !== w || BE.wrap.height !== h) { BE.wrap.width = w; BE.wrap.height = h; }
    var ctx = BE.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255,80,80,0.65)';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    var my = self.team;
    var me = cam.matrixWorld.elements;
    var cx = me[12], cy = me[13], cz = me[14];
    var pa = { x: 0, y: 0 }, pb = { x: 0, y: 0 };
    var drawn = 0, paired = 0;

    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || !p.obj || !p.c || p === self) continue;
      if (p.team === my) continue;
      if (p.dead || !(p.hp > 0)) continue;
      var mm = p.obj.matrixWorld && p.obj.matrixWorld.elements;
      if (!mm) continue;
      var dx = mm[12] - cx, dy = mm[13] - cy, dz = mm[14] - cz;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > BE.range) continue;
      var by = p.c.byName;
      if (!by) continue;
      for (var j = 0; j < BONE_PAIRS.length; j++) {
        var ba = boneOf(by, BONE_PAIRS[j][0]), bb = boneOf(by, BONE_PAIRS[j][1]);
        if (!ba || !bb) continue;
        paired++;
        if (!beProject(cam, r, ba, pa)) continue;
        if (!beProject(cam, r, bb, pb)) continue;
        if (pa.x < r.left - 200 || pa.x > r.left + r.width + 200) continue;
        if (pa.y < r.top - 200 || pa.y > r.top + r.height + 200) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        drawn++;
      }
    }
    diag.lines = drawn;
    diag.paired = paired;
  }

  /* ---------- Chams ---------- */

  var CH = { on: 0, visibleColor: '#ff5252', blockedColor: '#ffd43b', entries: [], at: 0, game: null };
  try {
    var savedVisibleColor = localStorage.getItem('pbweb_chams_visible_color') || localStorage.getItem('pbweb_chams_color');
    var savedBlockedColor = localStorage.getItem('pbweb_chams_blocked_color');
    if (/^#[0-9a-fA-F]{6}$/.test(savedVisibleColor || '')) CH.visibleColor = savedVisibleColor;
    if (/^#[0-9a-fA-F]{6}$/.test(savedBlockedColor || '')) CH.blockedColor = savedBlockedColor;
  } catch (e) {}

  function chDispose(entry) {
    try {
      entry.mesh.material = entry.material;
      entry.mesh.renderOrder = entry.renderOrder;
      entry.mesh.onBeforeRender = entry.prevOBR;
      var mats = Array.isArray(entry.chams) ? entry.chams : [entry.chams];
      for (var j = 0; j < mats.length; j++) if (mats[j] && mats[j].dispose) mats[j].dispose();
    } catch (e) {}
  }

  function chRestore() {
    for (var i = 0; i < CH.entries.length; i++) chDispose(CH.entries[i]);
    CH.entries = [];
    CH.game = null;
    diag.chamsMeshes = 0;
  }

  function chMaterial(source, color) {
    if (!source || typeof source.clone !== 'function') return source;
    var mat = source.clone();
    if (mat.color && mat.color.set) mat.color.set(color);
    if (mat.emissive && mat.emissive.set) mat.emissive.set(color);
    if (typeof mat.emissiveIntensity === 'number') mat.emissiveIntensity = 0.35;
    mat.depthTest = true;
    mat.depthFunc = 3;
    mat.depthWrite = false;
    mat.transparent = false;
    mat.needsUpdate = true;
    return mat;
  }

  CH.clearAt = 0;
  function chDepthClear(renderer) {
    try {
      var now = performance.now();
      if (now - CH.clearAt < 4) return;
      CH.clearAt = now;
      renderer.clearDepth();
    } catch (e) {}
  }

  function chTint(material, color) {
    var mats = Array.isArray(material) ? material : [material];
    for (var i = 0; i < mats.length; i++) {
      var mat = mats[i];
      if (mat && mat.color && mat.color.set) mat.color.set(color);
      if (mat && mat.emissive && mat.emissive.set) mat.emissive.set(color);
    }
  }

  function chPartVisible(g, mesh, fallback) {
    try {
      if (!CH.point) CH.point = g.camera.position.clone();
      if (mesh.geometry && mesh.geometry.boundingSphere === null && mesh.geometry.computeBoundingSphere) mesh.geometry.computeBoundingSphere();
      var center = mesh.geometry && mesh.geometry.boundingSphere && mesh.geometry.boundingSphere.center;
      if (center && mesh.localToWorld) CH.point.copy(center); else CH.point.set(0, 0, 0);
      if (mesh.localToWorld) mesh.localToWorld(CH.point);
      else if (mesh.getWorldPosition) mesh.getWorldPosition(CH.point);
      else return fallback;
      return hasLineOfSight(g, g.camera, CH.point);
    } catch (e) { return fallback; }
  }

  function chTick(g) {
    if (!CH.on || !g || !g.P || !g.P.s) { if (CH.entries.length) chRestore(); return; }
    var list = playerList(g);
    if (!list) { if (CH.entries.length) chRestore(); return; }
    var now = performance.now();
    if (now < CH.at) return;
    CH.at = now + 300;
    if (CH.game && CH.game !== g) chRestore();
    CH.game = g;

    var active = new Set();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || p === g.P.s || p.team === g.P.s.team || p.dead || !(p.hp > 0) || !p.obj || !p.obj.traverse) continue;
      var head = headPoint(p);
      var headVisible = !!(head && hasLineOfSight(g, g.camera, head));
      p.obj.traverse(function (mesh) {
        if (!mesh || !mesh.isMesh || !mesh.material) return;
        var color = chPartVisible(g, mesh, headVisible) ? CH.visibleColor : CH.blockedColor;
        active.add(mesh);
        for (var k = 0; k < CH.entries.length; k++) {
          if (CH.entries[k].mesh !== mesh) continue;
          if (CH.entries[k].color !== color) { chTint(CH.entries[k].chams, color); CH.entries[k].color = color; }
          return;
        }
        try {
          var original = mesh.material;
          var tinted = Array.isArray(original)
            ? original.map(function (mat) { return chMaterial(mat, color); })
            : chMaterial(original, color);
          if (tinted === original) return;
          CH.entries.push({ mesh: mesh, material: original, chams: tinted, renderOrder: mesh.renderOrder, prevOBR: mesh.onBeforeRender, color: color });
          mesh.material = tinted;
          mesh.renderOrder = 500;
          mesh.onBeforeRender = chDepthClear;
        } catch (e) {}
      });
    }
    for (var n = CH.entries.length - 1; n >= 0; n--) {
      if (active.has(CH.entries[n].mesh)) continue;
      chDispose(CH.entries[n]);
      CH.entries.splice(n, 1);
    }
    diag.chamsMeshes = CH.entries.length;
  }

  function chColor(kind, value) {
    var key = kind === 'blocked' ? 'blockedColor' : 'visibleColor';
    if (!/^#[0-9a-fA-F]{6}$/.test(value || '')) return CH[key];
    var old = CH[key];
    CH[key] = value.toLowerCase();
    for (var i = 0; i < CH.entries.length; i++) {
      if (CH.entries[i].color !== old) continue;
      chTint(CH.entries[i].chams, CH[key]);
      CH.entries[i].color = CH[key];
    }
    try { localStorage.setItem('pbweb_chams_' + kind + '_color', CH[key]); } catch (e) {}
    return CH[key];
  }

  /* ---------- panel ---------- */

  const panel = document.createElement('div');
  panel.setAttribute('data-pb', '1');
  panel.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483001;background:#171717;color:#eee;border:1px solid #555;border-radius:8px;padding:10px 12px;font:12px system-ui,sans-serif;box-shadow:0 8px 24px #0008;min-width:200px';
  panel.innerHTML =
    '<div style="font-weight:700;margin-bottom:9px">Visual <span id="pb-diag" style="font-weight:400;color:#8ad">…</span></div>' +
    '<label style="display:flex;justify-content:space-between;gap:12px">Skeleton <input type="checkbox" data-control="bone"></label>' +
    '<label style="display:flex;justify-content:space-between;gap:12px;margin-top:9px">Chams <input type="checkbox" data-control="chams"></label>' +
    '<label style="display:block;margin-top:9px">Jarak Skeleton <input type="range" min="20" max="120" step="5" value="60" data-control="range"></label>' +
    '<div style="display:flex;gap:6px;margin-top:9px">' +
    '<input type="color" value="#ff5252" title="Terlihat" data-control="visible">' +
    '<input type="color" value="#ffd43b" title="Terhalang" data-control="blocked"></div>';

  const boneInput = panel.querySelector('[data-control="bone"]');
  const chamsInput = panel.querySelector('[data-control="chams"]');
  const rangeInput = panel.querySelector('[data-control="range"]');
  const visibleInput = panel.querySelector('[data-control="visible"]');
  const blockedInput = panel.querySelector('[data-control="blocked"]');
  const diagEl = panel.querySelector('#pb-diag');
  visibleInput.value = CH.visibleColor;
  blockedInput.value = CH.blockedColor;

  boneInput.addEventListener('change', () => { BE.on = boneInput.checked ? 1 : 0; if (!BE.on) beClear(); });
  chamsInput.addEventListener('change', () => { CH.on = chamsInput.checked ? 1 : 0; if (!CH.on) chRestore(); });
  rangeInput.addEventListener('input', () => { BE.range = Number(rangeInput.value); });
  visibleInput.addEventListener('input', () => chColor('visible', visibleInput.value));
  blockedInput.addEventListener('input', () => chColor('blocked', blockedInput.value));

  function mount() {
    const host = document.body || document.documentElement;
    if (!host) return setTimeout(mount, 50);
    host.appendChild(panel);
  }
  mount();

  let tick = 0;
  function frame() {
    requestAnimationFrame(frame);
    const g = window.G;
    if (g) { diag.gSeen++; diag.gAt = Date.now(); }
    if (BE.on) { try { if (g) beDraw(g); else beClear(); } catch (_) { beClear(); } }
    if (CH.on) { try { chTick(g); } catch (_) { chRestore(); } }

    if ((tick++ % 30) === 0) {
      const list = g ? playerList(g) : null;
      diag.players = list ? list.length : 0;
      const st = window.__pbStealth;
      diagEl.textContent = !g ? 'G:—' :
        'G:ok · p' + diag.players + ' · b' + diag.paired + (st && st.installed ? ' · ws' + st.blocked : ' · ws—');
      diagEl.title =
        'G=' + (g ? 'yes' : 'no') +
        '\nlist=' + (diag.listKey || '-') +
        '\nbones=' + (diag.boneNames.join(',') || '-') +
        '\nstealth=' + (st ? st.version + ' blocked=' + st.blocked : 'off');
    }
  }
  requestAnimationFrame(frame);
})();
