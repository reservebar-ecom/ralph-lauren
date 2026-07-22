// ===========================================================================
// Secured storefront (Elements + cloud-sdk)
//
// Gates the store behind an email/password sign-in, renders the product cards
// with Liquid Commerce Elements, then prefills the storefront and checkout from
// the signed-in shopper's saved profile, address, and payment method.
// ===========================================================================

// ── Config ─────────────────────────────────────────────────────────────────
const ELEMENTS_API_ENV = "production";
const ELEMENTS_API_KEY = "pk_92f397cf72213c9b17304f7a_ecd6b226d1e83138a8a1a75f078f5a4179a690e5b7827cf2a346fe3ef6234302";

const CLOUD_API_ENV = "prod";
const CLOUD_API_KEY = "712ef221200c9fe21e13ddd9f6a60dfe5823cf7d9f22570a15289aa6";

const ELEMENTS_SERVICES_BASE = {
  development: "https://elements-services-development-948630220003.us-central1.run.app",
  staging: "https://elements-services-staging-948630220003.us-central1.run.app",
  production: "https://elements-services-production-948630220003.us-central1.run.app",
};
const ELEMENTS_SERVICES_BASE_URL = ELEMENTS_SERVICES_BASE[ELEMENTS_API_ENV];

// ── Products ─────────────────────────────────────────────────────────────────
const PRODUCTS = [
  {
    name: "Woodford Reserve Double Oaked Kentucky Bourbon Whiskey",
    identifier: "GROUPING-2534779",
    image: "GROUPING-2534779",
    description: "Woodford Reserve Double Oaked Kentucky Straight Bourbon Whiskey is an innovative approach to twice-barreled bourbon, that showcases a rich and colorful flavor unlike any other Kentucky bourbon on the market."
  },
  {
    name: "Acqua Panna Flat Water",
    identifier: "GROUPING-2347346",
    image: "GROUPING-2347346",
    description: "Naturally crafted by the Tuscan landscape and bottles at the source, Acqua Panna Natural Spring Water is renowned for it’s unique taste."
  },
  {
    name: "Pellegrino Sparkling Mineral Water",
    identifier: "GROUPING-2347347",
    image: "GROUPING-2347347",
    description: "The water's pleasing effervescence, its subtle pearly reflections, and its thirst-quenching taste have made it famous the world over."
  },
  {
    name: "Coca-Cola",
    identifier: "GROUPING-2347344",
    image: "GROUPING-2347344",
    description: "Coca-Cola Original Taste — the refreshing, crisp taste you know and love. Great taste since 1886."
  },
  {
    name: "Diet Coca-Cola",
    identifier: "GROUPING-2347391",
    image: "GROUPING-2347391",
    description: "Get the great taste of Coca-Cola without all the calories."
  },
  {
    name: "Moët & Chandon Imperial Brut Champagne",
    identifier: "GROUPING-2347348",
    image: "GROUPING-2347348",
    description: "Moët Impérial is the House’s iconic champagne. Created in 1869, it embodies the unique Moët & Chandon style. A style that distinguishes itself by its bright fruitiness, its seductive palate and its elegant maturity."
  },
  {
    name: "Schwepps Ginger Ale",
    identifier: "GROUPING-2347345",
    image: "GROUPING-2347345",
    description: "Ginger Flavor: Schweppes Ginger Ale has a refreshing ginger flavor that provides a zesty taste experience."
  },
  {
    name: "New Belgium Fat Tire Amber Ale",
    identifier: "GROUPING-2500074",
    image: "GROUPING-2500074",
    description: "Fat Tire Amber is the easy-drinking Amber Ale born in Colorado from New Belgium Brewing Company, a certified B-Corp."
  },
  {
    name: "Stella Artois",
    identifier: "GROUPING-2500075",
    image: "GROUPING-2500075",
    description: "Stella Artois' rich brewing history dates back to 1366 in Leuven, Belgium, and was first brewed to celebrate the holiday season. Stella is made with its superior brewing process and uses only the best ingredients."
  },
];

