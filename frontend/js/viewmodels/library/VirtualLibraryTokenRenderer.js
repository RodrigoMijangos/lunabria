/**
 * VirtualLibraryTokenRenderer.js
 * Shared DOM rendering, query builder, and book-list helpers for Virtual Library modals.
 */
const DEFAULT_VL_FALLBACK_COVER =
  'data:image/svg+xml;utf8,<svg viewBox="0 0 200 300"><rect width="100%" height="100%" fill="%232d3748"/><path d="M70 120h60M70 150h60" stroke="%23718096" stroke-width="6"/><circle cx="100" cy="80" r="18" fill="%23a0aec0"/></svg>';

const FALLBACK_COVERS = { true: () => OFFLINE_FALLBACK_COVER, false: () => DEFAULT_VL_FALLBACK_COVER };
const DISPLAY_VALUES = { true: (v) => v, false: () => "none" };

class VirtualLibraryTokenRenderer {
  static mapElements(idMap) {
    const out = {};
    for (const [key, id] of Object.entries(idMap)) out[key] = document.getElementById(id);
    return out;
  }

  static setProp(target, key, value) {
    if (target) target[key] = value;
  }

  static setDisplay(target, displayValue) {
    this.setProp(target?.style, "display", displayValue);
  }

  static toggleDisplay(target, visible, visibleValue = "") {
    this.setDisplay(target, DISPLAY_VALUES[Boolean(visible)](visibleValue));
  }

  static setStatus(statusEl, message, color = "var(--accent-color)") {
    this.setProp(statusEl, "textContent", message);
    this.setProp(statusEl?.style, "color", color);
  }

  static getTrimmed(inputEl) {
    return String(inputEl?.value ?? "").trim();
  }

  static extractBooks(response) {
    if (Array.isArray(response)) return { books: response, total: response.length, page: 1 };
    const books = Array.isArray(response?.books) ? response.books : [];
    const rawTotal = Number(response?.total);
    return {
      books,
      total: Number.isFinite(rawTotal) ? rawTotal : books.length,
      page: Number(response?.page) || 1,
    };
  }

  static clearContainer(container) {
    if (!container) return;
    if (typeof container.replaceChildren === "function") container.replaceChildren();
    else container.textContent = "";
  }

