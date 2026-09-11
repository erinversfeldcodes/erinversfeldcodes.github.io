// Playground glue: tabs, batch pipeline, arcade seam, and — since M7 — the
// arcade's motion and sound. All domain behaviour comes from the wasm module;
// this file renders state and routes events.
//
// The M7 boundary rule (RUBRIC): the core is the sole simulation authority and
// this layer interpolates between core-emitted steps. Concretely, `render()`
// writes every data-* attribute synchronously from the core's answer, and
// only THEN does a sprite tween towards the cell the grid already shows. A
// half-finished tween can never be the reason a hook reads differently.
import init, { simulate, Arcade } from "./pkg/martian_robots_wasm.js";

const $ = (id) => document.querySelector(`[data-testid="${id}"]`);

const SAMPLE = "5 3\n1 1 E\nRFRFRFRF\n\n3 2 N\nFRRFLLFFRRFLL\n\n0 3 W\nLLFFFLFLFL\n";

// One switch, both properties (UI contract 0.2.0 §4). Motion off means sound
// off, and sound is the only thing here that can touch the network — so the
// flag that makes the page deterministic is the flag that makes it silent.
const MOTION =
  !matchMedia("(prefers-reduced-motion: reduce)").matches &&
  !new URLSearchParams(location.search).has("test");
document.documentElement.dataset.motion = MOTION ? "on" : "off";

function initTabs() {
  const tabs = [
    [$("tab-batch"), document.getElementById("panel-batch")],
    [$("tab-arcade"), document.getElementById("panel-arcade")],
  ];
  for (const [tab, panel] of tabs) {
    tab.addEventListener("click", () => {
      for (const [t, p] of tabs) {
        const selected = t === tab;
        t.setAttribute("aria-selected", String(selected));
        p.hidden = !selected;
      }
    });
  }
}

function initBatch() {
  const input = $("batch-input");
  const output = $("batch-output");
  const errors = $("batch-errors");
  $("batch-sample").addEventListener("click", () => {
    input.value = SAMPLE;
  });
  $("batch-run").addEventListener("click", () => {
    output.hidden = errors.hidden = true;
    try {
      output.textContent = simulate(input.value);
      output.hidden = false;
    } catch (e) {
      errors.textContent = e instanceof Error ? e.message : String(e);
      errors.hidden = false;
    }
  });
}

// Sound. Nothing is created — and therefore nothing is fetched — until the
// toggle is pressed on. That press is the one permitted post-load request
// (UI contract 0.2.0 §1), and under ?test=1 / reduced motion the toggle is
// disabled, so the page under test makes no post-load request at all.
function initSound() {
  const toggle = $("sound-toggle");
  const FILES = { move: "move.ogg", turn: "turn.ogg", lost: "lost.ogg", ignored: "ignored.ogg", land: "land.ogg" };
  let enabled = false;
  let sfx = null;
  let music = null;

  if (!MOTION) {
    toggle.disabled = true;
    return { play() {} };
  }

  function load() {
    sfx = Object.fromEntries(
      Object.entries(FILES).map(([name, file]) => {
        const a = new Audio(`assets/audio/${file}`);
        a.preload = "auto";
        a.volume = 0.6;
        // Explicit: Chrome does not fetch a detached element's media on
        // construction, preload="auto" notwithstanding — the server log
        // showed zero requests three seconds after the toggle. load() makes
        // the gesture the moment the effects arrive, which is both the
        // contract's model (§1) and what removes first-play latency.
        a.load();
        return [name, a];
      }),
    );
    music = new Audio("assets/audio/music.opus");
    music.loop = true;
    music.volume = 0.3;
    // Streams: the browser fetches progressively from here, not the whole
    // file up front. "none" keeps it from prefetching before play().
    music.preload = "none";
  }

  toggle.addEventListener("click", () => {
    enabled = !enabled;
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.textContent = enabled ? "SOUND: ON" : "SOUND: OFF";
    if (enabled) {
      if (!sfx) load();
      music.play().catch(() => {});
    } else {
      music.pause();
    }
  });

  return {
    play(name) {
      if (!enabled || !sfx?.[name]) return;
      const a = sfx[name];
      a.currentTime = 0;
      a.play().catch(() => {});
    },
  };
}

