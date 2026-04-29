const menuToggle = document.getElementById("menuToggle");
const mobileMenu = document.getElementById("mobileMenu");

if (menuToggle && mobileMenu) {
  menuToggle.addEventListener("click", () => {
    if (mobileMenu.style.display === "flex") {
      mobileMenu.style.display = "none";
    } else {
      mobileMenu.style.display = "flex";
    }
  });
}

const desktopSlides = document.querySelectorAll(".desktop-slide");
const mobileSlides = document.querySelectorAll(".mobile-slide");

let currentDesktopSlide = 0;
let currentMobileSlide = 0;

function showNextDesktopSlide() {
  if (desktopSlides.length === 0) return;

  desktopSlides[currentDesktopSlide].classList.remove("active");
  currentDesktopSlide = (currentDesktopSlide + 1) % desktopSlides.length;
  desktopSlides[currentDesktopSlide].classList.add("active");
}

function showNextMobileSlide() {
  if (mobileSlides.length === 0) return;

  mobileSlides[currentMobileSlide].classList.remove("active");
  currentMobileSlide = (currentMobileSlide + 1) % mobileSlides.length;
  mobileSlides[currentMobileSlide].classList.add("active");
}

if (desktopSlides.length > 1) {
  setInterval(showNextDesktopSlide, 4000);
}

if (mobileSlides.length > 1) {
  setInterval(showNextMobileSlide, 4000);
}

const contactForm = document.getElementById("contactForm");

