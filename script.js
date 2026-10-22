const root = document.documentElement;
const me = document.currentScript.dataset;
const calm = matchMedia("(prefers-reduced-motion: reduce)");

/* Theme */

const toggle = document.querySelector("[data-theme-toggle]");
const themeColors = { dark: "#0F2A22", light: "#F7F5EF" };

const syncTheme = (theme) => {
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", themeColors[theme]));
  toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
};

const toggleTheme = () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.classList.add("theme-switching");
  root.dataset.theme = next;
  syncTheme(next);
  setTimeout(() => root.classList.remove("theme-switching"), 250);
  try {
    localStorage.setItem("theme", next);
  } catch (e) {}
};

toggle.addEventListener("click", toggleTheme);
syncTheme(root.dataset.theme);

/* Live clocks, once a minute */

const clockFormat = new Intl.DateTimeFormat("en-GB", { timeZone: me.tz || "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

const tick = () => {
  const text = clockFormat.format(new Date());
  document.querySelectorAll("[data-clock]").forEach((clock) => {
    if (clock.textContent !== text) clock.textContent = text;
  });
};

tick();
setTimeout(() => {
  tick();
  setInterval(tick, 60000);
}, 60000 - (Date.now() % 60000));

/* Hero profile: types in once, 40ms a character, 1.5s at most. The text is cleared
   now, but typing waits for "load" plus an idle moment so it never competes with
   the first render. */

const json = document.querySelector("[data-json]");

if (json && !calm.matches) {
  const walker = document.createTreeWalker(json, NodeFilter.SHOW_TEXT);
  const parts = [];
  let total = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    parts.push([node, node.data]);
    total += node.data.length;
    node.data = "";
  }
  const duration = Math.min(total * 40, 1500);
  let start = 0;
  json.classList.add("is-typing");

  const type = (now) => {
    start ||= now;
    let left = Math.ceil(total * Math.min((now - start) / duration, 1));
    for (const [node, text] of parts) {
      const length = Math.min(left, text.length);
      if (node.data.length !== length) node.data = text.slice(0, length);
      left -= length;
    }
    if (now - start < duration) requestAnimationFrame(type);
    else json.classList.remove("is-typing");
  };

  const idle = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 600 }) : (fn) => setTimeout(fn, 0);
  const begin = () => idle(() => requestAnimationFrame(type));
  if (document.readyState === "complete") begin();
  else addEventListener("load", begin, { once: true });
}

/* Copy email */

const copyLabel = document.querySelector("[data-copy-label]");
let copyTimer;

const setCopyLabel = (text) => {
  if (!copyLabel) return;
  copyLabel.classList.add("is-out");
  setTimeout(() => {
    copyLabel.textContent = text;
    copyLabel.classList.remove("is-out");
  }, calm.matches ? 0 : 150);
};

const copyEmail = () => {
  const done = () => {
    setCopyLabel("copied ✓");
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => setCopyLabel("copy"), 2000);
  };
  const fallback = () => {
    const field = document.createElement("textarea");
    field.value = me.email;
    field.className = "visually-hidden";
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
    done();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(me.email).then(done, fallback);
  else fallback();
};

document.querySelector("[data-copy]")?.addEventListener("click", copyEmail);

/* Section reveals: one observer, each element animates once. */

if (root.classList.contains("js") && !calm.matches) {
  const revealer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      el.classList.add("is-in");
      revealer.unobserve(el);
      // Drop the reveal state once it has played, so hover transitions are instant again.
      setTimeout(() => el.removeAttribute("data-reveal"), 1000);
    });
  }, { threshold: 0.15 });
  document.querySelectorAll("[data-reveal]").forEach((el) => revealer.observe(el));
}

/* Résumé chooser: <details> handles open/close; this adds Esc, arrows and click-away. */

const resumeMenu = document.querySelector("[data-resume-menu]");

