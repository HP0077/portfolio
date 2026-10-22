// Case-study flow window: a dot walks the nodes and applies each step from data-sim.
// One requestAnimationFrame loop, paused off-screen and in hidden tabs.
(() => {
  const flow = document.querySelector("[data-flow]");
  if (!flow) return;

  const items = [...flow.querySelectorAll(".flow-nodes li")];
  flow.classList.add("is-live");

  const sim = JSON.parse(flow.dataset.sim || "[]");
  const notes = items.map((item) => item.querySelector(".note"));
  const log = flow.querySelector("[data-log]");
  const narrow = matchMedia("(max-width: 720px)");

  // Reduced motion: the HTML already shows the final state; on phones use the short labels.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    flow.dataset.at = items.length - 1;
    if (narrow.matches) sim.forEach((step) => { if (step.short) notes[step.at].textContent = step.short; });
    return;
  }

  const events = [];
  let t = 0;
  items.forEach((_, i) => {
    events.push({ t, at: i });
    t += 450;
    sim.filter((step) => step.at === i).forEach((step) => {
      events.push({ t, step });
      t += step.status || step.state ? 750 : 450;
    });
  });
  const total = t + 1400;

  let raf = 0;
  let start = 0;
  let next = 0;
  let current = -1;
  let typing = null;
  let visible = false;

  const reset = () => {
    items.forEach((item) => item.removeAttribute("data-state"));
    notes.forEach((note) => { note.textContent = note.dataset.default; });
    flow.classList.add("is-resetting");
    flow.dataset.at = 0;
    if (log) log.textContent = "";
    next = 0;
    current = -1;
    typing = null;
    start = 0;
  };

  const apply = (event, now) => {
    if (event.at !== undefined) {
      if (current >= 0 && items[current].dataset.state === "current") items[current].removeAttribute("data-state");
      current = event.at;
      flow.dataset.at = current;
      items[current].dataset.state = "current";
      return;
    }
    const { step } = event;
    if (step.state) items[step.at].dataset.state = step.state;
    if (step.status) notes[step.at].textContent = narrow.matches && step.short ? step.short : step.status;
    if (step.log && log) typing = { text: step.log, t0: now };
  };

  const frame = (now) => {
    if (!start) {
      start = now;
      flow.classList.remove("is-resetting");
    }
    const elapsed = now - start;
    while (next < events.length && events[next].t <= elapsed) apply(events[next++], now);
    if (typing) {
      const length = Math.min(typing.text.length, Math.floor((now - typing.t0) / 18));
      if (log.textContent.length !== length) log.textContent = typing.text.slice(0, length);
      if (length === typing.text.length) typing = null;
    }
    if (elapsed >= total) reset();
    raf = requestAnimationFrame(frame);
  };

  const update = () => {
    if (visible && !document.hidden) {
      if (raf) return;
      reset();
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  reset();
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    update();
  }, { threshold: 0.25 }).observe(flow);
  document.addEventListener("visibilitychange", update);
})();
