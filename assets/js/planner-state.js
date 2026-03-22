(function () {
        const SUPABASE_URL = 'https://ecvgbyhridhohshyyxkj.supabase.co';
        const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4Nfr6vF3t0gdnQe4PrlPwg_Ph48gf3N';
        const LOCAL_KEY_PREFIX = 'liem-planner-v8';
        const PROJECT_NAME = 'Main Workspace';

        if (!window.supabase || !window.supabase.createClient) {
            console.error('Supabase client library is missing.');
            return;
        }

        const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
            },
        });

        let selectedScheduleDate = todayString();
        let scheduleDaysCache = {};
        let plannerState = {
            projectsTree: [],
            scheduleDays: {},
        };

        const __plannerStateBridge = {
            get selectedScheduleDate() { return selectedScheduleDate; },
            set selectedScheduleDate(value) { selectedScheduleDate = value; },
            get scheduleDaysCache() { return scheduleDaysCache; },
            set scheduleDaysCache(value) { scheduleDaysCache = value || {}; },
            get plannerState() { return plannerState; },
            set plannerState(value) { plannerState = value || { projectsTree: [], scheduleDays: {} }; },
        };
        Object.defineProperty(window, 'selectedScheduleDate', { configurable: true, get: () => __plannerStateBridge.selectedScheduleDate, set: (value) => { __plannerStateBridge.selectedScheduleDate = value; } });
        Object.defineProperty(window, 'scheduleDaysCache', { configurable: true, get: () => __plannerStateBridge.scheduleDaysCache, set: (value) => { __plannerStateBridge.scheduleDaysCache = value; } });
        Object.defineProperty(window, 'plannerState', { configurable: true, get: () => __plannerStateBridge.plannerState, set: (value) => { __plannerStateBridge.plannerState = value; } });
        let currentUser = null;
        let currentWorkspaceId = null;
        let currentProfile = null;
        let isHydrating = false;
        let persistTimer = null;
        let initialGuestSnapshot = null;
        let authOpQueue = Promise.resolve();
        let authRefreshPromise = null;
        let authStateTimer = null;
        let authPulseTimer = null;
        let lastSessionCheckAt = 0;
        let autoSaveEnabled = true;
        let autoSaveTimer = null;
        let cloudDirty = false;
        let lastCloudSavedAt = null;
        let headerStatusTimer = null;
        let accountButtonTransientLabel = null;
        let accountButtonTransientTone = 'muted';
        let accountButtonTransientCheck = false;
        let accountButtonSavedCheck = false;
        let cloudSavePromise = null;

        function $(id) {
            return document.getElementById(id);
        }

        function todayString() {
            const now = new Date();
            const offset = now.getTimezoneOffset();
            const local = new Date(now.getTime() - offset * 60000);
            return local.toISOString().slice(0, 10);
        }

        function isoNow() {
            return new Date().toISOString();
        }

        function uid(prefix = 'id') {
            return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        }
        window.uid = uid;

        function sleep(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }

        function queueAuthOp(task) {
            const queued = authOpQueue.catch(() => {}).then(task);
            authOpQueue = queued.catch(() => {});
            return queued;
        }

        function isLockContentionError(error) {
            const message = String(error?.message || error || '').toLowerCase();
            return message.includes('another request stole it')
                || message.includes('lock:sb-')
                || message.includes('navigator lockmanager')
                || message.includes('lock acquisition')
                || message.includes('acquiring an exclusive');
        }

        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function setFeedback(message, type = 'info') {
            const box = $('auth-feedback');
            if (!box) return;
            if (!message) {
                box.className = 'hidden mb-4 rounded-xl border px-3 py-2 text-sm';
                box.textContent = '';
                return;
            }
            const palette = {
                info: 'border-brand/40 bg-brand/10 text-white',
                success: 'border-green-500/40 bg-green-500/10 text-green-200',
                error: 'border-red-500/40 bg-red-500/10 text-red-200',
                warn: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
            };
            box.className = `mb-4 rounded-xl border px-3 py-2 text-sm ${palette[type] || palette.info}`;
            box.textContent = message;
        }

        function setInlineStatus(message) {
            const el = $('auth-inline-status');
            if (el) el.textContent = message;
        }

        function getPrefsStorageKey(scope = currentUser?.id || 'guest') {
            return `${LOCAL_KEY_PREFIX}:prefs:${scope}`;
        }

        function readPrefs(scope = currentUser?.id || 'guest') {
            try {
                const raw = localStorage.getItem(getPrefsStorageKey(scope));
                return raw ? JSON.parse(raw) : {};
            } catch (error) {
                console.warn('Could not parse planner prefs', error);
                return {};
            }
        }

        function writePrefs(nextPrefs, scope = currentUser?.id || 'guest') {
            const merged = { ...readPrefs(scope), ...(nextPrefs || {}) };
            localStorage.setItem(getPrefsStorageKey(scope), JSON.stringify(merged));
            return merged;
        }

        function formatShortTime(dateValue) {
            if (!dateValue) return '';
            return new Date(dateValue).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        function getCompactHeaderUserLabel() {
            if (!currentUser) return 'guest';
            const displayValue = (currentProfile?.display_name || currentUser.user_metadata?.display_name || '').trim();
            if (displayValue) return displayValue;
            const emailValue = (currentUser.email || '').trim();
            if (emailValue) return emailValue.split('@')[0] || emailValue;
            return 'user';
        }

        function renderAccountButton() {
            const accountBtn = $('account-btn');
            if (!accountBtn) return;

            const baseLabel = currentUser ? getCompactHeaderUserLabel() : 'Account';
            const buttonLabel = currentUser
                ? (accountButtonTransientLabel || baseLabel)
                : 'Account';
            const hasPersistentCheck = !!currentUser && !!accountButtonSavedCheck && !cloudDirty;
            const showCheck = !!currentUser && (!!accountButtonTransientCheck || hasPersistentCheck);

            accountBtn.textContent = buttonLabel;
            accountBtn.dataset.tone = currentUser ? (accountButtonTransientTone || 'muted') : 'muted';
            accountBtn.dataset.check = showCheck ? 'true' : 'false';
            accountBtn.title = buttonLabel;
        }

        function setHeaderSaveStatus(message, tone = 'muted', showCheck = false) {
            accountButtonTransientLabel = currentUser ? (message || getCompactHeaderUserLabel()) : null;
            accountButtonTransientTone = tone;
            accountButtonTransientCheck = !!showCheck;
            renderAccountButton();
        }

        function syncCloudStatusUi() {
            const detail = $('account-sync-detail');
            const lastSaved = $('account-last-saved');

            accountButtonTransientLabel = null;
            accountButtonTransientTone = 'muted';
            accountButtonTransientCheck = false;

            if (!currentUser) {
                accountButtonSavedCheck = false;
                if (detail) detail.textContent = 'Sign in to enable cloud save.';
                if (lastSaved) lastSaved.textContent = 'No cloud saves yet';
                renderAccountButton();
                return;
            }

            const timeText = lastCloudSavedAt ? formatShortTime(lastCloudSavedAt) : '';
            if (detail) {
                detail.textContent = autoSaveEnabled
                    ? 'Auto Save to Cloud is on. Changes sync every 1 minute.'
                    : 'Auto Save to Cloud is off. Use Save now when needed.';
            }
            if (lastSaved) {
                lastSaved.textContent = timeText ? `Last saved ${timeText}` : 'No cloud saves yet';
            }
            renderAccountButton();
        }

        function flashHeaderSaveStatus(message, tone = 'muted', timeoutMs = 0, showCheck = false) {
            clearTimeout(headerStatusTimer);
            setHeaderSaveStatus(message, tone, showCheck);
            if (timeoutMs > 0) {
                headerStatusTimer = setTimeout(() => {
                    syncCloudStatusUi();
                }, timeoutMs);
            }
        }

        function updateAutoSaveUi() {
            const toggle = $('autosave-toggle');
            if (toggle) {
                toggle.classList.toggle('is-on', !!autoSaveEnabled);
                toggle.setAttribute('aria-checked', autoSaveEnabled ? 'true' : 'false');
                toggle.disabled = !currentUser;
            }
            syncCloudStatusUi();
        }

        function stopAutoSaveLoop() {
            if (autoSaveTimer) {
                clearInterval(autoSaveTimer);
                autoSaveTimer = null;
            }
        }

        function startAutoSaveLoop() {
            stopAutoSaveLoop();
            if (!currentUser || !autoSaveEnabled) return;
            autoSaveTimer = setInterval(() => {
                if (!currentUser || !autoSaveEnabled || !cloudDirty || isHydrating) return;
                saveSnapshotToCloud({ silentFeedback: true, source: 'auto' });
            }, 60 * 1000);
        }

        function loadAutoSavePreference(scope = currentUser?.id || 'guest') {
            const prefs = readPrefs(scope);
            autoSaveEnabled = prefs.autoSave !== false;
            updateAutoSaveUi();
            startAutoSaveLoop();
        }

        function setActiveAuthTab(tabName) {
            ['login', 'signup', 'account'].forEach((tab) => {
                const btn = $(`auth-tab-${tab}`);
                const panel = $(`auth-panel-${tab}`);
                const active = tab === tabName;
                if (btn) {
                    btn.classList.toggle('bg-brand', active);
                    btn.classList.toggle('text-black', active);
                    btn.classList.toggle('text-textMuted', !active);
                }
                if (panel) {
                    panel.classList.toggle('hidden', !active);
                    panel.classList.toggle('block', active);
                }
            });
            setFeedback('');
        }

        function injectScheduleDateDisplay() {
            const staleDisplay = $('schedule-date-display');
            if (staleDisplay) staleDisplay.remove();
        }

        function offsetIsoDate(isoDate, dayDelta) {
            const [year, month, day] = String(isoDate || '').split('-').map(Number);
            if (!year || !month || !day) return todayString();
            const shifted = new Date(year, month - 1, day + dayDelta, 12, 0, 0, 0);
            const yyyy = shifted.getFullYear();
            const mm = String(shifted.getMonth() + 1).padStart(2, '0');
            const dd = String(shifted.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }

        function updateScheduleDateUi() {
            injectScheduleDateDisplay();
            const calendarInput = document.querySelector('#calendar-modal input[type="date"]');
            if (calendarInput) calendarInput.value = selectedScheduleDate;
            const formatted = new Date(`${selectedScheduleDate}T12:00:00`).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric', weekday: 'short'
            });
            const calendarBtn = $('schedule-calendar-btn');
            if (calendarBtn) {
                calendarBtn.innerHTML = `<i class="ph ph-calendar-blank text-base"></i><span>${escapeHtml(formatted)}</span>`;
            }
        }

        function clearSortableArtifacts(root = document) {
            root.querySelectorAll('.project-item > .accordion-content, .phase-item > .accordion-content').forEach((el) => {
                el.removeAttribute('data-sortable-init');
            });
            root.querySelectorAll('.sortable-ghost, .sortable-chosen, .sortable-drag, .sortable-fallback').forEach((el) => {
                el.classList.remove('sortable-ghost', 'sortable-chosen', 'sortable-drag', 'sortable-fallback');
            });
        }

        function sanitizeSortableHtml(html) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = html || '';
            clearSortableArtifacts(wrapper);
            return wrapper.innerHTML;
        }

        function ensureAllIds() {
            document.querySelectorAll('[data-level]').forEach((el) => {
                if (!el.id) el.id = uid(el.dataset.level || 'node');
            });
            if (typeof window.ensureProjectDragHandles === 'function') window.ensureProjectDragHandles();
        }

        function initExtraSortables() {
            const allContainers = [
                $('active-projects-list'),
                $('pending-projects-list'),
                $('done-projects-list'),
                $('schedule-list'),
                ...document.querySelectorAll('.project-item > .accordion-content'),
                ...document.querySelectorAll('.phase-item > .accordion-content'),
            ].filter(Boolean);

            allContainers.forEach((el) => {
                if (el.dataset.sortableInit === '1') return;
                let group = 'generic';
                if (el.id === 'active-projects-list') group = 'active-projects';
                else if (el.id === 'pending-projects-list') group = 'pending-projects';
                else if (el.id === 'done-projects-list') group = 'done-projects';
                else if (el.id === 'schedule-list') group = 'schedule-actions';
                else if (el.closest('.project-item') && el.parentElement?.classList.contains('project-item')) group = 'phases';
                else if (el.closest('.phase-item')) group = 'outputs';

                const draggable = group === 'schedule-actions'
                    ? '.schedule-item'
                    : (group === 'phases'
                        ? '.phase-item'
                        : (group === 'outputs'
                            ? '.output-item'
                            : '.project-item'));

                new Sortable(el, {
                    group,
                    draggable,
                    animation: 110,
                    filter: '.editable-text, button, input, textarea, .chevron-icon',
                    preventOnFilter: false,
                    delay: 200,
                    delayOnTouchOnly: true,
                    fallbackTolerance: 3,
                    touchStartThreshold: 5,
                    ghostClass: 'opacity-50',
                    onStart: () => {
                        if (typeof window.__plannerHandleDragStart === 'function') {
                            window.__plannerHandleDragStart();
                        }
                    },
                    onEnd: () => {
                        if (typeof window.__plannerHandleDragEnd === 'function') {
                            window.__plannerHandleDragEnd();
                        } else {
                            schedulePersist('drag-end');
                        }
                    },
                });
                el.dataset.sortableInit = '1';
            });
        }


