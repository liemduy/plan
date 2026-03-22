(function () {
        function normalizeText(value) {
            return String(value || '')
                .normalize('NFD')
                .replace(/[̀-ͯ]/g, '')
                .toLowerCase()
                .trim();
        }

        function visibleProjectCount(list) {
            if (!list) return 0;
            return Array.from(list.children).filter((item) => item.classList.contains('project-item') && item.style.display !== 'none').length;
        }

        function applyProjectSearch() {
            const input = document.getElementById('project-search-input');
            const clearBtn = document.getElementById('project-search-clear-btn');
            const status = document.getElementById('project-search-status');
            if (!input) return;

            const query = normalizeText(input.value);
            const projects = Array.from(document.querySelectorAll('#project-list-container .project-item'));
            let visibleCount = 0;

            projects.forEach((project) => {
                const haystack = normalizeText(project.innerText);
                const matched = !query || haystack.includes(query);
                project.style.display = matched ? '' : 'none';
                if (matched) visibleCount += 1;
            });

            const pendingHeader = document.getElementById('pending-section-header');
            const doneHeader = document.getElementById('done-section-header');
            const pendingList = document.getElementById('pending-projects-list');
            const doneList = document.getElementById('done-projects-list');

            if (pendingHeader && pendingList) pendingHeader.classList.toggle('hidden', visibleProjectCount(pendingList) === 0);
            if (doneHeader && doneList) doneHeader.classList.toggle('hidden', visibleProjectCount(doneList) === 0);

            if (clearBtn) clearBtn.classList.toggle('hidden', !query);
            if (status) {
                if (query) {
                    status.classList.remove('hidden');
                    status.textContent = visibleCount > 0
                        ? `${visibleCount} matching project${visibleCount === 1 ? '' : 's'}`
                        : 'No matching projects';
                } else {
                    status.classList.add('hidden');
                    status.textContent = '';
                }
            }
        }

        function bootSearch() {
            const input = document.getElementById('project-search-input');
            const clearBtn = document.getElementById('project-search-clear-btn');
            const container = document.getElementById('project-list-container');
            if (!input || !container) return;

            input.addEventListener('input', applyProjectSearch);
            clearBtn?.addEventListener('click', () => {
                input.value = '';
                applyProjectSearch();
                input.focus();
            });

            document.addEventListener('input', (event) => {
                if (!input.value.trim()) return;
                if (event.target.closest('#project-list-container')) {
                    requestAnimationFrame(applyProjectSearch);
                }
            });

            const observer = new MutationObserver(() => requestAnimationFrame(applyProjectSearch));
            observer.observe(container, { childList: true, subtree: true, characterData: true });

            applyProjectSearch();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootSearch);
        } else {
            bootSearch();
        }
    })();
