// The WTH claw machine: a grab bag of open "What the Heck?!" topics for
// anyone who wants to fix one but can't decide which.
//
// The topics come from the forum as a build-time JSON blob (see the
// wth_topics_data task in the Rakefile). The machine itself is plain DOM: you
// walk the claw along the rail with the left and right controls, drop it, and
// it comes up with whichever capsule it was nearest, or with nothing. Every
// move is a button as well as a key, and "pick one for me" plays a whole turn
// on its own, so the machine works the same on a keyboard, on a phone, and
// with motion turned off.
(function () {
  const machine = document.querySelector("[data-claw-machine]");
  if (!machine) {
    return;
  }

  const poolEl = machine.querySelector("[data-claw-pool]");
  const pile = machine.querySelector("[data-pile]");
  const claw = machine.querySelector("[data-claw]");
  const glass = machine.querySelector(".machine-glass");
  const chute = machine.querySelector(".machine-chute");
  const status = machine.querySelector("[data-status]");
  const dropButton = machine.querySelector("[data-drop]");
  const skipButton = machine.querySelector("[data-skip]");
  const moveButtons = Array.from(machine.querySelectorAll("[data-move]"));
  const playCount = machine.querySelector("[data-plays]");
  const catchCount = machine.querySelector("[data-catches]");
  const prize = machine.querySelector("[data-prize]");
  const prizeCard = machine.querySelector("[data-prize-card]");
  const prizeTitle = machine.querySelector("[data-prize-title]");
  const prizeMeta = machine.querySelector("[data-prize-meta]");
  const prizeTags = machine.querySelector("[data-prize-tags]");
  const prizeLink = machine.querySelector("[data-prize-link]");
  const againButton = machine.querySelector("[data-again]");
  const haul = machine.querySelector("[data-haul]");
  const haulList = machine.querySelector("[data-haul-list]");

  if (!poolEl || !pile || !claw || !glass) {
    return;
  }

  const FORUM = "https://community.home-assistant.io/t/";

  // How many capsules sit in the glass at once. The pool is far bigger than
  // the glass, and the pile refills as capsules are taken out of it. A narrow
  // glass holds fewer, so the pile stays a pile instead of a stack.
  // How the capsules stack, bottom row first. Each row up holds one fewer and
  // sits further in, so the pile reads as a heap against the back of the
  // glass rather than as rows on a shelf.
  const rowPlan = () => (window.innerWidth < 700 ? [4, 3, 2] : [7, 6, 5]);
  const pileSize = () => rowPlan().reduce((total, row) => total + row, 0);
  // How far each row up is inset from the one below it, as a share of the
  // floor, and how much of a capsule's height a row above overlaps it.
  const ROW_INSET = 5;
  const ROW_OVERLAP = 0.62;
  // How close, as a share of the glass width, the claw has to be to a capsule
  // to come up with it. Wider than a capsule, so a near miss still counts,
  // but narrow enough that a badly aimed claw comes up empty.
  const GRAB_RANGE = 7;
  // Where the claw hands over what it caught, how far along the rail it can
  // travel, and the stretch of floor the capsules spread across, which stops
  // short of the chute.
  const CHUTE_POSITION = 91;
  const RAIL_LEFT = 6;
  const RAIL_RIGHT = 94;
  const PILE_LEFT = 7;
  const PILE_RIGHT = 74;
  // How fast the claw walks along the rail while a control is held down, and
  // the longest gap between frames it will act on. Without the ceiling, a
  // stalled or throttled frame hands the claw one huge step and flings it
  // across the glass.
  const MOVE_SPEED = 32;
  const MAX_FRAME = 0.05;
  // How far a tap or a key press nudges it.
  const NUDGE = 4;

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

  // Waiting topics, shuffled once so every play through the machine deals
  // them out in a different order.
  const waiting = pool.slice();
  for (let i = waiting.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [waiting[i], waiting[j]] = [waiting[j], waiting[i]];
  }

  let position = 50;
  let busy = false;
  let plays = 0;
  let catches = 0;

  // With motion turned down the claw still plays a whole turn, it just gets
  // there without the travel.
  const wait = (ms) =>
    new Promise((resolve) => setTimeout(resolve, reducedMotion.matches ? 0 : ms));

  // The page scrolls inside .page-content on this layout, so anything that
  // moves the view goes through scrollIntoView and lets the browser find the
  // right container rather than guessing at one.
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
      // Not every browser fires scrollend, so the wait is capped.
      window.setTimeout(finish, limit);
    });

  const mostlyInView = (element) => {
    const box = element.getBoundingClientRect();
    const visible = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
    return visible >= box.height * 0.7;
  };

  const setStatus = (text) => {
    if (status) {
      status.textContent = text;
    }
  };

  const moveTo = (next) => {
    position = Math.min(Math.max(next, RAIL_LEFT), RAIL_RIGHT);
    claw.style.left = `${position}%`;
  };

  const buildCapsule = (topic) => {
    const capsule = document.createElement("div");
    capsule.className = "capsule";
    // A pile of identical capsules looks printed rather than filled, so each
    // one takes one of four looks and sits at its own slight angle.
    capsule.dataset.look = String((topic.id || 0) % 4);
    capsule.style.setProperty("--capsule-tilt", `${Math.round(Math.random() * 16 - 8)}deg`);
    capsule.innerHTML = '<span class="capsule-mark" aria-hidden="true">?!</span>';
    return capsule;
  };

  // Heaps the capsules up from the floor of the glass. Rows above sit back
  // and in, and each row is drawn behind the one below it, so the pile has a
  // front and a back instead of reading as a flat line of discs.
  const layOutPile = () => {
    const capsules = Array.from(pile.children);
    const plan = rowPlan();
    const size = capsules.length ? capsules[0].offsetHeight : 0;
    let placed = 0;

    plan.forEach((count, row) => {
      const inRow = capsules.slice(placed, placed + count);
      placed += count;
      const left = PILE_LEFT + ROW_INSET * row;
      const right = PILE_RIGHT - ROW_INSET * row;
      const step = (right - left) / Math.max(inRow.length, 1);

      inRow.forEach((capsule, index) => {
        capsule.style.left = `${left + step * (index + 0.5)}%`;
        capsule.style.bottom = `${6 + row * size * ROW_OVERLAP}px`;
        // The bottom row is nearest the glass, so it is drawn in front.
        capsule.style.zIndex = String(plan.length - row);
      });
    });

    // Anything the plan did not account for sits on the floor rather than
    // stacking up in the top left corner.
    capsules.slice(placed).forEach((capsule) => {
      capsule.style.left = `${PILE_LEFT}%`;
      capsule.style.bottom = "6px";
      capsule.style.zIndex = String(plan.length);
    });
  };

  const fillPile = () => {
    while (pile.children.length < pileSize() && waiting.length > 0) {
      const topic = waiting.shift();
      const capsule = buildCapsule(topic);
      capsule.topic = topic;
      pile.appendChild(capsule);
    }
    layOutPile();
  };

  const capsuleAt = (spot) => {
    let nearest = null;
    let nearestDistance = Infinity;

    Array.from(pile.children).forEach((capsule) => {
      const distance = Math.abs(parseFloat(capsule.style.left) - spot);
      if (distance < nearestDistance) {
        nearest = capsule;
        nearestDistance = distance;
      }
    });

    return nearestDistance <= GRAB_RANGE ? nearest : null;
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
    catches += 1;
    if (catchCount) {
      catchCount.textContent = `${catches} caught`;
    }
    addToHaul(topic);
    setStatus("Caught one. Move the claw and go again.");
  };

  // The catch is worth following: the view drops to the prize card, then a
  // capsule falls out of the chute, down the page, and into the card, so the
  // thing you caught and the thing you are reading are visibly the same one.
  const deliverToCard = async (look) => {
    prize.scrollIntoView({ behavior: scrollBehavior(), block: "end" });
    await settleScroll(700);
    // A smooth scroll can be dropped entirely, in a background tab among
    // other places. The capsule is about to fall towards wherever the card
    // is, so make sure that is somewhere the player can see.
    if (!mostlyInView(prizeCard)) {
      prize.scrollIntoView({ block: "end" });
    }

    if (reducedMotion.matches) {
      prizeCard.focus({ preventScroll: true });
      return;
    }

    const from = chute ? chute.getBoundingClientRect() : null;
    // Measured before the card starts scaling, so this is its real box.

    const to = prizeCard.getBoundingClientRect();
    if (!from) {
      prizeCard.classList.remove("is-arriving");
      prizeCard.focus({ preventScroll: true });
      return;
    }

    const size = pile.firstElementChild ? pile.firstElementChild.offsetWidth : 54;
    const ghost = document.createElement("div");
    ghost.className = "capsule is-delivering";
    ghost.dataset.look = look;
    ghost.setAttribute("aria-hidden", "true");
    ghost.innerHTML = '<span class="capsule-mark">?!</span>';
    ghost.style.height = `${size}px`;
    ghost.style.width = `${size}px`;
    ghost.style.left = `${from.left + from.width / 2 - size / 2}px`;
    ghost.style.top = `${from.top + from.height - size / 2}px`;
    document.body.appendChild(ghost);

    // Land a little inside the top of the card, where the capsule reads as
    // having dropped into it rather than onto it.
    const fall = to.top + 36 - parseFloat(ghost.style.top);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    ghost.style.transform = `translateY(${fall}px) rotate(28deg)`;
    ghost.style.opacity = "0";
    prizeCard.classList.remove("is-arriving");
    prizeCard.classList.add("is-entering");

    await wait(620);
    ghost.remove();
    prizeCard.classList.remove("is-entering");
    prizeCard.classList.add("is-landed");
    window.setTimeout(() => prizeCard.classList.remove("is-landed"), 400);
    prizeCard.focus({ preventScroll: true });
  };

  const setBusy = (value) => {
    busy = value;
    [dropButton, skipButton, ...moveButtons].forEach((button) => {
      if (button) {
        button.disabled = value;
      }
    });
  };

  const countPlay = () => {
    plays += 1;
    if (playCount) {
      playCount.textContent = `${plays} ${plays === 1 ? "drop" : "drops"}`;
    }
  };

  const machineIsEmpty = () => {
    if (pile.children.length === 0 && waiting.length === 0) {
      setStatus("That is every WTH in the machine. The category has plenty more.");
      [dropButton, skipButton, ...moveButtons].forEach((button) => {
        if (button) {
          button.disabled = true;
        }
      });
      return true;
    }
    return false;
  };

  const play = async () => {
    if (busy) {
      return;
    }
    stopMoving();
    setBusy(true);
    prize.hidden = true;
    prizeCard.classList.remove("is-arriving", "is-entering", "is-landed");
    countPlay();

    // After a catch the view is down on the prize card, so bring the glass
    // back before dropping into a machine the player cannot see.
    if (!mostlyInView(glass)) {
      glass.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
      await settleScroll(700);
      if (!mostlyInView(glass)) {
        glass.scrollIntoView({ block: "center" });
      }
    }

    const capsule = capsuleAt(position);

    setStatus("Down it goes…");
    claw.classList.add("is-dropping");
    await wait(650);

    claw.classList.add("is-closed");
    await wait(300);

    if (!capsule) {
      claw.classList.remove("is-dropping");
      await wait(500);
      claw.classList.remove("is-closed");
      setStatus("The claw came up empty. Line it up and try again.");
      setBusy(false);
      return;
    }

    // Hand the capsule over to the claw so it rides along with it.
    const topic = capsule.topic;
    capsule.classList.add("is-held");
    capsule.style.left = "";
    capsule.style.bottom = "";
    capsule.style.zIndex = "";
    claw.querySelector(".machine-claw-head").appendChild(capsule);

    setStatus("Got it. Heading for the chute…");
    claw.classList.remove("is-dropping");
    await wait(600);

    claw.style.left = `${CHUTE_POSITION}%`;
    await wait(750);

    claw.classList.remove("is-closed");
    // Drop it the real distance down to the chute, measured rather than
    // guessed, so it lands in the opening at any size of glass.
    const chuteBox = chute ? chute.getBoundingClientRect() : null;
    if (chuteBox) {
      // `top` is measured from the claw head, so the drop is added to where
      // the capsule already hangs rather than replacing it.
      const drop = chuteBox.top - capsule.getBoundingClientRect().top;
      capsule.style.setProperty("--capsule-fall", `${capsule.offsetTop + Math.max(drop, 0)}px`);
    }
    capsule.classList.add("is-falling");
    // A shade longer than the fall itself, so the capsule is out of sight
    // behind the chute rim before it is taken off the page.
    await wait(520);

    const look = capsule.dataset.look;
    capsule.remove();
    fillPile();
    // Back to where it was aimed, ready for the next go.
    claw.style.left = `${position}%`;
    showPrize(topic);
    await deliverToCard(look);
    setBusy(false);
    machineIsEmpty();
  };

  // A whole turn without aiming: the claw lines itself up on a capsule picked
  // at random and drops on it, for anyone who would rather not play.
  const playForMe = () => {
    if (busy) {
      return;
    }
    const capsules = Array.from(pile.children);
    if (capsules.length === 0) {
      machineIsEmpty();
      return;
    }

    const capsule = capsules[Math.floor(Math.random() * capsules.length)];
    moveTo(parseFloat(capsule.style.left));
    setStatus("Lining up…");
    // Let the claw travel to the capsule before it drops on it.
    window.setTimeout(play, reducedMotion.matches ? 0 : 800);
  };

  // Holding a control walks the claw along the rail; a tap nudges it.
  let moving = 0;
  let movingFrame = null;
  let lastFrame = 0;

  const step = (now) => {
    if (!moving) {
      return;
    }
    const elapsed = lastFrame ? Math.min((now - lastFrame) / 1000, MAX_FRAME) : 0;
    lastFrame = now;
    moveTo(position + moving * MOVE_SPEED * elapsed);
    movingFrame = window.requestAnimationFrame(step);
  };

  function stopMoving() {
    moving = 0;
    lastFrame = 0;
    if (movingFrame) {
      window.cancelAnimationFrame(movingFrame);
      movingFrame = null;
    }
    claw.classList.remove("is-moving");
  }

  const startMoving = (direction) => {
    if (busy || moving === direction) {
      return;
    }
    stopMoving();
    moving = direction;
    claw.classList.add("is-moving");
    // One nudge up front, so a tap moves the claw even if it never sees a
    // frame while the control is down.
    moveTo(position + direction * NUDGE);
    movingFrame = window.requestAnimationFrame(step);
  };

  moveButtons.forEach((button) => {
    const direction = button.dataset.move === "right" ? 1 : -1;

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      startMoving(direction);
    });
    ["pointerup", "pointerleave", "pointercancel", "blur"].forEach((name) => {
      button.addEventListener(name, stopMoving);
    });
    // A keyboard press sends a click with no pointer behind it (detail 0),
    // and never the pointer events that walk the claw, so it nudges here. A
    // click that followed a tap has already been handled by those.
    button.addEventListener("click", (event) => {
      if (event.detail === 0) {
        moveTo(position + direction * NUDGE);
      }
    });
  });

  // The arrow keys drive the claw whenever the focus is on the machine.
  machine.addEventListener("keydown", (event) => {
    if (busy) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveTo(position - NUDGE);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveTo(position + NUDGE);
    }
  });

  if (dropButton) {
    dropButton.addEventListener("click", play);
  }

  if (skipButton) {
    skipButton.addEventListener("click", playForMe);
  }

  if (againButton) {
    againButton.addEventListener("click", () => {
      prize.hidden = true;
      if (dropButton && !dropButton.disabled) {
        dropButton.focus();
      }
    });
  }

  window.addEventListener("resize", () => {
    if (busy) {
      layOutPile();
    } else {
      fillPile();
    }
  });

  fillPile();
  moveTo(position);
})();