// ── Auth (sign-in overlay) ─────────────────────────────────────────────────────

// Validate credentials against elements-services (POST { email, password } →
// { valid: boolean }).
async function verifyRlUser(email, password) {
  try {
    const res = await fetch(`${ELEMENTS_SERVICES_BASE_URL}/api/other/verify-rl-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.valid === true;
  } catch (err) {
    console.warn("[RL] Credential verification failed:", err);
    return false;
  }
}

// Show the sign-in overlay and resolve with the authenticated email so the
// caller can prefill from that user.
function requestLogin(verify) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "rl-auth-overlay";
    overlay.innerHTML = `
      <div id="rl-auth-card" role="dialog" aria-modal="true" aria-labelledby="rl-auth-title">
        <div class="rl-auth-brand">
          <span style="color:#041e3a">Ralph Lauren</span><span style="color:#6b7280">x</span><span style="color:#8B4513">ReserveBar</span>
        </div>
        <h2 id="rl-auth-title">Sign in</h2>
        <p>Enter your email and password to continue.</p>
        <form id="rl-auth-form" novalidate>
          <input id="rl-auth-email" type="email" autocomplete="email" placeholder="Email" aria-label="Email" />
          <input id="rl-auth-input" type="password" autocomplete="current-password" placeholder="Password" aria-label="Password" />
          <div id="rl-auth-error">Invalid email or password. Please try again.</div>
          <button id="rl-auth-submit" type="submit">Sign in</button>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("rl-visible"));

    const emailInput = overlay.querySelector("#rl-auth-email");
    const input = overlay.querySelector("#rl-auth-input");
    const error = overlay.querySelector("#rl-auth-error");
    const form = overlay.querySelector("#rl-auth-form");
    const submit = overlay.querySelector("#rl-auth-submit");
    emailInput.focus();

    // Clear the error as soon as either field is edited.
    [emailInput, input].forEach((el) =>
      el.addEventListener("input", () => error.classList.remove("rl-show"))
    );

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const password = input.value;
      if (!email || !password) {
        error.classList.add("rl-show");
        return;
      }
      submit.disabled = true;
      const ok = await verify(email, password);
      submit.disabled = false;
      if (!ok) {
        error.classList.add("rl-show");
        input.select();
        return;
      }
      overlay.classList.remove("rl-visible");
      setTimeout(() => overlay.remove(), 200);
      resolve(email);
    });
  });
}

// ── Storefront rendering ───────────────────────────────────────────────────────

// Render the product cards, alternating image/text sides per row. Each card
// leaves an empty `content-<identifier>` node for Elements to inject into.
function renderProductCards(products) {
  const container = document.querySelector("#products");

  products.forEach((product, index) => {
    const isEven = index % 2 === 0;
    const bgColor = isEven ? "bg-white" : "bg-gray-50";

    const imageSection = `
      <div class="flex justify-center ${isEven ? 'lg:order-1' : 'lg:order-2'}">
        <div class="bg-white p-8 rounded-lg shadow-sm border border-gray-100 max-w-md">
          <img
            src="/assets/imgs/${product.image}.png"
            alt="${product.name}"
            class="w-full h-auto object-contain max-h-[400px]"
          />
        </div>
      </div>
    `;

    const productSection = `
      <div class="flex flex-col justify-start ${isEven ? 'lg:order-2' : 'lg:order-1'} space-y-6">
        <div class="space-y-4">
          <h2 class="text-2xl md:text-3xl font-light text-gray-900 leading-tight">
            ${product.name}
          </h2>
          <p class="text-sm text-gray-600 leading-relaxed">
            ${product.description}
          </p>
        </div>
        <div id="content-${product.identifier}" class="min-h-[300px]"></div>
      </div>
    `;

    const wrapper = document.createElement("div");
    wrapper.className = `w-full ${bgColor}`;
    wrapper.innerHTML = `
      <div class="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-start py-20 px-8">
        ${imageSection}
        ${productSection}
      </div>
    `;

    container.appendChild(wrapper);
  });
}

