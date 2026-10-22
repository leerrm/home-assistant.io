// The Wheel of WTH: a grab bag of open "What the Heck?!" topics for anyone
// who wants to fix one but can't decide which.
//
// The topics come from the forum as a build-time JSON blob (see the
// wth_topics_data task in the Rakefile). A spin picks the winning segment
// first and then works out the angle that brings it under the pointer, so
// what the wheel shows and what the page says can never disagree.
(function () {
  const game = document.querySelector("[data-wheel-game]");
  if (!game) {
    return;
  }

  const poolEl = game.querySelector("[data-wheel-pool]");
  const wheel = game.querySelector("[data-wheel]");
  const face = game.querySelector("[data-wheel-face]");
  const status = game.querySelector("[data-status]");
  const spinButton = game.querySelector("[data-spin]");
  const playCount = game.querySelector("[data-plays]");
  const prize = game.querySelector("[data-prize]");
  const prizeCard = game.querySelector("[data-prize-card]");
  const prizeTitle = game.querySelector("[data-prize-title]");
  const prizeMeta = game.querySelector("[data-prize-meta]");
  const prizeTags = game.querySelector("[data-prize-tags]");
  const prizeLink = game.querySelector("[data-prize-link]");
  const againButton = game.querySelector("[data-again]");
  const haul = game.querySelector("[data-haul]");
  const haulList = game.querySelector("[data-haul-list]");

  if (!poolEl || !wheel || !face) {
    return;
  }

  const FORUM = "https://community.home-assistant.io/t/";
  const SVG_NS = "http://www.w3.org/2000/svg";
  // Segments on the wheel at once. The pool is far bigger; a segment is
  // refilled from it as soon as its topic has been won.
  const SEGMENTS = 12;
  // Whole turns before the wheel settles, and how long that takes.
  const TURNS = 4;
  const SPIN_MS = 3600;
  // Four fills, repeated around the wheel. The count is deliberately not a
  // factor of SEGMENTS, so neighbouring segments never share a colour.
  const FILLS = ["#16F3BE", "#5AB9EE", "#FFFFFF", "#9DECE5", "#18BCF2"];

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let pool = [];
  try {
    pool = JSON.parse(poolEl.textContent);
  } catch (error) {
    return;
  }
  if (!Array.isArray(pool) || pool.length === 0) {
    return;
  }

  // Waiting topics, shuffled once so every visit deals them out differently.
  const waiting = pool.slice();
  for (let i = waiting.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [waiting[i], waiting[j]] = [waiting[j], waiting[i]];
  }

  const segmentAngle = 360 / SEGMENTS;
  let segments = [];
  let rotation = 0;
  let busy = false;
  let spins = 0;

  const wait = (ms) =>
    new Promise((resolve) => setTimeout(resolve, reducedMotion.matches ? 0 : ms));

  const setStatus = (text) => {
    if (status) {
      status.textContent = text;
    }
  };

  // A wedge from the centre out to the rim, drawn from the top clockwise.
  const wedgePath = (index) => {
    const start = (index * segmentAngle - 90) * (Math.PI / 180);
    const end = ((index + 1) * segmentAngle - 90) * (Math.PI / 180);
    const r = 98;
    const x1 = Math.cos(start) * r;
    const y1 = Math.sin(start) * r;
    const x2 = Math.cos(end) * r;
    const y2 = Math.sin(end) * r;
    const wide = segmentAngle > 180 ? 1 : 0;
    return `M 0 0 L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${wide} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  };

  const drawFace = () => {
    face.textContent = "";
    segments.forEach((topic, index) => {
      const wedge = document.createElementNS(SVG_NS, "path");
      wedge.setAttribute("d", wedgePath(index));
      wedge.setAttribute("fill", FILLS[index % FILLS.length]);
      wedge.setAttribute("class", "wheel-wedge");
      wedge.dataset.index = String(index);
      face.appendChild(wedge);

      // A mark rather than a title: at twelve to a wheel there is no room
      // for a sentence, and the card does the telling once it lands.
      const mid = (index * segmentAngle + segmentAngle / 2 - 90) * (Math.PI / 180);
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", (Math.cos(mid) * 72).toFixed(2));
      label.setAttribute("y", (Math.sin(mid) * 72).toFixed(2));
      label.setAttribute("class", "wheel-mark");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "central");
      // Upright, not radial: turned to follow the wedge, half of them would
      // be upside down at rest.
      label.textContent = "?!";
      face.appendChild(label);
    });
  };

  const fillSegments = () => {
    while (segments.length < SEGMENTS && waiting.length > 0) {
      segments.push(waiting.shift());
    }
    drawFace();
  };

  const formatMeta = (topic) => {
    const parts = [];
    if (topic.votes > 0) {
      parts.push(`${topic.votes} ${topic.votes === 1 ? "vote" : "votes"}`);
    }
    if (topic.replies > 0) {
      parts.push(`${topic.replies} ${topic.replies === 1 ? "reply" : "replies"}`);
    }
    if (topic.posted) {
      const posted = new Date(`${topic.posted}T00:00:00Z`);
      if (!Number.isNaN(posted.getTime())) {
        parts.push(
          `posted ${posted.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })}`
        );
      }
    }
    return parts.join(" · ");
  };

  const addToHaul = (topic) => {
    if (!haul || !haulList) {
      return;
    }
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = FORUM + topic.slug + "/" + topic.id;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = topic.title;
    item.appendChild(link);
    haulList.prepend(item);
    haul.hidden = false;
  };

  const showPrize = (topic) => {
    prizeTitle.textContent = topic.title;
    prizeMeta.textContent = formatMeta(topic);
    prizeLink.href = FORUM + topic.slug + "/" + topic.id;

    prizeTags.textContent = "";
    (topic.tags || []).forEach((tag) => {
      const item = document.createElement("li");
      item.className = "prize-tag";
      item.textContent = tag;
      prizeTags.appendChild(item);
    });

    if (!reducedMotion.matches) {
      prizeCard.classList.add("is-arriving");
    }
    prize.hidden = false;
    addToHaul(topic);
    setStatus("That is your WTH. Spin again whenever you like.");
  };

  const scrollBehavior = () => (reducedMotion.matches ? "auto" : "smooth");

  const settleScroll = (limit) =>
    new Promise((resolve) => {
      if (reducedMotion.matches) {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.removeEventListener("scrollend", finish, true);
        resolve();
      };
      window.addEventListener("scrollend", finish, true);
      window.setTimeout(finish, limit);
    });

  const mostlyInView = (element) => {
    const box = element.getBoundingClientRect();
    const visible = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
    return visible >= box.height * 0.7;
  };

  // The result is worth following: the view drops to the card and the card
  // grows into its place, so the spin and the reading are one movement.
  const revealCard = async () => {
    prize.scrollIntoView({ behavior: scrollBehavior(), block: "end" });
    await settleScroll(700);
    if (!mostlyInView(prizeCard)) {
      prize.scrollIntoView({ block: "end" });
    }

    if (!reducedMotion.matches) {
      prizeCard.classList.remove("is-arriving");
      prizeCard.classList.add("is-entering");
      await wait(520);
      prizeCard.classList.remove("is-entering");
    }
    prizeCard.focus({ preventScroll: true });
  };

  const setBusy = (value) => {
    busy = value;
    if (spinButton) {
      spinButton.disabled = value;
    }
  };

  const spin = async () => {
    if (busy || segments.length === 0) {
      return;
    }
    setBusy(true);
    prize.hidden = true;
    prizeCard.classList.remove("is-arriving", "is-entering");

    spins += 1;
    if (playCount) {
      playCount.textContent = `${spins} ${spins === 1 ? "spin" : "spins"}`;
    }

    if (!mostlyInView(wheel)) {
      wheel.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
      await settleScroll(700);
      if (!mostlyInView(wheel)) {
        wheel.scrollIntoView({ block: "center" });
      }
    }

    // Pick the winner first, then turn the wheel to it. Reading the angle
    // afterwards would leave the two free to disagree.
    const index = Math.floor(Math.random() * segments.length);
    const topic = segments[index];
    // Land anywhere within the segment rather than dead centre every time.
    const withinSegment = (Math.random() - 0.5) * (segmentAngle - 6);
    const centre = index * segmentAngle + segmentAngle / 2 + withinSegment;
    // Carry on from where it stopped, so it never spins backwards.
    const current = ((rotation % 360) + 360) % 360;
    rotation += TURNS * 360 + (((360 - centre) % 360) - current + 360) % 360;

    setStatus("Spinning…");
    wheel.style.transform = `rotate(${rotation}deg)`;
    await wait(SPIN_MS);

    // The segment is spent: hand its slot to a topic that is still waiting.
    segments.splice(index, 1);
    fillSegments();

    showPrize(topic);
    await revealCard();
    setBusy(false);

    if (segments.length === 0) {
      setStatus("That is every WTH on the wheel. The category has plenty more.");
      if (spinButton) {
        spinButton.disabled = true;
      }
    }
  };

  fillSegments();

  if (spinButton) {
    spinButton.addEventListener("click", spin);
  }

  if (againButton) {
    againButton.addEventListener("click", () => {
      prize.hidden = true;
      if (spinButton && !spinButton.disabled) {
        spinButton.focus();
      }
    });
  }
})();
