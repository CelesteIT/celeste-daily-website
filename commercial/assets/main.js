(() => {
  'use strict';
  const form = document.getElementById('propertyForm');
  const mapHost = document.getElementById('propertyMap');
  const message = document.getElementById('formMessage');
  const submitBtn = document.getElementById('submitBtn');
  let marker = null;
  let location = null;
  let map = null;
  const districts = {
    Ampara:[7.30,81.67], Anuradhapura:[8.31,80.40], Badulla:[6.99,81.06], Batticaloa:[7.72,81.70],
    Colombo:[6.927,79.861], Galle:[6.05,80.22], Gampaha:[7.09,80.00], Hambantota:[6.12,81.12],
    Jaffna:[9.66,80.02], Kalutara:[6.59,79.96], Kandy:[7.29,80.63], Kegalle:[7.25,80.34],
    Kilinochchi:[9.39,80.40], Kurunegala:[7.49,80.36], Mannar:[8.98,79.90], Matale:[7.47,80.62],
    Matara:[5.95,80.55], Monaragala:[6.87,81.35], Mullaitivu:[9.27,80.81],
    'Nuwara Eliya':[6.97,80.77], Polonnaruwa:[7.94,81.00], Puttalam:[8.04,79.84], Ratnapura:[6.68,80.40],
    Trincomalee:[8.57,81.23], Vavuniya:[8.75,80.50]
  };
  function report(text, ok = false) { message.textContent = text; message.classList.toggle('success', ok); message.hidden = !text; }
  function isSriLanka(lat, lng) { return lat >= 5.5 && lat <= 10.1 && lng >= 79.4 && lng <= 82.5; }
  function selectLocation(lat, lng) {
    if (!isSriLanka(lat, lng)) { report('Please choose a location in Sri Lanka.'); return; }
    report('');
    location = { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
    if (marker) marker.setLatLng([lat, lng]);
    else {
      marker = L.marker([lat, lng], { draggable: true, autoPan: true }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); selectLocation(p.lat, p.lng); });
    }
    document.getElementById('locationStatus').textContent = 'Property location selected ✓';
    document.getElementById('coords').textContent = `Coordinates: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
    const link = document.getElementById('mapsLink');
    link.href = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
    link.hidden = false;
  }
  if (typeof window.L === 'undefined') {
    mapHost.textContent = 'Map could not load. Please check your internet connection and reload this page.';
    report('The interactive map could not load. Please try again with an internet connection.');
  } else {
    map = L.map(mapHost, { scrollWheelZoom: false }).setView([7.85, 80.8], 8);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
      maxZoom: 19
    }).addTo(map);
    map.on('click', (e) => selectLocation(e.latlng.lat, e.latlng.lng));
    document.getElementById('district').addEventListener('change', (e) => {
      const point = districts[e.target.value];
      if (point) map.flyTo(point, 12, { duration: 0.8 });
    });
    document.getElementById('locateBtn').addEventListener('click', () => {
      if (!navigator.geolocation) { report('Your browser does not support location detection. Tap the map to place a pin.'); return; }
      navigator.geolocation.getCurrentPosition(
        p => { selectLocation(p.coords.latitude, p.coords.longitude); map.flyTo([p.coords.latitude, p.coords.longitude], 16); },
        () => report('Location access is unavailable. You can still tap the map to place the pin.'),
        { enableHighAccuracy: true, timeout: 12000 }
      );
    });
  }
  function getData() {
    const f = new FormData(form);
    return Object.fromEntries([...f.entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
  }
  function check(data) {
    const required = [
      ['full_name', 'Enter your full name.'], ['phone', 'Enter your contact number.'],
      ['email', 'Enter your email address.'], ['property_type', 'Select a property type.'],
      ['address', 'Enter the full property address.'], ['district', 'Select a district.'],
      ['city', 'Enter the city or town.']
    ];
    for (const [name, error] of required) {
      if (!data[name]) { const input = form.elements.namedItem(name); input?.focus?.(); return error; }
    }
    if (!/^\+?[\d\s().-]{9,22}$/.test(data.phone) || (data.phone.match(/\d/g) || []).length < 9) return 'Enter a valid contact number.';
    if (data.whatsapp && (!/^\+?[\d\s().-]{9,22}$/.test(data.whatsapp) || (data.whatsapp.match(/\d/g) || []).length < 9)) return 'Enter a valid WhatsApp number.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return 'Enter a valid email address.';
    if (data.full_name.length < 2 || data.address.length < 5 || data.city.length < 2) return 'Please add more detail to the name and address fields.';
    if (data.property_size && !(Number(data.property_size) > 0)) return 'Enter a positive property size.';
    if (!location) { mapHost.scrollIntoView({ behavior: 'smooth', block: 'center' }); return 'Click the map to place a pin at the property location.'; }
    if (!form.elements.namedItem('consent').checked) return 'Please confirm the details and agree to the contact notice.';
    return '';
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = getData();
    const error = check(data);
    if (error) { report(error); return; }
    data.consent = true;
    data.latitude = location.latitude;
    data.longitude = location.longitude;
    submitBtn.disabled = true;
    submitBtn.firstElementChild.textContent = 'Submitting registration…';
    report('');
    try {
      const response = await fetch('/commercial/api/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(data)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Submission failed. Please try again.');
      document.getElementById('referenceId').textContent = payload.reference;
      form.hidden = true;
      document.getElementById('successPanel').hidden = false;
      document.getElementById('successPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { report(e.message || 'Could not submit. Please try again later.'); }
    finally {
      submitBtn.disabled = false;
      submitBtn.firstElementChild.textContent = 'Submit property registration';
    }
  });
  document.getElementById('registerAnother').addEventListener('click', () => {
    form.reset();
    location = null;
    if (marker) { map.removeLayer(marker); marker = null; }
    document.getElementById('locationStatus').textContent = 'No location selected yet';
    document.getElementById('coords').textContent = 'Click anywhere on the map to place a property pin.';
    document.getElementById('mapsLink').hidden = true;
    document.getElementById('successPanel').hidden = true;
    form.hidden = false;
    report('');
    if (map) { map.setView([7.85,80.8], 8); setTimeout(() => map.invalidateSize(), 100); }
    document.getElementById('register').scrollIntoView({ behavior:'smooth' });
  });
})();
