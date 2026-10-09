
/* =========================================================
   CELESTE DAILY
   DEDICATED PRODUCT LISTING PAGE

   Features:
   - Contact person information
   - Add, edit and remove products
   - Maximum 10 products
   - Image validation and preview
   - Automatic image compression
   - Single email submission through Vercel API
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const MAX_PRODUCTS = 10;
  const MAX_ORIGINAL_IMAGE = 2 * 1024 * 1024;
  const MAX_REQUEST_BYTES = 3.8 * 1024 * 1024;

  const $ = (id) => document.getElementById(id);

  /* -------------------------------------------------------
     PAGE ELEMENTS
  ------------------------------------------------------- */

  const panel = $("productListingPanel");

  const contactName = $("listingContactName");
  const contactNumber = $("listingContactNumber");
  const contactEmail = $("listingContactEmail");

  const addItemButton = $("openProductModalBtn");

  const productsCount = $("productItemsCount");
  const productsEmpty = $("productItemsEmpty");
  const productsList = $("productItemsList");

  const submitButton = $("productListingSubmit");
  const statusMessage = $("productListingStatus");

  const modal = $("productModal");
  const modalForm = $("productItemForm");
  const modalTitle = $("productModalTitle");

  const modalClose = $("closeProductModalBtn");
  const modalCancel = $("cancelProductModalBtn");
  const modalSave = $("saveProductBtn");

  const itemName = $("productItemName");
  const itemDescription = $("productItemDescription");
  const itemImage = $("productItemImage");
  const itemMrp = $("productItemMrp");
  const itemCost = $("productItemCost");

  const imageUploadText = $("productImageUploadText");
  const imagePreview = $("productModalImagePreview");
  const imagePreviewImg = $("productModalImagePreviewImg");
  const removeImageButton = $("removeModalProductImage");

  /* -------------------------------------------------------
     ONLY RUN ON PRODUCT LISTING PAGE
  ------------------------------------------------------- */

  const requiredElements = [
    panel,
    contactName,
    contactNumber,
    contactEmail,
    addItemButton,
    productsCount,
    productsEmpty,
    productsList,
    submitButton,
    statusMessage,
    modal,
    modalForm,
    modalTitle,
    modalSave,
    itemName,
    itemDescription,
    itemImage,
    itemMrp,
    itemCost,
    imageUploadText,
    imagePreview,
    imagePreviewImg
  ];

  if (requiredElements.some((element) => !element)) {
    console.warn(
      "Product listing page: required HTML elements are missing."
    );
    return;
  }

  /* -------------------------------------------------------
     APPLICATION STATE
  ------------------------------------------------------- */

  let products = [];

  let editingIndex = null;

  let selectedImageFile = null;
  let selectedPreviewUrl = "";

  // True only for image URLs created inside the modal.
  let temporaryPreview = false;

  let submitting = false;

  /* -------------------------------------------------------
     STATUS MESSAGE
  ------------------------------------------------------- */

  function showStatus(message, type = "") {
    statusMessage.textContent = message;

    statusMessage.className = "product-listing-status";

    if (type === "error") {
      statusMessage.classList.add("is-error");
    }

    if (type === "success") {
      statusMessage.classList.add("is-success");
    }
  }

  /* -------------------------------------------------------
     PRODUCT LIMIT
  ------------------------------------------------------- */

  function canAddProduct() {
    if (products.length >= MAX_PRODUCTS) {
      showStatus(
        `You can submit a maximum of ${MAX_PRODUCTS} products at once.`,
        "error"
      );

      return false;
    }

    return true;
  }

  /* -------------------------------------------------------
     MODAL IMAGE PREVIEW
  ------------------------------------------------------- */

  function updateImagePreview() {
    if (selectedImageFile && selectedPreviewUrl) {
      imagePreviewImg.src = selectedPreviewUrl;

      imagePreview.hidden = false;

      imageUploadText.textContent = selectedImageFile.name;
    } else {
      imagePreviewImg.removeAttribute("src");

      imagePreview.hidden = true;

      imageUploadText.textContent = "Upload product image";
    }
  }

  /* -------------------------------------------------------
     RELEASE TEMPORARY PREVIEW
  ------------------------------------------------------- */

  function releaseTemporaryPreview() {
    if (temporaryPreview && selectedPreviewUrl) {
      URL.revokeObjectURL(selectedPreviewUrl);
    }

    temporaryPreview = false;
  }

  /* -------------------------------------------------------
     RESET MODAL
  ------------------------------------------------------- */

  function resetModal() {
    releaseTemporaryPreview();

    modalForm.reset();

    editingIndex = null;

    selectedImageFile = null;
    selectedPreviewUrl = "";
    temporaryPreview = false;

    modalTitle.textContent = "Add Product";
    modalSave.textContent = "Add Product";

    updateImagePreview();
  }

  /* -------------------------------------------------------
     OPEN MODAL
  ------------------------------------------------------- */

  function openModal(index = null) {
    if (submitting) return;

    resetModal();

    if (index !== null) {
      const product = products[index];

      if (!product) return;

      editingIndex = index;

      modalTitle.textContent = "Edit Product";
      modalSave.textContent = "Save Changes";

      itemName.value = product.itemName;
      itemDescription.value = product.description;
      itemMrp.value = product.mrp;
      itemCost.value = product.cost;

      selectedImageFile = product.imageFile;
      selectedPreviewUrl = product.previewUrl;

      // Existing product owns this URL.
      temporaryPreview = false;

      updateImagePreview();
    }

    modal.hidden = false;

    document.body.classList.add("product-modal-open");

    window.setTimeout(() => {
      itemName.focus();
    }, 80);
  }

  /* -------------------------------------------------------
     CLOSE MODAL
  ------------------------------------------------------- */

  function closeModal() {
    modal.hidden = true;

    document.body.classList.remove("product-modal-open");

    resetModal();
  }

  /* -------------------------------------------------------
     ADD ITEM BUTTON
  ------------------------------------------------------- */

  addItemButton.addEventListener("click", () => {
    if (submitting) return;

    if (!canAddProduct()) return;

    showStatus("");

    openModal();
  });

  /* -------------------------------------------------------
     MODAL CLOSE BUTTONS
  ------------------------------------------------------- */

  modalClose?.addEventListener("click", closeModal);

  modalCancel?.addEventListener("click", closeModal);

  modal
    .querySelectorAll("[data-close-product-modal]")
    .forEach((element) => {
      element.addEventListener("click", closeModal);
    });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });

  /* -------------------------------------------------------
     SELECT PRODUCT IMAGE
  ------------------------------------------------------- */

  itemImage.addEventListener("change", () => {
    const file = itemImage.files?.[0];

    if (!file) return;

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
      alert("Please choose a JPG, PNG or WEBP image.");

      itemImage.value = "";
      return;
    }

    if (file.size > MAX_ORIGINAL_IMAGE) {
      alert("Product images must be smaller than 2 MB.");

      itemImage.value = "";
      return;
    }

    releaseTemporaryPreview();

    selectedImageFile = file;

    selectedPreviewUrl = URL.createObjectURL(file);

    temporaryPreview = true;

    updateImagePreview();
  });

  /* -------------------------------------------------------
     REMOVE IMAGE INSIDE MODAL
  ------------------------------------------------------- */

  removeImageButton?.addEventListener("click", () => {
    releaseTemporaryPreview();

    selectedImageFile = null;
    selectedPreviewUrl = "";
    temporaryPreview = false;

    itemImage.value = "";

    updateImagePreview();
  });

  /* -------------------------------------------------------
     ADD OR UPDATE PRODUCT
  ------------------------------------------------------- */

  modalForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (submitting) return;

    if (!modalForm.reportValidity()) return;

    const name = itemName.value.trim();
    const description = itemDescription.value.trim();

    const mrp = Number(itemMrp.value);
    const cost = Number(itemCost.value);

    if (!name || !description) {
      alert("Please enter the product name and description.");
      return;
    }

    if (!selectedImageFile || !selectedPreviewUrl) {
      alert("Please upload a product image.");
      return;
    }

    if (!Number.isFinite(mrp) || mrp < 0) {
      alert("Please enter a valid MRP.");
      return;
    }

    if (!Number.isFinite(cost) || cost < 0) {
      alert("Please enter a valid Cost Price.");
      return;
    }

    const product = {
      itemName: name,
      description,
      mrp,
      cost,
      imageFile: selectedImageFile,
      previewUrl: selectedPreviewUrl
    };

    if (editingIndex !== null) {
      const oldProduct = products[editingIndex];

      products[editingIndex] = product;

      if (
        oldProduct?.previewUrl &&
        oldProduct.previewUrl !== product.previewUrl
      ) {
        URL.revokeObjectURL(oldProduct.previewUrl);
      }
    } else {
      if (!canAddProduct()) return;

      products.push(product);
    }

    // Transfer preview ownership from modal to product list.
    temporaryPreview = false;

    closeModal();

    renderProducts();

    showStatus("");
  });

  /* -------------------------------------------------------
     FORMAT PRICE
  ------------------------------------------------------- */

  function formatPrice(value) {
    return Number(value).toLocaleString("en-LK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /* -------------------------------------------------------
     CREATE PRODUCT SUMMARY CARD
  ------------------------------------------------------- */

  function createProductCard(product, index) {
    const card = document.createElement("div");

    card.className = "product-summary-card";

    // The HTML template contains no untrusted values.
    card.innerHTML = `
      <img class="product-summary-image" alt="">

      <div class="product-summary-copy">
        <span class="product-summary-number"></span>
        <h4></h4>
        <p></p>
      </div>

      <div class="product-summary-side">
        <div class="product-summary-prices"></div>

        <div class="product-summary-actions">
          <button
            type="button"
            class="product-summary-edit"
          >
            <i class="fa-solid fa-pen"></i>
            Edit
          </button>

          <button
            type="button"
            class="product-summary-remove"
          >
            <i class="fa-solid fa-trash-can"></i>
            Remove
          </button>
        </div>
      </div>
    `;

    const img = card.querySelector(".product-summary-image");

    img.src = product.previewUrl;
    img.alt = product.itemName;

    card.querySelector(
      ".product-summary-number"
    ).textContent = `Product ${index + 1}`;

    card.querySelector("h4").textContent = product.itemName;

    card.querySelector(".product-summary-copy p").textContent =
      product.description;

    const prices = card.querySelector(".product-summary-prices");

    prices.textContent =
      `MRP: Rs. ${formatPrice(product.mrp)}  ·  ` +
      `Cost: Rs. ${formatPrice(product.cost)}`;

    const editButton = card.querySelector(".product-summary-edit");

    const removeButton = card.querySelector(".product-summary-remove");

    editButton.disabled = submitting;
    removeButton.disabled = submitting;

    editButton.addEventListener("click", () => {
      if (!submitting) openModal(index);
    });

    removeButton.addEventListener("click", () => {
      if (submitting) return;

      const removed = products[index];

      products.splice(index, 1);

      renderProducts();

      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }

      showStatus("");
    });

    return card;
  }

  /* -------------------------------------------------------
     RENDER PRODUCTS
  ------------------------------------------------------- */

  function renderProducts() {
    productsList.innerHTML = "";

    productsCount.textContent =
      `${products.length} ${products.length === 1 ? "item" : "items"}`;

    productsEmpty.hidden = products.length > 0;

    addItemButton.disabled =
      submitting || products.length >= MAX_PRODUCTS;

    submitButton.disabled =
      submitting || products.length === 0;

    products.forEach((product, index) => {
      productsList.appendChild(
        createProductCard(product, index)
      );
    });
  }

  /* -------------------------------------------------------
     CONTACT PERSON VALIDATION
  ------------------------------------------------------- */

  function validateContactDetails() {
    const contactFields = [
      contactName,
      contactNumber,
      contactEmail
    ];

    for (const field of contactFields) {
      if (!field.reportValidity()) {
        field.focus();

        return null;
      }
    }

    const name = contactName.value.trim();
    const number = contactNumber.value.trim();
    const email = contactEmail.value.trim();

    if (name.length < 2) {
      showStatus("Please enter your full name.", "error");

      contactName.focus();

      return null;
    }

    const digitsOnly = number.replace(/\D/g, "");

    if (digitsOnly.length < 9 || digitsOnly.length > 15) {
      showStatus(
        "Please enter a valid contact number.",
        "error"
      );

      contactNumber.focus();

      return null;
    }

    if (!contactEmail.validity.valid) {
      showStatus(
        "Please enter a valid email address.",
        "error"
      );

      contactEmail.focus();

      return null;
    }

    return {
      contactName: name,
      contactNumber: number,
      contactEmail: email
    };
  }

  /* -------------------------------------------------------
     CANVAS TO BLOB
  ------------------------------------------------------- */

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Unable to process product image."));
          }
        },
        "image/jpeg",
        quality
      );
    });
  }

  /* -------------------------------------------------------
     BLOB TO BASE64 DATA URL
  ------------------------------------------------------- */

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);

      reader.onerror = () => {
        reject(new Error("Unable to read product image."));
      };

      reader.readAsDataURL(blob);
    });
  }

  /* -------------------------------------------------------
     AUTOMATIC IMAGE COMPRESSION
  ------------------------------------------------------- */

  async function compressImage(file) {
    const TARGET_BYTES = 220 * 1024;
    const MAX_OUTPUT_BYTES = 280 * 1024;

    const objectUrl = URL.createObjectURL(file);

    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => resolve(img);

        img.onerror = () => {
          reject(new Error(
            `Unable to open image: ${file.name}`
          ));
        };

        img.src = objectUrl;
      });

      const originalWidth = image.naturalWidth;
      const originalHeight = image.naturalHeight;

      if (!originalWidth || !originalHeight) {
        throw new Error("Invalid product image.");
      }

      let maxDimension = 1200;
      let finalBlob = null;

      while (maxDimension >= 320) {
        const largestSide = Math.max(
          originalWidth,
          originalHeight
        );

        const scale = Math.min(
          1,
          maxDimension / largestSide
        );

        const width = Math.max(
          1,
          Math.round(originalWidth * scale)
        );

        const height = Math.max(
          1,
          Math.round(originalHeight * scale)
        );

        const canvas = document.createElement("canvas");

        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");

        if (!context) {
          throw new Error("Image processing is not supported.");
        }

        // JPEG does not support transparency.
        context.fillStyle = "#ffffff";

        context.fillRect(0, 0, width, height);

        context.drawImage(image, 0, 0, width, height);

        let quality = 0.82;

        while (quality >= 0.38) {
          finalBlob = await canvasToBlob(canvas, quality);

          if (finalBlob.size <= TARGET_BYTES) {
            break;
          }

          quality -= 0.08;
        }

        if (finalBlob && finalBlob.size <= TARGET_BYTES) {
          break;
        }

        maxDimension = Math.floor(maxDimension * 0.8);
      }

      if (!finalBlob || finalBlob.size > MAX_OUTPUT_BYTES) {
        throw new Error(
          `Could not compress ${file.name} sufficiently. ` +
          "Please choose a smaller image."
        );
      }

      const dataUrl = await blobToDataUrl(finalBlob);

      const originalName =
        file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9_-]/g, "_")
          .slice(0, 60) || "product";

      return {
        name: `${originalName}.jpg`,
        type: "image/jpeg",
        dataUrl
      };

    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  /* -------------------------------------------------------
     LOCK INTERFACE DURING SUBMISSION
  ------------------------------------------------------- */

  function setSubmitting(value) {
    submitting = value;

    contactName.disabled = value;
    contactNumber.disabled = value;
    contactEmail.disabled = value;

    renderProducts();
  }

  /* -------------------------------------------------------
     RELEASE SAVED IMAGES
  ------------------------------------------------------- */

  function clearProducts() {
    products.forEach((product) => {
      if (product.previewUrl) {
        URL.revokeObjectURL(product.previewUrl);
      }
    });

    products = [];

    renderProducts();
  }

  /* -------------------------------------------------------
     CLOUDFLARE TURNSTILE

     The public widget generates a short-lived token.
     Only the Vercel backend can validate this token
     using TURNSTILE_SECRET_KEY.
  ------------------------------------------------------- */

  function getTurnstileToken() {
    const widget = window.turnstile;

    if (!widget || typeof widget.getResponse !== "function") {
      return "";
    }

    if (typeof widget.isExpired === "function" && widget.isExpired()) {
      return "";
    }

    const token = widget.getResponse();
    return typeof token === "string" ? token.trim() : "";
  }

  function resetTurnstile() {
    if (window.turnstile && typeof window.turnstile.reset === "function") {
      try {
        window.turnstile.reset();
      } catch (error) {
        console.warn("Turnstile could not be reset:", error);
      }
    }
  }

  /* -------------------------------------------------------
     SUBMIT PRODUCT LISTING
  ------------------------------------------------------- */

  submitButton.addEventListener("click", async () => {
    if (submitting) return;

    if (products.length === 0) {
      showStatus("Please add at least one product.", "error");
      return;
    }

    if (products.length > MAX_PRODUCTS) {
      showStatus(
        `You can only submit ${MAX_PRODUCTS} products at once.`,
        "error"
      );

      return;
    }

    const contact = validateContactDetails();

    if (!contact) return;

    // Do not start image compression until security is completed.
    if (!getTurnstileToken()) {
      showStatus(
        "Please complete the security verification before submitting.",
        "error"
      );
      return;
    }

    setSubmitting(true);

    submitButton.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Preparing...';

    try {
      const items = [];

      for (let index = 0; index < products.length; index++) {
        const product = products[index];

        showStatus(
          `Preparing product ${index + 1} of ${products.length}...`
        );

        const compressedImage = await compressImage(
          product.imageFile
        );

        items.push({
          itemName: product.itemName,
          description: product.description,
          mrp: product.mrp,
          cost: product.cost,
          image: compressedImage
        });
      }

      /*
       * Send contact details ONCE,
       * together with all submitted products.
       */

      // Read again: a Turnstile token may expire while images compress.
      const turnstileToken = getTurnstileToken();

      if (!turnstileToken) {
        throw new Error(
          "Security verification expired. Please complete it and try again."
        );
      }

      const payload = {
        contactName: contact.contactName,
        contactNumber: contact.contactNumber,
        contactEmail: contact.contactEmail,
        turnstileToken,
        items
      };

      const requestBody = JSON.stringify(payload);

      const requestSize = new Blob([requestBody]).size;

      if (requestSize > MAX_REQUEST_BYTES) {
        throw new Error(
          "The listing is too large to submit. " +
          "Please reduce the number of products and try again."
        );
      }

      showStatus("Sending your product listing...");

      submitButton.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';

      const response = await fetch("/api/product-listing", {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: requestBody
      });

      const result = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || result.ok !== true) {
        if (
          response.status === 404 &&
          (
            location.hostname === "127.0.0.1" ||
            location.hostname === "localhost"
          )
        ) {
          throw new Error(
            "Email submission is not available through VS Code " +
            "Live Server. Please test it on Vercel after the " +
            "email API has been configured."
          );
        }

        throw new Error(
          result.error ||
          "Unable to submit your product listing. Please try again."
        );
      }

      // Email API confirmed the submission.
      clearProducts();

      contactName.value = "";
      contactNumber.value = "";
      contactEmail.value = "";

      showStatus(
        "Your product listing has been submitted successfully. " +
        "Our team will review it and contact you if further " +
        "information is required.",
        "success"
      );

    } catch (error) {
      console.error("Product listing submission failed:", error);

      showStatus(
        error.message ||
        "Something went wrong. Please try again.",
        "error"
      );

    } finally {
      // Tokens are single-use even when a submission fails.
      resetTurnstile();
      setSubmitting(false);

      submitButton.innerHTML =
        'Submit Listing <i class="fa-solid fa-arrow-right"></i>';
    }
  });

  /* -------------------------------------------------------
     INITIAL RENDER
  ------------------------------------------------------- */

  renderProducts();

});
