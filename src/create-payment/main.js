// ===========================================================================
// Create / update a shopper and save a card (cloud-sdk)
//
// Flow: Email lookup → Profile → Address → Payment. The email step resolves an
// existing shopper or starts a new one; Address and Payment are optional and
// leave existing data untouched when skipped. Card capture uses the standalone
// LiquidCommercePaymentElement factory with createConfirmationToken() and
// confirmPaymentSession(), matching reservebar-app's "My Wallet → Add Card".
// ===========================================================================

// ── Config ─────────────────────────────────────────────────────────────────
// Same cloud target as the secured page (src/secured/main.js) so a shopper
// saved here is found when that page looks the user up by email.
const CLOUD_API_ENV = "prod";
const CLOUD_API_KEY = "712ef221200c9fe21e13ddd9f6a60dfe5823cf7d9f22570a15289aa6";
const GOOGLE_PLACES_API_KEY = "AIzaSyBSrLjV0Sj5ZV3ZSz8MLhCCULFQt8hzFwU"; // address autocomplete/details

// Field key → input-id maps, shared by the collect / prefill / reset helpers.
const PROFILE_FIELDS = {
  email: "f-email",
  firstName: "f-first",
  lastName: "f-last",
  phone: "f-phone",
  birthDate: "f-dob",
  company: "f-company",
};
const ADDRESS_FIELDS = {
  one: "a-one",
  two: "a-two",
  city: "a-city",
  state: "a-state",
  zip: "a-zip",
  country: "a-country",
};

// Button labels, keyed by whether the shopper already exists.
const LABELS = {
  profileSubmit: { new: "Create shopper", existing: "Update shopper" },
  addressSubmit: { new: "Save address & continue", existing: "Update address & continue" },
  addressSkip: { new: "Skip", existing: "Keep current" },
  paymentSubmit: { new: "Save card", existing: "Replace card" },
  paymentSkip: { new: "Skip & finish", existing: "Keep current card" },
};

// ── DOM + logging helpers ────────────────────────────────────────────────────
const byId = (id) => document.getElementById(id);
const getField = (id) => byId(id).value.trim();
const setField = (id, value) => { byId(id).value = value ?? ""; };
const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