if (resumeMenu) {
  const summary = resumeMenu.querySelector("summary");
  const links = [...resumeMenu.querySelectorAll("a")];
  const closeMenu = (refocus) => {
    resumeMenu.open = false;
    if (refocus) summary.focus();
  };

  resumeMenu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && resumeMenu.open) {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      resumeMenu.open = true;
      const i = links.indexOf(document.activeElement);
      const next = event.key === "ArrowDown" ? (i + 1) % links.length : (i <= 0 ? links.length : i) - 1;
      links[next].focus();
    }
  });

  // Tabbing out of the panel or clicking elsewhere closes it.
  resumeMenu.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !resumeMenu.contains(event.relatedTarget)) closeMenu(false);
  });
  document.addEventListener("click", (event) => {
    if (resumeMenu.open && !resumeMenu.contains(event.target)) closeMenu(false);
  });
  links.forEach((link) => link.addEventListener("click", () => closeMenu(false)));
}

/* Command palette: Ctrl/Cmd+K or "/" */

const palette = document.querySelector("[data-palette]");
const paletteInput = palette.querySelector("[data-palette-input]");
const options = [...palette.querySelectorAll('[role="option"]')];
const emptyNote = palette.querySelector("[data-palette-empty]");
let activeIndex = 0;
let returnFocus = null;

const visibleOptions = () => options.filter((option) => !option.hidden);

const setActive = (index) => {
  const list = visibleOptions();
  options.forEach((option) => option.setAttribute("aria-selected", "false"));
  if (!list.length) return paletteInput.removeAttribute("aria-activedescendant");
  activeIndex = (index + list.length) % list.length;
  list[activeIndex].setAttribute("aria-selected", "true");
  paletteInput.setAttribute("aria-activedescendant", list[activeIndex].id);
};

const filterOptions = () => {
  const query = paletteInput.value.trim().toLowerCase();
  options.forEach((option) => { option.hidden = !option.firstChild.textContent.toLowerCase().includes(query); });
  emptyNote.hidden = visibleOptions().length > 0;
  setActive(0);
};

const openPalette = () => {
  if (palette.open) return;
  returnFocus = document.activeElement;
  paletteInput.value = "";
  filterOptions();
  palette.showModal();
  paletteInput.focus();
};

const closePalette = () => {
  if (!palette.open || palette.classList.contains("is-closing")) return;
  if (calm.matches) return palette.close();
  palette.classList.add("is-closing");
  setTimeout(() => {
    palette.classList.remove("is-closing");
    palette.close();
  }, 120);
};

palette.addEventListener("cancel", (event) => {
  event.preventDefault();
  closePalette();
});

palette.addEventListener("close", () => {
  if (returnFocus && returnFocus !== document.body && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  else paletteInput.blur();
});

const runCommand = (option) => {
  const command = option.dataset.cmd;

  if (command === "goto") {
    const target = document.getElementById(option.dataset.target);
    if (!target) {
      location.href = "/#" + option.dataset.target;
      return;
    }
    const heading = target.querySelector("h2");
    heading.setAttribute("tabindex", "-1");
    // The close handler moves focus here once the dialog has closed.
    returnFocus = heading;
    closePalette();
    target.scrollIntoView({ behavior: calm.matches ? "auto" : "smooth" });
    history.replaceState(null, "", "#" + target.id);
    return;
  }

  closePalette();
  if (command === "copy") copyEmail();
  else if (command === "theme") toggleTheme();
  else if (command === "open") window.open(option.dataset.href, "_blank", "noopener");
};

paletteInput.addEventListener("input", filterOptions);

paletteInput.addEventListener("keydown", (event) => {
  if (!palette.open) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
  } else if (event.key === "Enter") {
    event.preventDefault();
    const option = visibleOptions()[activeIndex];
    if (option) runCommand(option);
  } else if (event.key === "Tab") {
    // The input is the only focusable element, so focus stays in the dialog.
    event.preventDefault();
  }
});

options.forEach((option) => {
  option.addEventListener("click", () => runCommand(option));
  option.addEventListener("pointerenter", () => setActive(visibleOptions().indexOf(option)));
});

// A click on the scrim (the dialog element itself, outside the window) closes it.
palette.addEventListener("click", (event) => {
  if (event.target === palette) closePalette();
});

document.querySelector("[data-palette-open]").addEventListener("click", openPalette);

document.addEventListener("keydown", (event) => {
  const typing = event.target.closest("input, textarea, select, [contenteditable]");
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (palette.open) closePalette();
    else openPalette();
  } else if (event.key === "/" && !typing && !palette.open) {
    event.preventDefault();
    openPalette();
  }
});