function cloneDeep(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function getLiveProjectUi() {
    return window.plannerProjectUi || {};
}

function getProjectTemplate(level) {
    const templates = getLiveProjectUi().templates || {};
    return templates[level] || '';
}

function createElementFromHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '').trim();
    return template.content.firstElementChild || null;
}

function getDirectLevelChildren(container) {
    return Array.from(container?.children || []).filter((child) => child?.matches?.('[data-level]'));
}

function getProjectTitleElement(element) {
    if (!element) return null;
    if (element.dataset.level === 'output') {
        return element.querySelector(':scope .editable-text');
    }
    return element.querySelector(':scope > .accordion-header .editable-text');
}

function serializeProjectNodeFromDom(element) {
    if (!element?.dataset?.level) return null;
    const level = element.dataset.level;
    const content = level === 'output' ? null : element.querySelector(':scope > .accordion-content');
    const title = getProjectTitleElement(element)?.innerText?.trim() || `Untitled ${level}`;
    return {
        id: element.id || uid(level),
        level,
        title,
        status: element.dataset.status || '',
        doneDate: element.dataset.date || '',
        startDate: element.dataset.startDate || '',
        endDate: element.dataset.endDate || '',
        expanded: level === 'output' ? true : !(content?.classList.contains('hidden')),
        children: content ? getDirectLevelChildren(content).map(serializeProjectNodeFromDom).filter(Boolean) : [],
    };
}

function serializeProjectsTreeFromDom() {
    const roots = [
        ...Array.from($('active-projects-list')?.children || []),
        ...Array.from($('pending-projects-list')?.children || []),
        ...Array.from($('done-projects-list')?.children || []),
    ].filter((element) => element?.matches?.('.project-item'));
    return roots.map(serializeProjectNodeFromDom).filter(Boolean);
}

function findNodeInProjectsTree(sourceId, nodes = plannerState.projectsTree) {
    if (!sourceId || !Array.isArray(nodes)) return null;
    for (const node of nodes) {
        if (node.id === sourceId) return node;
        const match = findNodeInProjectsTree(sourceId, node.children || []);
        if (match) return match;
    }
    return null;
}

function resolveSourceTextById(sourceId, fallbackText = 'Unknown Item') {
    if (!sourceId) return fallbackText || 'Unknown Item';
    const liveDomNode = document.getElementById(sourceId);
    const liveText = getProjectTitleElement(liveDomNode)?.innerText?.trim();
    if (liveText) return liveText;
    const stateNode = findNodeInProjectsTree(sourceId, plannerState.projectsTree);
    if (stateNode?.title) return stateNode.title;
    return fallbackText || 'Unknown Item';
}

