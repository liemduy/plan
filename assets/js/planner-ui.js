document.addEventListener('DOMContentLoaded', () => {
            const projectListContainer = document.getElementById('project-list-container');
            const addProjectBtn = document.getElementById('add-project-btn');

            let isDragging = false;
            window.__plannerHandleDragStart = () => {
                isDragging = true;
                cancelPress();
                if (contextMenu) contextMenu.classList.add('hidden');
                if (datePickerMenu) datePickerMenu.classList.add('hidden');
                document.body.classList.add('dragging');
            };
            window.__plannerHandleDragEnd = () => {
                setTimeout(() => {
                    isDragging = false;
                    document.body.classList.remove('dragging');
                }, 50);
                updateAll();
                if (!document.getElementById('schedule-view')?.classList.contains('hidden')) {
                    window.plannerBridge?.syncSelectedScheduleDay?.();
                }
                if (typeof window.schedulePersist === 'function') window.schedulePersist('drag-end');
            };

            // --- SORTABLE JS INITIALIZATION ---
            function getSortableHandleSelector(el) {
                return null;
            }

            function ensureProjectDragHandles(root = document) {
                root.querySelectorAll('.drag-handle').forEach((el) => el.remove());
            }

            function initSortable(el, groupName) {
                if (!el || el.dataset.sortableInit === '1') return;
                const draggable = groupName === 'schedule-actions'
                    ? '.schedule-item'
                    : (groupName === 'phases'
                        ? '.phase-item'
                        : (groupName === 'outputs'
                            ? '.output-item'
                            : '.project-item'));
                new Sortable(el, {
                    group: groupName,
                    draggable,
                    animation: 110,
                    filter: '.editable-text, button, input, textarea, .chevron-icon',
                    preventOnFilter: false,
                    delay: 200,
                    delayOnTouchOnly: true,
                    fallbackTolerance: 3,
                    touchStartThreshold: 5,
                    ghostClass: 'opacity-50',
                    onStart: function() {
                        if (typeof window.__plannerHandleDragStart === 'function') {
                            window.__plannerHandleDragStart();
                        } else {
                            isDragging = true;
                        }
                    },
                    onEnd: function() {
                        if (typeof window.__plannerHandleDragEnd === 'function') {
                            window.__plannerHandleDragEnd();
                        } else {
                            setTimeout(() => isDragging = false, 50);
                            updateAll();
                        }
                    }
                });
                el.dataset.sortableInit = '1';
            }

            window.getSortableHandleSelector = getSortableHandleSelector;
            window.ensureProjectDragHandles = ensureProjectDragHandles;
            ensureProjectDragHandles();

            // Init existing containers
            initSortable(document.getElementById('active-projects-list'), 'active-projects');
            initSortable(document.getElementById('pending-projects-list'), 'pending-projects');
            initSortable(document.getElementById('done-projects-list'), 'done-projects');
            document.querySelectorAll('.project-item > .accordion-content').forEach(el => initSortable(el, 'phases'));
            document.querySelectorAll('.phase-item > .accordion-content').forEach(el => initSortable(el, 'outputs'));
            initSortable(document.getElementById('schedule-list'), 'schedule-actions');

            // --- ACCOUNT MODAL LOGIC ---
            const accountBtn = document.getElementById('account-btn');
            const authModal = document.getElementById('auth-modal');
            const authDialog = document.getElementById('auth-modal-dialog');
            const closeAuthBtn = document.getElementById('close-auth-btn');
            const authBackdrop = document.getElementById('auth-modal-backdrop');

            function openAuth() {
                if(!authModal) return;
                authModal.classList.remove('hidden');
                requestAnimationFrame(() => {
                    authDialog.classList.remove('scale-95', 'opacity-0');
                    authDialog.classList.add('scale-100', 'opacity-100');
                });
            }
            function closeAuth() {
                if(!authModal) return;
                authDialog.classList.remove('scale-100', 'opacity-100');
                authDialog.classList.add('scale-95', 'opacity-0');
                setTimeout(() => authModal.classList.add('hidden'), 200);
            }
            if(accountBtn) accountBtn.addEventListener('click', openAuth);
            if(closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuth);
            if(authBackdrop) authBackdrop.addEventListener('click', closeAuth);

            // --- IDs GENERATOR ---
            function generateId() { return 'item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9); }
            document.querySelectorAll('[data-level]').forEach(el => {
                if (!el.id) el.id = generateId();
            });

            // --- MISSED PROJECTS LOGIC ---
            function updateMissedProjects() {
                const missedProjects = window.plannerUiShared.collectMissedProjects({
                    referenceDate: new Date(),
                    scheduledSourceIds: Array.from(document.querySelectorAll('.schedule-item'))
                        .map((item) => item.dataset.sourceId)
                        .filter(Boolean),
                });
                window.plannerUiShared.renderMissedProjects(missedProjects);
            }

            const toggleMissedBtn = document.getElementById('toggle-missed-btn');
            if (toggleMissedBtn) {
                toggleMissedBtn.addEventListener('click', () => {
                    const missedList = document.getElementById('missed-projects-list');
                    const missedCaret = document.getElementById('missed-caret');
                    if (missedList && missedCaret) {
                        missedList.classList.toggle('hidden');
                        missedCaret.classList.toggle('rotate-180');
                    }
                });
            }

            function flashNavigationTarget(targetEl) {
                const highlightTarget = targetEl?.closest('.project-item, .phase-item, .output-item') || targetEl;
                if (!highlightTarget) return;
                highlightTarget.classList.remove('nav-flash-target');
                void highlightTarget.offsetWidth;
                highlightTarget.classList.add('nav-flash-target');
                window.setTimeout(() => {
                    highlightTarget.classList.remove('nav-flash-target');
                }, 1650);
            }

            function expandNavigationParents(targetEl) {
                let parentContent = targetEl?.closest('.accordion-content');
                while(parentContent) {
                    const header = parentContent.previousElementSibling;
                    if(header && header.classList.contains('accordion-header') && parentContent.classList.contains('hidden')) {
                        openAccordion(header);
                    }
                    parentContent = parentContent.parentElement?.closest('.accordion-content');
                }
            }

            function waitForNavigationTarget(targetId, callback, timeoutMs = 2400) {
                const startedAt = performance.now();
                const step = () => {
                    const liveTarget = document.getElementById(targetId);
                    const highlightTarget = liveTarget?.closest('.project-item, .phase-item, .output-item') || liveTarget;
                    if (!highlightTarget) {
                        if (performance.now() - startedAt < timeoutMs) requestAnimationFrame(step);
                        return;
                    }

                    const rect = highlightTarget.getBoundingClientRect();
                    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
                    const centerY = (rect.top + rect.bottom) / 2;
                    const isVisible = rect.bottom > 72 && rect.top < viewportHeight - 72;
                    const isNearCenter = Math.abs(centerY - (viewportHeight / 2)) <= Math.max(120, viewportHeight * 0.24);

                    if ((isVisible && isNearCenter) || (performance.now() - startedAt >= timeoutMs)) {
                        callback(liveTarget);
                        return;
                    }

                    requestAnimationFrame(step);
                };

                requestAnimationFrame(step);
            }

            // Highlight & Navigate Logic
            document.addEventListener('click', (e) => {
                const navBtn = e.target.closest('.navigate-to-source') || e.target.closest('.missed-project-link');
                if (navBtn) {
                    const targetId = navBtn.dataset.targetId;
                    if (!targetId) return;

                    const initialTargetEl = document.getElementById(targetId);
                    if (initialTargetEl) {
                        const isMissedProjectJump = !!navBtn.closest('.missed-project-link');
                        showView('projects');

                        requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                                const liveTarget = document.getElementById(targetId);
                                if (!liveTarget) return;

                                expandNavigationParents(liveTarget);
                                liveTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });

                                waitForNavigationTarget(targetId, (readyTarget) => {
                                    flashNavigationTarget(readyTarget);
                                    if (isMissedProjectJump) {
                                        window.setTimeout(() => {
                                            flashNavigationTarget(document.getElementById(targetId) || readyTarget);
                                        }, 260);
                                    }
                                }, isMissedProjectJump ? 2800 : 2000);
                            });
                        });
                    }
                }
            });

            // Handle renaming updating missed projects list
            document.addEventListener('focusout', (e) => {
                if (e.target.classList.contains('editable-text')) {
                    updateMissedProjects();
                }
            });

            // --- UPDATE COUNTERS LOGIC ---
            function updateCounters() {
                window.plannerUiShared.updateProgressCounters();
            }

            function updateProjectListsVisibility() {
                window.plannerUiShared.updateSectionHeaders();
            }

            function updateAll() {
                syncAllTimeRangesAndPendingStates();
                updateCounters();
                updateMissedProjects();
                updateProjectListsVisibility();
            }

            // Run on load
            updateAll();

            // --- TEMPLATES ---
            const templates = {
                output: `
                    <div class="output-item group flex items-center justify-between py-1.5 px-2 -mx-2 hover:bg-white/5 rounded transition" data-level="output">
                        <div class="flex items-center flex-1 mr-3 sm:mr-4">
                            <i class="ph ph-check-circle text-textMuted mr-2 opacity-50 text-sm"></i>
                            <div class="flex flex-col flex-1">
                                <div class="flex items-center flex-wrap">
                                    <span class="pending-badge hidden bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold mr-2">Pending</span>
                                    <span contenteditable="true" class="text-base text-gray-200 editable-text">New Output</span>
                                    <span class="badge-container"></span>
                                </div>
                                <div class="flex flex-wrap items-center gap-2.5 mt-0.5 leading-tight">
                                    <div class="time-range-container text-xs text-textMuted hidden flex-row items-center gap-1 leading-tight"></div>
                                </div>
                            </div>
                        </div>
                        <button class="delete-btn text-textMuted hover:text-red-500 transition p-1 shrink-0"><i class="ph ph-trash text-base"></i></button>
                    </div>
                `,
                phase: `
                    <div class="phase-item mb-1 border-b border-transparent" data-level="phase">
                        <div class="accordion-header w-full flex items-center justify-between py-1.5 sm:py-2.5 text-left group cursor-pointer hover:bg-white/5 px-2 -mx-2 rounded transition">
                            <div class="flex items-center flex-1 mr-3 sm:mr-4">
                                <div class="flex flex-col flex-1">
                                    <div class="flex items-center flex-wrap">
                                        <span class="pending-badge hidden bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold mr-2">Pending</span>
                                        <span contenteditable="true" class="font-bold text-base text-white group-hover:text-brand transition editable-text">New Phase</span>
                                        <span class="badge-container"></span>
                                    </div>
                                    <div class="flex flex-wrap items-center gap-2.5 mt-0.5 leading-tight">
                                        <span class="progress-counter text-xs font-normal text-textMuted select-none hidden leading-tight" contenteditable="false"></span>
                                        <div class="time-range-container text-xs text-textMuted hidden flex-row items-center gap-1 leading-tight"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-1 sm:gap-2 shrink-0">
                                <button class="add-output-btn text-xs font-semibold text-white bg-white/10 hover:bg-white hover:text-black transition px-2 py-1 rounded-full flex items-center gap-1"><i class="ph ph-plus"></i><span class="hidden sm:inline">output</span></button>
                                <button class="delete-btn text-textMuted hover:text-red-500 transition p-1"><i class="ph ph-trash text-lg"></i></button>
                                <i class="ph ph-caret-down text-xl chevron-icon text-textMuted group-hover:text-white transition ml-1"></i>
                            </div>
                        </div>
                        <div class="accordion-content pl-3 sm:pl-5 pb-1.5 space-y-0.5 block mt-0.5"></div>
                    </div>
                `,
                project: `
                    <div class="project-item border-b border-borderGray" data-level="project">
                        <div class="accordion-header w-full flex items-center justify-between py-3 sm:py-4 text-left group cursor-pointer hover:bg-white/5 px-2 -mx-2 rounded transition">
                            <div class="flex items-center flex-1 mr-3 sm:mr-4">
                                <i class="ph ph-folder-notch text-2xl text-brand transition-colors duration-300 mr-3 project-icon"></i>
                                <div class="flex flex-col flex-1">
                                    <div class="flex items-center flex-wrap">
                                        <span class="pending-badge hidden bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold mr-2">Pending</span>
                                        <span contenteditable="true" class="editable-text font-bold text-lg text-brand">New Project</span>
                                        <span class="badge-container"></span>
                                    </div>
                                    <div class="project-subtext-row flex flex-wrap items-center gap-2.5 leading-tight">
                                        <span class="progress-counter text-xs font-normal text-textMuted select-none hidden leading-tight" contenteditable="false"></span>
                                        <div class="time-range-container text-xs text-textMuted hidden flex-row items-center gap-1 leading-tight"></div>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-1 sm:gap-2 shrink-0">
                                <button class="add-phase-btn text-xs font-semibold text-brand bg-brand/10 hover:bg-brand hover:text-black transition px-2 py-1 rounded-full flex items-center gap-1"><i class="ph ph-plus"></i><span class="hidden sm:inline">phase</span></button>
                                <button class="delete-btn text-textMuted hover:text-red-500 transition p-1"><i class="ph ph-trash text-lg"></i></button>
                                <i class="ph ph-caret-down text-xl chevron-icon rotate-180 text-brand transition-colors duration-300 ml-1"></i>
                            </div>
                        </div>
                        <div class="accordion-content pl-5 sm:pl-10 pb-3 block"></div>
                    </div>
                `
            };

            // --- DELETE MODAL LOGIC ---
            let itemToDelete = null;
            let deleteConfirmCallback = null;

            const deleteModal = document.getElementById('delete-modal');
            const deleteModalDialog = document.getElementById('delete-modal-dialog');
            const deleteModalBackdrop = document.getElementById('delete-modal-backdrop');
            const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
            const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
            const deleteModalTitle = document.getElementById('delete-modal-title');
            const deleteModalMessage = document.getElementById('delete-modal-message');

            function showDeleteModal(item, opts = {}) {
                itemToDelete = item || null;
                deleteConfirmCallback = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;

                if (deleteModalTitle) deleteModalTitle.textContent = opts.title || 'Confirm Deletion';
                if (deleteModalMessage) deleteModalMessage.textContent = opts.message ||
                    'Are you sure you want to delete this item? This action cannot be undone and will delete all items inside it.';

                deleteModal.classList.remove('hidden');
                requestAnimationFrame(() => {
                    deleteModalDialog.classList.remove('scale-95', 'opacity-0');
                    deleteModalDialog.classList.add('scale-100', 'opacity-100');
                });
            }

            function hideDeleteModal() {
                deleteModalDialog.classList.remove('scale-100', 'opacity-100');
                deleteModalDialog.classList.add('scale-95', 'opacity-0');
                setTimeout(() => {
                    deleteModal.classList.add('hidden');
                    itemToDelete = null;
                    deleteConfirmCallback = null;
                }, 200);
            }

            if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', hideDeleteModal);
            if (deleteModalBackdrop) deleteModalBackdrop.addEventListener('click', hideDeleteModal);

            if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Custom confirm flow (e.g., schedule actions)
                if (deleteConfirmCallback) {
                    try { deleteConfirmCallback(); } catch (error) { console.error(error); }
                    hideDeleteModal();
                    return;
                }

                // Default: delete a tree item (project/phase/output)
                if (itemToDelete) {
                    const item = itemToDelete;
                    const parentToCheck = item.parentElement?.closest('[data-level]');
                    item.style.opacity = '0';
                    item.style.transform = 'scale(0.98)';
                    item.style.transition = 'all 0.3s';
                    setTimeout(() => {
                        item.remove();
                        if (parentToCheck) updateParentStatus(parentToCheck);
                        updateAll(); // RECOUNT & MISSED
                    }, 300);
                }
                hideDeleteModal();
            });


            // --- ADD / ACCORDION / DELETE BUTTON HANDLERS ---
            if(addProjectBtn) addProjectBtn.addEventListener('click', () => {
                const activeList = document.getElementById('active-projects-list');
                activeList.insertAdjacentHTML('beforeend', templates.project);
                const newProject = activeList.lastElementChild;
                newProject.id = generateId(); // Assign ID
                initSortable(newProject.querySelector(':scope > .accordion-content'), 'phases');
                newProject.querySelector('.editable-text').focus();
                updateAll(); // RECOUNT & MISSED
            });

            if(projectListContainer) projectListContainer.addEventListener('click', (e) => {
                if (Date.now() < suppressClickUntil) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                if (isDragging) return; // Chống click nhầm sau khi thả kéo
                if (e.target.classList.contains('editable-text')) return;
                if (e.target.closest('.drag-handle')) {
                    e.stopPropagation();
                    return;
                }

                const btn = e.target.closest('button');
                if (btn) e.stopPropagation();

                // Add Phase
                if (e.target.closest('.add-phase-btn')) {
                    const projectItem = e.target.closest('.project-item');
                    const contentArea = projectItem.querySelector(':scope > .accordion-content');
                    contentArea.insertAdjacentHTML('beforeend', templates.phase);
                    const newPhase = contentArea.lastElementChild;
                    newPhase.id = generateId(); // Assign ID
                    initSortable(newPhase.querySelector(':scope > .accordion-content'), 'outputs');
                    openAccordion(projectItem.querySelector(':scope > .accordion-header'));
                    newPhase.querySelector('.editable-text').focus();
                    updateParentStatus(projectItem); 
                    updateAll(); // RECOUNT & MISSED
                    return;
                }

                // Add Output
                if (e.target.closest('.add-output-btn')) {
                    const phaseItem = e.target.closest('.phase-item');
                    const contentArea = phaseItem.querySelector(':scope > .accordion-content');
                    contentArea.insertAdjacentHTML('beforeend', templates.output);
                    const newOutput = contentArea.lastElementChild;
                    newOutput.id = generateId(); // Assign ID
                    openAccordion(phaseItem.querySelector(':scope > .accordion-header'));
                    newOutput.querySelector('.editable-text').focus();
                    updateParentStatus(phaseItem);
                    updateAll(); // RECOUNT & MISSED
                    return;
                }

                // Add Output
                if (e.target.closest('.add-output-btn')) {
                    const phaseItem = e.target.closest('.phase-item');
                    const contentArea = phaseItem.querySelector(':scope > .accordion-content');
                    contentArea.insertAdjacentHTML('beforeend', templates.output);
                    openAccordion(phaseItem.querySelector(':scope > .accordion-header'));
                    contentArea.lastElementChild.querySelector('.editable-text').focus();
                    updateParentStatus(phaseItem);
                    updateCounters(); // RECOUNT
                    return;
                }

                // Delete Request
                if (e.target.closest('.delete-btn')) {
                    const item = e.target.closest('[data-level]');
                    if (item) showDeleteModal(item);
                    return;
                }

                // Accordion Toggle
                const header = e.target.closest('.accordion-header');
                if (header) toggleAccordion(header);
            });

            function toggleAccordion(header) {
                const content = header.nextElementSibling;
                if(!content) return;
                if (content.classList.contains('hidden')) { openAccordion(header); } 
                else { closeAccordion(header); }
            }

            function openAccordion(header) {
                const content = header.nextElementSibling;
                const chevron = header.querySelector('.chevron-icon');
                content.classList.remove('hidden'); content.classList.add('block');
                chevron.classList.add('rotate-180');

                // Color change logic cho Project Level
                const isProject = header.closest('.project-item') && !header.closest('.phase-item');
                if (isProject) {
                    const textSpan = header.querySelector('.editable-text');
                    const icon = header.querySelector('.project-icon');
                    const isPending = textSpan.classList.contains('is-pending-text');
                    const isDone = header.closest('.project-item').dataset.status === 'done';
                    
                    if (isDone) {
                        textSpan.classList.replace('text-white', 'text-blue-500');
                        if (icon) icon.classList.replace('text-white', 'text-blue-500');
                        chevron.classList.replace('text-textMuted', 'text-blue-500');
                    } else if(!isPending) {
                        textSpan.classList.replace('text-white', 'text-brand');
                        if (icon) icon.classList.replace('text-white', 'text-brand');
                        chevron.classList.replace('text-textMuted', 'text-brand');
                    }
                }
            }

            function closeAccordion(header) {
                const content = header.nextElementSibling;
                const chevron = header.querySelector('.chevron-icon');
                content.classList.add('hidden'); content.classList.remove('block');
                chevron.classList.remove('rotate-180');

                // Color change logic cho Project Level
                const isProject = header.closest('.project-item') && !header.closest('.phase-item');
                if (isProject) {
                    const textSpan = header.querySelector('.editable-text');
                    const icon = header.querySelector('.project-icon');
                    const isPending = textSpan.classList.contains('is-pending-text');
                    const isDone = header.closest('.project-item').dataset.status === 'done';
                    
                    if (isDone) {
                        textSpan.classList.replace('text-blue-500', 'text-white');
                        if (icon) icon.classList.replace('text-blue-500', 'text-white');
                        chevron.classList.replace('text-blue-500', 'text-textMuted');
                    } else if(!isPending) {
                        textSpan.classList.replace('text-brand', 'text-white');
                        if (icon) icon.classList.replace('text-brand', 'text-white');
                        chevron.classList.replace('text-brand', 'text-textMuted');
                    }
                }
            }

            if(projectListContainer) projectListContainer.addEventListener('keydown', (e) => {
                if (e.target.classList.contains('editable-text') && e.key === 'Enter') {
                    e.preventDefault(); e.target.blur();
                }
            });


            // --- LONG PRESS & MARK AS DONE LOGIC ---
            let longPressTarget = null;
            let activeContextTarget = null;
            let lastClientX = 0;
            let lastClientY = 0;
            let pressStartedAt = 0;
            let pressMoved = false;
            let suppressClickUntil = 0;
            const LONG_PRESS_DURATION = 420;
            const PRESS_MOVE_THRESHOLD = 8;

            const contextMenu = document.getElementById('custom-context-menu');
            const datePickerMenu = document.getElementById('date-picker-menu');
            const menuMarkDone = document.getElementById('menu-mark-done');
            const menuMarkUndone = document.getElementById('menu-mark-undone');
            const menuAddActions = document.getElementById('menu-add-actions');
            const menuAddTime = document.getElementById('menu-add-time');
            const doneDateInput = document.getElementById('done-date-input');

            // --- VIEW NAVIGATION LOGIC ---
            const projectsView = document.getElementById('projects-view');
            const scheduleView = document.getElementById('schedule-view');
            const logoBtn = document.getElementById('logo-btn');
            const navActionsBtn = document.getElementById('nav-actions-btn');
            const viewTabs = document.querySelectorAll('.view-tab');

            function updateViewTabs(viewName) {
                viewTabs.forEach((tab) => {
                    const isActive = tab.dataset.view === viewName;
                    tab.classList.toggle('is-active', isActive);
                });
            }

            function showView(viewName) {
                const wasScheduleVisible = scheduleView && !scheduleView.classList.contains('hidden');
                if (wasScheduleVisible && viewName !== 'schedule') {
                    window.plannerBridge?.syncSelectedScheduleDay?.();
                }

                if (viewName === 'schedule') {
                    projectsView.classList.replace('block', 'hidden');
                    scheduleView.classList.replace('hidden', 'block');
                    window.plannerBridge?.renderSelectedScheduleDay?.();
                } else {
                    scheduleView.classList.replace('block', 'hidden');
                    projectsView.classList.replace('hidden', 'block');
                }
                updateViewTabs(viewName);
            }

            if(logoBtn) logoBtn.addEventListener('click', () => {
                showView('projects');
            });

            if(navActionsBtn) navActionsBtn.addEventListener('click', () => {
                showView('schedule');
            });

            viewTabs.forEach((tab) => {
                tab.addEventListener('click', () => {
                    showView(tab.dataset.view || 'projects');
                });
            });

            const scheduleBackBtn = document.getElementById('schedule-back-btn');
            if(scheduleBackBtn) scheduleBackBtn.addEventListener('click', () => {
                showView('projects');
            });

            updateViewTabs(projectsView.classList.contains('hidden') ? 'schedule' : 'projects');

            // --- CALENDAR MODAL LOGIC ---
            const calendarModal = document.getElementById('calendar-modal');
            const calendarDialog = document.getElementById('calendar-modal-dialog');
            const scheduleCalendarBtn = document.getElementById('schedule-calendar-btn');
            const schedulePrevDayBtn = document.getElementById('schedule-prev-day-btn');
            const scheduleNextDayBtn = document.getElementById('schedule-next-day-btn');
            const closeCalendarBtn = document.getElementById('close-calendar-btn');
            const cancelCalendarBtn = document.getElementById('cancel-calendar-btn');
            const calendarModalBackdrop = document.getElementById('calendar-modal-backdrop');
            const saveCalendarBtn = document.getElementById('save-calendar-btn');

            function openCalendarModal() {
                if(!calendarModal) return;
                calendarModal.classList.remove('hidden');
                requestAnimationFrame(() => {
                    calendarDialog.classList.remove('scale-95', 'opacity-0');
                    calendarDialog.classList.add('scale-100', 'opacity-100');
                });
            }

            function closeCalendarModal() {
                if(!calendarModal) return;
                calendarDialog.classList.remove('scale-100', 'opacity-100');
                calendarDialog.classList.add('scale-95', 'opacity-0');
                setTimeout(() => calendarModal.classList.add('hidden'), 200);
            }

            if(scheduleCalendarBtn) scheduleCalendarBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                openCalendarModal();
            };
            function offsetIsoDateLocal(isoDate, dayDelta) {
                const [year, month, day] = String(isoDate || '').split('-').map(Number);
                if (!year || !month || !day) return '';
                const shifted = new Date(year, month - 1, day + dayDelta, 12, 0, 0, 0);
                const yyyy = shifted.getFullYear();
                const mm = String(shifted.getMonth() + 1).padStart(2, '0');
                const dd = String(shifted.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            }

            if(schedulePrevDayBtn) schedulePrevDayBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const bridge = window.plannerBridge;
                const currentDate = bridge?.getSelectedScheduleDate?.();
                const nextDate = offsetIsoDateLocal(currentDate, -1);
                if (bridge?.switchScheduleDate && nextDate) {
                    bridge.switchScheduleDate(nextDate);
                }
            };
            if(scheduleNextDayBtn) scheduleNextDayBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const bridge = window.plannerBridge;
                const currentDate = bridge?.getSelectedScheduleDate?.();
                const nextDate = offsetIsoDateLocal(currentDate, 1);
                if (bridge?.switchScheduleDate && nextDate) {
                    bridge.switchScheduleDate(nextDate);
                }
            };
            if(closeCalendarBtn) closeCalendarBtn.addEventListener('click', closeCalendarModal);
            if(cancelCalendarBtn) cancelCalendarBtn.addEventListener('click', closeCalendarModal);
            if(calendarModalBackdrop) calendarModalBackdrop.addEventListener('click', closeCalendarModal);
            if(saveCalendarBtn) saveCalendarBtn.addEventListener('click', closeCalendarModal); // Later, add real logic here

            function getTargetContainer(element) {
                if (element.dataset.level === 'output') return element;
                return Array.from(element.children).find(c => c.classList.contains('accordion-header'));
            }

            function resetPressState() {
                longPressTarget = null;
                pressStartedAt = 0;
                pressMoved = false;
            }

            function getClientPoint(e) {
                if (e.touches && e.touches[0]) {
                    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
                }
                if (e.changedTouches && e.changedTouches[0]) {
                    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
                }
                if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
                    return { x: e.clientX, y: e.clientY };
                }
                return null;
            }

            function startPress(e) {
                if (isDragging) return;
                if (e.target.closest('button') || e.target.closest('.drag-handle') || e.target.closest('.editable-text') || e.target.closest('input, textarea, select')) return;
                if (e.touches && e.touches.length > 1) return;

                const point = getClientPoint(e);
                if (!point) return;

                const item = e.target.closest('[data-level]');
                if (!item) return;

                lastClientX = point.x;
                lastClientY = point.y;
                pressStartedAt = Date.now();
                pressMoved = false;
                longPressTarget = item;
            }

            function trackPressMove(e) {
                if (!longPressTarget) return;
                const point = getClientPoint(e);
                if (!point) return;

                const dx = Math.abs(point.x - lastClientX);
                const dy = Math.abs(point.y - lastClientY);
                if (dx > PRESS_MOVE_THRESHOLD || dy > PRESS_MOVE_THRESHOLD || isDragging) {
                    pressMoved = true;
                }
            }

            function endPress() {
                if (!longPressTarget) return;

                const item = longPressTarget;
                const pressDuration = Date.now() - pressStartedAt;
                const shouldShowContextMenu = !pressMoved && !isDragging && pressDuration >= LONG_PRESS_DURATION;

                resetPressState();

                if (shouldShowContextMenu) {
                    suppressClickUntil = Date.now() + 350;
                    showContextMenu(item);
                }
            }

            function cancelPress() {
                resetPressState();
            }

            if(projectListContainer) {
                projectListContainer.addEventListener('mousedown', startPress);
                projectListContainer.addEventListener('touchstart', startPress, {passive: true});
            }
            window.addEventListener('mousemove', trackPressMove);
            window.addEventListener('touchmove', trackPressMove, {passive: true});
            window.addEventListener('mouseup', endPress);
            window.addEventListener('touchend', endPress);
            window.addEventListener('touchcancel', cancelPress);
            window.addEventListener('blur', cancelPress);

            function hideFloatingMenus(clearTarget = false) {
                if (contextMenu) contextMenu.classList.add('hidden');
                if (datePickerMenu) datePickerMenu.classList.add('hidden');
                if (clearTarget) activeContextTarget = null;
            }

            function getActiveContextTarget() {
                return activeContextTarget || longPressTarget || null;
            }

            function handleGlobalMenuDismiss(e) {
                const clickedInsideContextMenu = contextMenu && contextMenu.contains(e.target);
                const clickedInsideDatePicker = datePickerMenu && datePickerMenu.contains(e.target);
                const clickedInsideTimeRangeModal = timeRangeModal && timeRangeModal.contains(e.target);
                if (!clickedInsideContextMenu && !clickedInsideDatePicker && !clickedInsideTimeRangeModal) {
                    hideFloatingMenus(true);
                }
            }

            document.addEventListener('mousedown', handleGlobalMenuDismiss);
            document.addEventListener('touchstart', handleGlobalMenuDismiss, { passive: true });

            function showContextMenu(item) {
                cancelPress();
                longPressTarget = item;
                activeContextTarget = item;
                
                // Huỷ bôi đen text nếu có
                window.getSelection().removeAllRanges();
                if(document.activeElement && document.activeElement.classList.contains('editable-text')) {
                    document.activeElement.blur();
                }

                const isDone = item.dataset.status === 'done';
                const isOutput = item.dataset.level === 'output';

                // Chỉ hiện "Mark as undone" nếu đã done VÀ đang ở cấp output
                if (isDone && isOutput) {
                    menuMarkDone.classList.add('hidden');
                    menuMarkUndone.classList.remove('hidden');
                } else {
                    menuMarkDone.classList.remove('hidden');
                    menuMarkUndone.classList.add('hidden');
                }

                // Cập nhật Logic Add Actions: Chỉ hiện khi chưa done
                if (isDone) {
                    menuAddActions.classList.add('hidden');
                } else {
                    menuAddActions.classList.remove('hidden');
                }

                contextMenu.style.left = `${lastClientX}px`;
                contextMenu.style.top = `${lastClientY}px`;
                contextMenu.classList.remove('hidden');
                datePickerMenu.classList.add('hidden');
            }

            // Click "Mark as done" -> Show Date Picker
            if(menuMarkDone) menuMarkDone.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = getActiveContextTarget();
                if (!target) return;
                activeContextTarget = target;
                contextMenu.classList.add('hidden');
                
                const today = new Date();
                const yyyy = today.getFullYear();
                const mm = String(today.getMonth() + 1).padStart(2, '0');
                const dd = String(today.getDate()).padStart(2, '0');
                doneDateInput.value = `${yyyy}-${mm}-${dd}`;
                
                datePickerMenu.style.left = `${lastClientX}px`;
                datePickerMenu.style.top = `${lastClientY}px`;
                datePickerMenu.classList.remove('hidden');
            });

            // Click "Mark as undone"
            if(menuMarkUndone) menuMarkUndone.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = getActiveContextTarget();
                if (!target) return;
                contextMenu.classList.add('hidden');
                
                // 1. Gỡ hiệu ứng của chính nó
                applyUndoneUI(target);
                
                // 2. Tự động gỡ các mục con bên trong (nếu có)
                const children = target.querySelectorAll('[data-level]');
                children.forEach(child => applyUndoneUI(child));

                // 3. Gọi lên cha để check
                const parent = target.parentElement.closest('[data-level]');
                if (parent) updateParentStatus(parent);

                activeContextTarget = null;
                // RECOUNT
                updateCounters();
            });

            // Click "Add actions" (Mở modal nhập nội dung)
            const actionModal = document.getElementById('action-modal');
            const actionDialog = document.getElementById('action-modal-dialog');
            const actionInput = document.getElementById('action-input');
            const outputInput = document.getElementById('output-input');
            const cancelActionBtn = document.getElementById('cancel-action-btn');
            const saveActionBtn = document.getElementById('save-action-btn');
            const actionModalBackdrop = document.getElementById('action-modal-backdrop');

            let currentEditingScheduleItem = null;
            let currentActionSourceRef = null;

            // --- TIME RANGE MODAL LOGIC ---
            const timeRangeModal = document.getElementById('time-range-modal');
            const timeRangeDialog = document.getElementById('time-range-modal-dialog');
            const startTimeInput = document.getElementById('start-time-input');
            const endTimeInput = document.getElementById('end-time-input');
            
            function openTimeRangeModal() {
                if(!timeRangeModal) return;
                timeRangeModal.classList.remove('hidden');
                requestAnimationFrame(() => {
                    timeRangeDialog.classList.remove('scale-95', 'opacity-0');
                    timeRangeDialog.classList.add('scale-100', 'opacity-100');
                });
            }

            function closeTimeRangeModal(clearTarget = false) {
                if(!timeRangeModal) return;
                timeRangeDialog.classList.remove('scale-100', 'opacity-100');
                timeRangeDialog.classList.add('scale-95', 'opacity-0');
                setTimeout(() => timeRangeModal.classList.add('hidden'), 200);
                if (clearTarget) activeContextTarget = null;
            }

            document.getElementById('close-time-range-btn').addEventListener('click', () => closeTimeRangeModal(true));
            document.getElementById('cancel-time-range-btn').addEventListener('click', () => closeTimeRangeModal(true));
            document.getElementById('time-range-modal-backdrop').addEventListener('click', () => closeTimeRangeModal(true));
            
            if(menuAddTime) menuAddTime.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = getActiveContextTarget();
                if (!target) return;
                activeContextTarget = target;
                contextMenu.classList.add('hidden');
                
                // Đọc date hiện tại nếu đã có
                startTimeInput.value = target.dataset.startDate || '';
                endTimeInput.value = target.dataset.endDate || '';
                
                openTimeRangeModal();
            });

            function syncTimeRangeUI(element) {
                const container = getTargetContainer(element);
                const timeRangeContainer = container ? container.querySelector('.time-range-container') : null;
                if (!timeRangeContainer) return;

                const startVal = element.dataset.startDate || '';
                const endVal = element.dataset.endDate || '';

                if (!startVal || !endVal) {
                    timeRangeContainer.innerHTML = '';
                    timeRangeContainer.classList.add('hidden');
                    timeRangeContainer.classList.remove('flex');
                    return;
                }

                const [sy, sm, sd] = startVal.split('-');
                const [ey, em, ed] = endVal.split('-');
                const formattedStart = `${sd}/${sm}/${sy.slice(2)}`;
                const formattedEnd = `${ed}/${em}/${ey.slice(2)}`;

                timeRangeContainer.innerHTML = `${formattedStart} <i class="ph ph-arrow-right text-brand"></i> ${formattedEnd}`;
                timeRangeContainer.classList.remove('hidden');
                timeRangeContainer.classList.add('flex');
            }

            function syncAllTimeRangesAndPendingStates() {
                document.querySelectorAll('[data-level]').forEach((element) => {
                    syncTimeRangeUI(element);
                    updatePendingStatus(element);
                });
            }

            document.getElementById('save-time-range-btn').addEventListener('click', () => {
                const target = getActiveContextTarget();
                if (!target) {
                    closeTimeRangeModal();
                    return;
                }

                const startVal = startTimeInput.value;
                const endVal = endTimeInput.value;

                if (!startVal && !endVal) {
                    delete target.dataset.startDate;
                    delete target.dataset.endDate;
                    syncTimeRangeUI(target);
                    updatePendingStatus(target);
                    updateAll();
                    activeContextTarget = null;
                    closeTimeRangeModal();
                    return;
                }

                if (!startVal || !endVal) {
                    alert('Please choose both start and end date, or clear both to remove the range.');
                    return;
                }

                if (endVal < startVal) {
                    alert('End date must be on or after start date.');
                    return;
                }

                target.dataset.startDate = startVal;
                target.dataset.endDate = endVal;
                syncTimeRangeUI(target);
                updatePendingStatus(target);
                updateAll();
                activeContextTarget = null;
                closeTimeRangeModal();
            });
            // --- END TIME RANGE MODAL LOGIC ---

            function openActionModal() {
                if(!actionModal) return;
                actionModal.classList.remove('hidden');
                requestAnimationFrame(() => {
                    actionDialog.classList.remove('scale-95', 'opacity-0');
                    actionDialog.classList.add('scale-100', 'opacity-100');
                });
            }

            function closeActionModal() {
                if(!actionModal) return;
                actionDialog.classList.remove('scale-100', 'opacity-100');
                actionDialog.classList.add('scale-95', 'opacity-0');
                setTimeout(() => actionModal.classList.add('hidden'), 200);
                if (!currentEditingScheduleItem) currentActionSourceRef = null;
            }

            if(cancelActionBtn) cancelActionBtn.addEventListener('click', closeActionModal);
            if(actionModalBackdrop) actionModalBackdrop.addEventListener('click', closeActionModal);

            if(menuAddActions) menuAddActions.addEventListener('click', (e) => {
                e.stopPropagation();
                contextMenu.classList.add('hidden');

                const sourceTarget = (typeof getActiveContextTarget === 'function' ? getActiveContextTarget() : null) || longPressTarget || null;
                if (sourceTarget) {
                    if (!sourceTarget.id) {
                        sourceTarget.id = (window.plannerProjectUi?.generateId?.() || window.uid?.(sourceTarget.dataset.level || 'node') || `node-${Date.now()}`);
                    }
                    const sourceTextEl = (typeof getProjectTitleElement === 'function' ? getProjectTitleElement(sourceTarget) : null) || sourceTarget.querySelector('.editable-text');
                    currentActionSourceRef = {
                        id: sourceTarget.id,
                        text: sourceTextEl?.innerText?.trim() || 'Unknown Item',
                    };
                } else {
                    currentActionSourceRef = null;
                }
                
                // Mặc định tên action là +action theo yêu cầu
                actionInput.value = '+action';
                outputInput.value = ''; // Làm trống ô outputs
                currentEditingScheduleItem = null; // Đặt lại trạng thái edit
                
                openActionModal();
            });

            // Xử lý khi lưu Add Action (Chuyển qua Schedule)
            if(saveActionBtn) saveActionBtn.addEventListener('click', (e) => {
                e.preventDefault();
                try {
                    const actionText = actionInput.value.trim();
                    const outputsText = outputInput.value.trim();
                    
                    if (!actionText) {
                        actionInput.focus();
                        return;
                    }

                    const manualOutputs = outputsText
                        ? outputsText.split('\n').map((line) => line.trim()).filter(Boolean).map((text) => ({ id: uid('manual'), text, done: false }))
                        : [];

                    saveCurrentScheduleIntoCache();

                    if (currentEditingScheduleItem) {
                        const entryId = currentEditingScheduleItem.dataset.entryId;
                        const entries = Array.isArray(scheduleDaysCache[selectedScheduleDate]) ? scheduleDaysCache[selectedScheduleDate] : [];
                        const targetEntry = entries.find((entry) => entry.id === entryId);
                        if (targetEntry) {
                            targetEntry.actionTitle = actionText;
                            targetEntry.manualOutputs = manualOutputs;
                            targetEntry.mode = targetEntry.sourceId ? 'linked' : 'custom';
                        }

                        currentEditingScheduleItem = null;
                        renderScheduleForSelectedDate();
                        window.dispatchEvent(new CustomEvent('planner-sync-schedule'));
                        closeActionModal();
                        return;
                    }

                    let sourceId = currentActionSourceRef?.id || '';
                    let sourceText = currentActionSourceRef?.text || 'Unknown Item';
                    if (!sourceId) {
                        const sourceTarget = (typeof getActiveContextTarget === 'function' ? getActiveContextTarget() : null) || longPressTarget || null;
                        if (sourceTarget) {
                            if (!sourceTarget.id) {
                                sourceTarget.id = (window.plannerProjectUi?.generateId?.() || window.uid?.(sourceTarget.dataset.level || 'node') || `node-${Date.now()}`);
                            }
                            sourceId = sourceTarget.id;
                            const sourceTextEl = (typeof getProjectTitleElement === 'function' ? getProjectTitleElement(sourceTarget) : null) || sourceTarget.querySelector('.editable-text');
                            const liveSourceText = sourceTextEl?.innerText?.trim();
                            if (liveSourceText) sourceText = liveSourceText;
                        }
                    }

                    const entries = Array.isArray(scheduleDaysCache[selectedScheduleDate]) ? scheduleDaysCache[selectedScheduleDate] : [];
                    entries.push(normalizeScheduleEntry({
                        id: (window.plannerProjectUi?.generateId?.() || window.uid?.('schedule') || `schedule-${Date.now()}`),
                        sourceId,
                        sourceText,
                        mode: sourceId ? 'linked' : 'custom',
                        actionTitle: actionText,
                        done: false,
                        expanded: true,
                        childState: {},
                        manualOutputs,
                    }));
                    scheduleDaysCache[selectedScheduleDate] = entries;

                    renderScheduleForSelectedDate();
                    window.dispatchEvent(new CustomEvent('planner-sync-schedule'));
                    
                    closeActionModal();
                    updateMissedProjects();
                    showView('schedule');
                } catch (error) {
                    console.error('Failed to save action from modal:', error);
                }
            });

            // Logic xóa và expand block ở tab Schedule
            const scheduleListElement = document.getElementById('schedule-list');
            if(scheduleListElement) scheduleListElement.addEventListener('mousedown', (e) => {
                if (e.target.closest('.schedule-header-actions button')) {
                    e.stopPropagation();
                }
            });

            if(scheduleListElement) scheduleListElement.addEventListener('click', (e) => {
                if (isDragging) return; // Chống click nhầm sau khi thả
                if (e.target.classList.contains('editable-text') || e.target.type === 'checkbox') return;

                const editBtn = e.target.closest('.edit-schedule-btn');
                if(editBtn) {
                    e.stopPropagation();
                    currentEditingScheduleItem = editBtn.closest('.schedule-item');
                    saveCurrentScheduleIntoCache();
                    const entryId = currentEditingScheduleItem?.dataset.entryId;
                    const entry = (scheduleDaysCache[selectedScheduleDate] || []).find((item) => item.id === entryId);

                    actionInput.value = entry?.actionTitle || currentEditingScheduleItem.querySelector('.action-title-text').innerText;
                    outputInput.value = Array.from(entry?.manualOutputs || []).map((item) => item.text).join('\n');
                    openActionModal();
                    return;
                }

                const delBtn = e.target.closest('.delete-schedule-btn');
                if (delBtn) {
                    e.stopPropagation();
                    const item = delBtn.closest('.schedule-item');
                    if (!item) return;

                    showDeleteModal(item, {
                        title: 'Delete action?',
                        message: 'Are you sure you want to delete this scheduled action? This cannot be undone.',
                        onConfirm: () => {
                            const entryIdToDelete = String(item.dataset.entryId || '').trim();
                            if (!entryIdToDelete) return;

                            const liveItem = scheduleListElement.querySelector(`.schedule-item[data-entry-id="${CSS.escape(entryIdToDelete)}"]`) || item;
                            if (liveItem) {
                                liveItem.remove();
                            }

                            scheduleDaysCache[selectedScheduleDate] = parseScheduleEntriesFromDom()
                                .map(normalizeScheduleEntry)
                                .filter((entry) => entry.id !== entryIdToDelete);

                            plannerState.scheduleDays = cloneDeep(scheduleDaysCache || {});
                            syncSelectedScheduleDay();
                            renderScheduleForSelectedDate();
                            if (typeof schedulePersist === 'function') schedulePersist('delete-action');
                        }
                    });
                    return;
                }

                // Accordion Toggle cho Schedule
                const toggleTarget = e.target.closest('.schedule-main-trigger, .schedule-toggle-btn');
                if (toggleTarget) {
                    const item = toggleTarget.closest('.schedule-item');
                    const header = item?.querySelector('.schedule-header');
                    const content = header?.nextElementSibling;
                    const chevron = header?.querySelector('.schedule-toggle-btn .schedule-toggle-icon, .schedule-toggle-btn svg');
                    const toggleBtn = header?.querySelector('.schedule-toggle-btn');
                    if (content && chevron && toggleBtn) {
                        if (content.classList.contains('hidden')) {
                            content.classList.remove('hidden');
                            content.classList.add('block');
                            chevron.style.transform = 'rotate(180deg)';
                            toggleBtn.setAttribute('aria-label', 'Collapse action');
                        } else {
                            content.classList.add('hidden');
                            content.classList.remove('block');
                            chevron.style.transform = 'rotate(0deg)';
                            toggleBtn.setAttribute('aria-label', 'Expand action');
                        }
                    }
                }
            });

            if(scheduleListElement) scheduleListElement.addEventListener('change', (e) => {
                const checkbox = e.target.closest('input[type="checkbox"]');
                if (!checkbox) return;

                if (checkbox.classList.contains('schedule-done-checkbox')) {
                    const titleText = checkbox.closest('.schedule-header')?.querySelector('.action-title-text');
                    if (titleText) {
                        titleText.classList.toggle('text-brand', checkbox.checked);
                        titleText.classList.toggle('text-white', !checkbox.checked);
                    }
                }

                const checklistRow = checkbox.closest('[data-linked-kind="source-child"], [data-linked-kind="manual-output"]');
                if (checklistRow) {
                    const rowText = checklistRow.querySelector('.output-text') || checklistRow.querySelector('.flex-1 > span:first-child');
                    if (rowText) {
                        rowText.classList.toggle('text-brand', checkbox.checked);
                        rowText.classList.toggle('text-gray-300', !checkbox.checked);
                    }
                }

                saveCurrentScheduleIntoCache();
                window.dispatchEvent(new CustomEvent('planner-sync-schedule'));
            });

            // Save Date Picker
            const saveDateBtn = document.getElementById('save-date-btn');
            if(saveDateBtn) saveDateBtn.addEventListener('click', () => {
                const dateVal = doneDateInput.value;
                const target = getActiveContextTarget();
                if (!dateVal || !target) return;
                datePickerMenu.classList.add('hidden');
                
                processMarkAsDone(target, dateVal, false);
                activeContextTarget = null;
                updateCounters(); // RECOUNT
            });

            const cancelDateBtn = document.getElementById('cancel-date-btn');
            if(cancelDateBtn) cancelDateBtn.addEventListener('click', () => {
                datePickerMenu.classList.add('hidden');
                activeContextTarget = null;
            });

            // --- CORE LOGIC HIERARCHY ---

            function applyDoneUI(element, dateStr) {
                element.dataset.status = 'done';
                element.dataset.date = dateStr;
                
                const container = getTargetContainer(element);
                if(container) {
                    if (element.dataset.level === 'project') {
                        container.classList.add('is-done-bg-blue');
                        const isExpanded = container.nextElementSibling && !container.nextElementSibling.classList.contains('hidden');
                        if (isExpanded) {
                            const textSpan = container.querySelector('.editable-text');
                            const icon = container.querySelector('.project-icon');
                            const chevron = container.querySelector('.chevron-icon');
                            
                            if (textSpan) {
                                textSpan.classList.remove('text-brand', 'text-white', 'is-pending-text');
                                textSpan.classList.add('text-blue-500');
                            }
                            if (icon) {
                                icon.classList.remove('text-brand', 'text-white', 'text-yellow-500');
                                icon.classList.add('text-blue-500');
                            }
                            if (chevron) {
                                chevron.classList.remove('text-brand', 'text-white', 'text-yellow-500', 'text-textMuted');
                                chevron.classList.add('text-blue-500');
                            }
                        }
                    } else {
                        container.classList.add('is-done-bg');
                    }
                }
                
                if(element.dataset.level === 'output') {
                    const icon = container.querySelector('.ph-check-circle');
                    if(icon) {
                        icon.classList.remove('text-textMuted', 'opacity-50');
                        icon.classList.add('text-brand', 'opacity-100');
                        icon.classList.replace('ph', 'ph-fill');
                    }
                }

                const badgeContainer = container.querySelector('.badge-container');
                if (badgeContainer) {
                    const [y, m, d] = dateStr.split('-');
                    const dateObj = new Date(y, m - 1, d);
                    const formattedDate = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                    if (element.dataset.level === 'project') {
                        badgeContainer.innerHTML = `<span class="done-badge-blue"><i class="ph ph-check mr-1"></i> ${formattedDate}</span>`;
                    } else {
                        badgeContainer.innerHTML = `<span class="done-badge"><i class="ph ph-check mr-1"></i> ${formattedDate}</span>`;
                    }
                }
            }

            function applyUndoneUI(element) {
                delete element.dataset.status;
                delete element.dataset.date;
                
                const container = getTargetContainer(element);
                if(container) {
                    if (element.dataset.level === 'project') {
                        container.classList.remove('is-done-bg-blue');
                        const isExpanded = container.nextElementSibling && !container.nextElementSibling.classList.contains('hidden');
                        if (isExpanded) {
                            const textSpan = container.querySelector('.editable-text');
                            const icon = container.querySelector('.project-icon');
                            const chevron = container.querySelector('.chevron-icon');
                            
                            if (textSpan) {
                                textSpan.classList.remove('text-blue-500');
                                textSpan.classList.add('text-brand');
                            }
                            if (icon) {
                                icon.classList.remove('text-blue-500');
                                icon.classList.add('text-brand');
                            }
                            if (chevron) {
                                chevron.classList.remove('text-blue-500');
                                chevron.classList.add('text-brand');
                            }
                        }
                    } else {
                        container.classList.remove('is-done-bg');
                    }
                }

                if(element.dataset.level === 'output') {
                    const icon = container.querySelector('.ph-check-circle');
                    if(icon) {
                        icon.classList.add('text-textMuted', 'opacity-50');
                        icon.classList.remove('text-brand', 'opacity-100');
                        icon.classList.replace('ph-fill', 'ph');
                    }
                }

                const badgeContainer = container.querySelector('.badge-container');
                if (badgeContainer) badgeContainer.innerHTML = '';
                
                updatePendingStatus(element); // Re-evaluate pending status when undone
            }

            function updatePendingStatus(element) {
                const startDateStr = element.dataset.startDate;
                const container = getTargetContainer(element);
                if (!container) return;
                
                const editableText = container.querySelector('.editable-text');
                const pendingBadge = container.querySelector('.pending-badge');
                const icon = container.querySelector('.project-icon');
                
                if (!editableText || !pendingBadge) return;

                const showPendingBadge = () => {
                    pendingBadge.classList.remove('hidden');
                    pendingBadge.style.display = 'inline-flex';
                };

                const hidePendingBadge = () => {
                    pendingBadge.classList.add('hidden');
                    pendingBadge.style.display = '';
                };

                // Nếu đã done thì không show pending nữa
                if (element.dataset.status === 'done' || !startDateStr) {
                    editableText.classList.remove('is-pending-text');
                    hidePendingBadge();
                    
                    if (icon && element.dataset.level === 'project') {
                        const isExpanded = container.nextElementSibling && !container.nextElementSibling.classList.contains('hidden');
                        const isDone = element.dataset.status === 'done';
                        const colorClass = isExpanded ? (isDone ? 'text-blue-500' : 'text-brand') : 'text-white';
                        icon.className = `ph ph-folder-notch text-2xl ${colorClass} transition-colors duration-300 mr-3 project-icon`;
                    }
                } else {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0); // Đưa về 0h để so sánh ngày
                    
                    // Parse yyyy-mm-dd
                    const [y, m, d] = startDateStr.split('-');
                    const startDate = new Date(y, m - 1, d);
                    
                    if (startDate > today) {
                        editableText.classList.add('is-pending-text');
                        showPendingBadge();
                        if (icon && element.dataset.level === 'project') {
                            icon.className = 'ph-fill ph-clock text-2xl text-yellow-500 transition-colors duration-300 mr-3 project-icon';
                        }
                    } else {
                        editableText.classList.remove('is-pending-text');
                        hidePendingBadge();
                        if (icon && element.dataset.level === 'project') {
                            const isExpanded = container.nextElementSibling && !container.nextElementSibling.classList.contains('hidden');
                            const isDone = element.dataset.status === 'done';
                            const colorClass = isExpanded ? (isDone ? 'text-blue-500' : 'text-brand') : 'text-white';
                            icon.className = `ph ph-folder-notch text-2xl ${colorClass} transition-colors duration-300 mr-3 project-icon`;
                        }
                    }
                }

                // AUTO-MOVE LOGIC FOR PROJECTS (Active <-> Pending <-> Done)
                if (element.dataset.level === 'project') {
                    const isDone = element.dataset.status === 'done';
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const startDateObj = startDateStr ? new Date(startDateStr.split('-')[0], startDateStr.split('-')[1] - 1, startDateStr.split('-')[2]) : null;
                    const isPendingNow = !isDone && startDateObj && startDateObj > today;
                    
                    const activeList = document.getElementById('active-projects-list');
                    const pendingList = document.getElementById('pending-projects-list');
                    const doneList = document.getElementById('done-projects-list');

                    let targetList = activeList;
                    if (isDone) {
                        targetList = doneList;
                    } else if (isPendingNow) {
                        targetList = pendingList;
                    }

                    if (element.parentElement !== targetList) {
                        targetList.appendChild(element);
                    }

                    updateProjectListsVisibility();
                }
            }

            function processMarkAsDone(element, dateStr, isAutoPropagated = false) {
                if (!isAutoPropagated || element.dataset.status !== 'done') {
                    applyDoneUI(element, dateStr);
                    updatePendingStatus(element); // Update pending status when done
                }

                if (!isAutoPropagated) { 
                    const children = element.querySelectorAll('[data-level]');
                    children.forEach(child => {
                        if (child.dataset.status !== 'done') {
                            applyDoneUI(child, dateStr);
                        }
                    });
                }

                if (element.parentElement) {
                    const parent = element.parentElement.closest('[data-level]');
                    if (parent) updateParentStatus(parent);
                }
            }

            function updateParentStatus(parentElement) {
                if (!parentElement) return;

                const contentArea = Array.from(parentElement.children).find(c => c.classList.contains('accordion-content'));
                if(!contentArea) return;
                
                const directChildren = Array.from(contentArea.querySelectorAll(':scope > [data-level]'));
                
                if (directChildren.length === 0) {
                    if (parentElement.dataset.status === 'done') {
                        applyUndoneUI(parentElement);
                        const grandParent = parentElement.parentElement.closest('[data-level]');
                        if(grandParent) updateParentStatus(grandParent);
                    }
                    return;
                }

                const allDone = directChildren.every(child => child.dataset.status === 'done');

                if (allDone) {
                    let maxDate = '';
                    directChildren.forEach(child => {
                        const d = child.dataset.date;
                        if (!maxDate || d > maxDate) maxDate = d;
                    });
                    
                    processMarkAsDone(parentElement, maxDate, true);
                } else {
                    if (parentElement.dataset.status === 'done') {
                        applyUndoneUI(parentElement);
                        const grandParent = parentElement.parentElement.closest('[data-level]');
                        if(grandParent) updateParentStatus(grandParent); 
                    }
                }
            }

            window.plannerProjectUi = {
                templates,
                generateId,
                openAccordion,
                closeAccordion,
                updateAll,
                updateParentStatus,
                applyDoneUI,
                applyUndoneUI,
                updatePendingStatus,
                syncTimeRangeUI,
            };
        });
