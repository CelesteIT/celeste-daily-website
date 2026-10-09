/* =========================================================
   CELESTE DAILY
   PRODUCT LISTING EMAIL API

   Vercel Serverless Function

   Features:
   - Multiple Category Team recipients
   - Supplier contact information
   - Up to 10 products
   - Product image attachments
   - Resend email integration
========================================================= */

const MAX_PRODUCTS = 10;

const MAX_IMAGE_BYTES = 300 * 1024;

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

const MAX_RECIPIENTS = 20;

const TURNSTILE_ACTION = "product_listing";
const ALLOWED_TURNSTILE_HOSTNAMES = new Set([
  "celeste.lk",
  "www.celeste.lk"
]);

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);


/* =========================================================
   VALIDATION ERROR
========================================================= */

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/* =========================================================
   REQUIRED TEXT VALIDATION
========================================================= */

function requiredText(value, label, maxLength) {
  if (typeof value !== "string") {
    throw new ValidationError(`${label} is required.`);
  }

  const cleaned = value.trim();

  if (!cleaned) {
    throw new ValidationError(`${label} is required.`);
  }

  if (cleaned.length > maxLength) {
    throw new ValidationError(`${label} is too long.`);
  }

  return cleaned;
}


/* =========================================================
   EMAIL VALIDATION
========================================================= */

function isValidEmail(email) {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)
  );
}


/* =========================================================
   MULTIPLE CATEGORY TEAM EMAILS

   Environment Variable:

   PRODUCT_LISTING_TO_EMAIL

   Example:
   person1@celeste.lk,person2@celeste.lk

========================================================= */

function getRecipients() {
  const configuredEmails =
    process.env.PRODUCT_LISTING_TO_EMAIL || "";

  const recipients = [
    ...new Set(
      configuredEmails
        .split(",")
        .map(email => email.trim().toLowerCase())
        .filter(Boolean)
    )
  ];

  if (
    recipients.length === 0 ||
    recipients.length > MAX_RECIPIENTS
  ) {
    throw new Error(
      "Invalid product listing recipient configuration."
    );
  }

  if (!recipients.every(isValidEmail)) {
    throw new Error(
      "Invalid recipient email address configuration."
    );
  }

  return recipients;
}


/* =========================================================
   VALIDATE SUPPLIER CONTACT DETAILS
========================================================= */

function validateContact(body) {
  const contactName = requiredText(
    body.contactName,
    "Full Name",
    120
  );

  const contactNumber = requiredText(
    body.contactNumber,
    "Contact Number",
    20
  );

  const contactEmail = requiredText(
    body.contactEmail,
    "Email Address",
    254
  );

  const phoneDigits =
    contactNumber.replace(/\D/g, "");

  if (
    !/^[+0-9 ()-]+$/.test(contactNumber) ||
    phoneDigits.length < 9 ||
    phoneDigits.length > 15
  ) {
    throw new ValidationError(
      "Please enter a valid contact number."
    );
  }

  if (!isValidEmail(contactEmail)) {
    throw new ValidationError(
      "Please enter a valid email address."
    );
  }

  return {
    contactName,
    contactNumber,
    contactEmail
  };
}


/* =========================================================
   VALIDATE PRICE
========================================================= */

function validatePrice(value, label) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    throw new ValidationError(
      `${label} is required.`
    );
  }

  const price = Number(value);

  if (
    !Number.isFinite(price) ||
    price < 0 ||
    price > 1000000000
  ) {
    throw new ValidationError(
      `${label} is invalid.`
    );
  }

  return price;
}


/* =========================================================
   VALIDATE PRODUCT IMAGE
========================================================= */

function validateImage(image, index) {
  const productNumber = index + 1;

  if (
    !image ||
    typeof image !== "object" ||
    typeof image.dataUrl !== "string" ||
    typeof image.type !== "string"
  ) {
    throw new ValidationError(
      `Product ${productNumber}: image is required.`
    );
  }

  if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
    throw new ValidationError(
      `Product ${productNumber}: unsupported image type.`
    );
  }

  const match = image.dataUrl.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/
  );

  if (!match || match[1] !== image.type) {
    throw new ValidationError(
      `Product ${productNumber}: invalid image data.`
    );
  }

  const base64Content = match[2];

  const buffer = Buffer.from(
    base64Content,
    "base64"
  );

  if (
    buffer.length === 0 ||
    buffer.length > MAX_IMAGE_BYTES
  ) {
    throw new ValidationError(
      `Product ${productNumber}: image exceeds allowed size.`
    );
  }

  /* Validate actual image format */

  const isJpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  const isPng =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([
        137, 80, 78, 71, 13, 10, 26, 10
      ])
    );

  const isWebp =
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";

  const validSignature =
    (image.type === "image/jpeg" && isJpeg) ||
    (image.type === "image/png" && isPng) ||
    (image.type === "image/webp" && isWebp);

  if (!validSignature) {
    throw new ValidationError(
      `Product ${productNumber}: invalid image format.`
    );
  }

  const extension =
    image.type === "image/png"
      ? "png"
      : image.type === "image/webp"
        ? "webp"
        : "jpg";

  const filename =
    `product-${String(productNumber).padStart(2, "0")}.${extension}`;

  return {
    filename,
    content: base64Content
  };
}


