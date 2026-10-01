/**
 * NotesView.js
 * Renders individual note cards and components for notebook view mode.
 */
const NotesView = {
  createNoteCard(annot, colorMeta, onJumpToPage, onEditComment, onDelete) {
    const card = document.createElement('div');
    card.className = 'notes-card';
    card.style.borderLeftColor = colorMeta?.color || '#ffeb3b';

    const header = document.createElement('div');
    header.className = 'notes-card-header';

    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'notes-card-tags';

    const pageChip = document.createElement('button');
    pageChip.type = 'button';
    pageChip.className = 'notes-page-chip';
    pageChip.innerHTML = `<span>📄</span> Page ${annot.page}`;
    pageChip.title = `Go to page ${annot.page}`;
    pageChip.onclick = () => onJumpToPage(annot.page);
    tagsWrap.appendChild(pageChip);

    const catBadge = document.createElement('span');
    catBadge.className = 'notes-category-badge';
    catBadge.style.backgroundColor = colorMeta ? `${colorMeta.color}33` : 'rgba(234, 179, 8, 0.2)';
    catBadge.style.borderColor = colorMeta?.color || 'var(--accent-color)';
    catBadge.style.color = 'var(--text-primary)';
    catBadge.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${colorMeta?.color || '#eab308'};"></span> ${colorMeta?.name || 'Annotation'}`;
    tagsWrap.appendChild(catBadge);

    header.appendChild(tagsWrap);

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'notes-card-actions';

    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'btn btn-secondary notes-read-here-btn';
    readBtn.innerHTML = '<span>📖</span> Read here';
    readBtn.onclick = () => onJumpToPage(annot.page);
    actionsWrap.appendChild(readBtn);

    const commentBtn = document.createElement('button');
    commentBtn.type = 'button';
    commentBtn.className = 'btn btn-icon';
    commentBtn.title = annot.comment ? 'Edit Note' : 'Add Note';
    commentBtn.innerHTML = annot.comment ? '📝' : '💬';
    commentBtn.onclick = () => onEditComment(annot);
    actionsWrap.appendChild(commentBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-icon';
    deleteBtn.title = 'Delete Highlight';
    deleteBtn.style.color = '#ef4444';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.onclick = () => onDelete(annot.id);
    actionsWrap.appendChild(deleteBtn);

    header.appendChild(actionsWrap);
    card.appendChild(header);

    const quote = document.createElement('blockquote');
    quote.className = 'notes-quote';
    quote.textContent = annot.text ? `“${annot.text}”` : '“Selected text fragment”';
    card.appendChild(quote);

    if (annot.comment && annot.comment.trim()) {
      const commentBox = document.createElement('div');
      commentBox.className = 'notes-comment-box';
      commentBox.innerHTML = `
        <div class="notes-comment-icon">💡</div>
        <div class="notes-comment-content">
          <span class="notes-comment-label">Your Personal Note</span>
          <p class="notes-comment-text">${annot.comment}</p>
        </div>
      `;
      card.appendChild(commentBox);
    }

    return card;
  }
};

window.NotesView = NotesView;