function initArcade(sound) {
  let arcade = null;
  const grid = $("arcade-grid");
  const status = $("arcade-status");
  const stage = grid.parentElement;
  const robot = stage.querySelector(".robot");
  const burst = stage.querySelector(".burst");

  // Presentation state only: the sprite's accumulated rotation, so a left
  // turn from N rotates 90° anticlockwise rather than spinning the long way
  // round to 270°. It is derived from the core's orientation and re-synced to
  // it after every render, so it can never disagree with the simulation for
  // more than one frame — the core stays the authority.
  const BASE = { N: 0, E: 90, S: 180, W: 270 };
  let spin = 0;

  function cellRect(x, y) {
    const cell = grid.querySelector(`[data-cell="${x},${y}"]`);
    const s = stage.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    return { left: c.left - s.left, top: c.top - s.top };
  }

  // Positions the robot sprite over the cell the grid ALREADY shows as
  // occupied. With motion on, the CSS transition carries it there; with
  // motion off there is no transition and it simply appears.
  function placeRobot() {
    const x = arcade.active_x();
    const y = arcade.active_y();
    if (x === undefined || y === undefined) {
      robot.hidden = true;
      return;
    }
    const o = arcade.active_orientation();
    // Re-sync: presentation must agree with the core modulo full turns.
    if (((spin % 360) + 360) % 360 !== BASE[o]) spin = BASE[o];
    const { left, top } = cellRect(x, y);
    robot.style.setProperty("--x", `${left}px`);
    robot.style.setProperty("--y", `${top}px`);
    robot.style.setProperty("--spin", `${spin}deg`);
    robot.hidden = false;
  }

  function flashBurst(x, y) {
    if (!MOTION) return;
    const { left, top } = cellRect(x, y);
    burst.style.setProperty("--x", `${left}px`);
    burst.style.setProperty("--y", `${top}px`);
    burst.hidden = false;
    burst.classList.remove("go");
    void burst.offsetWidth; // restart the animation
    burst.classList.add("go");
    burst.addEventListener("animationend", () => { burst.hidden = true; }, { once: true });
  }

  function render() {
    if (!arcade) return;
    const maxX = arcade.max_x(), maxY = arcade.max_y();
    grid.style.setProperty("--cols", maxX + 1);
    grid.replaceChildren();
    const robotX = arcade.active_x(), robotY = arcade.active_y();
    const lost = arcade.last_lost();
    // Row maxY at the top: north points up.
    for (let y = maxY; y >= 0; y--) {
      for (let x = 0; x <= maxX; x++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.cell = `${x},${y}`;
        // The scent mark itself is CSS (a data: URI), so marking a cell is
        // never a network request — see style.css for why that matters.
        if (arcade.is_scented(x, y)) cell.dataset.scented = "true";
        if (robotX === x && robotY === y) {
          cell.dataset.robot = "true";
          cell.dataset.orientation = arcade.active_orientation();
        }
        if (lost) {
          const [lx, ly] = lost.split(" ");
          if (Number(lx) === x && Number(ly) === y && !cell.dataset.robot) {
            cell.dataset.lost = "true";
          }
        }
        grid.appendChild(cell);
      }
    }
    grid.hidden = false;
    // Every hook above is final at this point. Only now does decoration move.
    placeRobot();
  }

  function say(text) {
    status.textContent = text;
  }

  $("arcade-setup").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      arcade = new Arcade(Number($("arcade-max-x").value), Number($("arcade-max-y").value));
      $("arcade-land-form").hidden = false;
      robot.hidden = burst.hidden = true;
      say("World ready. Land a robot.");
      render();
    } catch (err) {
      say(String(err.message ?? err));
    }
  });

  $("arcade-land-form").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      arcade.land(
        Number($("arcade-land-x").value),
        Number($("arcade-land-y").value),
        $("arcade-land-orientation").value,
      );
      spin = BASE[arcade.active_orientation()];
      say("Robot landed. Drive with the keys.");
      render();
      sound.play("land");
    } catch (err) {
      say(String(err.message ?? err));
    }
  });

  const KEYS = { ArrowLeft: "L", ArrowRight: "R", ArrowUp: "F", l: "L", r: "R", f: "F", L: "L", R: "R", F: "F" };
  document.addEventListener("keydown", (e) => {
    if (document.getElementById("panel-arcade").hidden || !arcade) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const instruction = KEYS[e.key];
    if (!instruction) return;
    e.preventDefault();
    try {
      const before = arcade.last_lost();
      const outcome = arcade.step(instruction);
      if (outcome === "lost") {
        say(`Robot LOST at ${arcade.last_lost()} — its scent now guards that cell. Land the next robot.`);
      } else if (outcome === "ignored") {
        say("Scent! The fatal move was ignored.");
      } else {
        say("");
        // A turn the core accepted: rotate the way the key said, not the
        // long way round. placeRobot() re-syncs to the core's orientation.
        if (instruction === "L") spin -= 90;
        if (instruction === "R") spin += 90;
      }
      render();
      if (outcome === "lost") {
        const [lx, ly] = arcade.last_lost().split(" ");
        if (arcade.last_lost() !== before) flashBurst(Number(lx), Number(ly));
        sound.play("lost");
      } else if (outcome === "ignored") {
        sound.play("ignored");
      } else {
        sound.play(instruction === "F" ? "move" : "turn");
      }
    } catch (err) {
      say(String(err.message ?? err));
    }
  });
}

await init();
document.documentElement.dataset.ready = "true";
initTabs();
initBatch();
initArcade(initSound());
