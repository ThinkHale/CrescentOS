// Badge printer module for Fargo DTC1250e
// Generates CR80 cards with photo, name, barcode, and badge number

const BadgePrinter = (() => {
  const CARD_WIDTH = 1014;  // CR80 in pixels at 300 DPI (3.375" * 300)
  const CARD_HEIGHT = 638;  // CR80 height (2.125" * 300)
  const LOGO_HEIGHT = 80;
  const PHOTO_SIZE = 240;
  const BARCODE_HEIGHT = 60;

  // Generate PLX barcode format: PLX-{EID}-{first 3 of last name}
  function generateBarcodeText(eid, lastName) {
    const lastNameKey = (lastName || "").toUpperCase().slice(0, 3) || "XXX";
    const eidPadded = String(eid).padStart(8, "0");
    return `PLX-${eidPadded}-${lastNameKey}`;
  }

  // Create badge as canvas image
  async function generateBadgeCanvas(associate) {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext("2d");

    // White background
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // ProLogistix logo (placeholder text, can be replaced with actual logo)
    ctx.fillStyle = "#2c3e50";
    ctx.font = "bold 32px Arial";
    ctx.textAlign = "center";
    ctx.fillText("ProLogistix", CARD_WIDTH / 2, 50);

    let yOffset = LOGO_HEIGHT + 20;

    // Photo frame
    if (associate.photo_url) {
      try {
        const img = await loadImage(associate.photo_url);
        const photoX = (CARD_WIDTH - PHOTO_SIZE) / 2;
        // Draw circular photo with border
        ctx.beginPath();
        ctx.arc(CARD_WIDTH / 2, yOffset + PHOTO_SIZE / 2, PHOTO_SIZE / 2, 0, Math.PI * 2);
        ctx.strokeStyle = "#2c3e50";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.clip();
        ctx.drawImage(img, photoX, yOffset, PHOTO_SIZE, PHOTO_SIZE);
        ctx.restore();
      } catch (e) {
        console.warn("Could not load photo:", e);
        // Draw placeholder
        ctx.fillStyle = "#ecf0f1";
        ctx.fillRect((CARD_WIDTH - PHOTO_SIZE) / 2, yOffset, PHOTO_SIZE, PHOTO_SIZE);
      }
    } else {
      ctx.fillStyle = "#ecf0f1";
      ctx.fillRect((CARD_WIDTH - PHOTO_SIZE) / 2, yOffset, PHOTO_SIZE, PHOTO_SIZE);
    }

    yOffset += PHOTO_SIZE + 15;

    // Name (bold, large)
    ctx.fillStyle = "#2c3e50";
    ctx.font = "bold 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText((associate.name || "").toUpperCase(), CARD_WIDTH / 2, yOffset);

    yOffset += 40;

    // Barcode (using barcode library if available, or text fallback)
    const barcodeText = generateBarcodeText(associate.eid, associate.name);
    try {
      // Try to use JsBarcode if loaded, otherwise text
      if (window.JsBarcode) {
        // Use a hidden canvas for JsBarcode
        const barcodeCanvas = document.createElement("canvas");
        JsBarcode(barcodeCanvas, barcodeText, {
          format: "CODE128",
          width: 2,
          height: BARCODE_HEIGHT,
          margin: 5,
        });
        const barcodeX = (CARD_WIDTH - 200) / 2;
        ctx.drawImage(barcodeCanvas, barcodeX, yOffset, 200, BARCODE_HEIGHT);
      } else {
        // Fallback: text representation
        ctx.font = "12px monospace";
        ctx.fillStyle = "#2c3e50";
        ctx.textAlign = "center";
        ctx.fillText(barcodeText, CARD_WIDTH / 2, yOffset + 20);
      }
    } catch (e) {
      console.warn("Barcode generation failed:", e);
      ctx.font = "12px monospace";
      ctx.fillStyle = "#2c3e50";
      ctx.textAlign = "center";
      ctx.fillText(barcodeText, CARD_WIDTH / 2, yOffset + 20);
    }

    yOffset += BARCODE_HEIGHT + 10;

    // Badge number (EID)
    ctx.fillStyle = "#95a5a6";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.fillText(`Badge #${associate.eid}`, CARD_WIDTH / 2, yOffset);

    return canvas;
  }

  // Load image from URL
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // Export badge as PNG
  async function exportPNG(associate) {
    const canvas = await generateBadgeCanvas(associate);
    return canvas.toDataURL("image/png");
  }

  // Export badge as PDF
  async function exportPDF(associate) {
    const canvas = await generateBadgeCanvas(associate);
    const dataUrl = canvas.toDataURL("image/png");

    // Create PDF (requires jsPDF library)
    if (window.jsPDF) {
      const { jsPDF } = window;
      const doc = new jsPDF("l", "px", [CARD_WIDTH, CARD_HEIGHT]);
      doc.addImage(dataUrl, "PNG", 0, 0, CARD_WIDTH, CARD_HEIGHT);
      return doc;
    } else {
      console.warn("jsPDF not loaded, returning canvas data URL");
      return dataUrl;
    }
  }

  // Print badge (opens print dialog)
  async function printBadge(associate) {
    const canvas = await generateBadgeCanvas(associate);
    const dataUrl = canvas.toDataURL("image/png");

    const printWindow = window.open();
    printWindow.document.write(`
      <html>
        <head>
          <title>Badge - ${associate.name}</title>
          <style>
            body { margin: 0; padding: 0; }
            img { width: 100%; height: auto; display: block; }
            @media print {
              body { margin: 0; padding: 0; }
              img { width: 100%; }
            }
          </style>
        </head>
        <body>
          <img src="${dataUrl}" />
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  }

  // Preview badge in modal
  async function previewBadge(associate) {
    const canvas = await generateBadgeCanvas(associate);
    const dataUrl = canvas.toDataURL("image/png");

    openModal(`
      <h2>Badge Preview — ${esc(associate.name)}</h2>
      <div style="text-align: center; margin: 20px 0;">
        <img src="${dataUrl}" style="max-width: 100%; max-height: 400px; border: 1px solid #ccc; border-radius: 4px;">
      </div>
      <p class="muted">Size: 3.375" × 2.125" (CR80) at 300 DPI</p>
      <div class="inline mt">
        <button class="btn btn-primary" id="preview-print">🖨️ Print badge</button>
        <button class="btn" onclick="closeModal()">Cancel</button>
      </div>`);

    $("#preview-print").onclick = () => {
      closeModal();
      printBadge(associate);
    };
  }

  return {
    generateBarcodeText,
    generateBadgeCanvas,
    exportPNG,
    exportPDF,
    printBadge,
    previewBadge,
  };
})();
