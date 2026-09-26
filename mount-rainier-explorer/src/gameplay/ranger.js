import { pick } from './jev.js';
import { RANGER_LINES, RANGER_REPLIES } from '../data/ranger.js';
import { GENERIC_LINES } from '../data/radio.js';
import { radioStatic } from '../audio.js';

const $ = (id) => document.getElementById(id);
const FT = 3.28084;

// Time-of-day targets the ranger can skip to. Hours are solved from the sun
// model (so "sunset" is right in any season); `h` is used when there's no sun.
const TIMES = {
  keep: { label: 'as it is', desc: 'No change to the time of day is asked for.' },
  sunrise: { label: 'sunrise', el: 1, am: true, desc: 'Dawn or sunrise.' },
  morning: { label: 'mid-morning', h: 9.5, desc: 'Morning, after sunrise.' },
  midday: { label: 'midday', h: 13.1, desc: 'Noon or the middle of the day.' },
  afternoon: { label: 'afternoon', h: 15.5, desc: 'Afternoon.' },
  golden_hour: { label: 'golden hour', el: 8, am: false, desc: 'Golden hour, the warm light an hour or so before sunset.' },
  sunset: { label: 'sunset', el: 0, am: false, desc: 'Sunset.' },
  dusk: { label: 'dusk', el: -5, am: false, desc: 'Dusk or twilight, alpenglow after sunset.' },
  night: { label: 'night', h: 22.5, desc: 'Night, dark sky, stars.' },
};
const SEASONS = {
  keep: 'No change of season is asked for.',
  summer: 'Summer: wildflowers, green meadows.',
  autumn: 'Autumn: fall colour, red huckleberry.',
  winter: 'Winter: snow everywhere.',
};
const GEAR = {
  none: 'No piece of gear is mentioned.',
  map: 'The map.',
  compass: 'The compass.',
  radio: 'The radio or music.',
  camera: 'The camera or taking photos.',
  binoculars: 'Binoculars, looking at something far away.',
  flashlight: 'The flashlight, headlamp, or light.',
  poles: 'Trekking poles.',
};
const INTENTS = {
  travel: 'The hiker wants to go (be taken) somewhere now: a named place or a kind of place ("a lake", "the lookout", "take me there").',
  recommend: 'The hiker asks for a suggestion or advice on where to go or what to see, without asking to be moved yet.',
  set_time: 'The hiker wants to change the time of day or skip ahead (to sunrise, sunset, night...) without going anywhere.',
  set_season: 'The hiker wants a different season (summer wildflowers, autumn colour, winter snow).',
  camp: 'The hiker wants to make camp, rest, cook, eat or sleep.',
  stargaze: 'The hiker wants to look at the stars or the night sky.',
  gear: 'The hiker wants to use, hold or switch to a piece of gear (map, compass, camera, binoculars, flashlight, poles, radio).',
  info: 'The hiker asks where they are, what they are looking at, or for facts about a place.',
  chitchat: 'Greeting, thanks, small talk, a joke, or anything else.',
};
const REPLIES = {
  greeting: 'Hello, radio check, are you there.',
  thanks: 'Thanks or appreciation.',
  how_are_you: 'Asking how the ranger is doing.',
  joke: 'Asking for a joke or something fun.',
  weather: 'Asking about the weather or forecast.',
  goodbye: 'Signing off, goodbye.',
  compliment: 'Praising the ranger or the park.',
  other: 'Anything else.',
};

/**
 * The ranger on the other end of the radio, powered by Jev when the player
 * has added a key:
 *   - command(): the hiker radios a request in plain words; one Jev call turns
 *     it into typed game actions (intent, destination, time, season, gear).
 *   - update(): watches the game state and, at quiet moments or after
 *     something happens, asks Jev whether to speak and which hand-written
 *     line fits right now.
 * Without a key the radio behaves as before.
 */