const logEl = byId("activity-log");
function log(message) {
  console.log("[create-payment]", message);
  logEl.textContent += `${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// Read the inputs named by `fieldMap` (output key → input id), keeping only the
// non-empty values.
function collectFields(fieldMap) {
  const result = {};
  for (const [key, id] of Object.entries(fieldMap)) {
    const value = getField(id);
    if (value) result[key] = value;
  }
  return result;
}

// ── Validation ────────────────────────────────────────────────────────────────
// Mirror the backend DTO rules so a bad value is caught here with a clear
// message instead of surfacing as an opaque server-side validation error.

// birthDate must be strict ISO 8601 with a 4-digit year, e.g. "2000-02-12".
function isValidBirthDate(value) {
  if (!value) return true; // optional
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

// phone needs ≥10 digits: US is 10 or 11 (11 must start with 1); an
// international number must start with "+".
function isValidPhone(value) {
  if (!value) return true; // optional
  const cleaned = value.replace(/[^\d+]/g, "");
  if (cleaned.length < 10) return false;
  if (cleaned.startsWith("+1")) return cleaned.length === 11;
  if (cleaned.startsWith("+")) return cleaned.length >= 8 && cleaned.length <= 16;
  if (cleaned.length === 10 || cleaned.length === 11) {
    return !(cleaned.length === 11 && !cleaned.startsWith("1"));
  }
  return false;
}

// Build a readable, multi-line message from a thrown SDK error. Field-level
// detail lives in `err.errors` (each with `.property` / `.constraints`); the
// user route reports those under a generic "not found" message, so relabel it.
function describeError(err) {
  const payload = err?.response?.data ?? err?.data ?? err ?? {};
  const errors = Array.isArray(payload?.errors)
    ? payload.errors
    : Array.isArray(err?.errors)
    ? err.errors
    : [];
  let baseMsg = payload?.message ?? err?.message ?? String(err);
  if (errors.length && /not.?found/i.test(baseMsg)) baseMsg = "Validation failed";
  const lines = [baseMsg];
  for (const e of errors) {
    const field = e?.property ?? e?.field ?? "field";
    const detail = e?.constraints
      ? Object.values(e.constraints).join("; ")
      : e?.message ?? JSON.stringify(e);
    lines.push(`• ${field}: ${detail}`);
  }
  return lines.join("\n");
}

// Run an async action with a button in a "busy" state, restoring it afterwards.
async function runWithButton(button, busyLabel, action) {
  const idleLabel = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await action();
  } catch (err) {
    console.error(err);
    log(describeError(err));
  } finally {
    button.disabled = false;
    button.textContent = idleLabel;
  }
}

// ── Step navigation ─────────────────────────────────────────────────────────
const STEP_ORDER = ["profile", "address", "payment"];
const stepStates = { profile: "active", address: "locked", payment: "locked" };

function renderSteps() {
  for (const step of STEP_ORDER) {
    byId(`card-${step}`).dataset.state = stepStates[step];
    document.querySelector(`.steps li[data-step="${step}"]`).dataset.state = stepStates[step];
  }
}

// Mark a step done and activate (and, for payment, mount) the next one.
function completeStep(step) {
  stepStates[step] = "done";
  const nextStep = STEP_ORDER[STEP_ORDER.indexOf(step) + 1];
  if (nextStep && stepStates[nextStep] === "locked") stepStates[nextStep] = "active";
  renderSteps();
  if (nextStep === "payment" && stepStates.payment === "active") mountPaymentElement();
}

function showStepSummary(step, summaryHtml) {
  byId(`card-${step}`).querySelector(".card-summary").innerHTML =
    `<div class="sum-text">${summaryHtml}</div><button type="button" class="link" data-edit="${step}">Edit</button>`;
}

// Re-open a completed step from its "Edit" link.
document.addEventListener("click", (e) => {
  const step = e.target?.dataset?.edit;
  if (!step) return;
  stepStates[step] = "active";
  renderSteps();
});

// ── Shared state ──────────────────────────────────────────────────────────────
let cloud = null;
let customerId = null;
let customerEmail = null;
let paymentElement = null;
let isPaymentMounted = false;
const selectedPlace = { lat: null, long: null, placesId: null };
// The shopper's saved address / cards, used to purge stale records so an update
// leaves exactly the address + card entered here (no duplicates).
let existingAddresses = [];
let existingPayments = [];
// Whether the looked-up email resolved to a populated shopper (drives labels).
let isExistingShopper = false;

// ── SDK init ──────────────────────────────────────────────────────────────────
(async () => {
  cloud = await window.LiquidCommerce(CLOUD_API_KEY, {
    env: CLOUD_API_ENV,
    googlePlacesApiKey: GOOGLE_PLACES_API_KEY,
  });
  log("SDK ready");
  if (!GOOGLE_PLACES_API_KEY) {
    const hint = byId("addr-hint");
    hint.classList.add("warn");
    hint.textContent = "No Google Places API key set — autocomplete is disabled. Enter the address fields manually.";
  }
})().catch((err) => {
  console.error(err);
  log(`Init error: ${err?.message ?? err}`);
});

// ── Step 1 — Shopper (email lookup → profile) ─────────────────────────────────

// Populate every step's fields and labels from a resolved shopper.
function applyShopperToSteps(user) {
  const key = isExistingShopper ? "existing" : "new";

  // Profile.
  setField("f-first", user.firstName || "");
  setField("f-last", user.lastName || "");
  setField("f-phone", user.phone || "");
  setField("f-dob", (user.birthDate || "").split("T")[0]);
  setField("f-company", user.company || "Ralph Lauren"); // demo default when unset

  const status = byId("profile-status");
  status.className = `status ${key}`;
  status.textContent = isExistingShopper
    ? "Existing shopper — edit the details below, then Update."
    : "New shopper — fill in the details, then Create.";
  byId("profile-submit").textContent = LABELS.profileSubmit[key];

  // Address — prefill the default (or first) saved address, matching its
  // street / placesId / coords so an unedited save updates it in place.
  const addr = existingAddresses.find((a) => a.isDefault) || existingAddresses[0];
  if (addr) {
    setField("a-one", addr.one);
    setField("a-two", addr.two);
    setField("a-city", addr.city);
    setField("a-state", addr.state);
    setField("a-zip", addr.zip);
    setField("a-country", addr.country || "US");
    selectedPlace.placesId = addr.placesId ?? null;
    selectedPlace.lat = addr.lat ?? null;
    selectedPlace.long = addr.long ?? null;

    const addrStatus = byId("address-status");
    addrStatus.hidden = false;
    addrStatus.className = "status existing";
    addrStatus.textContent = "This shopper has a saved address below — edit it, or keep it as is.";
    byId("address-submit").textContent = LABELS.addressSubmit.existing;
    byId("skip-address").textContent = LABELS.addressSkip.existing;
  }

  // Payment — card details live in Stripe (read-only here); show what's on file.
  showCurrentCard(existingPayments);
}

// Render the card currently on file (if any) and relabel the payment buttons.
function showCurrentCard(payments) {
  const pm = payments.find((p) => p.isDefault) || payments[0];
  const el = byId("current-card");
  if (!pm?.card) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML =
    `Current card: <span class="chip">${escapeHtml(pm.card.brand || "card")}</span> ` +
    `•••• ${escapeHtml(pm.card.last4 || "")} · exp ` +
    `${escapeHtml(String(pm.card.expMonth || ""))}/${escapeHtml(String(pm.card.expYear || ""))}`;
  byId("save-card").textContent = LABELS.paymentSubmit.existing;
  byId("skip-payment").textContent = LABELS.paymentSkip.existing;
}

// Reset the address / payment steps to their "new shopper" defaults, so
// switching emails never leaves a prior shopper's data behind.
function resetStepsUi() {
  Object.values(ADDRESS_FIELDS).forEach((id) => setField(id, id === "a-country" ? "US" : ""));
  selectedPlace.lat = null;
  selectedPlace.long = null;
  selectedPlace.placesId = null;

  const addrStatus = byId("address-status");
  addrStatus.hidden = true;
  addrStatus.textContent = "";
  byId("address-submit").textContent = LABELS.addressSubmit.new;
  byId("skip-address").textContent = LABELS.addressSkip.new;

  byId("current-card").hidden = true;
  byId("save-card").textContent = LABELS.paymentSubmit.new;
  byId("skip-payment").textContent = LABELS.paymentSkip.new;
}

// Look the shopper up by email. session() is an upsert (there's no read-by-email
// endpoint): a missing email is created as an empty shell here and filled in on
// the profile save — the result is the same either way.
byId("email-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = getField("f-email");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    log("Enter a valid email to continue.");
    return;
  }
  runWithButton(e.submitter, "Checking…", async () => {
    resetStepsUi();
    const { data: user } = await cloud.user.session({ email });
    customerId = user.id;
    customerEmail = user.email;
    existingAddresses = user.addresses || [];
    existingPayments = user.savedPayments || [];
    isExistingShopper = Boolean(
      user.firstName || user.lastName || user.phone ||
      existingAddresses.length || existingPayments.length
    );
    log(`shopper ${isExistingShopper ? "found" : "is new"}: ${customerId} (${customerEmail})`);

    applyShopperToSteps(user);

    byId("email-form").hidden = true;
    byId("profile-form").hidden = false;
    byId("f-first").focus();
  });
});

// Switch shoppers by returning to the email lookup.
byId("change-email").addEventListener("click", () => {
  byId("profile-form").hidden = true;
  byId("email-form").hidden = false;
  byId("f-email").focus();
});

// Save the profile. session() upserts, targeted by id once the lookup resolved it.
byId("profile-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!getField("f-first")) {
    log("First name is required");
    return;
  }
  if (!isValidBirthDate(getField("f-dob"))) {
    log("Date of birth must be a valid date in YYYY-MM-DD form with a 4-digit year (e.g. 2000-02-12).");
    return;
  }
  if (!isValidPhone(getField("f-phone"))) {
    log("Phone must have at least 10 digits — a US number (10 digits) or an international number starting with +.");
    return;
  }
  runWithButton(e.submitter, isExistingShopper ? "Updating…" : "Creating…", async () => {
    const profile = collectFields(PROFILE_FIELDS);
    if (customerId) profile.id = customerId; // target the resolved shopper by id

    const { data: user } = await cloud.user.session(profile);
    customerId = user.id;
    customerEmail = user.email;
    log(`1) ${isExistingShopper ? "updated" : "created"} shopper: ${customerId} (${customerEmail})`);

    const fullName = `${profile.firstName} ${profile.lastName ?? ""}`.trim();
    showStepSummary("profile", `${fullName} · ${customerEmail}`);
    completeStep("profile");
  });
});

// ── Step 2 — Address (Google Places autocomplete) ──────────────────────────────
const addressSearchEl = byId("addr-search");
const suggestionsEl = byId("addr-suggestions");
let autocompleteTimer;

const hideSuggestions = () => {
  suggestionsEl.hidden = true;
  suggestionsEl.innerHTML = "";
};

addressSearchEl.addEventListener("input", () => {
  const query = addressSearchEl.value.trim();
  clearTimeout(autocompleteTimer);
  // The SDK's Places lookup only resolves queries that start with a street number.
  if (!GOOGLE_PLACES_API_KEY || query.length < 3 || !/^\d/.test(query)) {
    hideSuggestions();
    return;
  }
  autocompleteTimer = setTimeout(async () => {
    try {
      const { data: suggestions = [] } = await cloud.address.autocomplete({ input: query });
      if (!suggestions.length) return hideSuggestions();
      suggestionsEl.innerHTML = suggestions
        .map((s) => `<li data-id="${escapeHtml(s.id)}">${escapeHtml(s.description)}</li>`)
        .join("");
      suggestionsEl.hidden = false;
    } catch (err) {
      console.error(err);
      log(`autocomplete error: ${err?.message ?? err}`);
      hideSuggestions();
    }
  }, 300);
});

// Pick a suggestion → fetch its details → fill the address fields.
suggestionsEl.addEventListener("click", async (e) => {
  const item = e.target.closest("li[data-id]");
  if (!item) return;
  addressSearchEl.value = item.textContent;
  hideSuggestions();
  try {
    const { data: details = {} } = await cloud.address.details({ id: item.dataset.id });
    const address = details.address ?? {};
    setField("a-one", address.one);
    setField("a-two", address.two);
    setField("a-city", address.city);
    setField("a-state", address.state);
    setField("a-zip", address.zip);
    setField("a-country", address.country || "US");
    selectedPlace.lat = details.coords?.lat ?? null;
    selectedPlace.long = details.coords?.long ?? null;
    selectedPlace.placesId = item.dataset.id;
    log(`address selected: ${details.formattedAddress ?? "(filled)"}`);
  } catch (err) {
    console.error(err);
    log(`details error: ${err?.message ?? err}`);
  }
});

// Close the dropdown when clicking outside it.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".autocomplete")) hideSuggestions();
});

// Save the address. addAddress upserts by match key (street / placesId / coords),
// so a changed address inserts a new row — purge the rest to keep exactly one.
byId("address-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!getField("a-one") || !getField("a-city") || !getField("a-state") || !getField("a-zip")) {
    log("Address line 1, city, state and ZIP are required");
    return;
  }
  runWithButton(e.submitter, "Saving…", async () => {
    const address = {
      customerId,
      type: "shipping",
      isDefault: true,
      ...collectFields(ADDRESS_FIELDS),
    };
    if (selectedPlace.lat != null) address.lat = selectedPlace.lat;
    if (selectedPlace.long != null) address.long = selectedPlace.long;
    if (selectedPlace.placesId) address.placesId = selectedPlace.placesId;

    const { data: saved } = await cloud.user.addAddress(address);
    log(`2) saved address: ${saved?.id ?? "(ok)"}`);
    await purgeAddressesExcept(existingAddresses, saved?.id);
    existingAddresses = saved ? [saved] : [];
    showStepSummary(
      "address",
      `${address.one}${address.two ? `, ${address.two}` : ""}, ${address.city}, ${address.state} ${address.zip}`
    );
    completeStep("address");
  });
});

// The address is optional — skipping leaves any saved address untouched.
byId("skip-address").addEventListener("click", () => {
  showStepSummary(
    "address",
    isExistingShopper && existingAddresses.length ? "Kept existing address" : "Skipped — no address added"
  );
  completeStep("address");
});

// Remove every saved address except `keepId`. Non-defaults go first — the backend
// refuses to purge a default address while others still exist.
async function purgeAddressesExcept(addresses, keepId) {
  const toPurge = (addresses || [])
    .filter((a) => a?.id && a.id !== keepId)
    .sort((a, b) => (a.isDefault ? 1 : 0) - (b.isDefault ? 1 : 0));
  for (const addr of toPurge) {
    try {
      await cloud.user.purgeAddress(addr.id);
      log(`removed old address ${addr.id}`);
    } catch (err) {
      log(`could not remove old address ${addr.id}: ${err?.message ?? err}`);
    }
  }
}

// ── Step 3 — Payment ────────────────────────────────────────────────────────────
async function mountPaymentElement() {
  if (isPaymentMounted) return;
  isPaymentMounted = true;
  try {
    log("creating payment session…");
    const { data: session } = await cloud.user.paymentSession({ customerId, customerEmail });
    if (!session?.key || !session?.secret) throw new Error("payment session is missing key/secret");

    const paymentOptions = {
      session: { key: session.key, secret: session.secret, createdAt: new Date() },
      elementId: "payment-element",
      appearance: { theme: "stripe" },
      elementOptions: { layout: "tabs" },
    };
    // The cloud-sdk UMD exposes the element factory at window.LiquidCommercePaymentElement.
    paymentElement = window.LiquidCommercePaymentElement(paymentOptions);
    await paymentElement.mount(paymentOptions);

    paymentElement.subscribe("ready", () => {
      byId("save-card").disabled = false;
      log("3) card form ready — enter a card");
    });
    paymentElement.subscribe("loaderror", (event) => {
      log(`card load error: ${event?.error?.message ?? "unknown"}`);
    });
  } catch (err) {
    isPaymentMounted = false;
    console.error(err);
    log(`payment mount error: ${err?.message ?? err}`);
  }
}

// Save the card: confirmation token → confirm session → attach to the shopper.
byId("save-card").addEventListener("click", (e) => {
  runWithButton(e.currentTarget, "Saving…", async () => {
    // Confirmation token (runs client-side 3DS / confirmSetup when needed).
    // Success → { token }; failure → ILiquidPaymentError ({ type, message, code }).
    const tokenResult = await paymentElement.createConfirmationToken();
    if (!tokenResult?.token) {
      const errType = tokenResult?.type ?? "error";
      const errCode = tokenResult?.code ? ` #${tokenResult.code}` : "";
      console.error("[create-payment] createConfirmationToken returned:", tokenResult);
      log(`token error (${errType}${errCode}): ${tokenResult?.message ?? "no token returned"}`);
      return;
    }

    // Confirm the session → resolves the payment method id.
    const { data: confirmation } = await cloud.user.confirmPaymentSession(tokenResult.token);
    const paymentMethodId = confirmation?.id;
    if (!paymentMethodId) {
      console.error("[create-payment] confirmPaymentSession returned:", confirmation);
      log("confirm error: no payment method id returned");
      return;
    }
    log(`payment method id: ${paymentMethodId}`);

    // Attach as the default card, then purge older cards so exactly one remains.
    const { data: saved } = await cloud.user.addPayment({ customerId, paymentMethodId, isDefault: true });
    log(`saved payment method to user: ${saved?.id ?? paymentMethodId}`);
    await purgePaymentsExcept(existingPayments, saved?.id);
    existingPayments = saved ? [saved] : [];

    completeStep("payment");
    paymentElement.unmount();
    paymentElement.destroy();
    finish();
  });
});

