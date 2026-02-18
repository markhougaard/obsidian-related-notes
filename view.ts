import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import { SemanticSearchService } from './semantic_search';

export const VIEW_TYPE_RELATED_NOTES = 'related-notes-view';

import RelatedNotesPlugin from './main';

export class RelatedNotesView extends ItemView {
    private plugin: RelatedNotesPlugin;
    private searchQuery: string = '';
    private searchDebounceTimer: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: RelatedNotesPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_RELATED_NOTES;
    }

    getIcon() {
        return 'link';
    }

    getDisplayText() {
        return 'Related Notes';
    }

    async onOpen() {
        await this.update();
    }

    async update() {
        const container = this.contentEl;
        container.empty();

        const wrapper = container.createDiv({ cls: 'related-notes-container' });

        // --- Search input (always visible) ---
        const searchContainer = wrapper.createDiv({
            cls: 'related-notes-search-container',
            attr: {
                style: 'display: flex; align-items: center; gap: 4px; padding: 8px 10px;'
            }
        });

        const searchInput = searchContainer.createEl('input', {
            type: 'text',
            placeholder: 'Search notes...',
            cls: 'related-notes-search-input',
            attr: {
                style: [
                    'flex: 1',
                    'font-size: inherit',
                    'background: var(--input-bg)',
                    'border: 1px solid var(--input-border-color)',
                    'color: var(--text-normal)',
                    'padding: 4px 8px',
                    'border-radius: 4px',
                    'outline: none',
                ].join('; ')
            }
        }) as HTMLInputElement;
        searchInput.value = this.searchQuery;

        const clearBtn = searchContainer.createEl('button', {
            text: '×',
            cls: 'related-notes-search-clear',
            attr: {
                style: [
                    `display: ${this.searchQuery ? 'block' : 'none'}`,
                    'cursor: pointer',
                    'background: none',
                    'border: none',
                    'color: var(--text-muted)',
                    'font-size: 18px',
                    'line-height: 1',
                    'padding: 0 2px',
                    'flex-shrink: 0',
                ].join('; ')
            }
        });

        clearBtn.addEventListener('click', () => {
            this.searchQuery = '';
            this.update();
        });

        searchInput.addEventListener('input', (e) => {
            const value = (e.target as HTMLInputElement).value;
            this.searchQuery = value;
            clearBtn.style.display = value ? 'block' : 'none';

            if (this.searchDebounceTimer !== null) {
                window.clearTimeout(this.searchDebounceTimer);
            }
            this.searchDebounceTimer = window.setTimeout(() => {
                this.searchDebounceTimer = null;
                this.update();
            }, 500);
        });

        // Restore focus to the input when rebuilding during an active search
        if (this.searchQuery) {
            searchInput.focus();
            searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }

        // --- Content area ---
        if (this.searchQuery.trim()) {
            await this.renderSearchResults(wrapper, this.searchQuery.trim());
        } else {
            await this.renderRelatedNotes(wrapper);
        }
    }

    private async renderSearchResults(wrapper: HTMLElement, query: string) {
        wrapper.createEl('h4', {
            text: 'Search Results',
            cls: 'nav-file-title',
            attr: { style: 'margin: 4px 0 10px; padding-left: 10px;' }
        });

        const loadingEl = wrapper.createDiv({ cls: 'related-notes-loading' });
        loadingEl.createEl('span', { cls: 'loading-spinner' });
        loadingEl.createSpan({ text: ' Searching...' });

        let results: { file: TFile; score: number }[] = [];
        try {
            results = await this.plugin.searchService.searchByText(query, this.plugin.settings.maxRelatedNotes);
            loadingEl.remove();
        } catch (e) {
            loadingEl.remove();
            const errorContainer = wrapper.createDiv({ cls: 'related-notes-error-container' });
            errorContainer.createEl('p', { text: `Error: ${e.message}`, cls: 'related-notes-error' });
            console.error('Semantic search error:', e);
            return;
        }

        if (results.length === 0) {
            wrapper.createEl('p', { text: 'No results found.', cls: 'related-notes-empty' });
            return;
        }

        this.renderNoteList(wrapper, results);
    }

    private async renderRelatedNotes(wrapper: HTMLElement) {
        wrapper.createEl('h4', {
            text: 'Related Notes',
            cls: 'nav-file-title',
            attr: { style: 'margin: 4px 0 10px; padding-left: 10px;' }
        });

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            wrapper.createEl('p', { text: 'No active file.', cls: 'related-notes-empty' });
            return;
        }

        const loadingEl = wrapper.createDiv({ cls: 'related-notes-loading' });
        loadingEl.createEl('span', { cls: 'loading-spinner' });
        loadingEl.createSpan({ text: ' Finding related notes...' });

        let related: { file: TFile; score: number }[] = [];
        try {
            await this.plugin.searchService.indexNote(activeFile);
            related = this.plugin.searchService.findRelated(activeFile, this.plugin.settings.maxRelatedNotes);
            loadingEl.remove();
        } catch (e) {
            loadingEl.remove();
            const errorContainer = wrapper.createDiv({ cls: 'related-notes-error-container' });
            errorContainer.createEl('p', { text: `Error: ${e.message}`, cls: 'related-notes-error' });
            const retryBtn = errorContainer.createEl('button', { text: 'Retry' });
            retryBtn.onclick = () => this.update();
            console.error('Related Notes Error:', e);
            return;
        }

        if (related.length === 0) {
            wrapper.createEl('p', { text: 'No related notes found.', cls: 'related-notes-empty' });
            return;
        }

        this.renderNoteList(wrapper, related);
    }

    private renderNoteList(wrapper: HTMLElement, items: { file: TFile; score: number }[]) {
        const list = wrapper.createEl('div', { cls: 'related-notes-list' });
        const seenPaths = new Set<string>();

        for (const item of items) {
            if (seenPaths.has(item.file.path)) continue;
            seenPaths.add(item.file.path);

            const itemWrapper = list.createDiv({ cls: 'related-note-wrapper' });

            const itemDiv = itemWrapper.createDiv({ cls: 'related-note-item nav-file-title' });
            itemDiv.createEl('span', {
                text: item.file.basename,
                cls: 'nav-file-title-content'
            });

            itemDiv.createEl('span', {
                text: `${Math.round(item.score * 100)}%`,
                cls: 'related-note-score',
                attr: { style: 'margin-left: auto; color: var(--text-muted); font-size: 0.8em;' }
            });

            const explainBtn = itemDiv.createEl('button', {
                text: '···',
                cls: 'related-note-explain-btn',
                attr: {
                    title: 'Why is this related?',
                    style: [
                        'background: none',
                        'border: none',
                        'cursor: pointer',
                        'color: var(--text-muted)',
                        'font-size: 1em',
                        'padding: 0 4px',
                        'flex-shrink: 0',
                        'margin-left: 4px',
                        'line-height: 1',
                    ].join('; ')
                }
            });

            const explanationEl = itemWrapper.createDiv({
                cls: 'related-note-explanation',
                attr: {
                    style: [
                        'display: none',
                        'font-size: 0.8em',
                        'color: var(--text-muted)',
                        'padding: 4px 10px 8px',
                        'font-style: italic',
                        'border-left: 2px solid var(--text-faint)',
                        'margin: 0 0 4px 10px',
                    ].join('; ')
                }
            });

            explainBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();

                if (explanationEl.style.display !== 'none') {
                    explanationEl.style.display = 'none';
                    return;
                }

                const activeFile = this.app.workspace.getActiveFile();
                explanationEl.style.display = 'block';

                if (!activeFile) {
                    explanationEl.setText('No active note to compare against.');
                    return;
                }

                explanationEl.setText('Thinking…');
                try {
                    await this.plugin.searchService.explainRelationship(
                        activeFile,
                        item.file,
                        (text) => explanationEl.setText(text)
                    );
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    explanationEl.setText(`Could not generate explanation: ${msg}`);
                    console.error('Explain error:', err);
                }
            });

            itemDiv.addEventListener('click', (e) => {
                e.preventDefault();
                this.app.workspace.openLinkText(item.file.path, '', true);
            });

            itemDiv.addEventListener('mouseenter', () => itemDiv.addClass('is-active'));
            itemDiv.addEventListener('mouseleave', () => itemDiv.removeClass('is-active'));
        }
    }

    async onClose() {
        if (this.searchDebounceTimer !== null) {
            window.clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = null;
        }
    }
}