// ── Elements / Cloud setup ─────────────────────────────────────────────────────

// Boot the Elements client: product elements, address elements, cart badges,
// and the cart-open handlers (desktop + mobile).
async function initElements(products) {
  window.addEventListener("lce:actions.client_ready", ({ detail: { data } }) => {
    console.log("Liquid Commerce Elements", data);
  });

  const client = await window.LiquidCommerce.Elements(ELEMENTS_API_KEY, {
    env: ELEMENTS_API_ENV,
    customTheme: {
      product: {
        layout: {
          showTitle: false,
          showImages: false,
          showDescription: false
        }
      }
    },
    // development: {
    //   customApiUrl: "http://0.0.0.0:8080"
    // },
  });

  const productElements = products.map(p => ({
    containerId: `content-${p.identifier}`,
    identifier: p.identifier
  }));
  await client.injectProductElement(productElements);

  // Address elements for both desktop and mobile.
  await client.injectAddressElement("address-placeholder", { showLabel: true });
  await client.injectAddressElement("address-placeholder-mobile", { showLabel: true });

  // Cart item count for both desktop and mobile.
  await client.ui.cartItemsCount("cart-badge-items");
  await client.ui.cartItemsCount("cart-badge-items-mobile");

  // Cart open handlers for both desktop and mobile.
  document.querySelector("#cart-open-button-demo").addEventListener("click", () => {
    client.actions.cart.openCart();
  });
  document.querySelector("#cart-open-button-demo-mobile").addEventListener("click", () => {
    client.actions.cart.openCart();
  });

  return client;
}

// Prefill the storefront + checkout from the signed-in shopper (created via
// /create-payment): the shipping address on the storefront, then customer info
// and the saved payment method once the checkout opens.
async function prefillFromUser(client, email) {
  try {
    const cloud = await window.LiquidCommerce(CLOUD_API_KEY, {
      env: CLOUD_API_ENV,
      googlePlacesApiKey: ""
    });

    // session() upserts and returns the full user, incl. addresses + savedPayments.
    const userResponse = await cloud.user.session({ email });
    const user = userResponse?.data;
    if (!user) {
      console.warn("[RL] No cloud user found for", email);
      return;
    }

    // Storefront shipping address, from the user's default (or first) saved address.
    const addr = (user.addresses || []).find(a => a.isDefault) || (user.addresses || [])[0];
    if (addr) {
      await client.actions.address.setAddressManually(
        {
          one: addr.one || "",
          two: addr.two || "",
          city: addr.city || "",
          state: addr.state || "",
          zip: addr.zip || "",
          country: addr.country || "US",
        },
        { latitude: addr.lat, longitude: addr.long }
      );
      console.log("[RL] prefilled address:", addr.id);
    } else {
      console.warn("[RL] user has no saved address");
    }

    // Once the checkout opens, prefill the customer info + saved payment method.
    const pm = (user.savedPayments || []).find(p => p.isDefault) || (user.savedPayments || [])[0];
    // birthDate comes back as an ISO timestamp (e.g. 1990-01-01T00:00:00.000Z);
    // the checkout field expects a plain date, so keep only the YYYY-MM-DD part.
    const birthDate = (user.birthDate || "").split("T")[0];
    window.addEventListener("lce:actions.checkout_loaded", () => {
      client.actions.checkout.updateCustomerInfo({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || email,
        phone: user.phone || "",
        birthDate,
        company: user.company || "",
      });

      if (pm && pm.id && pm.card) {
        client.actions.checkout.setSavedPaymentMethod({
          id: pm.id,
          card: {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.expMonth,
            expYear: pm.card.expYear,
          },
        });
        console.log("[RL] prefilled saved payment method:", pm.id);
      } else {
        console.warn("[RL] user has no saved payment — create one at /create-payment");
      }
    });
  } catch (prefillError) {
    console.warn("[RL] Prefill skipped:", prefillError);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const email = await requestLogin(verifyRlUser);
  renderProductCards(PRODUCTS);
  const client = await initElements(PRODUCTS);
  await prefillFromUser(client, email);
});
