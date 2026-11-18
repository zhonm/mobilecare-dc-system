/**
 * Shared utility for capturing rendered Recharts SVG visualizations from the DOM
 * and embedding them cleanly into jsPDF reports.
 */

const CHART_FONT_FAMILY = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/**
 * Rasterize a single SVG element into a crisp 2x PNG data URL.
 * Returns null if the SVG has zero dimensions or fails to rasterize.
 */
async function rasterizeSvgToPng(svgEl) {
  if (!svgEl || typeof XMLSerializer === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  const rect = svgEl.getBoundingClientRect();
  const width = Math.round(rect.width || Number(svgEl.getAttribute('width')) || 0);
  const height = Math.round(rect.height || Number(svgEl.getAttribute('height')) || 0);
  if (width <= 10 || height <= 10) return null;

  const cloned = svgEl.cloneNode(true);
  cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  cloned.setAttribute('width', String(width));
  cloned.setAttribute('height', String(height));
  if (!cloned.getAttribute('viewBox')) {
    cloned.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  cloned.style.fontFamily = CHART_FONT_FAMILY;

  // Ensure all <text> / <tspan> nodes have an explicit readable font-family
  cloned.querySelectorAll('text, tspan').forEach((node) => {
    if (!node.style.fontFamily) {
      node.style.fontFamily = CHART_FONT_FAMILY;
    }
  });

  const serialized = new XMLSerializer().serializeToString(cloned);
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        const pngDataUrl = canvas.toDataURL('image/png');
        resolve({ dataUrl: pngDataUrl, width, height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = svgDataUrl;
  });
}

/**
 * Extract the nearest card title and optional subtitle for a chart wrapper element.
 */
function extractChartCardMeta(wrapperEl, fallbackIndex) {
  const card = wrapperEl.closest('.card') || wrapperEl.parentElement?.parentElement || wrapperEl.parentElement;
  let title = `Chart ${fallbackIndex + 1}`;
  let subtitle = '';

  if (card) {
    const heading = card.querySelector('h3, h4, h2');
    if (heading && heading.textContent) {
      title = heading.textContent.replace(/\s+/g, ' ').trim();
    }
    const subCandidates = card.querySelectorAll('div, p, span');
    for (const el of subCandidates) {
      if (el === heading || el.contains(heading) || el.closest('.recharts-wrapper')) continue;
      const styleColor = el.style?.color || '';
      const cls = typeof el.className === 'string' ? el.className : '';
      if (styleColor.includes('text-muted') || cls.includes('subtitle') || cls.includes('muted')) {
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt && txt !== title && txt.length < 140) {
          subtitle = txt;
          break;
        }
      }
    }
  }

  return { title, subtitle };
}

/**
 * Pick the main chart <svg> inside a .recharts-wrapper by largest area,
 * ignoring small 14x14 legend swatch SVGs.
 */
function findMainChartSvg(wrapper) {
  const svgs = Array.from(wrapper.querySelectorAll('svg.recharts-surface, svg'));
  let bestSvg = null;
  let bestArea = 0;

  for (const svg of svgs) {
    if (svg.closest('.recharts-legend-wrapper')) continue;
    const rect = svg.getBoundingClientRect();
    const w = rect.width || Number(svg.getAttribute('width')) || 0;
    const h = rect.height || Number(svg.getAttribute('height')) || 0;
    const area = w * h;
    if (w >= 80 && h >= 60 && area > bestArea) {
      bestArea = area;
      bestSvg = svg;
    }
  }

  return bestSvg;
}

/**
 * Extract legend items (label + hex/rgb color) from a Recharts wrapper if present,
 * falling back to custom `[data-chart-legend-item]` elements inside the parent card.
 */
function extractLegendItems(wrapper) {
  const items = [];
  const legendNodes = wrapper.querySelectorAll('.recharts-legend-item');
  legendNodes.forEach((node) => {
    const labelEl = node.querySelector('.recharts-legend-item-text');
    const label = (labelEl?.textContent || node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!label) return;

    let color = labelEl?.style?.color || '';
    const iconPath = node.querySelector('.recharts-legend-icon, path, rect, circle, line');
    if (iconPath) {
      color = iconPath.getAttribute('fill') || iconPath.getAttribute('stroke') || color;
      if (color === 'none') {
        color = iconPath.getAttribute('stroke') || '#3b82f6';
      }
    }
    items.push({ label, color: color || '#64748b' });
  });

  if (items.length === 0) {
    const card = wrapper.closest('.card') || wrapper.parentElement?.parentElement;
    if (card) {
      card.querySelectorAll('[data-chart-legend-item]').forEach((node) => {
        const label = (node.getAttribute('data-legend-label') || node.textContent || '').replace(/\s+/g, ' ').trim();
        const color = node.getAttribute('data-legend-color') || '#64748b';
        if (label) {
          items.push({ label, color });
        }
      });
    }
  }

  return items;
}

/**
 * Capture all visible Recharts charts inside a DOM container as PNG data URLs.
 * Safe to call in SSR/Node (returns [] immediately).
 *
 * @param {HTMLElement|null} containerEl
 * @returns {Promise<Array<{ title: string, subtitle: string, legendItems: Array<{label: string, color: string}>, dataUrl: string, width: number, height: number }>>}
 */
export async function captureChartsFromContainer(containerEl) {
  if (typeof document === 'undefined' || !containerEl) return [];

  const wrappers = Array.from(containerEl.querySelectorAll('.recharts-wrapper'));
  if (wrappers.length === 0) return [];

  const results = [];
  for (let i = 0; i < wrappers.length; i += 1) {
    const wrapper = wrappers[i];
    const svgEl = findMainChartSvg(wrapper);
    if (!svgEl) continue;

    const rasterized = await rasterizeSvgToPng(svgEl);
    if (!rasterized) continue;

    const { title, subtitle } = extractChartCardMeta(wrapper, results.length);
    const legendItems = extractLegendItems(wrapper);
    results.push({
      title,
      subtitle,
      legendItems,
      dataUrl: rasterized.dataUrl,
      width: rasterized.width,
      height: rasterized.height
    });
  }

  return results;
}

function parseCssColorToRgb(colorStr) {
  if (!colorStr || typeof colorStr !== 'string') return [100, 116, 139];
  const hexMatch = colorStr.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16)
    ];
  }
  const rgbMatch = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  return [100, 116, 139];
}