if (contactForm) {
  contactForm.addEventListener("submit", function (e) {
    e.preventDefault();

    const name = document.getElementById("name")?.value.trim() || "";
    const phone = document.getElementById("phone")?.value.trim() || "";
    const email = document.getElementById("email")?.value.trim() || "";
    const subject = document.getElementById("subject")?.value.trim() || "";
    const message = document.getElementById("message")?.value.trim() || "";

    const whatsappNumber = "94775882525";

    const whatsappMessage =
      `Hello Celeste,\n\n` +
      `Name: ${name}\n` +
      `Phone: ${phone}\n` +
      `Email: ${email}\n` +
      `Subject: ${subject}\n` +
      `Message: ${message}`;

    const whatsappURL = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`;

    window.open(whatsappURL, "_blank");
  });
}

const locationSearch = document.getElementById("locationSearch");
const locationFilterButtons = document.querySelectorAll(".location-filter-btn");
const locationCards = document.querySelectorAll(".location-directory-card");
const locationsResultCount = document.getElementById("locationsResultCount");

let activeLocationFilter = "all";

function filterLocations() {
  if (!locationCards.length) return;

  const searchValue = locationSearch ? locationSearch.value.toLowerCase().trim() : "";
  let visibleCount = 0;

  locationCards.forEach((card) => {
    const category = (card.dataset.category || "").toLowerCase();
    const name = (card.dataset.name || "").toLowerCase();
    const area = (card.dataset.area || "").toLowerCase();

    const matchesFilter =
      activeLocationFilter === "all" || category === activeLocationFilter;

    const matchesSearch =
      name.includes(searchValue) || area.includes(searchValue);

    if (matchesFilter && matchesSearch) {
      card.classList.remove("hidden");
      visibleCount++;
    } else {
      card.classList.add("hidden");
    }
  });

  if (locationsResultCount) {
    locationsResultCount.textContent = `${visibleCount} location${visibleCount === 1 ? "" : "s"} found`;
  }
}

if (locationSearch) {
  locationSearch.addEventListener("input", filterLocations);
}

if (locationFilterButtons.length) {
  locationFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      locationFilterButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      activeLocationFilter = button.dataset.filter || "all";
      filterLocations();
    });
  });
}

filterLocations();

/* Scroll autoplay videos */
const scrollAutoplayVideos = document.querySelectorAll(".scroll-autoplay-video");

if (scrollAutoplayVideos.length > 0) {
  const videoObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target;

        if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    },
    {
      threshold: [0.25, 0.45, 0.7]
    }
  );

  scrollAutoplayVideos.forEach((video) => {
    videoObserver.observe(video);
  });
}

/* Just Celeste It - nearest Uber store */
const justCelesteButtons = document.querySelectorAll(".just-celeste-btn");

const celesteUberStores = [
  {
    name: "Colombo 06",
    lat: 6.8796,
    lng: 79.8711,
    uberUrl: "https://www.ubereats.com/store-browse-uuid/4f15f834-7050-4adc-8a5c-dbaef8e1f000?diningMode=DELIVERY"
  },
  {
    name: "Attidiya",
    lat: 6.8462,
    lng: 79.8840,
    uberUrl: "https://www.ubereats.com/store-browse-uuid/c1c99983-fd89-53fb-8bf7-f66ac4c69cbf?diningMode=DELIVERY"
  },
  {
    name: "Ethulkotte",
    lat: 6.9041,
    lng: 79.9053,
    uberUrl: "https://www.ubereats.com/store-browse-uuid/430c0cae-71db-5684-9b3f-6012241c011d?diningMode=DELIVERY"
  },
  {
    name: "Pannipitiya",
    lat: 6.8543,
    lng: 79.9493,
    uberUrl: "https://www.ubereats.com/store-browse-uuid/ae9ff179-10c6-5b81-b42d-2012ddbab1be?diningMode=DELIVERY"
  }
];

function getDistanceInKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function findNearestCelesteStore(userLat, userLng) {
  let nearestStore = null;
  let shortestDistance = Infinity;

  celesteUberStores.forEach((store) => {
    const distance = getDistanceInKm(userLat, userLng, store.lat, store.lng);

    if (distance < shortestDistance) {
      shortestDistance = distance;
      nearestStore = store;
    }
  });

  return nearestStore;
}

function setButtonLoadingState(button, isLoading) {
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }

    button.textContent = "Finding nearest store...";
    button.classList.add("is-loading");
    button.style.pointerEvents = "none";
    button.setAttribute("aria-disabled", "true");
  } else {
    button.textContent = button.dataset.originalText || "Just Celeste It";
    button.classList.remove("is-loading");
    button.style.pointerEvents = "";
    button.removeAttribute("aria-disabled");
  }
}

function openNearestCelesteStore(event) {
  event.preventDefault();

  const button = event.currentTarget;
  setButtonLoadingState(button, true);

  if (!navigator.geolocation) {
    alert("Location access is not supported on this device. Redirecting to Colombo 06 store.");
    setButtonLoadingState(button, false);
    window.open(celesteUberStores[0].uberUrl, "_blank");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const userLat = position.coords.latitude;
      const userLng = position.coords.longitude;

      const nearestStore = findNearestCelesteStore(userLat, userLng);

      setButtonLoadingState(button, false);

      if (nearestStore) {
        window.open(nearestStore.uberUrl, "_blank");
      } else {
        window.open(celesteUberStores[0].uberUrl, "_blank");
      }
    },
    () => {
      alert("We couldn't access your location. Redirecting to Colombo 06 store.");
      setButtonLoadingState(button, false);
      window.open(celesteUberStores[0].uberUrl, "_blank");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000
    }
  );
}

if (justCelesteButtons.length > 0) {
  justCelesteButtons.forEach((button) => {
    button.addEventListener("click", openNearestCelesteStore);
  });
}

const revealCards = document.querySelectorAll(".reveal-card");

if (revealCards.length) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
    }
  );

  revealCards.forEach((card) => {
    revealObserver.observe(card);
  });
}

/* Mobile dropdown menus */
const mobileDropdownToggles = document.querySelectorAll(".mobile-dropdown-toggle");

if (mobileDropdownToggles.length) {
  mobileDropdownToggles.forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      e.preventDefault();

      const dropdown = toggle.closest(".mobile-dropdown");

      document.querySelectorAll(".mobile-dropdown").forEach((item) => {
        if (item !== dropdown) {
          item.classList.remove("active");
        }
      });

      dropdown.classList.toggle("active");
    });
  });
}


