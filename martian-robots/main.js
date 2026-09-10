// Playground glue: tabs, batch pipeline, arcade seam. All domain behaviour
// comes from the wasm module; this file renders state and routes events.
import init, { simulate, Arcade } from "./pkg/martian_robots_wasm.js";

const $ = (id) => document.querySelector(`[data-testid="${id}"]`);

const SAMPLE = "5 3\n1 1 E\nRFRFRFRF\n\n3 2 N\nFRRFLLFFRRFLL\n\n0 3 W\nLLFFFLFLFL\n";

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

function initArcade() {
  let arcade = null;
  const grid = $("arcade-grid");
  const status = $("arcade-status");

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
        if (arcade.is_scented(x, y)) {
          cell.dataset.scented = "true";
          cell.textContent = "×";
        }
        if (robotX === x && robotY === y) {
          cell.dataset.robot = "true";
          const o = arcade.active_orientation();
          cell.dataset.orientation = o;
          cell.textContent = { N: "▲", E: "▶", S: "▼", W: "◀" }[o];
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
  }

  function say(text) {
    status.textContent = text;
  }

  $("arcade-setup").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      arcade = new Arcade(Number($("arcade-max-x").value), Number($("arcade-max-y").value));
      $("arcade-land-form").hidden = false;
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
      say("Robot landed. Drive with the keys.");
      render();
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
      const outcome = arcade.step(instruction);
      if (outcome === "lost") {
        say(`Robot LOST at ${arcade.last_lost()} — its scent now guards that cell. Land the next robot.`);
      } else if (outcome === "ignored") {
        say("Scent! The fatal move was ignored.");
      } else {
        say("");
      }
      render();
    } catch (err) {
      say(String(err.message ?? err));
    }
  });
}

await init();
document.documentElement.dataset.ready = "true";
initTabs();
initBatch();
initArcade();