  static addSpan(parent, className, textContent) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = textContent;
    parent.appendChild(span);
    return span;
  }

  static createCoverWrap(book) {
    const coverWrap = document.createElement("div");
    coverWrap.className = "vl-book-cover-wrap";
    const coverImg = document.createElement("img");
    coverImg.className = "vl-book-cover";
    coverImg.alt = String(book.title ?? "");
    coverImg.loading = "lazy";
    coverImg.src = book.cover_url || `/api/books/${book.id}/cover`;
    coverImg.onerror = () => {
      coverImg.onerror = null;
      coverImg.src = FALLBACK_COVERS[typeof OFFLINE_FALLBACK_COVER !== "undefined"]();
    };
    coverWrap.appendChild(coverImg);
    return coverWrap;
  }

  static createBookCheckboxItem(book, isSelected, stringifyCheckboxId = false) {
    const label = document.createElement("label");
    label.className = ["vl-book-item", isSelected ? "is-selected" : ""].filter(Boolean).join(" ");
    label.dataset.bookId = String(book.id);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.bookId = stringifyCheckboxId ? String(book.id) : book.id;
    checkbox.checked = isSelected;
    label.append(checkbox);
    this.addSpan(label, "vl-book-title-author", `${book.title} — ${book.authors ?? ""}`);
    label.append(this.createCoverWrap(book));
    return label;
  }

  static createPreviewBookCard(book) {
    const card = document.createElement("div");
    card.className = "vl-book-item vl-book-preview-item";
    card.append(this.createCoverWrap(book));
    this.addSpan(card, "vl-book-title-author", `${book.title} — ${book.authors ?? ""}`);
    return card;
  }

  static matchesBookSearch(book, normalizedQuery) {
    const tags = [book.tags].flat().join(" ");
    return `${book.title ?? ""} ${book.authors ?? ""} ${tags}`.toLowerCase().includes(normalizedQuery);
  }

  static renderEmptyMessage(container, message) {
    const empty = document.createElement("div");
    Object.assign(empty.style, { padding: "12px", textAlign: "center", color: "var(--text-secondary)" });
    empty.textContent = message;
    container.appendChild(empty);
  }

  static renderClauseTokens({ container, queryInput, compiledPreview = null, includeRemoveButton = true, onUpdated }) {
    if (!container) return;
    const raw = this.getTrimmed(queryInput);
    this.clearContainer(container);
    if (!raw || typeof LunabriaQueryCompiler?.parseClauses !== "function") {
      this.setProp(compiledPreview, "textContent", "");
      return;
    }
    const compiled = LunabriaQueryCompiler.compile(raw);
    this.setProp(compiledPreview, "textContent", compiled ? `Calibre: ${compiled}` : "");
    const clauses = LunabriaQueryCompiler.parseClauses(raw);
    clauses.forEach((cl, idx) => {
      const isNegated = cl.op.includes("-");
      const isOr = cl.op.includes(",");
      const pill = document.createElement("div");
      pill.className = ["vl-token-pill", isNegated ? "is-negated" : ""].filter(Boolean).join(" ");
      if (idx > 0 && isOr) this.addSpan(pill, "vl-token-op vl-token-op-or", "OR");
      else if (idx > 0 && !isNegated) this.addSpan(pill, "vl-token-op vl-token-op-and", "AND");
      if (isNegated) this.addSpan(pill, "vl-token-op vl-token-op-not", "NOT");
      if (cl.field) this.addSpan(pill, "vl-token-field", `${cl.field}:`);
      const valSpan = this.addSpan(
        pill,
        "vl-token-value",
        cl.values.map((v) => (v.isQuoted ? `"${v.value}"` : v.value)).join(", "),
      );
      const handleRemove = (e) => {
        e?.stopPropagation?.();
        clauses.splice(idx, 1);
        this.setProp(queryInput, "value", LunabriaQueryCompiler.formatClauses(clauses));
        onUpdated?.();
      };
      if (includeRemoveButton) {
        const removeBtn = document.createElement("button");
        Object.assign(removeBtn, {
          type: "button",
          className: "vl-token-remove",
          textContent: "\u2715",
          onclick: handleRemove,
        });
        removeBtn.setAttribute?.("aria-label", `Remove filter ${valSpan.textContent}`);
        pill.appendChild(removeBtn);
      } else {
        pill.onclick = handleRemove;
      }
      container.appendChild(pill);
    });
  }

  static setBuilderVisible(queryBuilderCard, builderToggleBtn, visible) {
    if (!queryBuilderCard) return;
    if (visible) queryBuilderCard.removeAttribute?.("hidden");
    else queryBuilderCard.setAttribute?.("hidden", "");
    this.toggleDisplay(queryBuilderCard, visible, "");
    builderToggleBtn?.setAttribute?.("aria-expanded", String(visible));
    builderToggleBtn?.classList?.toggle?.("active", visible);
    this.setProp(builderToggleBtn?.querySelector?.("span"), "textContent", visible ? "Hide Builder" : "Query Builder");
  }

  static handleCheckboxChange(event, selectedIdsSet, onSelectionUpdated) {
    const checkbox = event.target?.dataset?.bookId ? event.target : event.target?.closest?.("input[data-book-id]");
    if (!checkbox) return;
    const id = Number(checkbox.dataset.bookId);
    const isChecked = Boolean(checkbox.checked);
    if (isChecked) selectedIdsSet.add(id);
    else selectedIdsSet.delete(id);
    checkbox.closest?.(".vl-book-item")?.classList?.toggle?.("is-selected", isChecked);
    onSelectionUpdated?.();
  }
}

window.VirtualLibraryTokenRenderer = VirtualLibraryTokenRenderer;
