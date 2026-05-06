// Main UI references used by the planner interactions.
const stationButtons = document.querySelectorAll("[data-station]");
const universityButtons = document.querySelectorAll("[data-university]");
const confirmButton = document.querySelector("[data-confirm-button]");
const selectionNote = document.querySelector("[data-selection-note]");
const confirmFeedback = document.querySelector("[data-confirm-feedback]");
const routePanel = document.querySelector("[data-route-panel]");
const routeStart = document.querySelector("[data-route-start]");
const routeDestination = document.querySelector("[data-route-destination]");
const boardingTime = document.querySelector("[data-boarding-time]");
const arrivalTime = document.querySelector("[data-arrival-time]");
const trainArrivalTime = document.querySelector("[data-train-arrival-time]");
const walkDuration = document.querySelector("[data-walk-duration]");
const delayBadge = document.querySelector("[data-delay-badge]");
const primaryNote = document.querySelector("[data-primary-note]");
const routeStops = document.querySelector("[data-route-stops]");
const backupCard = document.querySelector("[data-backup-card]");
const backupStatus = document.querySelector("[data-backup-status]");
const backupBoardingTime = document.querySelector("[data-backup-boarding-time]");
const backupArrivalTime = document.querySelector("[data-backup-arrival-time]");
const backupTrainArrivalTime = document.querySelector("[data-backup-train-arrival-time]");
const backupWalkDuration = document.querySelector("[data-backup-walk-duration]");
const backupRouteStart = document.querySelector("[data-backup-route-start]");
const backupRouteDestination = document.querySelector("[data-backup-route-destination]");
const backupNote = document.querySelector("[data-backup-note]");
const classTimeInput = document.querySelector("[data-class-time]");
const walkTimeInput = document.querySelector("[data-walk-time]");
const termsOpenButton = document.querySelector("[data-terms-open]");
const termsModal = document.querySelector("[data-terms-modal]");
const termsCloseButtons = document.querySelectorAll("[data-terms-close]");

let selectedStation = document.querySelector(".station-card-active")?.dataset.station ?? "";
let selectedUniversity = document.querySelector(".switch-chip-active")?.dataset.university ?? "";

const scheduleData = window.trainScheduleData ?? {
  stations: [],
  universities: {},
  defaultWalkingMinutes: {},
  services: [],
};

const stations = scheduleData.stations;
const services = scheduleData.services;
const universityStationMap = scheduleData.universities;
const defaultWalkingMinutes = scheduleData.defaultWalkingMinutes;
// Backup train can still be shown if the delay stays within this limit.
const BACKUP_DELAY_ALLOWANCE_MINUTES = 30;

// Convert HH:MM into minutes to make comparisons easier.
function timeToMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

// Convert minutes back into HH:MM for the visible cards.
function minutesToTime(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60).toString().padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

// Decide whether the trip is going toward Thennia or back to Algiers.
function getRouteDirection(startStation, destinationStation) {
  const startIndex = stations.indexOf(startStation);
  const destinationIndex = stations.indexOf(destinationStation);

  if (startIndex === -1 || destinationIndex === -1) {
    return "algiers-to-thennia";
  }

  return startIndex <= destinationIndex ? "algiers-to-thennia" : "thennia-to-algiers";
}

// Build the list of stations shown in the route preview card.
function buildRoute() {
  const destinationStation = universityStationMap[selectedUniversity] ?? "باب الزوار";
  const startIndex = stations.indexOf(selectedStation);
  const destinationIndex = stations.indexOf(destinationStation);

  if (startIndex === -1 || destinationIndex === -1) {
    return { destinationStation, visibleStops: [selectedStation] };
  }

  const step = startIndex <= destinationIndex ? 1 : -1;
  const visibleStops = [];

  for (let index = startIndex; index !== destinationIndex + step; index += step) {
    visibleStops.push(stations[index]);
  }

  return { destinationStation, visibleStops };
}

// Keep only train services that can serve both the chosen start and destination.
function getCandidateServices(destinationStation, walkMinutes) {
  const routeDirection = getRouteDirection(selectedStation, destinationStation);

  return services
    .filter((service) => service.direction === routeDirection)
    .filter((service) => service.stops?.[selectedStation] && service.stops?.[destinationStation])
    .map((service) => {
      const boarding = timeToMinutes(service.stops[selectedStation]);
      const stationArrival = timeToMinutes(service.stops[destinationStation]);
      const universityArrival = stationArrival + walkMinutes;

      return {
        ...service,
        boarding,
        stationArrival,
        universityArrival,
      };
    })
    .filter((service) => service.boarding < service.stationArrival)
    .sort((a, b) => a.boarding - b.boarding);
}

