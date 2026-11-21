'use strict';

/*
 * PemburuHS Stealth Layer — v1.3.0 (fixed)
 *
 * Runs in the page's MAIN world at document_start, before any game script.
 *
 * FIXES vs 1.2.0
 *  1. Binary frames are inspected too. The old guard returned early for
 *     anything that was not a string, so a build that talks over ArrayBuffer /
 *     typed arrays reported acflag freely while the layer looked installed.
 *  2. Moar encodings: "acflag", "ac\u0066lag", "ac\x66lag", plus the case where
 *     the scanner sends the field name as a bare token without quotes.
 *  3. Everything it sees is counted in window.__pbStealth.diag so the panel can
 *     show whether the hook is live and how many reports it ate.
 *
 * Nothing here overrides toString, JSON, Storage, rAF, WebGL or the 2D canvas.
 * No game function is patched by name, so bundle updates do not break it.
 *
 * What it does NOT do: forge server-validated claims. The server owns HP,
 * positions and hit validation; a forged "hit" is detected and banned.
 */

(function () {
  if (window.__pbStealth) return;

  var state = {
    installed: false,
    blocked: 0,
    lastBlockedAt: 0,
    flags: {},
    lastFlag: null,
    hits: { count: 0, last: null },
    diag: { strings: 0, buffers: 0, blobs: 0, uninspected: 0 },
    version: '1.3.0',
    needsReload: false      // set when a Blob payload could not be read synchronously
  };
  window.__pbStealth = state;

  try {
    var q = new URLSearchParams(location.search);
    var wp = q.get('weapon');
    if (wp) state.matchWeapon = wp;
    var own = q.get('own');
    if (own !== null) state.matchOwn = own.split(',').filter(Boolean).length;
  } catch (e) {}

  var NATIVE_SEND = null;
  var dec = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8', { fatal: false }) : null;

  /* Cheap byte scan: does this buffer contain the ASCII "acflag" or the
     escaped forms, without allocating a string for every frame? */
  function bufferHasFlag(buf) {
    var n = buf.length;
    if (n < 8 || n > 1 << 20) return false;
    /* match on the leading "ac" and require "lag" within 12 bytes */
    for (var i = 0; i + 1 < n; i++) {
      if (buf[i] !== 0x61 || buf[i + 1] !== 0x63) continue;   // 'a' 'c'
      var end = Math.min(n - 3, i + 16);
      for (var j = i + 2; j + 2 < end; j++) {
        if (buf[j] === 0x6c && buf[j + 1] === 0x61 && buf[j + 2] === 0x67) return true; // 'l' 'a' 'g'
      }
    }
    return false;
  }

  function isAcString(data) {
    if (data.length < 8) return false;
    if (data.indexOf('acflag') !== -1) return true;
    if (data.indexOf('ac\\u0066lag') !== -1) return true;
    if (data.indexOf('ac\\x66lag') !== -1) return true;
    if (data.indexOf('ac\\u{66}lag') !== -1) return true;
    return /ac(?:\\u0066|\\x66)lag/i.test(data);
  }

  function toBytes(payload) {
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
    if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    return null;
  }

  function noteFlag(data) {
    state.blocked++;
    state.lastBlockedAt = Date.now();
    try {
      var msg = typeof data === 'string' ? JSON.parse(data) : null;
      var kind = (msg && msg.k) || 'unknown';
      state.flags[kind] = (state.flags[kind] || 0) + 1;
      state.lastFlag = { k: kind, d: (msg && msg.d) || '', at: Date.now() };
    } catch (e) {
      state.lastFlag = { k: 'unparsed', d: String(data).slice(0, 160), at: Date.now() };
    }
  }

  function gameState() {
    try { return window.G || null; } catch (e) { return null; }
  }

  function hitDistance(msg) {
    try {
      var G = gameState();
      var me = G && G.P && G.P.s && G.P.s.mover && G.P.s.mover.pos;
      var victim = null;
      if (G && G.bots) {
        for (var i = 0; i < G.bots.length; i++) {
          if (G.bots[i] && G.bots[i].id === msg.target) { victim = G.bots[i]; break; }
        }
      }
      var tv = victim && victim.mover && victim.mover.pos;
      if (!me || !tv) return -1;
      var dx = tv.x - me.x, dy = tv.y - me.y, dz = tv.z - me.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    } catch (e) { return -1; }
  }

  function recordHit(data) {
    if (typeof data !== 'string' || data.indexOf('"t":"hit"') === -1) return;
    try {
      var msg = JSON.parse(data);
      if (!msg || msg.t !== 'hit') return;
      var dist = hitDistance(msg);
      state.hits.count++;
      state.hits.last = {
        at: Date.now(), target: msg.target, dmg: msg.dmg, w: msg.w,
        head: !!msg.head, dist: dist >= 0 ? Math.round(dist * 10) / 10 : undefined
      };
    } catch (e) {}
  }

  function inspect(payload) {
    // returns true when the frame must be dropped
    if (typeof payload === 'string') {
      state.diag.strings++;
      if (isAcString(payload)) { noteFlag(payload); return true; }
      recordHit(payload);
      return false;
    }
    var bytes = toBytes(payload);
    if (bytes) {
      state.diag.buffers++;
      if (bufferHasFlag(bytes)) {
        noteFlag(dec ? dec.decode(bytes.subarray(0, Math.min(bytes.length, 4096))) : 'acflag');
        return true;
      }
      return false;
    }
    if (typeof Blob !== 'undefined' && payload instanceof Blob) {
      state.diag.blobs++;
      // A Blob cannot be read synchronously on the main thread. Flag it so the
      // panel can say the frame went out unread instead of pretending it was clear.
      state.diag.uninspected++;
      state.needsReload = true;
      return false;
    }
    return false;
  }

  function install() {
    var WS = window.WebSocket;
    if (!WS || !WS.prototype) return false;
    var proto = WS.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'send');
    if (!desc || typeof desc.value !== 'function') return false;
    if (desc.value.__pbSendGuard) { state.installed = true; return true; }
    NATIVE_SEND = desc.value;
    var guard = new Proxy(NATIVE_SEND, {
      apply: function (target, thisArg, args) {
        try {
          if (inspect(args[0])) return undefined;   // dropped silently
        } catch (e) {}
        return Reflect.apply(target, thisArg, args);
      }
    });
    Object.defineProperty(guard, '__pbSendGuard', { value: true });
    Object.defineProperty(proto, 'send', {
      value: guard, writable: true, enumerable: desc.enumerable, configurable: true
    });
    state.installed = true;
    return true;
  }

  if (!install()) {
    var tries = 0;
    var timer = setInterval(function () {
      if (install() || ++tries > 100) clearInterval(timer);
    }, 10);
  }
})();
