/**
 * MobileSelectionTargetResolver.js
 * Resolves touch points to PDF page wrappers, word spans, and initial DOM Ranges
 * with mobile spatial tolerance (holgura).
 */
class MobileSelectionTargetResolver {
  static resolveInitialSelectionRange(controller, point, pageWrapper) {
    const targetProbe =
      controller.getTextPositionAt(point.x, point.y, pageWrapper) ||
      controller.findNearbyTarget(point.x, point.y, pageWrapper, 44, 30);

    const textNodeType = typeof Node !== "undefined" ? Node.TEXT_NODE : 3;
    if (targetProbe?.node?.nodeType === textNodeType) {
      const bounds = ReaderTextTargetGeometry.getWordBoundaries({
        node: targetProbe.node,
        offset: targetProbe.offset,
      });
      if (bounds && bounds.endOffset > bounds.startOffset) {
        try {
          const range = document.createRange();
          range.setStart(bounds.startNode, bounds.startOffset);
          range.setEnd(bounds.endNode, bounds.endOffset);
          if (range.toString().trim()) return range;
        } catch (_) {}
      }
    }

    const targetSpan = targetProbe?.span || controller.findTargetElementUnderPoint(point.x, point.y, pageWrapper);
    if (!targetSpan) return null;
    try {
      const range = document.createRange();
      range.selectNodeContents(targetSpan);
      return range.toString().trim() ? range : null;
    } catch (err) {
      console.warn("[MobileSelectionController] Selection creation failed:", err);
      return null;
    }
  }

  static findNearbyTarget(clientX, clientY, pageWrapper, slackX = 44, slackY = 30) {
    const textLayer = pageWrapper?.querySelector?.(".textLayer") || pageWrapper?.querySelector?.(".pdf-text-layer");
    if (!textLayer) return null;

    if (typeof ReaderNativeSelectionLoupeController !== "undefined") {
      const probe = ReaderNativeSelectionLoupeController.prototype?.findTextTargetWithinGap?.call(
        null,
        clientX,
        clientY,
        textLayer,
        slackX,
        slackY,
        false,
      );
      if (probe?.node) return probe;
    }

    const words = Array.from(textLayer.querySelectorAll?.(".precise-word") || []);
    const candidates = words.length > 0 ? words : Array.from(textLayer.querySelectorAll?.(".precise-line, span") || []);
    if (!candidates.length) return null;

    const nearest = ReaderTextTargetGeometry.nearestElement(candidates, clientX, clientY);
    if (nearest && nearest.distanceSq <= slackX * slackX + slackY * slackY) {
      const textNode = nearest.element.firstChild || nearest.element;
      const offset = ReaderTextTargetGeometry.textOffsetAtX(textNode, nearest.rect, clientX);
      return { node: textNode, offset, span: nearest.element, rect: nearest.rect };
    }
    return null;
  }

  static elementsAt(clientX, clientY) {
    if (document.elementsFromPoint) return document.elementsFromPoint(clientX, clientY);
    if (document.elementFromPoint) return [document.elementFromPoint(clientX, clientY)];
    return [];
  }

  static findTargetElementUnderPoint(clientX, clientY) {
    for (const el of this.elementsAt(clientX, clientY)) {
      if (!el) continue;
      const found =
        el.closest?.(".precise-word, .precise-line, .textLayer span") ||
        (el.classList?.contains("precise-word") || el.classList?.contains("precise-line") ? el : null);
      if (found) return found;
    }
    return null;
  }

  static getTextPositionAt(controller, clientX, clientY, pageWrapper) {
    if (!pageWrapper) return null;

    const caret = ReaderTextTargetGeometry.caretPosition(clientX, clientY);
    const textNodeType = typeof Node !== "undefined" ? Node.TEXT_NODE : 3;
    if (caret && caret.node.nodeType === textNodeType && pageWrapper.contains(caret.node)) {
      return caret;
    }

    const textSpan = controller.findTargetElementUnderPoint(clientX, clientY, pageWrapper);
    if (textSpan && pageWrapper.contains(textSpan)) {
      const textNode = textSpan.firstChild || textSpan;
      const rect = textSpan.getBoundingClientRect ? textSpan.getBoundingClientRect() : { left: 0, width: 100 };
      return {
        node: textNode,
        offset: ReaderTextTargetGeometry.textOffsetAtX(textNode, rect, clientX),
      };
    }
    return null;
  }

  static getPageWrapperAt(controller, clientX, clientY) {
    const viewport = controller.reader?.viewportEl || document.getElementById("pdf-viewport");
    if (!viewport) return null;

    for (const el of this.elementsAt(clientX, clientY)) {
      const wrapper =
        el?.closest?.('.pdf-page-wrapper, [id^="pdf-page-"]') ||
        (el?.classList?.contains("pdf-page-wrapper") ? el : null);
      if (wrapper) return wrapper;
    }

    const queryWrappers = Array.from(viewport.querySelectorAll?.('.pdf-page-wrapper, [id^="pdf-page-"]') || []);
    const allWrappers =
      queryWrappers.length > 0
        ? queryWrappers
        : Array.from(viewport.children || []).filter(
            (c) => c.classList?.contains("pdf-page-wrapper") || c.id?.startsWith("pdf-page-"),
          );
    if (!allWrappers.length) {
      return viewport.querySelector?.(".textLayer")?.parentElement || null;
    }

    let nearestWrapper = null;
    let minVerticalDist = Infinity;
    for (const w of allWrappers) {
      const rect = w.getBoundingClientRect?.();
      if (!rect) continue;
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return w;
      }
      const dist = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (dist < minVerticalDist) {
        minVerticalDist = dist;
        nearestWrapper = w;
      }
    }
    return (
      nearestWrapper ||
      document.getElementById(`pdf-page-${controller.model.currentPage}`) ||
      viewport.querySelector?.(`.pdf-page-wrapper[data-page="${controller.model.currentPage}"]`) ||
      allWrappers[0] ||
      null
    );
  }
}

window.MobileSelectionTargetResolver = MobileSelectionTargetResolver;