// Choose the best train first, then the next acceptable one as backup.
function findServiceOptions(destinationStation, classTime, walkMinutes) {
  const classStartMinutes = timeToMinutes(classTime);
  const candidates = getCandidateServices(destinationStation, walkMinutes);

  if (!candidates.length) {
    return { primary: null, backup: null };
  }

  const onTimeServices = candidates.filter((service) => service.universityArrival <= classStartMinutes);
  let primary = onTimeServices.at(-1) ?? null;

  if (!primary) {
    primary =
      candidates.find(
        (service) => service.universityArrival <= classStartMinutes + BACKUP_DELAY_ALLOWANCE_MINUTES
      ) ?? null;
  }

  if (!primary) {
    return { primary: null, backup: null };
  }

  const primaryIndex = candidates.findIndex((service) => service.id === primary.id);
  const backup =
    candidates
      .slice(primaryIndex + 1)
      .find((service) => service.universityArrival <= classStartMinutes + BACKUP_DELAY_ALLOWANCE_MINUTES) ?? null;

  return { primary, backup };
}

// Generate the small status text shown on each train card.
function getServiceStatus(service, classStartMinutes) {
  const delta = service.universityArrival - classStartMinutes;

  if (delta <= 0) {
    const earlyMinutes = Math.abs(delta);
    return {
      badge: `رحلة ${service.id}`,
      note:
        earlyMinutes === 0
          ? "هذا القطار يوصلك في وقت بداية الحصة تمامًا."
          : `هذا القطار يوصلك قبل الحصة بـ ${earlyMinutes} دقيقة.`,
    };
  }

  return {
    badge: `تأخر ${delta} د`,
    note: `يمكن اعتماد هذا القطار إذا كان التأخر المقبول لديك حتى ${delta} دقيقة.`,
  };
}

// Fill either the main card or the backup card using the same renderer.
function renderServiceCard(service, options) {
  const {
    classStartMinutes,
    boardingTarget,
    trainArrivalTarget,
    universityArrivalTarget,
    statusTarget,
    noteTarget,
    walkTarget,
    startTarget,
    destinationTarget,
  } = options;

  const status = getServiceStatus(service, classStartMinutes);

  boardingTarget.textContent = minutesToTime(service.boarding);
  trainArrivalTarget.textContent = minutesToTime(service.stationArrival);
  universityArrivalTarget.textContent = minutesToTime(service.universityArrival);
  statusTarget.textContent = status.badge;
  noteTarget.textContent = status.note;

  if (walkTarget) {
    walkTarget.textContent = `${service.walkMinutes} دقائق`;
  }

  if (startTarget) {
    startTarget.textContent = selectedStation;
  }

  if (destinationTarget) {
    destinationTarget.textContent = service.destinationStation;
  }
}

