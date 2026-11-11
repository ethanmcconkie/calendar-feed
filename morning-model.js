/* V6-1 §2-4: the morning's model, pure (no DOM). Loaded in <head> so index.html can put the painting up before the big
   scripts (the view must be on screen in under 1 s); morning.js draws from it; launcher/dev/morning-test.js checks it.
   Data: Home Base's cached calendar (hb.cal.last, as Grind's day() reads it) and today's changes over it (the helper's
   today-only record, cal_today.py, kept here as hb.cal.today). Nothing else, nothing made up.
     window.MorningModel.day(cal, date)            today's timed blocks (the keyed ones, as Grind), minutes after midnight
     window.MorningModel.resolve(blocks, ev)       the one rule (the same as cal_today.resolve; launcher/dev/morning-cases.json)
     window.MorningModel.model(cal, date, nowMin, rec)   the line: window, items (blocks + free gaps), current, dot, min left
     window.MorningModel.open(cal, date, nowMin, rec, away)   does the morning view show now?
     window.MorningModel.plan(date)                  the day's plan (Sunday, brief 11-07): the one place the day decides
     window.MorningModel.hold(cal, date, nowMin, rec, fired)   a Grind morning: Grind until Work, the Library for Study */
(function () {
  'use strict';
  var X = 140, W = 1640, TAIL = 220, Y = 1000;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function minsOf(d) { return d.getHours() * 60 + d.getMinutes(); }
  function atMin(s) { var m = /^(\d\d?):(\d\d)$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; }
  function hm(m) { var h = Math.floor(m / 60) % 24; return (((h + 11) % 12) + 1) + ':' + pad(m % 60); }
  // an event's id; without one, its title plus its start (the helper uses the same)
  function idOf(e) { return e.id ? String(e.id) : String(e.title || '') + '@' + String(e.start || ''); }

  // today's timed events from the cache, as Grind's day(): the kinds' blocks (they carry a key); none keyed: all of them
  function day(cal, d) {
    if (!cal || !Array.isArray(cal.events)) return null;
    var t = ymd(d);
    var evs = cal.events.filter(function (e) { return e && !e.allDay && e.start && ymd(new Date(e.start)) === t; }).map(function (e) {
      var st = new Date(e.start), en = new Date(e.end || e.start), s = minsOf(st);
      return { id: idOf(e), title: String(e.title || ''), key: e.key || null, s: s, e: Math.max(s + 1, ymd(en) === t ? minsOf(en) : 1440) };
    }).sort(function (x, y) { return x.s - y.s || y.e - x.e; });
    var keyed = evs.filter(function (e) { return e.key; });
    return keyed.length ? keyed : evs;
  }
  // 11-09: when alarm a rings on day d, in minutes, or null: that date's one-morning change (a.moves {"YYYY-MM-DD":
  // "HH:MM" | "off"}, the Mac's alarm_day.py) over its days. Its on/off isn't looked at here.
  function ringAt(a, d) {
    if (!a) return null;
    var mv = a.moves && a.moves[ymd(d)];
    if (mv === 'off') return null;
    if (mv) return atMin(mv);
    var dn = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()], days = a.days && a.days.length ? a.days : null;
    return !days || days.indexOf(dn) >= 0 ? atMin(a.at) : null;
  }
  function alarmAt(cal, d) {
    var al = ((cal && cal.alarms) || []).filter(function (a) { return a && a.on !== false; }).map(function (a) { return ringAt(a, d); })
      .filter(function (m) { return m != null && m < 720; }).sort(function (x, y) { return x - y; });
    return al.length ? al[0] : null;
  }

  // the one rule (V6-Rules): only the block you touch moves; a gap it leaves goes free; a neighbour it lands on gives
  // up the overlap (covered whole: gone for today); between two changed blocks the later touch wins. ev's keys are in
  // the order they were touched.
  function trim(x, by) {
    if (x.e <= by.s || x.s >= by.e) return x;
    if (by.s <= x.s && x.e <= by.e) return null;
    var y = Object.assign({}, x);
    if (x.s < by.s) y.e = by.s; else y.s = by.e;
    return y;
  }
  function resolve(blocks, ev) {
    ev = ev || {};
    var order = Object.keys(ev), changed = [], rest = [];
    blocks.forEach(function (b) {
      var c = ev[b.id];
      if (c && c.skip) return;
      if (c) changed.push(Object.assign({}, b, { s: c.s, e: c.e, moved: true, _n: order.indexOf(b.id) }));
      else rest.push(Object.assign({}, b));
    });
    changed.sort(function (a, b) { return a._n - b._n; });
    var won = [];
    changed.forEach(function (b) { won = won.map(function (x) { return trim(x, b); }).filter(Boolean); won.push(b); });
    won.forEach(function (b) { rest = rest.map(function (x) { return trim(x, b); }).filter(Boolean); });
    return won.concat(rest).sort(function (a, b) { return a.s - b.s || b.e - a.e; }).map(function (b) { delete b._n; return b; });
  }

  // 11-10: what ends the morning is one rule, the screens table's (screens.js): the first block whose screen is Home
  // ("work=h" by default; his own picks and Muse's through the pref `screens`), or any block in the Work block calendar.
  // It was "the first block 120 min or longer", a guess: with Work missing from the feed (11-06 to 11-10) the line ran
  // to 12:00 and the 9:00 Viajes bar crossed the screen. The line, Grind's hold and the screens all read this.
  function ends(b) {
    if (!b || b.free) return false;
    if (b.key === 'work') return true;
    var S = window.HBScreens, t = String(b.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (S && S.screenFor) return S.screenFor(b.title) === 'h';
    // before screens.js has loaded (index.html paints the morning first): his pick for this title from the same pref
    var p = read('hb.prefs'), own = null;
    String(p && typeof p.screens === 'string' ? p.screens : '').split('|').forEach(function (kv) {
      var i = kv.lastIndexOf('='); if (i > 0 && kv.slice(0, i).trim().toLowerCase().replace(/\s+/g, ' ') === t) own = kv.slice(i + 1);
    });
    return own != null ? own === 'h' : t === 'work';
  }
  // the line (§3): from the block on at the alarm (Grind's hand-over), else the first keyed block after 5:00, to the
  // anchor (the block that ends the morning: ends(), Work), else the last morning block's end (to 12:00 at most). Gaps of 5 min or more are free (dashed, a "+").
  // The day's plan says how far it reaches (plan().line): 'morning' to 12:00 as above; 'day' (Sunday, Ethan 11-08 noon:
  // "let's have the calendar up too on here") the same line over the whole day, to the anchor else the last block's end.
  function model(cal, d, now, rec) {
    var raw = day(cal, d);
    if (!raw || !raw.length) return null;
    var END = plan(d).line === 'day' ? 1440 : NOON;
    var al = alarmAt(cal, d);
    var F = (al != null && raw.filter(function (b) { return b.s <= al && al < b.e; })[0]) || raw.filter(function (b) { return b.s >= 300; })[0];
    if (!F || F.s >= END) return null;
    var ev = rec && rec.date === ymd(d) && rec.ev && typeof rec.ev === 'object' ? rec.ev : {};
    var res = resolve(raw, ev), Fr = res.filter(function (b) { return b.id === F.id; })[0];
    var from = Math.min(F.s, Fr ? Fr.s : F.s);
    var after = res.filter(function (b) { return b.s >= from; });
    var anchor = after.filter(function (b) { return b.s < END && ends(b); })[0] || null;
    var to = anchor ? anchor.s : Math.min(END, Math.max.apply(null, after.filter(function (b) { return b.s < END; }).map(function (b) { return b.e; })));
    if (to <= from) return null;
    var items = [], t = from;
    after.forEach(function (b) {
      if (b === anchor || b.s >= to) return;
      // 11-10: a block wholly inside one already on the line (Wake up 6:30-6:35 in Get ready 6:30-6:45) isn't its own
      // bead: two icons and two labels on the same spot read as one dark, doubled label
      if (items.length && b.e <= t && items.some(function (x) { return !x.free && x.s <= b.s && b.e <= x.e; })) return;
      if (items.length && b.s - t >= 5) items.push({ free: true, id: 'free@' + t, title: 'Free', key: null, s: t, e: b.s });
      items.push(b); t = Math.max(t, b.e);
    });
    if (anchor) {
      if (items.length && anchor.s - t >= 5) items.push({ free: true, id: 'free@' + t, title: 'Free', key: null, s: t, e: anchor.s });
      items.push(Object.assign({ anchor: true }, anchor));
    }
    if (!items.length) return null;
    var K = (W - TAIL) / (to - from), hx = function (m) { return X + (Math.min(m, to) - from) * K; };
    items.forEach(function (it, i) {
      it.x = it.anchor ? X + W - TAIL : hx(it.s);
      it.done = !it.free && it.e <= now;
      it.cur = !it.free && !it.anchor && it.s <= now && now < it.e;
    });
    var ci = -1; items.forEach(function (it, i) { if (it.cur && ci < 0) ci = i; });
    if (ci < 0) items.forEach(function (it, i) { if (it.free && it.s <= now && now < it.e && ci < 0) ci = i; });   // in a free gap: the dot rides it, nothing is named
    var cur = ci >= 0 ? items[ci] : null, next = cur ? items[ci + 1] || null : null;
    return { from: from, to: to, items: items, ci: ci, cur: cur, next: next, anchor: anchor, now: now, X: X, W: W, TAIL: TAIL, Y: Y, K: K, hx: hx, raw: raw, ev: ev,
      left: cur && !cur.free && next ? cur.e - now : null };
  }
  // the day's plan (brief 11-07, Ethan: "the scripture thing on all day on Sunday. No grind mode when I wake up, even if
  // there's an alarm... at least until noon"; 11-08 noon: "after 12 p.m., the screensaver of Jesus Christ stays. But the
  // scripture leaves. And then the app dock comes up and stays up unless I press the F3"). The one place the day decides;
  // the Mac's half is mac-helper/day_plan.py, the same rule, both checked against launcher/dev/sunday-cases.json.
  //   home   'scripture': the Scripture/Morning view is Home from 00:00 to 24:00, blocks or none, one screen all day
  //          (Back and Home never leave it); 'week': its own hours
  //   dock   how the screen stands by itself: 'down' the verse, Open library and the line (F3 / Down: the dock up over
  //          it); 'up' (Sunday from 12:00) the painting with the dock up, the verse gone (F3 / Down: the verse, Open
  //          library and the line back; again: the dock). Taken at each change (a boot, a reload, 12:00, a new date)
  //   line   how far the line reaches: 'morning' (to 12:00 as above) or 'day' (Sunday: the whole day)
  //   grind  may an alarm open Grind today (Sunday: no; the Mac rings it the gentle way, onto Scripture)
  // Monday 00:00 is a new date: the week's plan again, nothing carried over.
  var NOON = 720;
  function plan(d) {
    var sun = d.getDay() === 0;
    return { day: sun ? 'sunday' : 'week', home: sun ? 'scripture' : 'week', dock: sun && minsOf(d) >= NOON ? 'up' : 'down', line: sun ? 'day' : 'morning', grind: !sun };
  }
  // does the morning view show now? From the line's first block to its anchor (12:00 without one), with blocks today;
  // not while he's sent it away (Back on it: the usual Home until the next block starts). Sunday (plan): all day, never
  // sent away
  function open(cal, d, now, rec, away) {
    var p = plan(d);
    if (p.home === 'scripture') return true;
    var m = model(cal, d, now, rec);
    if (!m || now < m.from || now >= m.to) return false;
    if (away && away.date === ymd(d) && now < away.until) return false;
    return true;
  }
  // grind -> study -> grind (11-08, Ethan): on a weekday whose Grind alarm rang (fired: hb.grind.fired {date}, written by
  // grind.js at the ring), from then until Work (the line's anchor) Grind's "you're up" stays the morning screen, except
  // while the Study block is on (the spirit calendar, titled Study): then the Library at his place. -> null (not this
  // morning, no Work on the line, or Work has started), else {until: Work's start, study: the Study block on now | null}
  function hold(cal, d, now, rec, fired) {
    var p = plan(d);
    if (!p.grind || d.getDay() === 6 || !fired || fired.date !== ymd(d)) return null;
    var m = model(cal, d, now, rec);
    if (!m || !m.anchor || now >= m.anchor.s) return null;
    var study = m.items.filter(function (b) { return !b.free && b.key === 'spirit' && /\bstudy\b/i.test(b.title) && b.s <= now && now < b.e; })[0] || null;
    return { until: m.anchor.s, study: study };
  }
  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }

  window.MorningModel = { day: day, resolve: resolve, model: model, open: open, plan: plan, hold: hold, ends: ends, alarmAt: alarmAt, ringAt: ringAt, hm: hm, ymd: ymd, minsOf: minsOf, idOf: idOf, read: read, X: X, W: W, TAIL: TAIL, Y: Y };
})();