/* =========================================================
   VALIDATE PRODUCTS
========================================================= */

function validateProducts(items) {
  if (!Array.isArray(items)) {
    throw new ValidationError(
      "Invalid product listing."
    );
  }

  if (items.length === 0) {
    throw new ValidationError(
      "Please add at least one product."
    );
  }

  if (items.length > MAX_PRODUCTS) {
    throw new ValidationError(
      `Maximum ${MAX_PRODUCTS} products allowed.`
    );
  }

  const products = [];
  const attachments = [];

  items.forEach((item, index) => {
    const number = index + 1;

    if (!item || typeof item !== "object") {
      throw new ValidationError(
        `Product ${number}: invalid product details.`
      );
    }

    const itemName = requiredText(
      item.itemName,
      `Product ${number} Item Name`,
      150
    );

    const description = requiredText(
      item.description,
      `Product ${number} Description`,
      1500
    );

    const mrp = validatePrice(
      item.mrp,
      `Product ${number} MRP`
    );

    const cost = validatePrice(
      item.cost,
      `Product ${number} Cost Price`
    );

    const attachment = validateImage(
      item.image,
      index
    );

    products.push({
      itemName,
      description,
      mrp,
      cost,
      imageName: attachment.filename
    });

    attachments.push(attachment);
  });

  return {
    products,
    attachments
  };
}


/* =========================================================
   BUILD EMAIL CONTENT
========================================================= */

function buildEmailHtml(contact, products) {
  const productCards = products
    .map((product, index) => {

      const description = escapeHtml(
        product.description
      ).replace(/\n/g, "<br>");

      return `
        <div style="
          border:1px solid #e8e8e8;
          border-radius:14px;
          padding:22px;
          margin-bottom:16px;
          background:#ffffff;
        ">

          <p style="
            margin:0 0 8px;
            color:#a47a31;
            font-size:12px;
            font-weight:bold;
            letter-spacing:1px;
          ">
            PRODUCT ${index + 1}
          </p>

          <h3 style="
            margin:0 0 16px;
            color:#111111;
            font-size:20px;
          ">
            ${escapeHtml(product.itemName)}
          </h3>

          <p style="color:#333333;line-height:1.6;">
            <strong>Description:</strong><br>
            ${description}
          </p>

          <p style="color:#333333;">
            <strong>MRP:</strong>
            Rs. ${product.mrp.toFixed(2)}
          </p>

          <p style="color:#333333;">
            <strong>Cost Price:</strong>
            Rs. ${product.cost.toFixed(2)}
          </p>

          <p style="color:#555555;">
            <strong>Product Image:</strong>
            ${escapeHtml(product.imageName)}
          </p>

        </div>
      `;
    })
    .join("");

  return `
    <div style="
      background:#f5f5f5;
      padding:30px 15px;
      font-family:Arial,Helvetica,sans-serif;
    ">

      <div style="
        max-width:760px;
        margin:0 auto;
        padding:30px;
        background:#ffffff;
        border-radius:18px;
      ">

        <p style="
          color:#a47a31;
          font-weight:bold;
          font-size:12px;
          letter-spacing:2px;
        ">
          LIST WITH CELESTE
        </p>

        <h1 style="
          margin:8px 0 12px;
          font-size:26px;
          color:#111111;
        ">
          New Product Listing Request
        </h1>

        <p style="
          color:#777777;
          line-height:1.6;
        ">
          A new product listing request has been
          submitted through celeste.lk.
        </p>

        <!-- CONTACT DETAILS -->

        <div style="
          margin:26px 0;
          padding:22px;
          border:1px solid #e8e1d3;
          border-radius:14px;
          background:#faf8f3;
        ">

          <h2 style="
            margin:0 0 16px;
            color:#111111;
            font-size:18px;
          ">
            Contact Person Details
          </h2>

          <p>
            <strong>Full Name:</strong>
            ${escapeHtml(contact.contactName)}
          </p>

          <p>
            <strong>Contact Number:</strong>
            ${escapeHtml(contact.contactNumber)}
          </p>

          <p>
            <strong>Email Address:</strong>
            ${escapeHtml(contact.contactEmail)}
          </p>

        </div>

        <!-- PRODUCTS -->

        <h2 style="
          margin:26px 0 18px;
          font-size:20px;
          color:#111111;
        ">
          Submitted Products (${products.length})
        </h2>

        ${productCards}

        <p style="
          margin-top:25px;
          color:#777777;
          font-size:13px;
          line-height:1.6;
        ">
          All submitted product images are
          included as email attachments.
        </p>

        <p style="
          margin-top:15px;
          color:#999999;
          font-size:12px;
        ">
          This email was generated through
          the Celeste Product Listing Portal.
        </p>

      </div>

    </div>
  `;
}


/* =========================================================
   VERIFY CLOUDFLARE TURNSTILE TOKEN

   Fail closed unless Cloudflare confirms:
   - Valid, unused, unexpired token
   - Expected production hostname
   - Correct product listing action
========================================================= */