function classifyProjectRoot(node) {
    if (!node) return 'active';
    if (node.status === 'done') return 'done';
    if (node.startDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startDateObj = new Date(`${node.startDate}T00:00:00`);
        if (!Number.isNaN(startDateObj.getTime()) && startDateObj > today) return 'pending';
    }
    return 'active';
}

function renderProjectNodeElement(node) {
    const templateHtml = getProjectTemplate(node?.level);
    const element = createElementFromHtml(templateHtml);
    if (!element) return null;

    element.id = node.id || uid(node.level || 'node');
    element.dataset.level = node.level || 'output';
    if (node.status === 'done') element.dataset.status = 'done';
    if (node.doneDate) element.dataset.date = node.doneDate;
    if (node.startDate) element.dataset.startDate = node.startDate;
    if (node.endDate) element.dataset.endDate = node.endDate;
    if (node.level !== 'output') {
        element.dataset.expanded = node.expanded === false ? 'false' : 'true';
    }

    const titleEl = getProjectTitleElement(element);
    if (titleEl) titleEl.textContent = node.title || `Untitled ${node.level || 'item'}`;

    if (node.level !== 'output') {
        const content = element.querySelector(':scope > .accordion-content');
        (node.children || []).forEach((child) => {
            const childEl = renderProjectNodeElement(child);
            if (childEl) content?.appendChild(childEl);
        });
    }

    return element;
}

function applyProjectDomStateAfterRender() {
    const projectUi = getLiveProjectUi();
    if (typeof projectUi.updateAll === 'function') {
        projectUi.updateAll();
    }
    document.querySelectorAll('.project-item, .phase-item').forEach((element) => {
        const header = element.querySelector(':scope > .accordion-header');
        const shouldExpand = element.dataset.expanded !== 'false';
        if (!header) return;
        if (shouldExpand) {
            projectUi.openAccordion?.(header);
        } else {
            projectUi.closeAccordion?.(header);
        }
    });
}

function renderProjectsTreeIntoDom(projectsTree) {
    const activeList = $('active-projects-list');
    const pendingList = $('pending-projects-list');
    const doneList = $('done-projects-list');
    if (!activeList || !pendingList || !doneList) return;

    activeList.innerHTML = '';
    pendingList.innerHTML = '';
    doneList.innerHTML = '';

    (Array.isArray(projectsTree) ? projectsTree : []).forEach((node) => {
        const nodeEl = renderProjectNodeElement(node);
        if (!nodeEl) return;
        const bucket = classifyProjectRoot(node);
        if (bucket === 'done') {
            doneList.appendChild(nodeEl);
        } else if (bucket === 'pending') {
            pendingList.appendChild(nodeEl);
        } else {
            activeList.appendChild(nodeEl);
        }
    });

    ensureAllIds();
    initExtraSortables();
    plannerState.projectsTree = cloneDeep(Array.isArray(projectsTree) ? projectsTree : []);
    applyProjectDomStateAfterRender();
}

function flattenLinkedChecklistRows(sourceNode) {
    const rows = [];
    const visit = (nodes) => {
        (nodes || []).forEach((node) => {
            rows.push({
                id: node.id,
                title: node.title || `Untitled ${node.level || 'item'}`,
                level: node.level || 'output',
                status: node.status || '',
            });
            if (node.children?.length) visit(node.children);
        });
    };
    visit(sourceNode?.children || []);
    return rows;
}

function normalizeManualOutputs(rawManualOutputs) {
    if (!Array.isArray(rawManualOutputs)) return [];
    return rawManualOutputs
        .map((row) => ({
            id: row?.id || uid('manual'),
            text: String(row?.text || '').trim(),
            done: !!row?.done,
        }))
        .filter((row) => row.text);
}

function normalizeScheduleEntry(entry = {}) {
    return {
        id: entry.id || uid('schedule'),
        sourceId: entry.sourceId || '',
        sourceText: entry.sourceText || 'Unknown Item',
        mode: entry.mode || (entry.sourceId ? 'linked' : 'custom'),
        actionTitle: entry.actionTitle || '+action',
        done: !!entry.done,
        expanded: entry.expanded !== false,
        childState: entry.childState && typeof entry.childState === 'object' ? entry.childState : {},
        manualOutputs: normalizeManualOutputs(entry.manualOutputs || (Array.isArray(entry.outputs) ? entry.outputs : [])),
    };
}

function refreshScheduledEntrySourceLabels(dateKey = selectedScheduleDate) {
    const entries = Array.isArray(scheduleDaysCache[dateKey]) ? scheduleDaysCache[dateKey] : [];
    scheduleDaysCache[dateKey] = entries.map((entry) => {
        const normalized = normalizeScheduleEntry(entry);
        const refreshedSourceText = normalized.sourceId
            ? resolveSourceTextById(normalized.sourceId || '', normalized.sourceText || 'Unknown Item')
            : (normalized.sourceText || 'Unknown Item');
        return {
            ...normalized,
            sourceText: refreshedSourceText,
        };
    });
}

function refreshAllScheduledSourceLabels() {
    Object.keys(scheduleDaysCache || {}).forEach((dateKey) => {
        refreshScheduledEntrySourceLabels(dateKey);
    });
    plannerState.scheduleDays = cloneDeep(scheduleDaysCache || {});
}

function parseScheduleEntriesFromDom() {
    const list = $('schedule-list');
    if (!list) return [];
    return Array.from(list.querySelectorAll(':scope > .schedule-item'))
        .filter((item) => !item.classList.contains('sortable-ghost') && !item.classList.contains('sortable-chosen') && !item.classList.contains('sortable-drag') && !item.classList.contains('sortable-fallback'))
        .map((item) => {
        if (!item.dataset.entryId) item.dataset.entryId = uid('schedule');

        const childState = {};
        item.querySelectorAll('.schedule-content [data-linked-kind="source-child"]').forEach((row) => {
            const childId = row.dataset.childId || '';
            if (!childId) return;
            childState[childId] = {
                done: !!row.querySelector('input[type="checkbox"]')?.checked,
            };
        });

        let manualRows = Array.from(item.querySelectorAll('.schedule-content [data-linked-kind="manual-output"]'));
        if (!manualRows.length) {
            manualRows = Array.from(item.querySelectorAll('.schedule-content .output-text'))
                .map((el) => el.closest('[data-linked-kind], .group\/output, .flex'))
                .filter(Boolean)
                .filter((row) => row.dataset.linkedKind !== 'source-child');
        }

        const manualOutputs = manualRows.map((row) => ({
            id: row.dataset.manualId || uid('manual'),
            text: row.querySelector('.output-text, [contenteditable="true"]')?.innerText?.trim() || '',
            done: !!row.querySelector('input[type="checkbox"]')?.checked,
        })).filter((row) => row.text);

        const sourceId = item.dataset.sourceId || '';
        const fallbackSourceText = (item.querySelector('.navigate-to-source span')?.innerText || 'Support: Unknown Item').replace(/^Support:\s*/, '');

        return normalizeScheduleEntry({
            id: item.dataset.entryId,
            sourceId,
            sourceText: resolveSourceTextById(sourceId, fallbackSourceText),
            mode: item.dataset.entryMode || (sourceId ? 'linked' : 'custom'),
            actionTitle: item.querySelector('.action-title-text')?.innerText.trim() || '+action',
            done: !!item.querySelector('.schedule-done-checkbox')?.checked,
            expanded: !item.querySelector('.schedule-content')?.classList.contains('hidden'),
            childState,
            manualOutputs,
        });
    });
}