// The card is optional — skipping tears down the form and leaves any saved card
// untouched.
byId("skip-payment").addEventListener("click", () => {
  if (paymentElement) {
    try { paymentElement.unmount(); paymentElement.destroy(); } catch (_) {}
  }
  completeStep("payment");
  finish();
});

// Remove every saved card except `keepId`. A card can't be edited in place — its
// details live in Stripe — so replacing one means add-new + purge-old.
async function purgePaymentsExcept(payments, keepId) {
  const toPurge = (payments || []).filter((p) => p?.id && p.id !== keepId);
  for (const pm of toPurge) {
    try {
      await cloud.user.purgePayment(customerId, pm.id);
      log(`removed old card ${pm.id}`);
    } catch (err) {
      log(`could not remove old card ${pm.id}: ${err?.message ?? err}`);
    }
  }
}

// Show the success banner (after saving a card, skipping payment, or a
// profile-only update).
function finish() {
  const done = byId("done");
  done.hidden = false;
  done.innerHTML =
    `<strong>All set 🎉</strong><br/>Shopper <b>${escapeHtml(customerEmail)}</b> is saved and up to date. ` +
    `Go to <a href="/secured/">the secured store</a> and sign in with this email — whatever profile, address ` +
    `and payment details are on file will be prefilled at checkout.`;
}