async function verifyTurnstile(token, secretKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          secret: secretKey,
          response: token
        }).toString(),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`Turnstile Siteverify HTTP ${response.status}`);
    }

    const result = await response.json();

    return (
      result?.success === true &&
      result.action === TURNSTILE_ACTION &&
      ALLOWED_TURNSTILE_HOSTNAMES.has(
        String(result.hostname || "").toLowerCase()
      )
    );
  } finally {
    clearTimeout(timeout);
  }
}


/* =========================================================
   VERCEL API HANDLER
========================================================= */

module.exports = async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  /* Only POST is allowed */

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      ok: false,
      error: "Method not allowed."
    });
  }

  /* Environment Variables */

  const turnstileSecret =
    process.env.TURNSTILE_SECRET_KEY;

  const apiKey =
    process.env.RESEND_API_KEY;

  const fromEmail =
    process.env.PRODUCT_LISTING_FROM_EMAIL;

  const toEmailConfig =
    process.env.PRODUCT_LISTING_TO_EMAIL;

  if (
    !turnstileSecret ||
    !apiKey ||
    !fromEmail ||
    !toEmailConfig
  ) {
    console.error(
      "Product Listing email configuration is missing."
    );

    return res.status(503).json({
      ok: false,
      error:
        "Product Listing email service is not configured."
    });
  }

  let contact;
  let products;
  let attachments;
  let recipients;
  let turnstileToken;

  /* -------------------------------------------------------
     VALIDATE REQUEST BEFORE SENDING
  ------------------------------------------------------- */

  try {
    recipients = getRecipients();

    let body = req.body;

    if (typeof body === "string") {
      if (
        Buffer.byteLength(body, "utf8") >
        MAX_REQUEST_BYTES
      ) {
        return res.status(413).json({
          ok: false,
          error: "Submission is too large."
        });
      }

      body = JSON.parse(body);
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      throw new ValidationError(
        "Invalid submission."
      );
    }

    const bodySize = Buffer.byteLength(
      JSON.stringify(body),
      "utf8"
    );

    if (bodySize > MAX_REQUEST_BYTES) {
      return res.status(413).json({
        ok: false,
        error: "Submission is too large."
      });
    }

    turnstileToken = requiredText(
      body.turnstileToken,
      "Security verification",
      2048
    );

    contact = validateContact(body);

    const validated = validateProducts(
      body.items
    );

    products = validated.products;

    attachments = validated.attachments;

  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof SyntaxError
    ) {
      return res.status(400).json({
        ok: false,
        error:
          error instanceof SyntaxError
            ? "Invalid JSON submission."
            : error.message
      });
    }

    console.error(
      "Product listing configuration/validation error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "Unable to process the listing request."
    });
  }

  /* -------------------------------------------------------
     VERIFY SECURITY BEFORE SENDING EMAIL
  ------------------------------------------------------- */

  try {
    const isVerified = await verifyTurnstile(
      turnstileToken,
      turnstileSecret
    );

    if (!isVerified) {
      return res.status(403).json({
        ok: false,
        error: "Security verification failed or expired. Please try again."
      });
    }
  } catch (error) {
    console.error(
      "Turnstile verification service unavailable:",
      error?.message || "Unknown error"
    );
    return res.status(503).json({
      ok: false,
      error: "Security verification is temporarily unavailable. Please try again."
    });
  }

  /* -------------------------------------------------------
     BUILD EMAIL
  ------------------------------------------------------- */

  const subject =
    `New Product Listing Request - ` +
    `${products.length} ` +
    `${products.length === 1 ? "Product" : "Products"}`;

  const html = buildEmailHtml(
    contact,
    products
  );

  /* -------------------------------------------------------
     SEND TO ALL CATEGORY TEAM MEMBERS
  ------------------------------------------------------- */

  try {
    const resendResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          from: fromEmail,

          // All Category Team recipients
          to: recipients,

          // Reply goes to the person who submitted
          reply_to: contact.contactEmail,

          subject,

          html,

          // All product images
          attachments
        })
      }
    );

    const resendResult =
      await resendResponse
        .json()
        .catch(() => ({}));

    if (!resendResponse.ok) {
      console.error(
        "Resend API error:",
        resendResponse.status,
        resendResult?.name || "Unknown error"
      );

      return res.status(502).json({
        ok: false,
        error:
          "Unable to send the listing email. Please try again."
      });
    }

    if (!resendResult.id) {
      console.error(
        "Resend did not return an email ID."
      );

      return res.status(502).json({
        ok: false,
        error:
          "Email service did not confirm acceptance."
      });
    }

    console.log(
      "Product Listing accepted by Resend.",
      "Recipient count:",
      recipients.length,
      "Product count:",
      products.length
    );

    return res.status(200).json({
      ok: true,
      message:
        "Product listing submitted successfully."
    });

  } catch (error) {
    console.error(
      "Product Listing email request failed:",
      error
    );

    return res.status(502).json({
      ok: false,
      error:
        "Email service is temporarily unavailable. Please try again."
    });
  }
};