function buildLinkedRowHtml(row, checked) {
    return `
        <div class="flex items-start gap-3 py-2 px-2 -mx-2 rounded transition hover:bg-white/5 schedule-linked-row" data-linked-kind="source-child" data-child-id="${escapeHtml(row.id || '')}" data-child-level="${escapeHtml(row.level || 'item')}">
            <input type="checkbox" class="mt-1 w-4 h-4 accent-brand rounded bg-[#121212] border-[#3e3e3e] cursor-pointer shrink-0" ${checked ? 'checked' : ''}>
            <div class="flex flex-col flex-1 min-w-0">
                <span class="text-sm ${checked ? 'text-brand' : 'text-gray-300'} break-words">${escapeHtml(row.title || 'Untitled')}</span>
                <span class="text-[11px] uppercase tracking-wide text-textMuted">${escapeHtml(row.level || 'item')}</span>
            </div>
        </div>
    `;
}

function buildManualOutputHtml(output) {
    return `
        <div class="flex items-start gap-3 py-2 group/output hover:bg-white/5 px-2 -mx-2 rounded transition" data-linked-kind="manual-output" data-manual-id="${escapeHtml(output.id || uid('manual'))}">
            <input type="checkbox" class="mt-1 w-4 h-4 accent-brand rounded bg-[#121212] border-[#3e3e3e] cursor-pointer shrink-0" ${output.done ? 'checked' : ''}>
            <span contenteditable="true" class="text-sm ${output.done ? 'text-brand' : 'text-gray-300'} editable-text output-text flex-1">${escapeHtml(output.text || '')}</span>
        </div>
    `;
}

function scheduleIconSvg(kind, expanded = false) {
    if (kind === 'edit') {
        return `<svg viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"><path d="M164.7 91.3l-76 76L56 200l32.7-32.7 76-76"/><path d="M144 40l72 72"/><path d="M184 20l52 52"/></svg>`;
    }
    if (kind === 'delete') {
        return `<svg viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"><path d="M40 64h176"/><path d="M96 64V40h64v24"/><path d="M72 64l8 136h96l8-136"/><path d="M104 104v64"/><path d="M152 104v64"/></svg>`;
    }
    return `<svg viewBox="0 0 256 256" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" style="transform:${expanded ? 'rotate(180deg)' : 'rotate(0deg)'}"><path d="M64 96l64 64 64-64"/></svg>`;
}

function buildScheduleContentHtml(entry, sourceNode) {
    const normalized = normalizeScheduleEntry(entry);
    const linkedRows = normalized.mode === 'linked' && sourceNode ? flattenLinkedChecklistRows(sourceNode) : [];
    const linkedHtml = linkedRows.length > 0
        ? `
            <div class="space-y-0.5">
                <p class="text-[11px] uppercase tracking-wide text-textMuted mb-1">Linked items</p>
                ${linkedRows.map((row) => {
                    const childState = normalized.childState?.[row.id];
                    const checked = typeof childState?.done === 'boolean' ? childState.done : row.status === 'done';
                    return buildLinkedRowHtml(row, checked);
                }).join('')}
            </div>
        `
        : '';

    const manualOutputs = normalizeManualOutputs(normalized.manualOutputs);
    const manualHtml = manualOutputs.length > 0
        ? `
            <div class="space-y-0.5 ${linkedRows.length ? 'pt-2' : ''}">
                ${linkedRows.length ? '<p class="text-[11px] uppercase tracking-wide text-textMuted mb-1">Manual checklist</p>' : ''}
                ${manualOutputs.map(buildManualOutputHtml).join('')}
            </div>
        `
        : '';

    if (linkedHtml || manualHtml) return `${linkedHtml}${manualHtml}`;
    if (normalized.mode === 'linked' && normalized.sourceId && !sourceNode) {
        return '<p class="text-xs text-yellow-300 italic">Linked source no longer exists.</p>';
    }
    if (normalized.mode === 'linked' && normalized.sourceId) {
        return '<p class="text-xs text-textMuted italic">No linked items under this source yet.</p>';
    }
    return '<p class="text-xs text-textMuted italic">No outputs added.</p>';
}

function buildScheduleEntryHtml(entry) {
    const normalized = normalizeScheduleEntry(entry);
    const sourceNode = normalized.sourceId ? findNodeInProjectsTree(normalized.sourceId, plannerState.projectsTree) : null;
    const sourceText = sourceNode?.title || normalized.sourceText || 'Unknown Item';
    const mode = normalized.mode || (normalized.sourceId ? 'linked' : 'custom');

    return `
        <div class="schedule-item border-b border-[#3e3e3e]" data-entry-id="${escapeHtml(normalized.id || uid('schedule'))}" data-source-id="${escapeHtml(normalized.sourceId || '')}" data-entry-mode="${escapeHtml(mode)}">
            <div class="schedule-header w-full text-left">
                <div class="schedule-main-trigger">
                    <input type="checkbox" class="schedule-done-checkbox w-5 h-5 accent-brand rounded bg-[#121212] border-[#3e3e3e] cursor-pointer shrink-0 mr-3" ${normalized.done ? 'checked' : ''}>
                    <div class="schedule-main-trigger-text flex flex-col">
                        <span contenteditable="true" class="font-bold text-base ${normalized.done ? 'text-brand' : 'text-white'} editable-text inline-block transition-colors action-title-text">${escapeHtml(normalized.actionTitle || '+action')}</span>
                        <button class="navigate-to-source flex items-center text-xs text-textMuted mt-1 hover:text-brand transition text-left" type="button" data-target-id="${escapeHtml(normalized.sourceId || '')}" ${normalized.sourceId ? '' : 'disabled'}>
                            <i class="ph ph-arrow-elbow-down-right mr-1.5 text-brand"></i>
                            <span>Support: ${escapeHtml(sourceText)}</span>
                        </button>
                    </div>
                </div>
                <div class="schedule-header-actions flex items-center shrink-0">
                    <button class="edit-schedule-btn" type="button" aria-label="Edit action"><i class="ph ph-pencil text-lg"></i></button>
                    <button class="delete-schedule-btn" type="button" aria-label="Delete action"><i class="ph ph-trash text-lg"></i></button>
                    <button class="schedule-toggle-btn" type="button" aria-label="${normalized.expanded ? 'Collapse action' : 'Expand action'}"><i class="ph ph-caret-down text-xl schedule-toggle-icon ${normalized.expanded ? 'rotate-180 text-white' : ''}"></i></button>
                </div>
            </div>
            <div class="schedule-content pl-4 sm:pl-11 pb-4 ${normalized.expanded ? 'block' : 'hidden'} space-y-1 min-h-[10px]">
                ${buildScheduleContentHtml(normalized, sourceNode)}
            </div>
        </div>
    `;
}

function renderScheduleForSelectedDate() {
    const list = $('schedule-list');
    const emptyState = $('schedule-empty-state');
    if (!list) return;
    plannerState.projectsTree = serializeProjectsTreeFromDom();
    refreshScheduledEntrySourceLabels(selectedScheduleDate);
    const entries = (scheduleDaysCache[selectedScheduleDate] || []).map(normalizeScheduleEntry);
    scheduleDaysCache[selectedScheduleDate] = entries;
    plannerState.scheduleDays = cloneDeep(scheduleDaysCache || {});
    list.innerHTML = entries.map(buildScheduleEntryHtml).join('');
    if (emptyState) emptyState.classList.toggle('hidden', entries.length > 0);
    initExtraSortables();
    updateMissedProjectsForSelectedDate();
    updateScheduleDateUi();
}

function saveCurrentScheduleIntoCache() {
    scheduleDaysCache[selectedScheduleDate] = parseScheduleEntriesFromDom().map(normalizeScheduleEntry);
    plannerState.scheduleDays = cloneDeep(scheduleDaysCache || {});
}

function createSnapshot() {
    ensureAllIds();
    saveCurrentScheduleIntoCache();
    plannerState.projectsTree = serializeProjectsTreeFromDom();
    plannerState.scheduleDays = cloneDeep(scheduleDaysCache || {});
    return {
        schemaVersion: 2,
        updatedAt: isoNow(),
        selectedScheduleDate,
        workspaceName: PROJECT_NAME,
        projectsTree: cloneDeep(plannerState.projectsTree || []),
        scheduleDays: cloneDeep(scheduleDaysCache || {}),
    };
}

function countProjectNodes(nodes = []) {
    return (nodes || []).reduce((sum, node) => sum + 1 + countProjectNodes(node.children || []), 0);
}