// Recompute the visible result cards every time inputs change.
function renderRoutePreview() {
  if (!routePanel || !routeStart || !routeDestination || !boardingTime || !arrivalTime || !routeStops) {
    return;
  }

  const { destinationStation, visibleStops } = buildRoute();
  const classTime = classTimeInput?.value || "11:00";
  const classStartMinutes = timeToMinutes(classTime);
  const walkMinutes = Number(walkTimeInput?.value || defaultWalkingMinutes[selectedUniversity] || 10);
  const { primary, backup } = findServiceOptions(destinationStation, classTime, walkMinutes);

  routeStart.textContent = selectedStation;
  routeDestination.textContent = destinationStation;

  if (walkDuration) {
    walkDuration.textContent = `${walkMinutes} دقائق`;
  }

  if (primary) {
    primary.walkMinutes = walkMinutes;
    primary.destinationStation = destinationStation;

    renderServiceCard(primary, {
      classStartMinutes,
      boardingTarget: boardingTime,
      trainArrivalTarget: trainArrivalTime,
      universityArrivalTarget: arrivalTime,
      statusTarget: delayBadge,
      noteTarget: primaryNote,
      walkTarget: walkDuration,
      startTarget: routeStart,
      destinationTarget: routeDestination,
    });
  } else {
    const fallbackArrival = classStartMinutes + BACKUP_DELAY_ALLOWANCE_MINUTES;
    boardingTime.textContent = "--:--";
    trainArrivalTime.textContent = "--:--";
    arrivalTime.textContent = minutesToTime(fallbackArrival);
    delayBadge.textContent = "لا توجد رحلة مناسبة";
    if (primaryNote) {
      primaryNote.textContent = "لا توجد رحلة مناسبة ضمن الوقت الحالي أو ضمن هامش التأخر الاحتياطي.";
    }
  }

  if (backup && backupCard && backupStatus && backupBoardingTime && backupArrivalTime && backupTrainArrivalTime && backupWalkDuration && backupRouteStart && backupRouteDestination && backupNote) {
    backup.walkMinutes = walkMinutes;
    backup.destinationStation = destinationStation;

    renderServiceCard(backup, {
      classStartMinutes,
      boardingTarget: backupBoardingTime,
      trainArrivalTarget: backupTrainArrivalTime,
      universityArrivalTarget: backupArrivalTime,
      statusTarget: backupStatus,
      noteTarget: backupNote,
      walkTarget: backupWalkDuration,
      startTarget: backupRouteStart,
      destinationTarget: backupRouteDestination,
    });

    backupCard.removeAttribute("hidden");
  } else if (backupCard) {
    backupCard.setAttribute("hidden", "");
  }

  routeStops.innerHTML = visibleStops
    .map((stop, index) => {
      const classes = [
        "route-stop",
        index === 0 ? "is-start" : "",
        stop === destinationStation ? "is-destination" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const label =
        index === 0 ? "الانطلاق" : stop === destinationStation ? "محطة الجامعة" : "مرور";

      return `
        <article class="${classes}">
          <small>${label}</small>
          <strong>${stop}</strong>
        </article>
      `;
    })
    .join("");

  if (!primary) {
    routeStops.insertAdjacentHTML(
      "beforeend",
      `
        <article class="route-stop">
          <small>تنبيه</small>
          <strong>لا يوجد قطار مناسب ضمن الوقت الحالي أو ضمن حد التأخر الاحتياطي.</strong>
        </article>
      `
    );
  }
}

// Update the text under the station selector and the confirm button label.
function updateSummaryText() {
  if (!confirmButton || !selectionNote) return;

  confirmButton.innerHTML = `
    <span class="material-symbols-outlined">check_circle</span>
    موافق، الانطلاق من ${selectedStation}
  `;

  selectionNote.innerHTML = `
    <span class="material-symbols-outlined">touch_app</span>
    المحطة الحالية: <strong>${selectedStation}</strong>، والوجهة الجامعية المختارة: <strong>${selectedUniversity}</strong>.
  `;
}

// Reveal the result section after the user confirms their choice.
function showConfirmation() {
  if (!confirmButton || !confirmFeedback) return;

  confirmButton.classList.add("is-confirmed");
  confirmFeedback.textContent = `تم اختيار محطة ${selectedStation} والانطلاق باتجاه ${selectedUniversity}.`;
  confirmFeedback.classList.add("is-visible");
  renderRoutePreview();
  routePanel?.removeAttribute("hidden");
  routePanel?.scrollIntoView({ behavior: "smooth", block: "start" });

  window.setTimeout(() => {
    confirmButton.classList.remove("is-confirmed");
  }, 350);
}

// Simple open/close helpers for the terms modal.
function openTermsModal() {
  termsModal?.removeAttribute("hidden");
  document.body.style.overflow = "hidden";
}

function closeTermsModal() {
  if (!termsModal) return;

  termsModal.setAttribute("hidden", "");
  document.body.style.overflow = "";
}

function rerenderIfVisible() {
  if (!routePanel?.hasAttribute("hidden")) {
    renderRoutePreview();
  }
}

function setWalkTimeFromUniversity() {
  if (walkTimeInput && defaultWalkingMinutes[selectedUniversity]) {
    walkTimeInput.value = String(defaultWalkingMinutes[selectedUniversity]);
  }
}

stationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    stationButtons.forEach((item) => {
      item.classList.remove("station-card-active");

      const status = item.querySelector("small");
      if (status && status.textContent.trim() === "محددة الآن") {
        status.textContent = "على نفس الخط";
      }
    });

    button.classList.add("station-card-active");
    selectedStation = button.dataset.station ?? "";

    const status = button.querySelector("small");
    if (status) {
      status.textContent = "محددة الآن";
    }

    button.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });

    updateSummaryText();
    rerenderIfVisible();
  });
});

universityButtons.forEach((button) => {
  button.addEventListener("click", () => {
    universityButtons.forEach((item) => item.classList.remove("switch-chip-active"));
    button.classList.add("switch-chip-active");
    selectedUniversity = button.dataset.university ?? "";
    setWalkTimeFromUniversity();

    updateSummaryText();
    rerenderIfVisible();
  });
});

confirmButton?.addEventListener("click", showConfirmation);
classTimeInput?.addEventListener("input", renderRoutePreview);
walkTimeInput?.addEventListener("input", renderRoutePreview);
termsOpenButton?.addEventListener("click", openTermsModal);
termsCloseButtons.forEach((button) => button.addEventListener("click", closeTermsModal));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTermsModal();
  }
});

updateSummaryText();
