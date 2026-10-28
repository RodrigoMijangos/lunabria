/**
 * TextLayerCrossReferenceDecorator.js
 * Resolves and decorates chapter/section cross-references inside rendered PDF text layers.
 */
const TextLayerCrossReferenceDecorator = {
  _normalizeReferenceText(value) {
    let normalized = "";
    const offsets = [];
    let previousWasSpace = false;
    const text = String(value || "");

    for (let offset = 0; offset < text.length; offset += 1) {
      const folded = text[offset]
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      for (const character of folded) {
        if (/\s/.test(character)) {
          if (!previousWasSpace) {
            normalized += " ";
            offsets.push(offset);
          }
          previousWasSpace = true;
        } else {
          normalized += character;
          offsets.push(offset);
          previousWasSpace = false;
        }
      }
    }

    return { text: normalized, offsets };
  },

  _canonicalReferenceNumber(value) {
    if (/^\d+(?:\.\d+)*$/.test(value)) {
      return value
        .split(".")
        .map((part) => part.replace(/^0+(?=\d)/, ""))
        .join(".");
    }
    if (!/^[ivxlcdm]+$/.test(value)) return null;

    const roman = value.toUpperCase();
    if (!/^(?=.)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(roman)) return null;
    const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    for (let index = 0; index < roman.length; index += 1) {
      const current = values[roman[index]];
      const next = values[roman[index + 1]] || 0;
      total += current < next ? -current : current;
    }
    return String(total);
  },

  _referenceNumberFromTitle(title, kind, depth) {
    const normalized = this._normalizeReferenceText(title).text.trim();
    const labelPattern =
      kind === "chapter"
        ? /^(?:chapter|chap(?:ter)?\.?|capitulo)\s+(\d+(?:\.\d+)*|[ivxlcdm]+)(?=$|[\s:.)-])/
        : /^(?:section|sec(?:tion)?\.?|seccion)\s+(\d+(?:\.\d+)*|[ivxlcdm]+)(?=$|[\s:.)-])/;
    const labeledMatch = normalized.match(labelPattern);
    if (labeledMatch) {
      if (kind === "section" && /[ivxlcdm]/.test(labeledMatch[1])) return null;
      return this._canonicalReferenceNumber(labeledMatch[1]);
    }

    const bareMatch = normalized.match(/^(\d+(?:\.\d+)*|[ivxlcdm]+)(?=$|[\s:.)-])/);
    if (!bareMatch) return null;
    if (kind === "chapter" && (depth !== 0 || bareMatch[1].includes("."))) return null;
    if (kind === "section" && ((depth === 0 && !bareMatch[1].includes(".")) || /[ivxlcdm]/.test(bareMatch[1]))) {
      return null;
    }
    return this._canonicalReferenceNumber(bareMatch[1]);
  },

  _findReferencePage(navigationMap, kind, identifier) {
    const canonicalIdentifier = this._canonicalReferenceNumber(identifier);
    if (!canonicalIdentifier || !Array.isArray(navigationMap?.toc)) return null;

    const entries = [];
    const visit = (items, depth = 0) => {
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (Number.isInteger(item.page) && item.page > 0 && typeof item.title === "string") {
          entries.push({ item, depth });
        }
        if (Array.isArray(item.children)) visit(item.children, depth + 1);
      }
    };
    visit(navigationMap.toc);

    const match = entries.find(
      ({ item, depth }) => this._referenceNumberFromTitle(item.title, kind, depth) === canonicalIdentifier,
    );
    return match ? match.item.page : null;
  },

  findCrossReferences(text, navigationMap) {
    const searchable = this._normalizeReferenceText(text);
    const references = [];
    const pattern =
      /\b(chapter|chap(?:ter)?\.?|capitulo|section|sec(?:tion)?\.?|seccion)\s+(\d+(?:\.\d+)*|[ivxlcdm]+)\b/g;
    let match = pattern.exec(searchable.text);

    while (match !== null) {
      const kind = /^(?:section|sec|seccion)/.test(match[1]) ? "section" : "chapter";
      const targetPage = this._findReferencePage(navigationMap, kind, match[2]);
      const start = searchable.offsets[match.index];
      const lastOffset = searchable.offsets[match.index + match[0].length - 1];
      if (targetPage && Number.isInteger(start) && Number.isInteger(lastOffset)) {
        references.push({
          start,
          end: lastOffset + 1,
          text: String(text || "")
            .slice(start, lastOffset + 1)
            .replace(/\s+/g, " ")
            .trim(),
          kind,
          targetPage,
        });
      }
      match = pattern.exec(searchable.text);
    }
    return references;
  },

  _collectTextNodes(container) {
    const nodes = [];
    const visit = (node) => {
      if (node?.nodeType === 3) {
        if (node.textContent) nodes.push(node);
        return;
      }
      if (node?.classList?.contains("reader-reference-link")) return;
      for (const child of Array.from(node?.childNodes || [])) visit(child);
    };
    visit(container);
    return nodes;
  },

  _hasNativePdfLinkAtPoint(container, event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    const pageWrapper = container.closest?.(".pdf-page-wrapper");
    const links = pageWrapper?.querySelectorAll?.(".pdf-internal-link") || [];
    return Array.from(links).some((link) => {
      const rect = link.getBoundingClientRect?.();
      return (
        rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    });
  },

  _guardReferenceGesture(link) {
    let activePointer = null;
    let suppressNextPointerClick = false;
    let suppressionTimer = null;
    const removeWindowListeners = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onEnd, true);
      window.removeEventListener("pointercancel", onCancel, true);
    };
    const suppressClick = () => {
      suppressNextPointerClick = true;
      clearTimeout(suppressionTimer);
      suppressionTimer = setTimeout(() => {
        suppressNextPointerClick = false;
        suppressionTimer = null;
      }, 0);
    };
    const onMove = (event) => {
      if (!activePointer || (activePointer.id != null && event.pointerId !== activePointer.id)) return;
      const distance = Math.hypot(event.clientX - activePointer.x, event.clientY - activePointer.y);
      activePointer.maxDistance = Math.max(activePointer.maxDistance, distance);
    };
    const onEnd = (event) => {
      if (!activePointer || (activePointer.id != null && event.pointerId !== activePointer.id)) return;
      const pointer = activePointer;
      const duration = Math.max(
        0,
        (Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now()) - pointer.startedAt,
      );
      const distance = Math.max(pointer.maxDistance, Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y));
      activePointer = null;
      removeWindowListeners();
      if (distance > 8 || (pointer.type === "touch" && duration >= 400)) suppressClick();
    };
    const onCancel = (event) => {
      if (!activePointer || (activePointer.id != null && event.pointerId !== activePointer.id)) return;
      activePointer = null;
      removeWindowListeners();
      suppressClick();
    };

    link.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      activePointer = {
        id: event.pointerId,
        type: event.pointerType || "mouse",
        x: event.clientX,
        y: event.clientY,
        startedAt: Number.isFinite(event.timeStamp) ? event.timeStamp : Date.now(),
        maxDistance: 0,
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onEnd, true);
      window.addEventListener("pointercancel", onCancel, true);
    });

    return () => suppressNextPointerClick;
  },

  decorateCrossReferences(container, navigationMap, sourcePage, onNavigate) {
    if (!container || typeof onNavigate !== "function" || !Number.isInteger(sourcePage) || sourcePage < 1) return 0;
    if (container.dataset?.crossReferencesProcessed === "true") return 0;
    if (container.dataset) container.dataset.crossReferencesProcessed = "true";

    const textNodes = this._collectTextNodes(container);
    const nodeRanges = [];
    const rawParts = [];
    let textLength = 0;
    for (let nodeIndex = 0; nodeIndex < textNodes.length; nodeIndex += 1) {
      const node = textNodes[nodeIndex];
      const text = node.textContent || "";
      rawParts.push(text);
      nodeRanges.push({ node, nodeIndex, start: textLength, end: textLength + text.length });
      textLength += text.length;
    }

    const references = this.findCrossReferences(rawParts.join(""), navigationMap);
    const operations = [];
    for (const reference of references) {
      const segments = nodeRanges.flatMap((range) => {
        const start = Math.max(reference.start, range.start);
        const end = Math.min(reference.end, range.end);
        return start < end
          ? [{ node: range.node, nodeIndex: range.nodeIndex, start: start - range.start, end: end - range.start }]
          : [];
      });

      const visibleSegments = segments.filter((segment) =>
        segment.node.textContent.slice(segment.start, segment.end).trim(),
      );
      visibleSegments.forEach((segment, index) =>
        operations.push({
          ...segment,
          reference,
          isPrimary: index === 0,
        }),
      );
    }

    operations.sort((a, b) => b.nodeIndex - a.nodeIndex || b.start - a.start);
    let decorated = 0;
    for (const operation of operations) {
      const { node, start, end, reference, isPrimary } = operation;
      const parent = node.parentNode;
      if (!parent || typeof node.splitText !== "function" || typeof parent.replaceChild !== "function") continue;

      try {
        node.splitText(end);
        const selectedText = node.splitText(start);
        const link = document.createElement("a");
        link.className = "reader-reference-link";
        link.setAttribute("href", `#pdf-page-${reference.targetPage}`);
        link.setAttribute("title", `Go to page ${reference.targetPage}`);
        link.setAttribute("data-target-page", reference.targetPage);
        if (isPrimary) {
          link.tabIndex = 0;
          link.setAttribute("aria-label", `Go to ${reference.text}, page ${reference.targetPage}`);
        } else {
          link.tabIndex = -1;
          link.setAttribute("aria-hidden", "true");
        }
        const isPointerGestureRejected = this._guardReferenceGesture(link);
        link.addEventListener("click", (event) => {
          event.preventDefault();
          if (event.detail > 0) {
            const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
            if (
              isPointerGestureRejected() ||
              this._hasNativePdfLinkAtPoint(container, event) ||
              (selection && !selection.isCollapsed)
            ) {
              return;
            }
          }
          onNavigate(reference.targetPage, sourcePage);
        });
        parent.replaceChild(link, selectedText);
        link.appendChild(selectedText);
        decorated += 1;
      } catch (error) {
        console.warn("[TextLayerView] Could not make a chapter reference interactive:", error);
      }
    }
    return decorated;
  },
};

window.TextLayerCrossReferenceDecorator = TextLayerCrossReferenceDecorator;
