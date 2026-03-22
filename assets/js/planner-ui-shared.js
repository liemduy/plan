(function () {
    function getByIdDefault(id) {
        return document.getElementById(id);
    }

    function escapeHtmlDefault(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function toSourceIdSet(values) {
        const normalized = Array.isArray(values) ? values : Array.from(values || []);
        return new Set(normalized.filter(Boolean));
    }

    function updateProgressCounters(options = {}) {
        const getById = options.getById || getByIdDefault;

        document.querySelectorAll('.phase-item').forEach((phase) => {
            const outputs = phase.querySelectorAll(':scope > .accordion-content > .output-item');
            const total = outputs.length;
            const done = Array.from(outputs).filter((item) => item.dataset.status === 'done').length;
            const pending = Array.from(outputs).filter((item) => {
                const badge = item.querySelector(':scope .pending-badge');
                return badge && !badge.classList.contains('hidden');
            }).length;
            const counter = phase.querySelector(':scope > .accordion-header .progress-counter');
            if (!counter) return;
            if (total > 0) {
                counter.textContent = pending > 0
                    ? `(${done}/${total} done, ${pending} pending)`
                    : `(${done}/${total} done)`;
                counter.classList.remove('hidden');
            } else {
                counter.classList.add('hidden');
            }
        });

        document.querySelectorAll('.project-item').forEach((project) => {
            const phases = project.querySelectorAll(':scope > .accordion-content > .phase-item');
            const total = phases.length;
            const done = Array.from(phases).filter((item) => item.dataset.status === 'done').length;
            const pending = Array.from(phases).filter((item) => {
                const badge = item.querySelector(':scope > .accordion-header .pending-badge');
                return badge && !badge.classList.contains('hidden');
            }).length;
            const counter = project.querySelector(':scope > .accordion-header .progress-counter');
            if (!counter) return;
            if (total > 0) {
                counter.textContent = pending > 0
                    ? `(${done}/${total} done, ${pending} pending)`
                    : `(${done}/${total} done)`;
                counter.classList.remove('hidden');
            } else {
                counter.classList.add('hidden');
            }
        });

        const projects = document.querySelectorAll('.project-item');
        const totalProjects = projects.length;
        const doneProjects = Array.from(projects).filter((project) => project.dataset.status === 'done').length;
        const pendingProjects = Array.from(projects).filter((project) => {
            const badge = project.querySelector(':scope > .accordion-header .pending-badge');
            return badge && !badge.classList.contains('hidden');
        }).length;
        const mainCounter = getById('main-progress-counter');
        if (mainCounter) {
            if (totalProjects > 0) {
                mainCounter.textContent = pendingProjects > 0
                    ? `${doneProjects}/${totalProjects} done, ${pendingProjects} pending`
                    : `${doneProjects}/${totalProjects} done`;
                mainCounter.classList.remove('hidden');
            } else {
                mainCounter.classList.add('hidden');
            }
        }
    }

    function updateSectionHeaders(options = {}) {
        const getById = options.getById || getByIdDefault;
        const pendingList = getById('pending-projects-list');
        const pendingHeader = getById('pending-section-header');
        if (pendingList && pendingHeader) {
            pendingHeader.classList.toggle('hidden', pendingList.children.length === 0);
        }

        const doneList = getById('done-projects-list');
        const doneHeader = getById('done-section-header');
        if (doneList && doneHeader) {
            doneHeader.classList.toggle('hidden', doneList.children.length === 0);
        }
    }

    function collectMissedProjects(options = {}) {
        const referenceDate = options.referenceDate instanceof Date
            ? new Date(options.referenceDate)
            : new Date();
        referenceDate.setHours(0, 0, 0, 0);
        const scheduledSourceIds = toSourceIdSet(options.scheduledSourceIds);
        const missedProjects = [];

        document.querySelectorAll('.project-item').forEach((project) => {
            const isDone = project.dataset.status === 'done';
            const startDateValue = project.dataset.startDate;
            const startDate = startDateValue ? new Date(`${startDateValue}T00:00:00`) : null;
            const isPending = !isDone && startDate && startDate > referenceDate;
            const descendantIds = Array.from(project.querySelectorAll('[data-level]'))
                .map((item) => item.id)
                .filter(Boolean);
            const allIds = [project.id, ...descendantIds].filter(Boolean);
            const hasAction = allIds.some((id) => scheduledSourceIds.has(id));

            if (!isDone && !isPending && !hasAction) {
                const titleEl = project.querySelector(':scope > .accordion-header .editable-text');
                if (titleEl) {
                    missedProjects.push({
                        id: project.id,
                        name: titleEl.innerText.trim() || 'Untitled Project',
                    });
                }
            }
        });

        return missedProjects;
    }

    function renderMissedProjects(missedProjects, options = {}) {
        const getById = options.getById || getByIdDefault;
        const escapeHtml = options.escapeHtml || escapeHtmlDefault;
        const countText = getById('missed-count-text');
        const listEl = getById('missed-projects-list');

        if (countText) {
            countText.innerText = `${missedProjects.length} project missed`;
        }

        if (!listEl) return;
        if (missedProjects.length > 0) {
            listEl.innerHTML = missedProjects.map((project) => `
                <button class="block text-sm text-textMuted hover:text-white text-left transition w-full missed-project-link py-1" data-target-id="${escapeHtml(project.id)}">
                    • ${escapeHtml(project.name || 'Untitled Project')}
                </button>
            `).join('');
            return;
        }

        listEl.innerHTML = '<span class="text-sm text-textMuted italic">All projects have actions!</span>';
    }

    window.plannerUiShared = {
        collectMissedProjects,
        renderMissedProjects,
        updateProgressCounters,
        updateSectionHeaders,
    };
})();