export class Ranger {
  constructor({ jev, game, atmo, hf, paths, lakes, falls, places, controller, travel, setSeason, isAuto }) {
    Object.assign(this, { jev, game, atmo, hf, paths, lakes, falls, places, controller, travel, setSeason });
    this.isAuto = isAuto || (() => true);
    this.said = new Set();
    this.events = [];          // { t, text }
    this.clock = 0;            // game seconds since start
    this.lastSpoke = -60;      // game seconds
    this.lastAsk = -999;
    this.busy = false;
    this.sampleT = 0;
    this.prev = null;
    this.lastRec = null;       // the place the ranger last suggested
    this.placeCriteria = { none: 'No particular place is asked about or implied.' };
    for (const p of places) {
      this.placeCriteria[p.id] = `${p.name}: ${p.kind} in ${p.regionLabel}, ${p.ft.toLocaleString()} ft. ${p.text || ''}`.slice(0, 420);
    }
    this._ui();
  }

  // --- context -------------------------------------------------------------------
  _nearest() {
    const c = this.controller.pos;
    let best = null, bd = Infinity;
    for (const p of this.places) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < bd) { bd = d; best = p; }
    }
    return { place: best, dist: bd };
  }

  _phase() {
    const A = this.atmo, el = A.sunElevation, pm = A.hours >= 12;
    if (el < -8) return pm || A.hours < 3 ? 'night' : 'before dawn';
    if (el < -1) return pm ? 'dusk, just after sunset' : 'dawn twilight';
    if (el < 3) return pm ? 'sunset' : 'sunrise';
    if (el < 12) return pm ? 'golden hour' : 'early morning';
    if (el < 30) return pm ? 'afternoon' : 'morning';
    return 'midday';
  }

  _state() {
    const c = this.controller, g = this.game, hf = this.hf, A = this.atmo;
    const { place, dist } = this._nearest();
    const x = c.pos.x, z = c.pos.z;
    const trail = this.paths.nearest(x, z, 3, ['trail', 'road']);
    const stream = this.paths.nearest(x, z, 60, ['stream']);
    const fall = this.falls?.nearest?.(x, z);
    const lake = this.lakes?.nearestLake?.(x, z, 400);
    const ft = Math.round(c.pos.y * FT);
    return {
      location: dist < 1500 ? `${place.name} (${Math.round(dist)} m away)` : `${place.regionLabel}, ${(dist / 1000).toFixed(1)} km from ${place.name}`,
      region: place.regionLabel,
      elevation_ft: ft,
      terrain: [
        trail ? `on the ${trail.line.name || (trail.line.type === 'road' ? 'road' : 'trail')}` : 'off trail',
        hf.forestAt(x, z) > 0.4 ? 'in forest' : hf.meadowAt(x, z) > 0.3 ? 'in open meadow' : 'on open rock',
        hf.snowAt(x, z) > 0.45 ? 'on snow or glacier' : '',
        ft > 6500 ? 'above treeline' : '',
        fall && fall.dist < 400 ? `near ${fall.fall.name || 'a waterfall'}` : '',
        lake ? 'by an alpine lake' : stream ? 'by a creek' : '',
      ].filter(Boolean).join(', '),
      time: `${A.clockString()}, ${this._phase()}`,
      season: A.season,
      hiker: {
        energy_percent: Math.round(g.energy),
        activity: c.stargaze ? 'lying back stargazing' : c.speed > 5 ? 'running' : c.speed > 0.8 ? 'walking' : 'standing still',
        holding: g.item,
        flashlight_on: !!g.flashOn,
      },
      camp: this.game.camp.active ? `camp pitched ${Math.round(this.game.camp.distanceTo(c.pos))} m away, fire ${this.game.camp.fireOn ? 'lit' : 'out'}${this.game.camp.cooking ? ', something cooking' : ''}` : 'no camp',
    };
  }

  _event(text) {
    this.events.push({ t: this.clock, text });
    if (this.events.length > 12) this.events.shift();
  }

  /** Turn state changes into short events the chatter can react to. */
  _sample() {
    const c = this.controller, g = this.game;
    const s = {
      phase: this._phase(),
      camp: g.camp.active,
      fire: g.camp.active && g.camp.fireOn,
      tired: g.energy < 30,
      exhausted: g.energy < 15,
      stars: c.stargaze,
      high: c.pos.y * FT > 8000,
      snow: this.hf.snowAt(c.pos.x, c.pos.z) > 0.45,
    };
    const p = this.prev;
    if (p) {
      if (s.phase !== p.phase) this._event(`the light changed: it is now ${s.phase}`);
      if (s.camp && !p.camp) this._event('the hiker just made camp');
      if (s.fire && !p.fire) this._event('the hiker lit the campfire');
      if (s.tired && !p.tired) this._event('the hiker is getting tired (energy under 30%)');
      if (s.exhausted && !p.exhausted) this._event('the hiker is exhausted (energy under 15%)');
      if (s.stars && !p.stars) this._event('the hiker lay back to stargaze');
      if (s.high && !p.high) this._event('the hiker climbed above 8,000 ft');
      if (s.snow && !p.snow) this._event('the hiker stepped onto snow or glacier');
    }
    this.prev = s;
  }

  onDiscover(p) { this._event(`the hiker arrived at ${p.name}`); this.lastSpoke = this.clock; }

  // --- situational chatter ---------------------------------------------------------
  update(dt) {
    this.clock += dt;
    this.sampleT -= dt;
    if (this.sampleT <= 0) { this.sampleT = 2; this._sample(); }
    if (!this.jev.enabled || !this.isAuto() || this.busy) return;
    const since = this.clock - this.lastSpoke, sinceAsk = this.clock - this.lastAsk;
    const fresh = this.events.some((e) => e.t > this.lastAsk && e.t > this.clock - 30);
    // ask after something happens, or now and then when it has been quiet
    if ((fresh && since > 25 && sinceAsk > 12) || (since > 100 && sinceAsk > 45)) this._chatter();
  }

  async _chatter() {
    if (this.game.subTimer > 0) return;
    const options = RANGER_LINES.filter((l) => !this.said.has(l.id));
    if (options.length < 2) { this.said.clear(); return; }
    this.busy = true;
    this.lastAsk = this.clock;
    const recent = this.events.filter((e) => e.t > this.clock - 300).map((e) => `${Math.round((this.clock - e.t) / 60)} min ago: ${e.text}`);
    try {
      const a = await this.jev.decide(
        { ...this._state(), recent_events: recent.length ? recent : ['nothing notable'], minutes_since_ranger_last_spoke: Math.round((this.clock - this.lastSpoke) / 6) / 10 },
        {
          speak: {
            type: 'noul',
            instructions: 'A friendly park ranger keeps an eye on this hiker over the radio but only speaks now and then. Would the ranger radio the hiker right now?',
            criteria: {
              true: 'Something just happened, or the moment clearly suits a short relevant remark (a view, the light, fatigue, night, safety), and the ranger has not spoken in a while.',
              false: 'Nothing notable is going on, the ranger spoke recently, or a remark would feel random.',
            },
          },
          line: {
            type: 'choice',
            instructions: 'Which of these radio lines best fits the hiker\'s situation right now? Each option describes when it fits.',
            criteria: Object.fromEntries(options.map((l) => [l.id, l.when])),
          },
        },
      );
      const line = pick(a.line, 0.25);
      if ((a.speak?.noul ?? 0) >= 0.55 && line && this.game.subTimer <= 0) {
        const l = RANGER_LINES.find((x) => x.id === line.value);
        this.said.add(l.id);
        this.lastSpoke = this.clock;
        this.game.subtitle('Ranger (radio)', l.text);
      }
    } catch (e) {
      console.warn('Jev chatter:', e.message);
      this.lastAsk = this.clock + 60;   // back off after an error
    } finally {
      this.busy = false;
    }
  }

  /** Built-in chatter for when Jev isn't set up (the original behaviour). */
  fallbackChatter() {
    return GENERIC_LINES[Math.floor(Math.random() * GENERIC_LINES.length)];
  }

  // --- the hiker radios in -----------------------------------------------------------
  async command(text) {
    text = text.trim().slice(0, 240);
    if (!text) return;
    radioStatic(this.game.audio);
    if (!this.jev.enabled) {
      this.say('…kssht… Can\'t make you out, hiker. (Add a Jev key under Settings, O, to talk to the ranger.)');
      return;
    }
    this._status('Ranger station is listening…');
    let a;
    try {
      a = await this.jev.decide(
        { hiker_radio_message: text, ...this._state(), place_ranger_last_suggested: this.lastRec ? this.lastRec.name : 'none' },
        {
          intent: { type: 'choice', instructions: 'What does the hiker want from the ranger with this radio message?', criteria: INTENTS },
          destination: {
            type: 'choice',
            instructions: 'Which place in the park best matches what the hiker asks for? If they say "there" or "that one", it is the place the ranger last suggested. For a vague request, pick the place that best suits their wish and the current time, season and energy, preferring somewhere other than where they already are. If no place is relevant, pick none.',
            criteria: this.placeCriteria,
          },
          time: { type: 'choice', instructions: 'Does the hiker ask for a particular time of day?', criteria: Object.fromEntries(Object.entries(TIMES).map(([k, v]) => [k, v.desc])) },
          season: { type: 'choice', instructions: 'Does the hiker ask for a particular season?', criteria: SEASONS },
          gear: { type: 'choice', instructions: 'Which piece of gear, if any, does the hiker want?', criteria: GEAR },
          reply: { type: 'choice', instructions: 'If this is small talk, what kind is it?', criteria: REPLIES },
        },
      );
    } catch (e) {
      this._status('');
      this.say(`…kssht… Lost you in the static. (${e.message})`);
      return;
    }
    this._status('');
    this._act(a);
  }

  _act(a) {
    const intent = pick(a.intent, 0.3);
    if (!intent) { this.say('Say again, hiker? You\'re breaking up.'); return; }
    const dest = pick(a.destination, 0.2);
    const place = dest && dest.value !== 'none' ? this.places.find((p) => p.id === dest.value) : null;
    const time = pick(a.time, 0.35);
    const season = pick(a.season, 0.4);
    const g = this.game;
    switch (intent.value) {
      case 'travel': {
        if (!place) { this.say('Copy, but where to? Name a lake, a falls, a lookout, or just tell me what you want to see.'); return; }
        const t = time && time.value !== 'keep' ? time.value : null;
        const sn = season && season.value !== 'keep' ? season.value : null;
        this.say(`Copy that. Heading to ${place.name}${t ? `, ${TIMES[t].label}` : ''}${sn ? ` in ${sn}` : ''}.`);
        if (sn) this.setSeason(sn);
        if (t) this.atmo.hours = this._hourFor(t);
        this.lastRec = null;
        this.travel(place);
        return;
      }
      case 'recommend': {
        if (!place) { this.say('Hard to pick just one. Open the places list with J, anything there is worth the walk.'); return; }
        this.lastRec = place;
        const first = (place.text || '').split(/(?<=\.)\s/)[0];
        this.say(`Try ${place.name}. ${first} Say "take me there" when you're ready.`);
        return;
      }
      case 'set_time': {
        if (!time || time.value === 'keep') { this.say('What time are you after? Sunrise, golden hour, sunset, night?'); return; }
        const h = this._hourFor(time.value);
        this.say(`Copy. Skipping ahead to ${TIMES[time.value].label}.`);
        g.fadeThen(() => { this.atmo.hours = h; }, 'Time passes…');
        return;
      }
      case 'set_season': {
        if (!season || season.value === 'keep') { this.say('Which season, hiker? Summer, autumn or winter?'); return; }
        this.setSeason(season.value);
        const sel = $('set-season');
        if (sel) sel.value = season.value;
        this.say(`Copy. Switching the park to ${season.value}.`);
        return;
      }
      case 'camp': g.pitchCamp(); return;
      case 'stargaze': this.say('Enjoy the sky, hiker. I\'ll keep the radio down.'); g.startStargazing(); return;
      case 'gear': {
        const gear = pick(a.gear, 0.3);
        if (!gear || gear.value === 'none') { this.say('Which bit of gear? Map, compass, camera, binoculars, flashlight or poles?'); return; }
        g.select(gear.value);
        return;
      }
      case 'info': {
        const here = this._nearest();
        const p = place || (here.dist < 2000 ? here.place : null);
        this.say(p ? p.text : `You're in ${here.place.regionLabel}, about ${Math.round(this.controller.pos.y * FT).toLocaleString()} ft up. Pull out the map with M.`);
        return;
      }
      default: {
        const r = pick(a.reply, 0) || { value: 'other' };
        this.say(RANGER_REPLIES[r.value] || RANGER_REPLIES.other);
      }
    }
  }

  say(text) {
    this.lastSpoke = this.clock;
    this.game.subtitle('Ranger (radio)', text, Math.min(14, 5 + text.length / 18));
  }

  /** Hour of the day for a named time, solved from the sun model for the current season. */
  _hourFor(key) {
    const T = TIMES[key], A = this.atmo;
    if (T.h !== undefined) return T.h;
    const saved = A.hours;
    let best = T.am ? 7 : 19, bd = Infinity;
    for (let h = T.am ? 3 : 12; h <= (T.am ? 12 : 23); h += 0.05) {
      A.hours = h;
      const el = A.computeSun();
      const d = Math.abs(el - T.el);
      if (d < bd) { bd = d; best = h; }
    }
    A.hours = saved;
    A.computeSun();
    return best;
  }

  // --- UI -------------------------------------------------------------------------------
  _ui() {
    const box = $('radio-cmd'), input = $('radio-input');
    if (!box) return;
    this.box = box;
    const open = () => {
      if (this.game.controller.stargaze) this.game.stopStargazing();
      box.classList.add('open');
      document.body.classList.add('radio-open');
      if (document.pointerLockElement) document.exitPointerLock();
      input.value = '';
      input.focus();
    };
    const close = () => { box.classList.remove('open'); document.body.classList.remove('radio-open'); input.blur(); };
    this.openBox = open;
    $('radio-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = input.value;
      close();
      this.command(t);
    });
    input.addEventListener('keydown', (e) => { if (e.code === 'Escape') close(); });
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && this.game.ready()) { e.preventDefault(); open(); }
    });
    $('btn-ranger')?.addEventListener('click', open);

    // Settings: the player's own OpenRouter key for Jev
    const key = $('set-jev-key'), status = $('jev-status');
    if (key) {
      key.value = this.jev.key;
      const show = (t, ok) => { status.textContent = t; status.dataset.ok = ok ? '1' : ''; };
      show(this.jev.enabled ? 'Key saved in this browser.' : 'No key: the ranger uses stock lines.', this.jev.enabled);
      $('jev-save').addEventListener('click', () => {
        this.jev.setKey(key.value);
        show(this.jev.enabled ? 'Saved. Press Enter in the park to radio the ranger.' : 'Key removed.', this.jev.enabled);
      });
      $('jev-test').addEventListener('click', async () => {
        this.jev.setKey(key.value);
        if (!this.jev.enabled) { show('Paste a key first.', false); return; }
        show('Calling Jev…', false);
        try {
          const a = await this.jev.decide({ message: 'Radio check, ranger station, do you read me?' }, {
            ok: { type: 'noul', instructions: 'Is this a radio check?', criteria: { true: 'It is a radio check or test.', false: 'It is something else.' } },
          });
          show(`Connected · ${this.jev.stats.lastMs} ms · radio check ${(a.ok.noul * 100).toFixed(0)}%`, true);
        } catch (e) {
          show(`Failed: ${e.message}`, false);
        }
      });
    }
  }

  _status(t) {
    const el = $('radio-status');
    if (!el) return;
    el.textContent = t;
    el.classList.toggle('show', !!t);
  }
}
