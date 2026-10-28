/**
 * VirtualLibraryQueryBuilder.js
 * Manages Calibre search rule editing, interactive query builder controls,
 * and live query preview across Virtual Library Create and Manage modals.
 */
class VirtualLibraryQueryBuilder {
  static bindCreateModalQuery(modal, els, isCurrentSequence) {
    const R = VirtualLibraryTokenRenderer;
    const renderQueryTokens = () =>
      R.renderClauseTokens({
        container: els.queryTokensContainer,
        queryInput: els.queryInput,
        includeRemoveButton: true,
        onUpdated: () => updateQueryPreview(),
      });

    const updateQueryPreview = async () => {
      renderQueryTokens();
      if (!els.queryPreviewList) return;
      const rawQuery = R.getTrimmed(els.queryInput);
      const compiledQuery = LunabriaQueryCompiler?.compile?.(rawQuery) ?? rawQuery;
      R.setProp(els.compiledPreview, "textContent", compiledQuery ? `Calibre: ${compiledQuery}` : "");
      if (!rawQuery) {
        R.setDisplay(els.queryPreviewContainer, "none");
        els.queryPreviewList.replaceChildren();
        return;
      }
      R.setDisplay(els.queryPreviewContainer, "block");
      R.setProp(els.queryPreviewCount, "textContent", "Checking matching books...");
      els.queryPreviewList.textContent = "Searching books matching expression...";
      try {
        const response = await api.getBooks(compiledQuery, null, { pageSize: 100 });
        if (!isCurrentSequence()) return;
        const { books: pageBooks, total } = R.extractBooks(response);
        R.setProp(els.queryPreviewCount, "textContent", `Matching books (${total}):`);
        els.queryPreviewList.replaceChildren();
        if (!pageBooks.length) {
          els.queryPreviewList.textContent = "No books match this Calibre search expression.";
          return;
        }
        pageBooks.forEach((b) => els.queryPreviewList.appendChild(R.createPreviewBookCard(b)));
      } catch {
        if (!isCurrentSequence()) return;
        R.setProp(els.queryPreviewCount, "textContent", "Matching books (0):");
        els.queryPreviewList.textContent = "Invalid Calibre search expression or no books match.";
      }
    };

    renderQueryTokens();
    R.setBuilderVisible(els.queryBuilderCard, els.builderToggleBtn, false);

    R.setProp(els.builderToggleBtn, "onclick", () => {
      const isHidden =
        Boolean(els.queryBuilderCard?.hasAttribute?.("hidden")) || els.queryBuilderCard?.style?.display === "none";
      R.setBuilderVisible(els.queryBuilderCard, els.builderToggleBtn, isHidden);
    });
    R.setProp(els.builderCloseBtn, "onclick", () =>
      R.setBuilderVisible(els.queryBuilderCard, els.builderToggleBtn, false),
    );
    R.setProp(els.addTermBtn, "onclick", () => {
      const val = R.getTrimmed(els.valueInput);
      if (!val || !els.queryInput) return;
      const field = els.fieldSelect?.value || "tags:";
      const isExact = els.exactCheckbox?.checked ?? true;
      const term = `${field} ${isExact ? `"${val}"` : val}`;
      const current = R.getTrimmed(els.queryInput);
      els.queryInput.value = current ? `${current} + ${term}` : term;
      R.setProp(els.valueInput, "value", "");
      updateQueryPreview();
    });
    R.setProp(els.clearQueryBtn, "onclick", () => {
      R.setProp(els.queryInput, "value", "");
      R.setProp(els.compiledPreview, "textContent", "");
      renderQueryTokens();
      updateQueryPreview();
    });
    (modal?.querySelectorAll?.(".vl-helper-btn") || []).forEach((btn) => {
      btn.onclick = () => {
        const insert = btn.dataset.insert;
        if (!insert || !els.queryInput) return;
        const current = R.getTrimmed(els.queryInput);
        if (/^ (\+|-)|^, /.test(insert)) {
          els.queryInput.value = current ? `${current}${insert}` : insert.includes("-") ? "- " : "";
        } else {
          els.queryInput.value = current ? `${current} + ${insert}` : insert;
        }
        updateQueryPreview();
      };
    });

    let querySearchTimeout = null;
    R.setProp(els.queryInput, "oninput", () => {
      window.clearTimeout(querySearchTimeout);
      querySearchTimeout = window.setTimeout(updateQueryPreview, 250);
    });

    return { updateQueryPreview };
  }

  static bindManageRuleSection(manager, library, els, loadManageBooks) {
    const R = VirtualLibraryTokenRenderer;
    R.setProp(els.queryInput, "value", library.query || "");
    R.setProp(els.queryText, "textContent", library.query || "(empty)");
    const renderManageTokens = () =>
      R.renderClauseTokens({
        container: els.queryTokensContainer,
        queryInput: els.queryInput,
        compiledPreview: els.compiledPreview,
        includeRemoveButton: false,
        onUpdated: renderManageTokens,
      });
    renderManageTokens();
    R.setProp(els.queryInput, "oninput", renderManageTokens);
    R.setProp(els.queryClearBtn, "onclick", () => {
      R.setProp(els.queryInput, "value", "");
      renderManageTokens();
    });
    R.setProp(els.saveQueryBtn, "onclick", async () => {
      els.saveQueryBtn.disabled = true;
      try {
        const updated = await api.updateVirtualLibrary(library.id, {
          query: R.getTrimmed(els.queryInput),
        });
        library.query = updated.query;
        R.setProp(els.queryText, "textContent", updated.query || "(empty)");
        R.setStatus(els.queryStatus, "Search rule updated successfully.", "var(--accent-color)");
        await manager.onLibrariesChanged?.(updated);
        loadManageBooks();
      } catch (err) {
        R.setStatus(els.queryStatus, `Error: ${err.message}`, "#dc2626");
      } finally {
        els.saveQueryBtn.disabled = false;
      }
    });
  }
}

window.VirtualLibraryQueryBuilder = VirtualLibraryQueryBuilder;