/**
 * Append a formatted "Visual Analytics & Charts" section to a jsPDF document.
 * Automatically lays out charts in a 2-column grid (or 1-column if only 1 chart)
 * with card borders, titles, subtitles, and automatic pagination.
 *
 * @param {any} doc - jsPDF instance
 * @param {Array<{ title: string, subtitle?: string, dataUrl: string, width: number, height: number }>} chartImages
 * @param {object} options
 */
export function appendChartsSectionToPdf(doc, chartImages = [], options = {}) {
  if (!doc || !Array.isArray(chartImages) || chartImages.length === 0) return;

  const {
    sectionTitle = 'Visual Analytics & Charts',
    sectionSubtitle = 'Captured from live dashboard visualizations',
    margin = 14,
    startOnNewPage = true,
    startY = null
  } = options;

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;

  let cursorY = startY;
  if (startOnNewPage || cursorY === null || cursorY > pageHeight - 60) {
    doc.addPage();
    cursorY = 16;
  }

  const drawSectionHeader = (yPos, isContinuation = false) => {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(isContinuation ? `${sectionTitle} (Continued)` : sectionTitle, margin, yPos);
    if (!isContinuation && sectionSubtitle) {
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.text(sectionSubtitle, margin, yPos + 5);
      return yPos + 10;
    }
    return yPos + 6;
  };

  cursorY = drawSectionHeader(cursorY, false);

  const cols = chartImages.length === 1 ? 1 : 2;
  const colGap = 6;
  const rowGap = 6;
  const cardWidth = cols === 1 ? contentWidth : (contentWidth - colGap) / 2;
  const cardPadding = 3.5;
  const headerBandHeight = 12;
  const maxChartHeight = cols === 1 ? 105 : 64;

  let idx = 0;
  while (idx < chartImages.length) {
    const rowItems = chartImages.slice(idx, idx + cols);

    // Compute uniform row height based on tallest chart in this row
    const computedHeights = rowItems.map((chart) => {
      const innerWidth = cardWidth - cardPadding * 2;
      const aspect = chart.height > 0 && chart.width > 0 ? chart.height / chart.width : 0.52;
      const rawH = innerWidth * aspect;
      const imgH = Math.min(maxChartHeight, Math.max(36, rawH));
      const hasLegend = Array.isArray(chart.legendItems) && chart.legendItems.length > 0;
      const legendHeight = hasLegend ? 5.5 : 0;
      return {
        imgH,
        legendHeight,
        cardH: headerBandHeight + imgH + legendHeight + cardPadding * 2
      };
    });

    const rowHeight = Math.max(...computedHeights.map((h) => h.cardH));

    // Page break if row doesn't fit
    if (cursorY + rowHeight > pageHeight - 12) {
      doc.addPage();
      cursorY = drawSectionHeader(16, true);
    }

    rowItems.forEach((chart, colIdx) => {
      const cardX = margin + colIdx * (cardWidth + colGap);
      const cardY = cursorY;
      const { imgH } = computedHeights[colIdx];

      // Card container
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.35);
      doc.roundedRect(cardX, cardY, cardWidth, rowHeight, 2, 2, 'FD');

      // Card title & subtitle
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      const titleText = String(chart.title || `Chart ${idx + colIdx + 1}`).slice(0, 68);
      doc.text(titleText, cardX + cardPadding, cardY + 5.5);

      if (chart.subtitle) {
        doc.setTextColor(100, 116, 139);
        doc.setFontSize(7.2);
        doc.setFont('helvetica', 'normal');
        const subText = String(chart.subtitle).slice(0, 82);
        doc.text(subText, cardX + cardPadding, cardY + 9.5);
      }

      // Fit image inside card bounds preserving aspect ratio
      const availW = cardWidth - cardPadding * 2;
      const aspect = chart.height > 0 && chart.width > 0 ? chart.width / chart.height : 1.9;
      let drawW = availW;
      let drawH = drawW / aspect;
      if (drawH > imgH) {
        drawH = imgH;
        drawW = drawH * aspect;
      }
      const imgX = cardX + (cardWidth - drawW) / 2;
      const imgY = cardY + headerBandHeight + (imgH - drawH) / 2;

      try {
        doc.addImage(chart.dataUrl, 'PNG', imgX, imgY, drawW, drawH);
      } catch {
        // Ignore malformed image
      }

      // Render legend strip at bottom of card if present
      if (Array.isArray(chart.legendItems) && chart.legendItems.length > 0) {
        const legendY = cardY + rowHeight - cardPadding - 1.5;
        let lx = cardX + cardPadding;
        const maxLx = cardX + cardWidth - cardPadding;
        doc.setFontSize(6.8);
        doc.setFont('helvetica', 'normal');
        for (const item of chart.legendItems) {
          const label = String(item.label || '').slice(0, 28);
          const textW = doc.getTextWidth(label);
          if (lx + 4 + textW > maxLx) break;
          const [r, g, b] = parseCssColorToRgb(item.color);
          doc.setFillColor(r, g, b);
          doc.rect(lx, legendY - 2.2, 2.5, 2.5, 'F');
          doc.setTextColor(71, 85, 105);
          doc.text(label, lx + 3.5, legendY);
          lx += 3.5 + textW + 4.5;
        }
      }
    });

    cursorY += rowHeight + rowGap;
    idx += cols;
  }
}
