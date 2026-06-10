// ===========================================================================
// Create shopper + save card (cloud-sdk)
//
// A three-step flow — Profile → Address → Payment — that creates a shopper,
// saves a shipping address (with Google Places autocomplete), and stores a
// card against the user. The card flow mirrors reservebar-app's working
// "My Wallet" → Add Card: the standalone `LiquidCommercePaymentElement` factory
// + `createConfirmationToken()` + `user.confirmPaymentSession()`.
// ===========================================================================

// ── Config ─────────────────────────────────────────────────────────────────
// Uses the SAME cloud target as the secured page (src/secured/main.js) so a
// shopper created here is found when that page looks the user up by email.
// const CLOUD_API_KEY = "712ef221200c9fe21e13ddd9f6a60dfe5823cf7d9f22570a15289aa6";
const CLOUD_API_ENV = "prod";
const CLOUD_API_KEY = "712ef221200c9fe21e13ddd9f6a60dfe5823cf7d9f22570a15289aa6";
const GOOGLE_PLACES_API_KEY = "AIzaSyBSrLjV0Sj5ZV3ZSz8MLhCCULFQt8hzFwU"; // address autocomplete/details

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

// Read several inputs at once, keeping only the non-empty ones.
// `fieldMap` maps an output key → input element id, e.g. { firstName: "f-first" }.
function collectFields(fieldMap) {
  const result = {};
  for (const [key, id] of Object.entries(fieldMap)) {
    const value = getField(id);
    if (value) result[key] = value;
  }
  return result;
}

// Run an async action with a button in a "busy" state; restore it on failure.
async function runWithButton(button, busyLabel, action) {
  const idleLabel = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await action();
  } catch (err) {
    console.error(err);
    log(`Error: ${err?.message ?? err}`);
    button.disabled = false;
    button.textContent = idleLabel;
  }
}

// ── Step navigation ──────────────────────────────────────────────────────────
const STEP_ORDER = ["profile", "address", "payment"];
const stepStates = { profile: "active", address: "locked", payment: "locked" };

function renderSteps() {
  for (const step of STEP_ORDER) {
    byId(`card-${step}`).dataset.state = stepStates[step];
    document.querySelector(`.steps li[data-step="${step}"]`).dataset.state = stepStates[step];
  }
}

// Mark the current step done and activate (+ kick off) the next one.
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

// Re-open a completed step when its "Edit" link is clicked.
document.addEventListener("click", (e) => {
  const step = e.target?.dataset?.edit;
  if (!step) return;
  stepStates[step] = "active";
  renderSteps();
});

// ── Shared state ─────────────────────────────────────────────────────────────
let cloud = null;
let customerId = null;
let customerEmail = null;
let paymentElement = null;
let isPaymentMounted = false;
const selectedPlace = { lat: null, long: null, placesId: null };

// ── Initialise the SDK ────────────────────────────────────────────────────────
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

// ── Step 1 — Profile ──────────────────────────────────────────────────────────
byId("profile-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!getField("f-email") || !getField("f-first")) {
    log("Email and first name are required");
    return;
  }
  runWithButton(e.submitter, "Saving…", async () => {
    const profile = collectFields({
      email: "f-email",
      firstName: "f-first",
      lastName: "f-last",
      phone: "f-phone",
      birthDate: "f-dob",
      company: "f-company",
    });

    const { data: user } = await cloud.user.session(profile);
    customerId = user.id;
    customerEmail = user.email;
    log(`1) user: ${customerId} (${customerEmail})`);

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
      ...collectFields({
        one: "a-one",
        two: "a-two",
        city: "a-city",
        state: "a-state",
        zip: "a-zip",
        country: "a-country",
      }),
    };
    if (selectedPlace.lat != null) address.lat = selectedPlace.lat;
    if (selectedPlace.long != null) address.long = selectedPlace.long;
    if (selectedPlace.placesId) address.placesId = selectedPlace.placesId;

    const { data: saved } = await cloud.user.addAddress(address);
    log(`2) saved address: ${saved?.id ?? "(ok)"}`);
    showStepSummary(
      "address",
      `${address.one}${address.two ? `, ${address.two}` : ""}, ${address.city}, ${address.state} ${address.zip}`
    );
    completeStep("address");
  });
});

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
    // The cloud-sdk UMD attaches this factory at window.LiquidCommercePaymentElement.
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

byId("save-card").addEventListener("click", (e) => {
  const saveButton = e.currentTarget;
  runWithButton(saveButton, "Saving…", async () => {
    // 1. Create a confirmation token from the mounted element (runs client-side
    //    3DS / confirmSetup when needed). Success → { token }. Failure →
    //    ILiquidPaymentError ({ type, message, code }) with no `token`.
    const tokenResult = await paymentElement.createConfirmationToken();
    if (!tokenResult?.token) {
      const errType = tokenResult?.type ?? "error";
      const errCode = tokenResult?.code ? ` #${tokenResult.code}` : "";
      console.error("[create-payment] createConfirmationToken returned:", tokenResult);
      log(`token error (${errType}${errCode}): ${tokenResult?.message ?? "no token returned"}`);
      saveButton.disabled = false;
      saveButton.textContent = "Save card";
      return;
    }

    // 2. Confirm/finalize the payment session → resolves the payment method id.
    const { data: confirmation } = await cloud.user.confirmPaymentSession(tokenResult.token);
    const paymentMethodId = confirmation?.id;
    if (!paymentMethodId) {
      console.error("[create-payment] confirmPaymentSession returned:", confirmation);
      log("confirm error: no payment method id returned");
      saveButton.disabled = false;
      saveButton.textContent = "Save card";
      return;
    }
    log(`payment method id: ${paymentMethodId}`);

    // 3. Save the payment method to the user.
    const { data: saved } = await cloud.user.addPayment({
      customerId,
      paymentMethodId,
      isDefault: true,
    });
    log(`saved payment method to user: ${saved?.id ?? paymentMethodId}`);

    completeStep("payment");
    paymentElement.unmount();
    paymentElement.destroy();

    const done = byId("done");
    done.hidden = false;
    done.innerHTML =
      `<strong>All set 🎉</strong><br/>Saved a card for <b>${escapeHtml(customerEmail)}</b>. ` +
      `Go to <a href="/secured/">the secured store</a> and sign in with this email to check out with the ` +
      `address, customer info and payment method prefilled.`;
  });
});