function snapshotHasMeaningfulContent(snapshot) {
    if (!snapshot) return false;
    const treeCount = countProjectNodes(snapshot.projectsTree || []);
    const legacyHtml = snapshot.projectLists || {};
    const legacyText = `${legacyHtml.activeHTML || ''}${legacyHtml.pendingHTML || ''}${legacyHtml.doneHTML || ''}`.replace(/\s+/g, '');
    const scheduleCount = Object.values(snapshot.scheduleDays || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    return treeCount > 0 || legacyText.length > 0 || scheduleCount > 0;
}

function writeLocalSnapshot(snapshot) {
    const key = currentUser?.id ? getUserStorageKey(currentUser.id) : getGuestStorageKey();
    localStorage.setItem(key, JSON.stringify(snapshot));
}

function getGuestStorageKey() {
    return `${LOCAL_KEY_PREFIX}:guest`;
}

function getUserStorageKey(userId) {
    return `${LOCAL_KEY_PREFIX}:user:${userId}`;
}

function readLocalSnapshotForUser(userId) {
    try {
        const raw = localStorage.getItem(getUserStorageKey(userId));
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('Could not parse user local snapshot', error);
        return null;
    }
}

function readGuestSnapshot() {
    try {
        const raw = localStorage.getItem(getGuestStorageKey());
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('Could not parse guest snapshot', error);
        return null;
    }
}

function applySnapshot(snapshot) {
    if (!snapshot) return;
    isHydrating = true;
    try {
        if (Array.isArray(snapshot.projectsTree)) {
            renderProjectsTreeIntoDom(snapshot.projectsTree);
        } else if (snapshot.projectLists) {
            if ($('active-projects-list')) $('active-projects-list').innerHTML = sanitizeSortableHtml(snapshot.projectLists.activeHTML || '');
            if ($('pending-projects-list')) $('pending-projects-list').innerHTML = sanitizeSortableHtml(snapshot.projectLists.pendingHTML || '');
            if ($('done-projects-list')) $('done-projects-list').innerHTML = sanitizeSortableHtml(snapshot.projectLists.doneHTML || '');
            ensureAllIds();
            initExtraSortables();
            applyProjectDomStateAfterRender();
            plannerState.projectsTree = serializeProjectsTreeFromDom();
        } else {
            plannerState.projectsTree = [];
            renderProjectsTreeIntoDom([]);
        }

        scheduleDaysCache = Object.fromEntries(Object.entries(snapshot.scheduleDays || {}).map(([dateKey, entries]) => [
            dateKey,
            Array.isArray(entries) ? entries.map(normalizeScheduleEntry) : [],
        ]));
        plannerState.scheduleDays = cloneDeep(scheduleDaysCache || {});
        selectedScheduleDate = snapshot.selectedScheduleDate || todayString();
        renderScheduleForSelectedDate();
    } finally {
        isHydrating = false;
    }
}

function refreshProjectCounters() {
            window.plannerUiShared.updateProgressCounters({ getById: $ });
            window.plannerUiShared.updateSectionHeaders({ getById: $ });
        }

        function updateMissedProjectsForSelectedDate() {
            const missedProjects = window.plannerUiShared.collectMissedProjects({
                referenceDate: new Date(`${selectedScheduleDate}T00:00:00`),
                scheduledSourceIds: (scheduleDaysCache[selectedScheduleDate] || [])
                    .map((item) => item.sourceId)
                    .filter(Boolean),
            });
            window.plannerUiShared.renderMissedProjects(missedProjects, { getById: $, escapeHtml });
        }

        async function ensureWorkspaceForUser(user) {
            const { data: existing, error: selectError } = await sb
                .from('planner_workspaces')
                .select('id, name')
                .eq('owner_user_id', user.id)
                .limit(1)
                .maybeSingle();
            if (selectError) throw selectError;
            if (existing?.id) return existing.id;

            const { data: created, error: insertError } = await sb
                .from('planner_workspaces')
                .insert({ owner_user_id: user.id, name: PROJECT_NAME })
                .select('id')
                .single();
            if (insertError) throw insertError;
            return created.id;
        }

        async function fetchProfile(userId) {
            const { data, error } = await sb
                .from('profiles')
                .select('id, display_name')
                .eq('id', userId)
                .maybeSingle();
            if (error) throw error;
            return data || null;
        }

        async function fetchCloudSnapshot(workspaceId) {
            const projectPromise = sb
                .from('planner_project_snapshots')
                .select('content, updated_at')
                .eq('workspace_id', workspaceId)
                .maybeSingle();

            const schedulePromise = sb
                .from('planner_schedule_days')
                .select('schedule_date, content, updated_at')
                .eq('workspace_id', workspaceId)
                .order('schedule_date', { ascending: true });

            const [{ data: projectRow, error: projectError }, { data: scheduleRows, error: scheduleError }] = await Promise.all([projectPromise, schedulePromise]);
            if (projectError) throw projectError;
            if (scheduleError) throw scheduleError;

            const projectContent = projectRow?.content || {};
            const snapshot = {
                schemaVersion: Number(projectContent.schemaVersion || 1),
                updatedAt: projectRow?.updated_at || null,
                selectedScheduleDate: todayString(),
                workspaceName: PROJECT_NAME,
                projectsTree: Array.isArray(projectContent.projectsTree) ? projectContent.projectsTree : null,
                projectLists: projectContent.projectLists || null,
                scheduleDays: {},
            };

            (scheduleRows || []).forEach((row) => {
                const dateKey = row.schedule_date;
                const rawEntries = Array.isArray(row.content?.entries) ? row.content.entries : (Array.isArray(row.content) ? row.content : []);
                snapshot.scheduleDays[dateKey] = rawEntries.map(normalizeScheduleEntry);
                if (!snapshot.updatedAt || (row.updated_at && row.updated_at > snapshot.updatedAt)) {
                    snapshot.updatedAt = row.updated_at;
                }
            });

            if (!snapshot.projectsTree && !snapshot.projectLists) return null;
            return snapshot;
        }

                function getErrorMessage(error) {
            return String(error?.message || error?.error_description || error?.details || error || '');
        }

        function isLikelyAuthError(error) {
            const message = getErrorMessage(error).toLowerCase();
            const status = Number(error?.status || error?.statusCode || 0);
            return status === 401
                || status === 403
                || message.includes('jwt')
                || message.includes('token')
                || message.includes('session')
                || message.includes('not authenticated')
                || message.includes('invalid claim')
                || message.includes('refresh token')
                || message.includes('auth session');
        }

        function getSessionExpiresAtMs(session) {
            if (!session?.expires_at) return 0;
            return Number(session.expires_at) * 1000;
        }

        function sessionExpiresSoon(session, thresholdMs = 90 * 1000) {
            const expiresAtMs = getSessionExpiresAtMs(session);
            if (!expiresAtMs) return false;
            return expiresAtMs - Date.now() <= thresholdMs;
        }

        async function getFreshCloudSession(actionLabel = 'use cloud sync', options = {}) {
            const { silent = false, forceRefresh = false } = options;
            return queueAuthOp(async () => {
                let data = null;
                let error = null;

                try {
                    const sessionResult = await sb.auth.getSession();
                    data = sessionResult.data;
                    error = sessionResult.error;
                } catch (sessionError) {
                    error = sessionError;
                }

                if (error && isLockContentionError(error)) {
                    if (!silent) console.warn(`Auth lock contention before ${actionLabel}; retrying getSession once`, error);
                    await sleep(80);
                    const retryResult = await sb.auth.getSession();
                    data = retryResult.data;
                    error = retryResult.error;
                }

                if (error) throw error;

                let session = data?.session || null;
                const canRefresh = !!session?.refresh_token;
                const shouldRefresh = canRefresh && (forceRefresh || sessionExpiresSoon(session));

                if (shouldRefresh) {
                    if (!authRefreshPromise) {
                        authRefreshPromise = sb.auth.refreshSession().finally(() => {
                            authRefreshPromise = null;
                        });
                    }

                    try {
                        const { data: refreshedData, error: refreshError } = await authRefreshPromise;
                        if (refreshError) {
                            if (!silent) console.warn(`Could not refresh session before ${actionLabel}`, refreshError);
                        } else if (refreshedData?.session) {
                            session = refreshedData.session;
                        }
                    } catch (refreshError) {
                        if (isLockContentionError(refreshError)) {
                            if (!silent) console.warn(`Auth lock contention during refresh before ${actionLabel}; using latest known session`, refreshError);
                        } else {
                            throw refreshError;
                        }
                    }
                }

                lastSessionCheckAt = Date.now();
                return session;
            });
        }

        async function ensureActiveCloudSession(actionLabel = 'use cloud sync', options = {}) {
            const { silent = false, forceRefresh = false } = options;
            const session = await getFreshCloudSession(actionLabel, { silent, forceRefresh });

            if (!session?.user) {
                handleSignedOut();
                if (!silent) {
                    setInlineStatus('Session expired · local only');
                    setFeedback(`Your session expired. Please log in again to ${actionLabel}.`, 'warn');
                    setActiveAuthTab('login');
                }
                return null;
            }

            const sessionUser = session.user;
            const userChanged = !currentUser || currentUser.id !== sessionUser.id;
            currentUser = sessionUser;

            if (userChanged || !currentWorkspaceId) {
                currentWorkspaceId = await ensureWorkspaceForUser(sessionUser);
            }
            if (userChanged || !currentProfile) {
                currentProfile = await fetchProfile(sessionUser.id).catch(() => currentProfile);
            }

            updateAccountUi();
            return session;
        }

        async function runCloudAction(actionLabel, actionFn, options = {}) {
            const { forceRefresh = false } = options;
            const session = await ensureActiveCloudSession(actionLabel, { forceRefresh });
            if (!session) return null;

            try {
                return await actionFn(session);
            } catch (error) {
                if (!isLikelyAuthError(error)) throw error;

                const refreshedSession = await ensureActiveCloudSession(actionLabel, { silent: true, forceRefresh: true });
                if (!refreshedSession) {
                    setInlineStatus('Session expired · local only');
                    setFeedback(`Your session expired. Please log in again to ${actionLabel}.`, 'warn');
                    setActiveAuthTab('login');
                    return null;
                }

                return await actionFn(refreshedSession);
            }
        }

        function pulseCloudSession(reason = 'use cloud sync') {
            if (!currentUser) return;
            const now = Date.now();
            if (now - lastSessionCheckAt < 4000) return;
            clearTimeout(authPulseTimer);
            authPulseTimer = setTimeout(async () => {
                try {
                    await ensureActiveCloudSession(reason, { silent: true, forceRefresh: false });
                } catch (error) {
                    console.warn(`Could not refresh session state for ${reason}`, error);
                }
            }, 120);
        }

        async function saveSnapshotToCloud(options = {}) {
            const { silentFeedback = false, source = 'manual' } = options;
            if (cloudSavePromise) return cloudSavePromise;

            cloudSavePromise = (async () => {
                try {
                    await runCloudAction('save to cloud', async () => {
                        const snapshot = createSnapshot();
                        const saveStateStartedAt = Date.now();
                        setInlineStatus('Saving to cloud…');
                        flashHeaderSaveStatus(`${getCompactHeaderUserLabel()} - saving...`, 'muted');

                        const { error: projectError } = await sb
                        .from('planner_project_snapshots')
                        .upsert({
                            workspace_id: currentWorkspaceId,
                            content: { schemaVersion: snapshot.schemaVersion, projectsTree: snapshot.projectsTree },
                            updated_at: isoNow(),
                        }, { onConflict: 'workspace_id' });
                    if (projectError) throw projectError;

                    const scheduleRows = Object.entries(snapshot.scheduleDays || {}).map(([scheduleDate, entries]) => ({
                        workspace_id: currentWorkspaceId,
                        schedule_date: scheduleDate,
                        content: {
                            schemaVersion: snapshot.schemaVersion,
                            entries: Array.isArray(entries) ? entries : [],
                            summary: {
                                total: Array.isArray(entries) ? entries.length : 0,
                                done: Array.isArray(entries) ? entries.filter((entry) => entry.done).length : 0,
                            },
                        },
                        updated_at: isoNow(),
                    }));

                    const { data: existingDates, error: existingDatesError } = await sb
                        .from('planner_schedule_days')
                        .select('schedule_date')
                        .eq('workspace_id', currentWorkspaceId);
                    if (existingDatesError) throw existingDatesError;

                    const localDateSet = new Set(Object.keys(snapshot.scheduleDays || {}));
                    const datesToDelete = (existingDates || []).map((row) => row.schedule_date).filter((date) => !localDateSet.has(date));
                    if (datesToDelete.length > 0) {
                        const { error: deleteError } = await sb
                            .from('planner_schedule_days')
                            .delete()
                            .eq('workspace_id', currentWorkspaceId)
                            .in('schedule_date', datesToDelete);
                        if (deleteError) throw deleteError;
                    }

                    if (scheduleRows.length > 0) {
                        const { error: scheduleError } = await sb
                            .from('planner_schedule_days')
                            .upsert(scheduleRows, { onConflict: 'workspace_id,schedule_date' });
                        if (scheduleError) throw scheduleError;
                    }

                        writeLocalSnapshot(snapshot);
                        cloudDirty = false;
                        accountButtonSavedCheck = true;
                        lastCloudSavedAt = isoNow();
                        const saveStateElapsed = Date.now() - saveStateStartedAt;
                        if (saveStateElapsed < 420) {
                            await new Promise((resolve) => setTimeout(resolve, 420 - saveStateElapsed));
                        }
                        setInlineStatus(`Signed in · cloud saved ${formatShortTime(lastCloudSavedAt)}`);
                        updateAutoSaveUi();
                        flashHeaderSaveStatus(getCompactHeaderUserLabel(), 'success', 1400, true);
                        if (!silentFeedback) setFeedback(source === 'auto' ? 'Auto-saved current planner to cloud.' : 'Saved current planner to cloud.', 'success');
                    });
                } catch (error) {
                    console.error(error);
                    setInlineStatus('Signed in · save failed');
                    flashHeaderSaveStatus(`${getCompactHeaderUserLabel()} - failed`, 'error', 2200);
                    if (!silentFeedback) setFeedback(getErrorMessage(error) || 'Could not save to Supabase.', 'error');
                } finally {
                    cloudSavePromise = null;
                }
            })();

            return cloudSavePromise;
        }

        async function loadSnapshotFromCloud() {
            const shouldLoad = window.confirm('Load from cloud will replace the current local planner on this device. Continue?');
            if (!shouldLoad) return;

            try {
                await runCloudAction('load from cloud', async () => {
                    setInlineStatus('Loading from cloud…');
                    const cloudSnapshot = await fetchCloudSnapshot(currentWorkspaceId);
                    if (!cloudSnapshot) {
                        setInlineStatus(`Signed in as ${currentUser.email || 'user'}`);
                        setFeedback('No cloud data found for this account yet.', 'warn');
                        return;
                    }
                    applySnapshot(cloudSnapshot);
                    writeLocalSnapshot(createSnapshot());
                    cloudDirty = false;
                    accountButtonSavedCheck = true;
                    lastCloudSavedAt = cloudSnapshot.updatedAt || isoNow();
                    setInlineStatus(`Signed in · cloud loaded ${formatShortTime(lastCloudSavedAt)}`);
                    updateAutoSaveUi();
                    flashHeaderSaveStatus(getCompactHeaderUserLabel(), 'success', 1400, true);
                    setFeedback('Loaded planner from cloud.', 'success');
                });
            } catch (error) {
                console.error(error);
                setInlineStatus('Signed in · load failed');
                flashHeaderSaveStatus(`${getCompactHeaderUserLabel()} - failed`, 'error', 2200);
                setFeedback(getErrorMessage(error) || 'Could not load from Supabase.', 'error');
            }
        }

        function schedulePersist(trigger) {

            if (isHydrating || isDragging) return;
            clearTimeout(persistTimer);
            persistTimer = setTimeout(() => {
                refreshAllScheduledSourceLabels();
                const snapshot = createSnapshot();
                writeLocalSnapshot(snapshot);
                if (currentUser) {
                    cloudDirty = true;
                    renderAccountButton();
                }
                refreshProjectCounters();
                updateMissedProjectsForSelectedDate();
            }, 250);
        }
        window.schedulePersist = schedulePersist;

        function chooseNewestSnapshot(...snapshots) {
            return snapshots
                .filter(Boolean)
                .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0] || null;
        }

        async function handleSignedIn(session) {
            currentUser = session?.user || null;
            if (!currentUser) return;

            try {
                currentWorkspaceId = await ensureWorkspaceForUser(currentUser);
                currentProfile = await fetchProfile(currentUser.id).catch(() => null);
                loadAutoSavePreference(currentUser.id);
                updateAccountUi();
                setActiveAuthTab('account');

                const localSnapshot = readLocalSnapshotForUser(currentUser.id);
                const guestSnapshot = readGuestSnapshot();
                const currentPageSnapshot = createSnapshot();
                const chosen = localSnapshot || currentPageSnapshot || guestSnapshot;
                if (chosen) applySnapshot(chosen);
                writeLocalSnapshot(createSnapshot());

                const cloudSnapshot = await fetchCloudSnapshot(currentWorkspaceId).catch((error) => {
                    console.error(error);
                    setFeedback(error.message || 'Could not check cloud data.', 'error');
                    return null;
                });

                cloudDirty = false;
                lastCloudSavedAt = cloudSnapshot?.updatedAt || null;
                if (cloudSnapshot) {
                    setInlineStatus(`Signed in as ${currentUser.email || 'user'} · cloud data available`);
                } else {
                    setInlineStatus(`Signed in as ${currentUser.email || 'user'} · cloud empty`);
                }
                updateAutoSaveUi();
                startAutoSaveLoop();
            } catch (error) {
                console.error(error);
                setFeedback(error.message || 'Could not initialize account data.', 'error');
                setInlineStatus('Signed in · setup error');
            }
        }

        function handleSignedOut() {
            if (currentUser) {
                try {
                    writeLocalSnapshot(createSnapshot());
                } catch (error) {
                    console.warn('Could not save user snapshot before logout', error);
                }
            }
            currentUser = null;
            currentWorkspaceId = null;
            currentProfile = null;
            lastCloudSavedAt = null;
            cloudDirty = false;
            accountButtonSavedCheck = false;
            loadAutoSavePreference('guest');
            stopAutoSaveLoop();
            updateAccountUi();
            setActiveAuthTab('login');
            const guestSnapshot = readGuestSnapshot() || initialGuestSnapshot;
            if (guestSnapshot) applySnapshot(guestSnapshot);
            setInlineStatus('Guest mode · local only');
            setFeedback('Signed out.', 'success');
        }

        function updateAccountUi() {
            const accountBtn = $('account-btn');
            const accountSignedAs = $('account-signed-as');
            const logoutBtn = $('logout-btn');
            const saveCloudBtn = $('save-cloud-btn');
            const loadCloudBtn = $('load-cloud-btn');
            const authTabs = $('auth-tabs');
            const loginTab = $('auth-tab-login');
            const signupTab = $('auth-tab-signup');
            const accountTab = $('auth-tab-account');
            const loginPanel = $('auth-panel-login');
            const signupPanel = $('auth-panel-signup');

            if (currentUser) {
                const displayValue = currentProfile?.display_name || currentUser.user_metadata?.display_name || '';
                const emailValue = currentUser.email || '';
                const signedAsValue = displayValue && emailValue && displayValue !== emailValue
                    ? `Signed as ${displayValue} / ${emailValue}`
                    : `Signed as ${displayValue || emailValue || 'user'}`;

                if (accountSignedAs) accountSignedAs.textContent = signedAsValue;
                if (logoutBtn) logoutBtn.disabled = false;
                if (saveCloudBtn) saveCloudBtn.disabled = false;
                if (loadCloudBtn) loadCloudBtn.disabled = false;

                if (authTabs) authTabs.classList.remove('grid-cols-3');
                if (authTabs) authTabs.classList.add('grid-cols-1');
                if (loginTab) loginTab.classList.add('hidden');
                if (signupTab) signupTab.classList.add('hidden');
                if (accountTab) {
                    accountTab.classList.remove('hidden');
                    accountTab.classList.add('col-span-1');
                }
                if (loginPanel) loginPanel.classList.add('hidden');
                if (signupPanel) signupPanel.classList.add('hidden');
            } else {
                if (accountSignedAs) accountSignedAs.textContent = 'Signed as Guest';
                if (logoutBtn) logoutBtn.disabled = true;
                if (saveCloudBtn) saveCloudBtn.disabled = true;
                if (loadCloudBtn) loadCloudBtn.disabled = true;

                if (authTabs) authTabs.classList.remove('grid-cols-1');
                if (authTabs) authTabs.classList.add('grid-cols-3');
                if (loginTab) loginTab.classList.remove('hidden');
                if (signupTab) signupTab.classList.remove('hidden');
                if (accountTab) accountTab.classList.remove('hidden');
            }

            updateAutoSaveUi();
        }

        function switchScheduleDate(nextDate) {
            if (!nextDate) return;
            saveCurrentScheduleIntoCache();
            selectedScheduleDate = nextDate;
            if (!scheduleDaysCache[selectedScheduleDate]) scheduleDaysCache[selectedScheduleDate] = [];
            renderScheduleForSelectedDate();
            schedulePersist('switch-date');
        }

        function syncSelectedScheduleDay() {
            if (isHydrating) return;
            saveCurrentScheduleIntoCache();
            writeLocalSnapshot(createSnapshot());
            if (currentUser) {
                cloudDirty = true;
                renderAccountButton();
            }
            updateMissedProjectsForSelectedDate();
        }

        document.addEventListener('click', (e) => {
            const prevBtn = e.target.closest('#schedule-prev-day-btn');
            if (prevBtn) {
                e.preventDefault();
                e.stopPropagation();
                switchScheduleDate(offsetIsoDate(selectedScheduleDate, -1));
                return;
            }
            const nextBtn = e.target.closest('#schedule-next-day-btn');
            if (nextBtn) {
                e.preventDefault();
                e.stopPropagation();
                switchScheduleDate(offsetIsoDate(selectedScheduleDate, 1));
                return;
            }
            const calendarBtn = e.target.closest('#schedule-calendar-btn');
            if (calendarBtn) {
                e.preventDefault();
                e.stopPropagation();
                const modal = document.getElementById('calendar-modal');
                const dialog = document.getElementById('calendar-modal-dialog');
                if (modal && dialog) {
                    modal.classList.remove('hidden');
                    requestAnimationFrame(() => {
                        dialog.classList.remove('scale-95', 'opacity-0');
                        dialog.classList.add('scale-100', 'opacity-100');
                    });
                }
            }
        });

        window.plannerBridge = {
            getSelectedScheduleDate: () => selectedScheduleDate,
            switchScheduleDate,
            syncSelectedScheduleDay,
            renderSelectedScheduleDay: renderScheduleForSelectedDate,
        };

        window.addEventListener('planner-sync-schedule', () => {
            syncSelectedScheduleDay();
        });

        window.addEventListener('planner-projects-changed', () => {
            if (isHydrating) return;
            plannerState.projectsTree = serializeProjectsTreeFromDom();
            refreshAllScheduledSourceLabels();
            if (!$('schedule-view')?.classList.contains('hidden')) {
                saveCurrentScheduleIntoCache();
                renderScheduleForSelectedDate();
            } else {
                updateMissedProjectsForSelectedDate();
            }
        });

        async function signUpWithPassword() {
            const email = $('signup-email')?.value.trim();
            const password = $('signup-password')?.value || '';
            const displayName = $('signup-display-name')?.value.trim();
            if (!email || !password) {
                setFeedback('Please enter both email and password.', 'warn');
                return;
            }
            const { data, error } = await sb.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        display_name: displayName || null,
                    },
                },
            });
            if (error) throw error;
            if (!data.session) {
                setFeedback('Account created. Check your inbox if email confirmation is enabled in Supabase.', 'success');
                setActiveAuthTab('login');
            } else {
                setFeedback('Account created and signed in.', 'success');
            }
        }

        async function signInWithPassword() {
            const email = $('login-email')?.value.trim();
            const password = $('login-password')?.value || '';
            if (!email || !password) {
                setFeedback('Please enter both email and password.', 'warn');
                return;
            }
            const { error } = await sb.auth.signInWithPassword({ email, password });
            if (error) throw error;
            setFeedback('Logged in successfully.', 'success');
        }

        async function signOut() {
            const { error } = await sb.auth.signOut();
            if (error) throw error;
        }

        function exportSnapshotAsJson() {
            const snapshot = createSnapshot();
            const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `liem-planner-${selectedScheduleDate}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            setFeedback('Exported planner JSON.', 'success');
        }

        function importSnapshotFromFile(file) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const parsed = JSON.parse(String(reader.result || '{}'));
                    if (!parsed || (!Array.isArray(parsed.projectsTree) && !parsed.projectLists) || !parsed.scheduleDays) {
                        throw new Error('Invalid planner JSON format.');
                    }
                    applySnapshot(parsed);
                    const snapshot = createSnapshot();
                    writeLocalSnapshot(snapshot);
                    if (currentUser) {
                        setFeedback('Imported planner JSON locally. Use Save to Cloud if you want to upload it.', 'success');
                    } else {
                        setFeedback('Imported planner JSON successfully.', 'success');
                    }
                } catch (error) {
                    setFeedback(error.message || 'Could not import JSON file.', 'error');
                }
            };
            reader.readAsText(file);
        }

        function bindUi() {
            injectScheduleDateDisplay();
            updateScheduleDateUi();
            updateAccountUi();
            setActiveAuthTab(currentUser ? 'account' : 'login');

            $('auth-tab-login')?.addEventListener('click', () => setActiveAuthTab('login'));
            $('auth-tab-signup')?.addEventListener('click', () => setActiveAuthTab('signup'));
            $('auth-tab-account')?.addEventListener('click', () => setActiveAuthTab('account'));

            $('account-btn')?.addEventListener('click', () => {
                setActiveAuthTab(currentUser ? 'account' : 'login');
            });

            $('login-form')?.addEventListener('submit', async (event) => {
                event.preventDefault();
                try {
                    await signInWithPassword();
                } catch (error) {
                    setFeedback(getErrorMessage(error) || 'Could not log in.', 'error');
                }
            });

            $('signup-form')?.addEventListener('submit', async (event) => {
                event.preventDefault();
                try {
                    await signUpWithPassword();
                } catch (error) {
                    setFeedback(getErrorMessage(error) || 'Could not sign up.', 'error');
                }
            });

            $('logout-btn')?.addEventListener('click', async () => {
                try {
                    await signOut();
                } catch (error) {
                    setFeedback(error.message || 'Could not log out.', 'error');
                }
            });

            $('save-cloud-btn')?.addEventListener('click', async () => {
                await saveSnapshotToCloud({ silentFeedback: false, source: 'manual' });
            });

            $('load-cloud-btn')?.addEventListener('click', async () => {
                await loadSnapshotFromCloud();
            });

            $('autosave-toggle')?.addEventListener('click', () => {
                if (!currentUser) return;
                autoSaveEnabled = !autoSaveEnabled;
                writePrefs({ autoSave: autoSaveEnabled }, currentUser.id);
                updateAutoSaveUi();
                startAutoSaveLoop();
                setFeedback(autoSaveEnabled ? 'Auto Save to Cloud is on.' : 'Auto Save to Cloud is off. Save manually when needed.', 'success');
            });

            $('export-json-btn')?.addEventListener('click', exportSnapshotAsJson);
            $('import-json-btn')?.addEventListener('click', () => $('import-json-file')?.click());
            $('import-json-file')?.addEventListener('change', (event) => {
                importSnapshotFromFile(event.target.files?.[0]);
                event.target.value = '';
            });

            $('save-calendar-btn')?.addEventListener('click', () => {
                const value = document.querySelector('#calendar-modal input[type="date"]')?.value;
                if (value) switchScheduleDate(value);
            });

            document.addEventListener('input', (event) => {
                if (event.target.closest('#project-list-container') || event.target.closest('#schedule-list')) {
                    schedulePersist('input');
                }
            });

            document.addEventListener('change', (event) => {
                if (event.target.closest('#project-list-container') || event.target.closest('#schedule-list')) {
                    schedulePersist('change');
                }
            });

            const projectObserverTargets = [
                $('active-projects-list'),
                $('pending-projects-list'),
                $('done-projects-list'),
            ].filter(Boolean);
            const projectObserver = new MutationObserver((mutations) => {
                if (isDragging) return;
                const hasProjectMutation = mutations.some((mutation) => {
                    const baseTarget = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
                    return !!baseTarget?.closest?.('#project-list-container');
                });
                if (hasProjectMutation) {
                    window.dispatchEvent(new CustomEvent('planner-projects-changed'));
                }
                schedulePersist('mutation');
            });
            projectObserverTargets.forEach((target) => projectObserver.observe(target, { childList: true, subtree: true, characterData: true, attributes: true }));

            const scheduleListTarget = $('schedule-list');
            if (scheduleListTarget) {
                const scheduleObserver = new MutationObserver(() => {
                    if (isDragging) return;
                    schedulePersist('mutation');
                });
                scheduleObserver.observe(scheduleListTarget, { childList: true, subtree: true, characterData: true });
            }

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState !== 'visible') return;
                pulseCloudSession('resume cloud sync');
            });

            window.addEventListener('focus', () => {
                pulseCloudSession('resume cloud sync');
            });
        }

        window.getLiveProjectUi = getLiveProjectUi;
        window.uid = uid;
        window.normalizeScheduleEntry = normalizeScheduleEntry;
        window.renderScheduleForSelectedDate = renderScheduleForSelectedDate;
        window.saveCurrentScheduleIntoCache = saveCurrentScheduleIntoCache;
        window.refreshScheduledEntrySourceLabels = refreshScheduledEntrySourceLabels;
        window.refreshAllScheduledSourceLabels = refreshAllScheduledSourceLabels;
        window.createPlannerSnapshot = createSnapshot;

        async function boot() {
            ensureAllIds();
            initExtraSortables();
            plannerState.projectsTree = serializeProjectsTreeFromDom();
            refreshProjectCounters();
            if (!scheduleDaysCache[selectedScheduleDate]) scheduleDaysCache[selectedScheduleDate] = parseScheduleEntriesFromDom().map(normalizeScheduleEntry);
            plannerState.scheduleDays = cloneDeep(scheduleDaysCache || {});
            updateMissedProjectsForSelectedDate();
            updateScheduleDateUi();

            initialGuestSnapshot = createSnapshot();
            const guestSnapshot = readGuestSnapshot();
            if (guestSnapshot) applySnapshot(guestSnapshot);
            writeLocalSnapshot(createSnapshot());
            loadAutoSavePreference('guest');
            bindUi();

            const initialSession = await ensureActiveCloudSession('start cloud sync', { silent: true, forceRefresh: false });
            if (initialSession) {
                await handleSignedIn(initialSession);
            } else {
                handleSignedOut();
            }

            sb.auth.onAuthStateChange((event, session) => {
                clearTimeout(authStateTimer);
                authStateTimer = setTimeout(() => {
                    if (event === 'SIGNED_OUT') {
                        handleSignedOut();
                        return;
                    }
                    if (session?.user) {
                        handleSignedIn(session).catch((error) => {
                            console.error(error);
                            setFeedback(error.message || 'Could not initialize account data.', 'error');
                            setInlineStatus('Signed in · setup error');
                        });
                    }
                }, 0);
            });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot);
        } else {
            boot();
        }
    })();
