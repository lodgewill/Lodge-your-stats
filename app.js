        
        
        // ==================== APP STATE ====================
        // Default courses, returned fresh each call so copies never share references.
        function makeDefaultCourses() {
            return [
                { id: 1, name: 'Rosebud 🐐 (North)', pars: [4,4,4,3,4,4,3,4,5,4,3,4,3,4,5,5,4,4] },
                { id: 2, name: 'Rosebud 🐐 (South)', pars: [4,5,4,3,5,4,4,3,4,4,5,3,4,3,4,4,5,4] },
                { id: 3, name: 'Yas Links', pars: [4,5,4,3,4,4,5,3,4,4,5,4,3,4,4,4,3,5] }
            ];
        }

        let state = {
            profile: { name: '', soundEnabled: true },
            courses: makeDefaultCourses(),
            rounds: [],
            currentRound: null,
            editingRoundIndex: null
        };
        
        let currentHoleIndex = 0;
        let currentFilter = '1y';
        let scorecardVisible = false;
        let pendingCelebration = null;
        let finishAttempted = false;
        let editingRoundIndex = null;
        let editingCourseId = null;

        // ==================== UTILITIES ====================
        // Escape user-entered text before putting it into the page as HTML,
        // so a name/course like "<b>" or an imported backup can't inject markup.
        function escapeHtml(str) {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // Total par for a round, taken from the pars actually played (stored on
        // each hole). This keeps past rounds correct even if the course is later
        // edited or deleted, and avoids the old "deleted course shows par 72" bug.
        function getRoundPar(round) {
            if (round && Array.isArray(round.holes) && round.holes.length) {
                return round.holes.reduce((sum, h) => sum + (h.par || 0), 0);
            }
            const course = round && state.courses.find(c => c.id === round.courseId);
            return course ? course.pars.reduce((a, b) => a + b, 0) : 72;
        }

        // ==================== STORAGE ====================
        function loadState() {
            const defaultCourses = makeDefaultCourses();
            
            // One-time cleanup of test/sample data
            if (!localStorage.getItem('testDataCleared_v32')) {
                localStorage.removeItem('golfStatsAppV2');
                localStorage.setItem('testDataCleared_v32', 'true');
            }
            
            try {
                const saved = localStorage.getItem('golfStatsAppV2');
                if (saved) {
                    state = JSON.parse(saved);
                    // Remove old rose emoji courses (🌹🐐)
                    state.courses = state.courses.filter(c => !c.name.includes('🌹'));
                    // Ensure default courses exist
                    defaultCourses.forEach(dc => {
                        if (!state.courses.find(c => c.name === dc.name)) {
                            state.courses.unshift(dc);
                        }
                    });
                    // Migrate old data - add new fields if missing
                    if (state.currentRound) {
                        state.currentRound.holes.forEach(h => {
                            if (h.gettableMade === undefined) h.gettableMade = 0;
                            if (h.gettableTotal === undefined) h.gettableTotal = h.gettable ? 1 : 0;
                            if (h.upDownAttempt === undefined) h.upDownAttempt = !h.gir;
                            if (h.upDownMade === undefined) h.upDownMade = h.upDown || null;
                            if (h.fromBunker === undefined) h.fromBunker = h.sand || false;
                        });
                    }
                    state.rounds.forEach(r => {
                        r.holes.forEach(h => {
                            if (h.gettableMade === undefined) h.gettableMade = h.gettable && h.gettableMade !== false ? 1 : 0;
                            if (h.gettableTotal === undefined) h.gettableTotal = h.gettable ? 1 : 0;
                            if (h.upDownAttempt === undefined) h.upDownAttempt = !h.gir;
                            if (h.upDownMade === undefined) h.upDownMade = h.upDown || null;
                            if (h.fromBunker === undefined) h.fromBunker = h.sand || false;
                        });
                    });
                    // Restore editingRoundIndex from state
                    editingRoundIndex = state.editingRoundIndex || null;
                    
                    // Save state after migrations/cleanup
                    saveState();
                }
            } catch (e) { console.error('Load error:', e); }
            
            // Request persistent storage
            if (navigator.storage && navigator.storage.persist) {
                navigator.storage.persist();
            }
        }
        
        function saveState() {
            try {
                localStorage.setItem('golfStatsAppV2', JSON.stringify(state));
            } catch (e) { console.error('Save error:', e); }
        }
        
        function exportData() {
            const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `golf-stats-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
        
        // Returns null if the backup looks valid, otherwise a plain-English reason.
        function validateBackup(data) {
            if (!data || typeof data !== 'object') return 'The file is not in the expected format.';
            if (typeof data.profile !== 'object' || data.profile === null) return 'It is missing your profile information.';
            if (!Array.isArray(data.courses)) return 'It is missing the list of courses.';
            if (!Array.isArray(data.rounds)) return 'It is missing the list of rounds.';
            for (const c of data.courses) {
                if (!c || typeof c.name !== 'string' || !Array.isArray(c.pars) ||
                    c.pars.length !== 18 || !c.pars.every(p => typeof p === 'number')) {
                    return 'One of the courses has invalid data.';
                }
            }
            for (const r of data.rounds) {
                if (!r || !Array.isArray(r.holes)) return 'One of the rounds has invalid data.';
            }
            return null;
        }

        function importData(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                let data;
                try {
                    data = JSON.parse(e.target.result);
                } catch (err) {
                    alert("This file isn't valid backup data, so nothing was changed.");
                    event.target.value = '';
                    return;
                }

                const problem = validateBackup(data);
                if (problem) {
                    alert('This backup looks invalid, so nothing was changed.\n\n' + problem);
                    event.target.value = '';
                    return;
                }

                if (!confirm(`This will REPLACE all your current data (${state.rounds.length} rounds, ${state.courses.length} courses) with this backup. Continue?`)) {
                    event.target.value = '';
                    return;
                }

                try {
                    // Safety net: keep a copy of the current data before overwriting.
                    localStorage.setItem('golfStatsAppV2_preimport', JSON.stringify(state));
                } catch (err) { /* ignore if storage is full */ }

                state = data;
                saveState();
                alert('Data imported successfully!');
                location.reload();
            };
            reader.readAsText(file);
        }
        
        // ==================== PROFILE ====================
        function showProfile() {
            document.getElementById('mainHeader').style.display = 'none';
            document.getElementById('profileHeader').style.display = 'block';
            document.getElementById('profilePage').classList.add('active');
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById('mainNav').style.display = 'none';
            document.getElementById('roundBanner').classList.remove('show');
            
            document.getElementById('inputName').value = state.profile.name || '';
            updateProfileAvatar();
            const soundOn = state.profile.soundEnabled !== false;
            const t = document.getElementById('soundToggle');
            t.classList.toggle('on', soundOn);
            t.setAttribute('aria-pressed', String(soundOn));
        }
        
        function hideProfile() {
            document.getElementById('mainHeader').style.display = 'block';
            document.getElementById('profileHeader').style.display = 'none';
            document.getElementById('profilePage').classList.remove('active');
            document.getElementById('mainNav').style.display = 'flex';
            showTab('homeTab');
        }
        
        function saveName() {
            state.profile.name = document.getElementById('inputName').value.trim();
            saveState();
            updateGreeting();
            updateProfileBtn();
            updateProfileAvatar();
            hideProfile();
        }
        
        function toggleSound() {
            state.profile.soundEnabled = !state.profile.soundEnabled;
            const t = document.getElementById('soundToggle');
            t.classList.toggle('on', state.profile.soundEnabled);
            t.setAttribute('aria-pressed', String(state.profile.soundEnabled));
            saveState();
        }
        
        function updateGreeting() {
            const el = document.getElementById('greeting');
            if (!state.profile.name) {
                el.textContent = '';
                return;
            }
            const hour = new Date().getHours();
            let greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
            const firstName = state.profile.name.trim().split(' ')[0];
            el.textContent = `${greeting}, ${firstName}`;
        }
        
        function updateProfileBtn() {
            const btn = document.getElementById('profileBtn');
            if (state.profile.name) {
                btn.textContent = state.profile.name.charAt(0).toUpperCase();
                btn.classList.add('has-initial');
            } else {
                btn.textContent = '👤';
                btn.classList.remove('has-initial');
            }
        }
        
        function updateProfileAvatar() {
            const avatar = document.getElementById('profileAvatar');
            if (state.profile.name) {
                avatar.textContent = state.profile.name.charAt(0).toUpperCase();
                avatar.classList.remove('empty');
            } else {
                avatar.textContent = '👤';
                avatar.classList.add('empty');
            }
        }
        
        // ==================== FUNNY MODAL ====================
        let funnyModalTimer = null;

        function showFunnyModal() {
            const m = document.getElementById('funnyModal');
            m.classList.add('show');
            // Auto-dismiss splash, then start the round. (Tapping it skips the wait.)
            clearTimeout(funnyModalTimer);
            funnyModalTimer = setTimeout(acceptAndStartRound, 2000);
        }

        function closeFunnyModal() {
            clearTimeout(funnyModalTimer);
            document.getElementById('funnyModal').classList.remove('show');
        }

        function acceptAndStartRound() {
            const m = document.getElementById('funnyModal');
            // Guard against double-firing (auto-dismiss timer + a tap to skip)
            if (!m.classList.contains('show')) return;
            closeFunnyModal();
            // If we're already on Play tab with a course selected, begin the round
            const courseSelect = document.getElementById('courseSelect');
            if (document.getElementById('playTab').classList.contains('active') && courseSelect && courseSelect.value) {
                beginRound();
            } else {
                startNewRound();
            }
        }
        
        // ==================== ROUND IN PROGRESS BANNER ====================
        function updateRoundBanner(tabId) {
            const banner = document.getElementById('roundBanner');
            const bannerText = document.querySelector('.round-in-progress-text');
            const continueBtn = document.querySelector('.continue-scoring-btn');
            
            if (state.currentRound && tabId !== 'playTab') {
                banner.classList.add('show');
                const isEditing = editingRoundIndex !== null;
                bannerText.textContent = isEditing ? '✏️ Editing Round' : '⛳ Round in Progress';
                continueBtn.textContent = isEditing ? 'Continue editing →' : 'Continue scoring →';
            } else {
                banner.classList.remove('show');
            }
        }
        
        function continueScoring() {
            // Jump to the first hole that still has no score entered.
            // New holes start at score 0, so "unscored" = score is 0 or empty.
            if (state.currentRound) {
                let firstUnscored = state.currentRound.holes.findIndex(h => !h.score);
                // If every hole already has a score, go to the last hole.
                if (firstUnscored === -1) firstUnscored = state.currentRound.holes.length - 1;
                currentHoleIndex = Math.min(firstUnscored, 17);
            }
            showTab('playTab');
        }
        
        // ==================== NAVIGATION ====================
        function showTab(tabId) {
            // Hide round summary if showing
            document.getElementById('roundSummary').classList.remove('active');
            document.getElementById('mainNav').style.display = 'flex';
            document.getElementById('mainHeader').style.display = tabId === 'playTab' && state.currentRound ? 'none' : 'block';
            
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            
            document.getElementById(tabId).classList.add('active');
            
            const navMap = { homeTab: 0, playTab: 1, statsTab: 2, historyTab: 3 };
            if (navMap[tabId] !== undefined) {
                document.querySelectorAll('.nav-item')[navMap[tabId]].classList.add('active');
            }
            
            updateRoundBanner(tabId);
            
            // Control body scroll - only lock when Play tab is active with a round and scorecard is closed
            if (tabId === 'playTab' && state.currentRound && !scorecardVisible) {
                document.body.classList.add('play-active');
            } else {
                document.body.classList.remove('play-active');
            }
            
            if (tabId === 'homeTab') updateHomeTab();
            if (tabId === 'statsTab') updateStatsTab();
            if (tabId === 'historyTab') updateHistoryTab();
            if (tabId === 'playTab') updatePlayTab();
            if (tabId === 'coursesTab') updateCoursesTab();
        }
        
        // ==================== HOME TAB ====================
        function updateHomeTab() {
            updateGreeting();
            updateProfileBtn();
            
            if (state.rounds.length === 0) {
                document.getElementById('lastRoundLabel').style.display = 'none';
                document.getElementById('homeScore').textContent = '--';
                document.getElementById('homeToPar').textContent = '';
                document.getElementById('homeMeta').textContent = 'No rounds yet';
                document.getElementById('homeFairways').textContent = '--%';
                document.getElementById('homeFairways').className = 'mini-stat-value';
                document.getElementById('homeGir').textContent = '--%';
                document.getElementById('homeGir').className = 'mini-stat-value';
                document.getElementById('homePutts').textContent = '--';
                document.getElementById('homePutts').className = 'mini-stat-value';
                document.getElementById('homeBirdies').textContent = '0';
                document.getElementById('recentRounds').innerHTML = '<div class="empty-state"><div class="empty-state-icon">⛳</div><div>Play your first round!</div></div>';
                return;
            }
            
            // Show Last Round label
            document.getElementById('lastRoundLabel').style.display = 'block';
            
            // Last round
            const lastRound = state.rounds[state.rounds.length - 1];
            document.getElementById('homeScore').textContent = lastRound.totalScore || '--';
            
            const course = state.courses.find(c => c.id === lastRound.courseId);
            const coursePar = getRoundPar(lastRound);
            const toPar = lastRound.totalScore - coursePar;
            document.getElementById('homeToPar').textContent = toPar === 0 ? 'E' : (toPar > 0 ? '+' + toPar : toPar);
            
            const date = new Date(lastRound.date);
            const dateStr = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
            document.getElementById('homeMeta').textContent = `${lastRound.courseName} • ${dateStr}`;
            
            // Calculate stats from last round
            const stats = calculateRoundStats(lastRound);
            
            document.getElementById('homeFairways').textContent = stats.fwPct !== null ? stats.fwPct + '%' : '--%';
            document.getElementById('homeFairways').className = 'mini-stat-value ' + getColorClass(stats.fwPct, 60);
            
            document.getElementById('homeGir').textContent = stats.girPct !== null ? stats.girPct + '%' : '--%';
            document.getElementById('homeGir').className = 'mini-stat-value ' + getColorClass(stats.girPct, 66);
            
            document.getElementById('homePutts').textContent = stats.totalPutts || '--';
            document.getElementById('homePutts').className = 'mini-stat-value ' + getColorClassInverse(stats.totalPutts, 29);
            
            document.getElementById('homeBirdies').textContent = stats.birdies;
            
            // Recent rounds (limited to 10, see History for more)
            const recent = [...state.rounds].reverse().slice(0, 10);
            document.getElementById('recentRounds').innerHTML = recent.length === 0 
                ? '<div class="empty-state"><div class="empty-state-icon">⛳</div><div>Play your first round!</div></div>'
                : recent.map((r, idx) => {
                const c = state.courses.find(x => x.id === r.courseId);
                const par = getRoundPar(r);
                const tp = r.totalScore - par;
                const tpStr = tp === 0 ? 'E' : (tp > 0 ? '+' + tp : tp);
                const d = new Date(r.date);
                return `<div class="recent-round-row" onclick="showRoundDetail(${state.rounds.length - 1 - idx})">
                    <div class="recent-round-info">
                        <div class="course-name">${escapeHtml(r.courseName)}</div>
                        <div class="round-date">${d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                    </div>
                    <div class="recent-round-scores">
                        <span class="score">${r.totalScore || '--'}</span>
                        <span class="to-par">${tpStr}</span>
                    </div>
                </div>`;
            }).join('');
        }
        
        function calculateRoundStats(round) {
            let fwHit = 0, fwTotal = 0, girHit = 0, girTotal = 0, totalPutts = 0, birdies = 0, eagles = 0;
            let udMade = 0, udAttempts = 0;
            let gettableMade = 0, gettableTotal = 0;
            let threePutts = 0;
            let scrambleSuccess = 0, scrambleAttempts = 0;
            let sandSavesMade = 0, sandSavesAttempts = 0;
            
            round.holes.forEach(h => {
                if (h.score === null || h.score === 0) return;
                
                const diff = h.score - h.par;
                if (diff === -1) birdies++;
                if (diff <= -2) eagles++;
                
                // Auto-calculate GIR
                const gir = calculateGIR(h.score, h.putts, h.par);
                girTotal++;
                if (gir) girHit++;
                
                if (h.par >= 4) {
                    fwTotal++;
                    if (h.fairway) fwHit++;
                }
                
                if (h.putts !== null && h.putts > 0) {
                    totalPutts += h.putts;
                    if (h.putts >= 3) threePutts++;
                }
                
                // Up & down stats
                if (h.upDownAttempt === true) {
                    udAttempts++;
                    if (h.upDownMade === true) udMade++;
                    
                    // Sand saves
                    if (h.fromBunker) {
                        sandSavesAttempts++;
                        if (h.upDownMade === true) sandSavesMade++;
                    }
                }
                
                // Gettable putts
                gettableTotal += h.gettableTotal || 0;
                gettableMade += h.gettableMade || 0;
                
                // Scrambling: par or better after missing GIR
                if (!gir) {
                    scrambleAttempts++;
                    if (diff <= 0) scrambleSuccess++;
                }
            });
            
            return {
                fwHit, fwTotal,
                fwPct: fwTotal > 0 ? Math.round(fwHit / fwTotal * 100) : null,
                girHit, girTotal,
                girPct: girTotal > 0 ? Math.round(girHit / girTotal * 100) : null,
                totalPutts: totalPutts || null,
                puttsPerHole: girTotal > 0 ? (totalPutts / girTotal).toFixed(2) : null,
                birdies, eagles,
                udMade, udAttempts,
                udPct: udAttempts > 0 ? Math.round(udMade / udAttempts * 100) : null,
                gettableMade, gettableTotal,
                gettablePct: gettableTotal > 0 ? Math.round(gettableMade / gettableTotal * 100) : null,
                threePutts,
                scrambleSuccess, scrambleAttempts,
                scramblePct: scrambleAttempts > 0 ? Math.round(scrambleSuccess / scrambleAttempts * 100) : null,
                sandSavesMade, sandSavesAttempts,
                sandSavesPct: sandSavesAttempts > 0 ? Math.round(sandSavesMade / sandSavesAttempts * 100) : null
            };
        }
        
        function calculateGIR(score, putts, par) {
            // GIR = reached green in (par - 2) strokes or fewer
            // If score - putts <= par - 2, then GIR
            if (score === null || putts === null) return false;
            return (score - putts) <= (par - 2);
        }
        
        function getColorClass(value, threshold) {
            if (value === null) return '';
            if (value >= threshold) return 'good';
            if (value >= threshold * 0.7) return 'medium';
            return 'bad';
        }
        
        function getColorClassInverse(value, threshold) {
            if (value === null) return '';
            if (value <= threshold) return 'good';
            if (value <= threshold * 1.2) return 'medium';
            return 'bad';
        }
        
        // ==================== STATS TAB ====================
        function setFilter(filter) {
            currentFilter = filter;
            document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
            document.querySelector(`.pill[data-filter="${filter}"]`).classList.add('active');
            
            document.getElementById('customDates').classList.toggle('show', filter === 'custom');
            
            if (filter !== 'custom') {
                updateStatsTab();
            }
        }
        
        function applyCustomFilter() {
            if (currentFilter === 'custom') {
                updateStatsTab();
            }
        }
        
        function getFilteredRounds() {
            const now = new Date();
            let fromDate;
            
            if (currentFilter === 'custom') {
                const from = document.getElementById('filterFrom').value;
                const to = document.getElementById('filterTo').value;
                if (from && to) {
                    return state.rounds.filter(r => {
                        const d = new Date(r.date);
                        return d >= new Date(from) && d <= new Date(to + 'T23:59:59');
                    });
                }
                return state.rounds;
            }
            
            switch (currentFilter) {
                case '6m': fromDate = new Date(now.setMonth(now.getMonth() - 6)); break;
                case '1y': fromDate = new Date(now.setFullYear(now.getFullYear() - 1)); break;
                default: return state.rounds;
            }
            
            return state.rounds.filter(r => new Date(r.date) >= fromDate);
        }
        
        function getUpDownColorClass(value) {
            if (value === null) return '';
            if (value >= 68) return 'good';
            if (value >= 55) return 'medium';
            return 'bad';
        }
        
        function getThreePuttColorClass(value) {
            if (value === null || isNaN(value)) return '';
            if (value < 1.0) return 'good';
            if (value <= 1.5) return 'medium';
            return 'bad';
        }
        
        function getBirdieColorClass(value) {
            if (value === null || isNaN(value)) return '';
            if (value >= 3.0) return 'good';
            if (value >= 2.0) return 'medium';
            return 'bad';
        }
        
        function updateStatsTab() {
            const rounds = getFilteredRounds();
            document.getElementById('statsRoundsCount').textContent = rounds.length;
            
            if (rounds.length === 0) {
                document.getElementById('statsRows').innerHTML = '<div class="empty-state"><div>No rounds in this period</div></div>';
                return;
            }
            
            // Aggregate stats
            let totalScore = 0, totalPar = 0, scores = [];
            let fwHit = 0, fwTotal = 0, girHit = 0, girTotal = 0;
            let totalPutts = 0, holesWithPutts = 0;
            let birdies = 0;
            let udMade = 0, udAttempts = 0;
            let gettableMade = 0, gettableTotal = 0;
            let par3Score = 0, par3Count = 0, par4Score = 0, par4Count = 0, par5Score = 0, par5Count = 0;
            let threePutts = 0;
            let scrambleSuccess = 0, scrambleAttempts = 0;
            let sandSavesMade = 0, sandSavesAttempts = 0;
            
            rounds.forEach(round => {
                const course = state.courses.find(c => c.id === round.courseId);
                const coursePar = getRoundPar(round);
                
                if (round.totalScore) {
                    totalScore += round.totalScore;
                    totalPar += coursePar;
                    scores.push(round.totalScore);
                }
                
                round.holes.forEach(h => {
                    if (h.score === null) return;
                    
                    const diff = h.score - h.par;
                    if (diff === -1) birdies++;
                    
                    // Auto-calculate GIR
                    const gir = calculateGIR(h.score, h.putts, h.par);
                    girTotal++;
                    if (gir) girHit++;
                    
                    if (h.par >= 4) {
                        fwTotal++;
                        if (h.fairway) fwHit++;
                    }
                    
                    if (h.putts !== null) {
                        totalPutts += h.putts;
                        holesWithPutts++;
                        if (h.putts >= 3) threePutts++;
                    }
                    
                    // Up & down
                    if (h.upDownAttempt === true) {
                        udAttempts++;
                        if (h.upDownMade === true) udMade++;
                        
                        // Sand saves
                        if (h.fromBunker) {
                            sandSavesAttempts++;
                            if (h.upDownMade === true) sandSavesMade++;
                        }
                    }
                    
                    // Gettable putts
                    gettableTotal += h.gettableTotal || 0;
                    gettableMade += h.gettableMade || 0;
                    
                    // Par type scoring
                    if (h.par === 3) { par3Score += diff; par3Count++; }
                    if (h.par === 4) { par4Score += diff; par4Count++; }
                    if (h.par === 5) { par5Score += diff; par5Count++; }
                    
                    // Scrambling
                    if (!gir) {
                        scrambleAttempts++;
                        if (diff <= 0) scrambleSuccess++;
                    }
                });
            });
            
            // Calculate averages
            const avgScore = scores.length > 0 ? (totalScore / scores.length).toFixed(1) : '--';
            const avgToPar = scores.length > 0 ? ((totalScore - totalPar) / scores.length).toFixed(1) : null;
            const avgToParStr = avgToPar !== null ? (avgToPar >= 0 ? '+' + avgToPar : avgToPar) : '';
            
            const fwPct = fwTotal > 0 ? Math.round(fwHit / fwTotal * 100) : null;
            const girPct = girTotal > 0 ? Math.round(girHit / girTotal * 100) : null;
            
            // Per-round averages for sub-text
            const fwPerRound = fwPct !== null ? Math.round(fwPct * 14 / 100) : null; // Based on standard 14 fairways
            const girPerRound = rounds.length > 0 ? Math.round(girHit / rounds.length) : null;
            
            const puttsPerRound = rounds.length > 0 && totalPutts > 0 ? (totalPutts / rounds.length).toFixed(1) : '--';
            const puttsPerHole = holesWithPutts > 0 ? (totalPutts / holesWithPutts).toFixed(2) : '--';
            const gettablePct = gettableTotal > 0 ? Math.round(gettableMade / gettableTotal * 100) : null;
            const udPct = udAttempts > 0 ? Math.round(udMade / udAttempts * 100) : null;
            const birdiesPerRound = rounds.length > 0 ? (birdies / rounds.length).toFixed(1) : '0';
            const threePuttsPerRound = rounds.length > 0 ? (threePutts / rounds.length).toFixed(2) : '--';
            const scramblePct = scrambleAttempts > 0 ? Math.round(scrambleSuccess / scrambleAttempts * 100) : null;
            const sandSavesPct = sandSavesAttempts > 0 ? Math.round(sandSavesMade / sandSavesAttempts * 100) : null;
            
            const par3Avg = par3Count > 0 ? (par3Score / par3Count).toFixed(1) : '--';
            const par4Avg = par4Count > 0 ? (par4Score / par4Count).toFixed(1) : '--';
            const par5Avg = par5Count > 0 ? (par5Score / par5Count).toFixed(1) : '--';
            
            // Build stats rows
            const stats = [
                { icon: '—', name: 'Scoring Avg', you: avgScore, youSub: avgToParStr, pga: '71.5', colorFn: null },
                { icon: '| |', name: 'Fairways', you: fwPct !== null ? fwPct + '%' : '--', youSub: fwPerRound !== null ? `${fwPerRound} of 14` : '', pga: '60%', color: getColorClass(fwPct, 60) },
                { icon: '◉', name: 'GIR', you: girPct !== null ? girPct + '%' : '--', youSub: girPerRound !== null ? `${girPerRound} of 18` : '', pga: '66%', color: getColorClass(girPct, 66) },
                { icon: '○', name: 'Putts/Round', you: puttsPerRound, youSub: '', pga: '29.0', color: getColorClassInverse(parseFloat(puttsPerRound), 29) },
                { icon: '◦', name: 'Putts/Hole', you: puttsPerHole, youSub: '', pga: '1.60', color: getColorClassInverse(parseFloat(puttsPerHole), 1.6) },
                { icon: '③', name: '3-Putts/Round', you: threePuttsPerRound, youSub: '', pga: '0.49', color: getThreePuttColorClass(parseFloat(threePuttsPerRound)) },
                { icon: '◐', name: 'Gettable Putts', nameSub: '(4-12ft)', you: gettablePct !== null ? gettablePct + '%' : '--', youSub: '', pga: '65%', color: getColorClass(gettablePct, 65) },
                { icon: 'S', name: 'Scrambling', you: scramblePct !== null ? scramblePct + '%' : '--', youSub: '', pga: '59%', color: getColorClass(scramblePct, 59) },
                { icon: '↕', name: 'Up & Down', nameSub: '(<15m from green)', you: udPct !== null ? udPct + '%' : '--', youSub: '', pga: '80%', color: getUpDownColorClass(udPct) },
                { icon: '🏖️', emoji: true, name: 'Sand Saves', you: sandSavesPct !== null ? sandSavesPct + '%' : '--', youSub: '', pga: '50%', color: getColorClass(sandSavesPct, 50) },
                { icon: '🐦', emoji: true, name: 'Birdies/Round', you: birdiesPerRound, youSub: '', pga: '3.9', color: getBirdieColorClass(parseFloat(birdiesPerRound)) },
                { icon: '③', name: 'Par 3s Avg', you: par3Avg !== '--' ? (parseFloat(par3Avg) >= 0 ? '+' : '') + par3Avg : '--', youSub: '', pga: '+0.1', colorFn: null },
                { icon: '④', name: 'Par 4s Avg', you: par4Avg !== '--' ? (parseFloat(par4Avg) >= 0 ? '+' : '') + par4Avg : '--', youSub: '', pga: 'E', colorFn: null },
                { icon: '⑤', name: 'Par 5s Avg', you: par5Avg !== '--' ? (parseFloat(par5Avg) >= 0 ? '+' : '') + par5Avg : '--', youSub: '', pga: '-0.6', colorFn: null }
            ];
            
            document.getElementById('statsRows').innerHTML = stats.map(s => `
                <div class="stat-row">
                    <div class="stat-left">
                        <div class="stat-icon ${s.emoji ? 'emoji' : ''}">${s.icon}</div>
                        <div>
                            <div class="stat-name">${s.name}</div>
                            ${s.nameSub ? `<div class="stat-name-sub">${s.nameSub}</div>` : ''}
                        </div>
                    </div>
                    <div class="stat-right">
                        <div class="stat-you-container">
                            <div class="stat-you ${s.color || ''}">${s.you}</div>
                            ${s.youSub ? `<div class="stat-you-sub">${s.youSub}</div>` : ''}
                        </div>
                        <span class="stat-pga">${s.pga}</span>
                    </div>
                </div>
            `).join('');
        }
        
        // ==================== HISTORY TAB ====================
        function updateHistoryTab() {
            document.getElementById('historyListView').classList.remove('hide');
            document.getElementById('historyDetail').classList.remove('show');
            
            if (state.rounds.length === 0) {
                document.getElementById('historyList').innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div>No rounds recorded yet</div></div>';
                return;
            }
            
            const sorted = [...state.rounds].reverse();
            document.getElementById('historyList').innerHTML = sorted.map((r, idx) => {
                const c = state.courses.find(x => x.id === r.courseId);
                const par = getRoundPar(r);
                const tp = r.totalScore - par;
                const tpStr = tp === 0 ? 'E' : (tp > 0 ? '+' + tp : tp);
                const d = new Date(r.date);
                return `<div class="list-item" onclick="showHistoryDetail(${state.rounds.length - 1 - idx})">
                    <div>
                        <div class="list-item-title">${escapeHtml(r.courseName)}</div>
                        <div class="list-item-sub">${d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                    </div>
                    <div class="list-item-right">
                        <div class="list-item-score">${r.totalScore || '--'}</div>
                        <div class="list-item-par">${tpStr}</div>
                    </div>
                </div>`;
            }).join('');
        }
        
        function showHistoryDetail(roundIndex) {
            const round = state.rounds[roundIndex];
            if (!round) return;
            
            document.getElementById('historyListView').classList.add('hide');
            document.getElementById('historyDetail').classList.add('show');
            
            const course = state.courses.find(c => c.id === round.courseId);
            const coursePar = course ? course.pars.reduce((a,b)=>a+b,0) : 72;
            const toPar = round.totalScore - coursePar;
            const toParStr = toPar === 0 ? 'E' : (toPar > 0 ? '+' + toPar : toPar);
            const d = new Date(round.date);
            
            const stats = calculateRoundStats(round);
            
            document.getElementById('historyDetailContent').innerHTML = `
                <div id="shareableContent" style="background:var(--bg);padding-bottom:24px;">
                    <div class="summary-header">
                        <div class="summary-title">${d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
                        <div class="summary-score">${round.totalScore || '--'}</div>
                        <div class="summary-to-par">${toParStr}</div>
                        <div class="summary-course">${escapeHtml(round.courseName)}</div>
                    </div>
                    <div class="section-header" style="margin-top:0;">
                        <span class="section-title">Scorecard</span>
                    </div>
                    <div class="scorecard-container show" style="margin-bottom:0;">
                        ${generateScorecardHTML(round, course, getPlayerLastName())}
                    </div>
                    <div class="section-header">
                        <span class="section-title">Statistics</span>
                    </div>
                    <div style="padding: 0 20px 0;">
                        ${generateStatsHTML(stats)}
                    </div>
                    <div style="text-align:center;padding:16px 20px 0;color:var(--text-faint);font-size:11px;">Lodge your stats ⛳</div>
                </div>
                <div style="padding: 0 20px 12px;">
                    <button class="btn btn-primary" onclick="shareRoundImage(event)">📤 Share Round</button>
                </div>
                <div style="padding: 0 20px 12px;">
                    <button class="btn btn-secondary" onclick="editRound(${roundIndex})">✏️ Edit Round</button>
                </div>
                <div style="padding: 0 20px 40px;">
                    <button class="btn btn-danger" onclick="deleteRound(${roundIndex})">Delete Round</button>
                </div>
            `;
        }
        
        // Load the bundled html2canvas only when it's actually needed (first share).
        function ensureHtml2Canvas() {
            if (window.html2canvas) return Promise.resolve();
            return new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'html2canvas.min.js';
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('Could not load the image library.'));
                document.head.appendChild(s);
            });
        }

        async function shareRoundImage(event) {
            const element = document.getElementById('shareableContent');
            if (!element) return;

            try {
                // Show loading state
                const shareBtn = event.target;
                const originalText = shareBtn.textContent;
                shareBtn.textContent = 'Generating...';
                shareBtn.disabled = true;

                // Make sure the screenshot library is loaded (lazy-loaded on first use)
                await ensureHtml2Canvas();

                // Capture the element as canvas
                const canvas = await html2canvas(element, {
                    backgroundColor: '#fafaf9',
                    scale: 2,
                    logging: false,
                    useCORS: true
                });
                
                // Convert to blob
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                
                // Check if native share is available with files
                if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'round.png', { type: 'image/png' })] })) {
                    const file = new File([blob], 'golf-round.png', { type: 'image/png' });
                    await navigator.share({
                        files: [file],
                        title: 'My Golf Round',
                        text: 'Check out my golf round!'
                    });
                } else {
                    // Fallback: download the image
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'golf-round.png';
                    a.click();
                    URL.revokeObjectURL(url);
                    alert('Image downloaded! You can share it manually.');
                }
                
                shareBtn.textContent = originalText;
                shareBtn.disabled = false;
            } catch (err) {
                console.error('Share failed:', err);
                alert('Unable to share. Please try again.');
                event.target.textContent = '📤 Share Round';
                event.target.disabled = false;
            }
        }
        
        function deleteRound(roundIndex) {
            if (!confirm('Are you sure you want to permanently delete this round? This cannot be undone.')) return;
            
            state.rounds.splice(roundIndex, 1);
            saveState();
            
            hideHistoryDetail();
            updateHistoryTab();
            updateStatsTab();
            updateHomeTab();
        }
        
        function editRound(roundIndex) {
            const round = state.rounds[roundIndex];
            if (!round) return;
            
            // Check if there's already a round in progress
            if (state.currentRound) {
                if (!confirm('You have a round in progress. Editing this round will discard any unsaved progress. Continue?')) {
                    return;
                }
            }
            
            // Deep copy the round data to currentRound for editing
            state.currentRound = JSON.parse(JSON.stringify(round));
            editingRoundIndex = roundIndex;
            state.editingRoundIndex = roundIndex;
            currentHoleIndex = 0;
            scorecardVisible = false;
            document.getElementById('scorecardContainer').classList.remove('show');
            document.getElementById('playActive').classList.remove('scorecard-open');
            document.getElementById('playTab').classList.remove('scorecard-open');
            finishAttempted = false;
            
            saveState();
            
            // Hide history detail and switch to play tab
            hideHistoryDetail();
            showTab('playTab');
        }
        
        function hideHistoryDetail() {
            document.getElementById('historyListView').classList.remove('hide');
            document.getElementById('historyDetail').classList.remove('show');
        }
        
        function showRoundDetail(roundIndex) {
            showTab('historyTab');
            setTimeout(() => showHistoryDetail(roundIndex), 100);
        }
        
        // ==================== COURSES TAB ====================
        function updateCoursesTab() {
            updateCourseSelect();

            // Reset the add/edit form each time this tab is (re)opened
            editingCourseId = null;
            document.getElementById('courseFormTitle').textContent = 'Add New Course';
            document.getElementById('courseFormBtn').textContent = 'Add Course';
            document.getElementById('newCourseName').value = '';
            document.getElementById('newCoursePars').value = '';

            if (state.courses.length === 0) {
                document.getElementById('coursesList').innerHTML = '<div class="empty-state"><div>No courses added yet</div></div>';
                return;
            }
            
            document.getElementById('coursesList').innerHTML = state.courses.map(c => `
                <div class="course-item">
                    <div>
                        <div class="course-name">${escapeHtml(c.name)}</div>
                        <div class="course-par">Par ${c.pars.reduce((a,b)=>a+b,0)}</div>
                    </div>
                    <div class="course-actions">
                        <div class="course-edit" onclick="editCourse(${c.id})">✏️</div>
                        <div class="course-delete" onclick="deleteCourse(${c.id})">🗑️</div>
                    </div>
                </div>
            `).join('');
        }
        
        function updateCourseSelect() {
            const select = document.getElementById('courseSelect');
            select.innerHTML = '<option value="">Choose a course...</option>' + 
                state.courses.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (Par ${c.pars.reduce((a,b)=>a+b,0)})</option>`).join('');
        }
        
        function addCourse() {
            const name = document.getElementById('newCourseName').value.trim();
            const parsStr = document.getElementById('newCoursePars').value.trim();
            
            if (!name) { alert('Please enter a course name'); return; }
            if (!parsStr) { alert('Please enter the pars'); return; }
            
            const pars = parsStr.split(',').map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p >= 3 && p <= 5);
            if (pars.length !== 18) { alert('Please enter exactly 18 valid pars (3, 4, or 5)'); return; }

            if (editingCourseId !== null) {
                // Save edits to an existing course. Past rounds keep their own
                // stored pars, so their scores are unaffected.
                const course = state.courses.find(c => c.id === editingCourseId);
                if (course) { course.name = name; course.pars = pars; }
            } else {
                state.courses.push({ id: Date.now(), name, pars });
            }
            saveState();

            updateCoursesTab(); // re-renders list and clears/resets the form
        }

        function editCourse(id) {
            const course = state.courses.find(c => c.id === id);
            if (!course) return;
            editingCourseId = id;
            document.getElementById('newCourseName').value = course.name;
            document.getElementById('newCoursePars').value = course.pars.join(',');
            document.getElementById('courseFormTitle').textContent = 'Edit Course';
            document.getElementById('courseFormBtn').textContent = 'Save Changes';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        
        function deleteCourse(id) {
            if (!confirm('Delete this course?')) return;
            state.courses = state.courses.filter(c => c.id !== id);
            saveState();
            updateCoursesTab();
        }
        
        // ==================== PLAY TAB ====================
        function updatePlayTab() {
            updateCourseSelect();
            if (!state.currentRound) {
                document.getElementById('playSetup').style.display = 'block';
                document.getElementById('playActive').style.display = 'none';
                document.getElementById('mainHeader').style.display = 'block';
                document.body.classList.remove('play-active');
            } else {
                document.getElementById('playSetup').style.display = 'none';
                document.getElementById('playActive').style.display = 'flex';
                document.getElementById('mainHeader').style.display = 'none';
                renderScorecard();
                renderCurrentHole();
                updateLiveScore();
                // Lock body scroll when round is active and scorecard is closed
                if (!scorecardVisible) {
                    document.body.classList.add('play-active');
                }
            }
        }
        
        function onCourseSelect() {
            const val = document.getElementById('courseSelect').value;
            document.getElementById('startRoundBtn').disabled = !val;
        }
        
        function startNewRound() {
            showTab('playTab');
        }
        
        function beginRound() {
            const courseId = parseInt(document.getElementById('courseSelect').value);
            const course = state.courses.find(c => c.id === courseId);
            if (!course) return;
            
            state.currentRound = {
                courseId,
                courseName: course.name,
                date: new Date().toISOString(),
                holes: course.pars.map((par, i) => ({
                    hole: i + 1,
                    par,
                    score: 0,
                    fairway: null,
                    putts: 0,
                    gettableMade: 0,
                    gettableTotal: 0,
                    upDownAttempt: null,
                    upDownMade: null,
                    fromBunker: false
                }))
            };
            
            currentHoleIndex = 0;
            scorecardVisible = false;
            document.getElementById('scorecardContainer').classList.remove('show');
            document.getElementById('playActive').classList.remove('scorecard-open');
            document.getElementById('playTab').classList.remove('scorecard-open');
            finishAttempted = false;
            editingRoundIndex = null;
            state.editingRoundIndex = null;
            saveState();
            updatePlayTab();
        }
        
        function toggleScorecard() {
            scorecardVisible = !scorecardVisible;
            document.getElementById('scorecardContainer').classList.toggle('show', scorecardVisible);
            document.getElementById('playActive').classList.toggle('scorecard-open', scorecardVisible);
            document.getElementById('playTab').classList.toggle('scorecard-open', scorecardVisible);
            document.getElementById('scorecardToggleBtn').textContent = scorecardVisible ? 'Hide Scorecard' : 'View Scorecard';
            
            // Control body scroll - unlock when scorecard is open, lock when closed
            if (scorecardVisible) {
                document.body.classList.remove('play-active');
                renderScorecard();
            } else {
                document.body.classList.add('play-active');
            }
        }
        
        function toggleMenu(event) {
            event.stopPropagation();
            const dropdown = document.getElementById('menuDropdown');
            dropdown.classList.toggle('show');
        }
        
        function closeMenuAndAbandon() {
            document.getElementById('menuDropdown').classList.remove('show');
            abandonRound();
        }
        
        // Close menu when clicking outside
        document.addEventListener('click', function(event) {
            const dropdown = document.getElementById('menuDropdown');
            if (dropdown && !event.target.closest('.menu-container')) {
                dropdown.classList.remove('show');
            }
        });

        // Press Escape (or Android back) to close an open pop-up dialog or menu.
        document.addEventListener('keydown', function(event) {
            if (event.key !== 'Escape') return;
            const openModal = document.querySelector('.modal-overlay.show');
            if (openModal) { openModal.classList.remove('show'); return; }
            const menu = document.getElementById('menuDropdown');
            if (menu && menu.classList.contains('show')) menu.classList.remove('show');
        });
        
        function renderScorecard() {
            if (!state.currentRound) return;
            const course = state.courses.find(c => c.id === state.currentRound.courseId);
            const playerName = getPlayerLastName();
            const content = generatePlayScorecardContent(state.currentRound, course, playerName);
            document.getElementById('classicScorecardFront').innerHTML = content.front;
            document.getElementById('classicScorecardBack').innerHTML = content.back;
        }
        
        function getPlayerLastName() {
            if (state.profile && state.profile.name && state.profile.name.trim()) {
                const parts = state.profile.name.trim().split(' ');
                return parts[parts.length - 1].toUpperCase();
            }
            return null;
        }
        
        function goToHole(holeNum) {
            const targetIndex = holeNum - 1;
            if (targetIndex === currentHoleIndex) return;
            
            // Complete any pending animation immediately
            if (animationInProgress) {
                completePendingAnimation();
            }
            
            const track = document.getElementById('carouselTrack');
            const goingForward = targetIndex > currentHoleIndex;
            
            // Animate in the direction of travel
            track.style.transform = `translateX(${goingForward ? '-66.666%' : '0%'})`;
            
            // Set up pending animation
            animationInProgress = true;
            pendingHoleChange = { direction: targetIndex, celebration: null };
            
            pendingAnimationTimeout = setTimeout(() => {
                currentHoleIndex = targetIndex;
                pendingCelebration = null;
                renderCarouselPanels();
                updateProgressBar();
                updateScorecard();
                
                animationInProgress = false;
                pendingHoleChange = null;
                pendingAnimationTimeout = null;
                
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }, 150);
        }
        
        function generateScorecardHTML(round, course, playerName) {
            const content = generateScorecardTableContentSplit(round, course, playerName);
            return `
                <div class="masters-scoreboard-scene">
                    <div class="masters-scoreboard">
                        <div class="masters-post-left"></div>
                        <div class="masters-board-wrapper">
                            <!-- Front 9 Section -->
                            <div class="masters-board masters-board-top">
                                <div class="masters-leaders-header"><span>LEADERS</span></div>
                                <table class="classic-scorecard">${content.front}</table>
                            </div>
                            <!-- Back 9 Section -->
                            <div class="masters-board masters-board-bottom">
                                <table class="classic-scorecard">${content.back}</table>
                            </div>
                        </div>
                        <div class="masters-post-right"></div>
                    </div>
                </div>
            `;
        }
        
        function generatePlayScorecardContent(round, course, playerName) {
            const front9 = round.holes.slice(0, 9);
            const back9 = round.holes.slice(9, 18);
            const nameLabel = playerName ? escapeHtml(playerName) : 'TO PAR';
            
            function isHoleIncomplete(hole) {
                if (hole.score === 0 || hole.score === null) return true;
                // Only check other fields if score has been entered
                if (hole.par >= 4 && hole.fairway === null) return true;
                if (hole.upDownAttempt === true && hole.upDownMade === null) return true;
                return false;
            }
            
            function getHoleCellStyle(hole) {
                const incomplete = isHoleIncomplete(hole);
                if (finishAttempted && incomplete) {
                    return 'background:#BA0C2F;color:#fff;';
                }
                return '';
            }
            
            function getScoreDisplay(hole) {
                if (hole.score === null || hole.score === 0) return '-';
                const diff = hole.score - hole.par;
                if (diff <= -2) return `<span class="eagle">${hole.score}</span>`;
                if (diff === -1) return `<span class="birdie">${hole.score}</span>`;
                if (diff === 1) return `<span class="bogey">${hole.score}</span>`;
                if (diff >= 2) return `<span class="double-bogey">${hole.score}</span>`;
                return hole.score;
            }
            
            function getToParDisplay(toPar) {
                if (toPar === 0) return '<span class="even-par">E</span>';
                if (toPar < 0) return `<span class="under-par">${Math.abs(toPar)}</span>`;
                return `<span class="over-par">${toPar}</span>`;
            }
            
            // Calculate cumulative to par for front 9
            const front9Cumulative = front9.map((h, i) => {
                if (h.score === null || h.score === 0) return '-';
                let cum = 0;
                for (let j = 0; j <= i; j++) {
                    if (front9[j].score > 0) cum += front9[j].score - front9[j].par;
                }
                if (cum === 0) return '<span class="even-par">E</span>';
                if (cum < 0) return `<span class="under-par">${Math.abs(cum)}</span>`;
                return `<span class="over-par">${cum}</span>`;
            });
            
            // Calculate cumulative to par for back 9 (continuing from front 9)
            const back9Cumulative = back9.map((h, i) => {
                if (h.score === null || h.score === 0) return '-';
                let cum = 0;
                for (let j = 0; j < 9; j++) {
                    if (front9[j].score > 0) cum += front9[j].score - front9[j].par;
                }
                for (let j = 0; j <= i; j++) {
                    if (back9[j].score > 0) cum += back9[j].score - back9[j].par;
                }
                if (cum === 0) return '<span class="even-par">E</span>';
                if (cum < 0) return `<span class="under-par">${Math.abs(cum)}</span>`;
                return `<span class="over-par">${cum}</span>`;
            });
            
            // Calculate front 9 totals
            const front9ParTotal = front9.reduce((sum, h) => sum + h.par, 0);
            const front9ScoreTotal = front9.reduce((sum, h) => sum + (h.score || 0), 0);
            const front9HasAllScores = front9.every(h => h.score > 0);
            const front9ToPar = front9ScoreTotal - front9ParTotal;
            
            // Calculate back 9 totals
            const back9ParTotal = back9.reduce((sum, h) => sum + h.par, 0);
            const back9ScoreTotal = back9.reduce((sum, h) => sum + (h.score || 0), 0);
            const back9HasAllScores = back9.every(h => h.score > 0);
            const back9ToPar = back9ScoreTotal - back9ParTotal;
            
            // Calculate total
            const totalPar = front9ParTotal + back9ParTotal;
            const totalScore = front9ScoreTotal + back9ScoreTotal;
            const allHolesScored = front9HasAllScores && back9HasAllScores;
            const totalToPar = totalScore - totalPar;
            
            // Front 9 HTML
            const front = `
                <tr class="hole-header">
                    <th class="label-cell">HOLE</th>
                    ${front9.map(h => `<th class="hole-num-cell" onclick="goToHole(${h.hole})" style="${getHoleCellStyle(h)}">${h.hole}</th>`).join('')}
                    <th class="total-cell">OUT</th>
                    <th class="total-cell"></th>
                </tr>
                <tr class="par-row">
                    <td class="label-cell">PAR</td>
                    ${front9.map(h => `<td>${h.par}</td>`).join('')}
                    <td class="total-cell">${front9ParTotal}</td>
                    <td class="total-cell"></td>
                </tr>
                <tr class="score-row">
                    <td class="label-cell">SCORE</td>
                    ${front9.map(h => `<td class="score-cell">${getScoreDisplay(h)}</td>`).join('')}
                    <td class="total-cell">${front9HasAllScores ? front9ScoreTotal : '-'}</td>
                    <td class="total-cell"></td>
                </tr>
                <tr class="cumulative-row">
                    <td class="label-cell">${nameLabel}</td>
                    ${front9Cumulative.map(c => `<td>${c}</td>`).join('')}
                    <td class="total-cell">${front9HasAllScores ? getToParDisplay(front9ToPar) : '-'}</td>
                    <td class="total-cell"></td>
                </tr>
            `;
            
            // Back 9 HTML
            const back = `
                <tr class="hole-header">
                    <th class="label-cell">HOLE</th>
                    ${back9.map(h => `<th class="hole-num-cell" onclick="goToHole(${h.hole})" style="${getHoleCellStyle(h)}">${h.hole}</th>`).join('')}
                    <th class="total-cell">IN</th>
                    <th class="total-cell">TOT</th>
                </tr>
                <tr class="par-row">
                    <td class="label-cell">PAR</td>
                    ${back9.map(h => `<td>${h.par}</td>`).join('')}
                    <td class="total-cell">${back9ParTotal}</td>
                    <td class="total-cell">${totalPar}</td>
                </tr>
                <tr class="score-row">
                    <td class="label-cell">SCORE</td>
                    ${back9.map(h => `<td class="score-cell">${getScoreDisplay(h)}</td>`).join('')}
                    <td class="total-cell">${back9HasAllScores ? back9ScoreTotal : '-'}</td>
                    <td class="total-cell">${allHolesScored ? totalScore : '-'}</td>
                </tr>
                <tr class="cumulative-row">
                    <td class="label-cell">${nameLabel}</td>
                    ${back9Cumulative.map(c => `<td>${c}</td>`).join('')}
                    <td class="total-cell">${back9HasAllScores ? getToParDisplay(back9ToPar) : '-'}</td>
                    <td class="total-cell">${allHolesScored ? getToParDisplay(totalToPar) : '-'}</td>
                </tr>
            `;
            
            return { front, back };
        }
        
        function generateScorecardTableContentSplit(round, course, playerName) {
            const holes = round.holes;
            const front9 = holes.slice(0, 9);
            const back9 = holes.slice(9, 18);
            const nameLabel = playerName ? escapeHtml(playerName) : 'TO PAR';
            
            function getScoreDisplay(hole) {
                if (hole.score === null || hole.score === 0) return '-';
                const diff = hole.score - hole.par;
                if (diff <= -2) return `<span class="eagle">${hole.score}</span>`;
                if (diff === -1) return `<span class="birdie">${hole.score}</span>`;
                if (diff === 1) return `<span class="bogey">${hole.score}</span>`;
                if (diff >= 2) return `<span class="double-bogey">${hole.score}</span>`;
                return hole.score;
            }
            
            function getToParDisplay(toPar) {
                if (toPar === 0) return '<span class="even-par">E</span>';
                if (toPar < 0) return `<span class="under-par">${Math.abs(toPar)}</span>`;
                return `<span class="over-par">${toPar}</span>`;
            }
            
            // Calculate cumulative to par for front 9
            const front9Cumulative = front9.map((h, i) => {
                if (h.score === null || h.score === 0) return '-';
                let cum = 0;
                for (let j = 0; j <= i; j++) {
                    if (front9[j].score > 0) cum += front9[j].score - front9[j].par;
                }
                if (cum === 0) return '<span class="even-par">E</span>';
                if (cum < 0) return `<span class="under-par">${Math.abs(cum)}</span>`;
                return `<span class="over-par">${cum}</span>`;
            });
            
            // Calculate cumulative to par for back 9 (continuing from front 9)
            const back9Cumulative = back9.map((h, i) => {
                if (h.score === null || h.score === 0) return '-';
                let cum = 0;
                for (let j = 0; j < 9; j++) {
                    if (front9[j].score > 0) cum += front9[j].score - front9[j].par;
                }
                for (let j = 0; j <= i; j++) {
                    if (back9[j].score > 0) cum += back9[j].score - back9[j].par;
                }
                if (cum === 0) return '<span class="even-par">E</span>';
                if (cum < 0) return `<span class="under-par">${Math.abs(cum)}</span>`;
                return `<span class="over-par">${cum}</span>`;
            });
            
            // Calculate front 9 totals
            const front9ParTotal = front9.reduce((sum, h) => sum + h.par, 0);
            const front9ScoreTotal = front9.reduce((sum, h) => sum + (h.score || 0), 0);
            const front9HasAllScores = front9.every(h => h.score > 0);
            const front9ToPar = front9ScoreTotal - front9ParTotal;
            
            // Calculate back 9 totals
            const back9ParTotal = back9.reduce((sum, h) => sum + h.par, 0);
            const back9ScoreTotal = back9.reduce((sum, h) => sum + (h.score || 0), 0);
            const back9HasAllScores = back9.every(h => h.score > 0);
            const back9ToPar = back9ScoreTotal - back9ParTotal;
            
            // Calculate total
            const totalPar = front9ParTotal + back9ParTotal;
            const totalScore = front9ScoreTotal + back9ScoreTotal;
            const allHolesScored = front9HasAllScores && back9HasAllScores;
            const totalToPar = totalScore - totalPar;
            
            const front = `
                <tr class="hole-header">
                    <th class="label-cell">HOLE</th>
                    ${front9.map(h => `<th>${h.hole}</th>`).join('')}
                    <th class="total-cell">OUT</th>
                    <th class="total-cell"></th>
                </tr>
                <tr class="par-row">
                    <td class="label-cell">PAR</td>
                    ${front9.map(h => `<td>${h.par}</td>`).join('')}
                    <td class="total-cell">${front9ParTotal}</td>
                    <td class="total-cell"></td>
                </tr>
                <tr class="score-row">
                    <td class="label-cell">SCORE</td>
                    ${front9.map(h => `<td class="score-cell">${getScoreDisplay(h)}</td>`).join('')}
                    <td class="total-cell">${front9HasAllScores ? front9ScoreTotal : '-'}</td>
                    <td class="total-cell"></td>
                </tr>
                <tr class="cumulative-row">
                    <td class="label-cell">${nameLabel}</td>
                    ${front9Cumulative.map(c => `<td>${c}</td>`).join('')}
                    <td class="total-cell">${front9HasAllScores ? getToParDisplay(front9ToPar) : '-'}</td>
                    <td class="total-cell"></td>
                </tr>
            `;
            
            const back = `
                <tr class="hole-header">
                    <th class="label-cell">HOLE</th>
                    ${back9.map(h => `<th>${h.hole}</th>`).join('')}
                    <th class="total-cell">IN</th>
                    <th class="total-cell">TOT</th>
                </tr>
                <tr class="par-row">
                    <td class="label-cell">PAR</td>
                    ${back9.map(h => `<td>${h.par}</td>`).join('')}
                    <td class="total-cell">${back9ParTotal}</td>
                    <td class="total-cell">${totalPar}</td>
                </tr>
                <tr class="score-row">
                    <td class="label-cell">SCORE</td>
                    ${back9.map(h => `<td class="score-cell">${getScoreDisplay(h)}</td>`).join('')}
                    <td class="total-cell">${back9HasAllScores ? back9ScoreTotal : '-'}</td>
                    <td class="total-cell">${allHolesScored ? totalScore : '-'}</td>
                </tr>
                <tr class="cumulative-row">
                    <td class="label-cell">${nameLabel}</td>
                    ${back9Cumulative.map(c => `<td>${c}</td>`).join('')}
                    <td class="total-cell">${back9HasAllScores ? getToParDisplay(back9ToPar) : '-'}</td>
                    <td class="total-cell">${allHolesScored ? getToParDisplay(totalToPar) : '-'}</td>
                </tr>
            `;
            
            return { front, back };
        }
        
        function generateStatsHTML(stats) {
            // Color functions for round summary
            function getColor(value, threshold) {
                if (value === null) return '';
                if (value >= threshold) return 'color:#107D57;';
                if (value >= threshold * 0.7) return 'color:var(--medium);';
                return 'color:var(--masters-red);';
            }
            function getColorInv(value, threshold) {
                if (value === null) return '';
                if (value <= threshold) return 'color:#107D57;';
                if (value <= threshold * 1.2) return 'color:var(--medium);';
                return 'color:var(--masters-red);';
            }
            function getUDColor(value) {
                if (value === null) return '';
                if (value >= 68) return 'color:#107D57;';
                if (value >= 55) return 'color:var(--medium);';
                return 'color:var(--masters-red);';
            }
            
            return `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div style="background:#ffffff;padding:12px;border-radius:10px;border:1px solid #e8e8e8;">
                        <div style="font-size:10px;color:var(--masters-green);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Fairways</div>
                        <div style="font-size:18px;font-weight:600;${getColor(stats.fwPct, 60)}">${stats.fwPct !== null ? stats.fwPct + '%' : '--'}</div>
                        <div style="font-size:11px;color:var(--text-faint);">${stats.fwHit} of ${stats.fwTotal}</div>
                    </div>
                    <div style="background:#fafafa;padding:12px;border-radius:10px;border:1px solid #e8e8e8;">
                        <div style="font-size:10px;color:var(--masters-green);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">GIR</div>
                        <div style="font-size:18px;font-weight:600;${getColor(stats.girPct, 66)}">${stats.girPct !== null ? stats.girPct + '%' : '--'}</div>
                        <div style="font-size:11px;color:var(--text-faint);">${stats.girHit} of ${stats.girTotal}</div>
                    </div>
                    <div style="background:#fafafa;padding:12px;border-radius:10px;border:1px solid #e8e8e8;">
                        <div style="font-size:10px;color:var(--masters-green);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Putts</div>
                        <div style="font-size:18px;font-weight:600;${getColorInv(stats.totalPutts, 29)}">${stats.totalPutts || '--'}</div>
                        <div style="font-size:11px;color:var(--text-faint);">${stats.puttsPerHole || '--'}/hole</div>
                    </div>
                    <div style="background:#ffffff;padding:12px;border-radius:10px;border:1px solid #e8e8e8;">
                        <div style="font-size:10px;color:var(--masters-green);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">3-Putts</div>
                        <div style="font-size:18px;font-weight:600;${stats.threePutts < 1 ? 'color:#107D57;' : stats.threePutts <= 1.5 ? 'color:var(--medium);' : 'color:var(--masters-red);'}">${stats.threePutts}</div>
                        <div style="font-size:11px;color:var(--text-faint);">&nbsp;</div>
                    </div>
                    <div style="background:#ffffff;padding:12px;border-radius:10px;border:1px solid #e8e8e8;">
                        <div style="font-size:10px;color:var(--masters-green);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Gettable Putts</div>
                        <div style="font-size:18px;font-weight:600;${getColor(stats.gettablePct, 65)}">${stats.gettablePct !== null ? stats.gettablePct + '%' : '--'}</div>
                        <div style="font-size:11px;color:var(--text-faint);">${stats.gettableMade} of ${stats.gettableTotal}</div>
                    </div>
                    <div style="background:#fafafa;padding:12px;border-radius:10px;border:1px solid #e8e8e8;">
                        <div style="font-size:10px;color:var(--masters-green);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Up & Down</div>
                        <div style="font-size:18px;font-weight:600;${getUDColor(stats.udPct)}">${stats.udPct !== null ? stats.udPct + '%' : '--'}</div>
                        <div style="font-size:11px;color:var(--text-faint);">${stats.udMade} of ${stats.udAttempts}</div>
                    </div>
                    <div style="background:#fafafa;padding:12px;border-radius:10px;border:1px solid #e8e8e8;">
                        <div style="font-size:10px;color:var(--masters-green);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Scrambling</div>
                        <div style="font-size:18px;font-weight:600;${getColor(stats.scramblePct, 59)}">${stats.scramblePct !== null ? stats.scramblePct + '%' : '--'}</div>
                        <div style="font-size:11px;color:var(--text-faint);">${stats.scrambleSuccess} of ${stats.scrambleAttempts}</div>
                    </div>
                    <div style="background:#ffffff;padding:12px;border-radius:10px;border:1px solid #e8e8e8;">
                        <div style="font-size:10px;color:var(--masters-green);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">🏖️ Sand Saves</div>
                        <div style="font-size:18px;font-weight:600;${getColor(stats.sandSavesPct, 50)}">${stats.sandSavesPct !== null ? stats.sandSavesPct + '%' : '--'}</div>
                        <div style="font-size:11px;color:var(--text-faint);">${stats.sandSavesMade} of ${stats.sandSavesAttempts}</div>
                    </div>
                    <div style="background:#ffffff;padding:12px;border-radius:10px;border:1px solid #e8e8e8;">
                        <div style="font-size:10px;color:var(--masters-green);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">🐦 Birdies</div>
                        <div style="font-size:18px;font-weight:600;${stats.birdies >= 3 ? 'color:#107D57;' : stats.birdies >= 2 ? 'color:var(--medium);' : 'color:var(--masters-red);'}">${stats.birdies}</div>
                        <div style="font-size:11px;color:var(--text-faint);">${stats.eagles > 0 ? '+' + stats.eagles + ' eagles 🦅' : ''}</div>
                    </div>
                </div>
            `;
        }
        
        function renderCurrentHole() {
            // Render all three carousel panels
            renderCarouselPanels();
            
            // Progress
            document.getElementById('progressFill').style.width = ((currentHoleIndex + 1) / 18 * 100) + '%';
            const isEditing = editingRoundIndex !== null;
            document.getElementById('progressText').textContent = isEditing 
                ? `Editing: Hole ${currentHoleIndex + 1} of 18` 
                : `Hole ${currentHoleIndex + 1} of 18`;
            
            // Update scorecard if visible
            if (scorecardVisible) renderScorecard();
        }
        
        function renderCarouselPanels() {
            // Render previous panel (if exists)
            const prevPanel = document.getElementById('panelPrev');
            if (currentHoleIndex > 0) {
                prevPanel.innerHTML = generateHoleContentHTML(currentHoleIndex - 1);
            } else {
                prevPanel.innerHTML = '';
            }
            
            // Render current panel
            const currentPanel = document.getElementById('panelCurrent');
            currentPanel.innerHTML = generateHoleContentHTML(currentHoleIndex);
            
            // Render next panel (if exists)
            const nextPanel = document.getElementById('panelNext');
            if (currentHoleIndex < 17) {
                nextPanel.innerHTML = generateHoleContentHTML(currentHoleIndex + 1);
            } else {
                nextPanel.innerHTML = '';
            }
            
            // Reset carousel position (center panel visible)
            const track = document.getElementById('carouselTrack');
            track.classList.add('no-transition');
            track.style.transform = 'translateX(-33.333%)';
            // Force reflow
            track.offsetHeight;
            track.classList.remove('no-transition');
        }
        
        function adjustScore(delta) {
            const hole = state.currentRound.holes[currentHoleIndex];
            const newScore = hole.score + delta;
            if (newScore < 0 || newScore > 15) return;
            
            hole.score = newScore;
            
            // Check for pending celebration (will trigger on next hole)
            if (newScore > 0) {
                const diff = hole.score - hole.par;
                if (diff === -1) {
                    pendingCelebration = 'birdie';
                } else if (diff <= -2) {
                    pendingCelebration = 'eagle';
                } else {
                    pendingCelebration = null;
                }
            } else {
                pendingCelebration = null;
            }
            
            saveState();
            renderCurrentHole();
            updateLiveScore();
        }
        
        function setFairway(value) {
            state.currentRound.holes[currentHoleIndex].fairway = value;
            saveState();
            renderCurrentHole();
        }
        
        function adjustPutts(delta) {
            const hole = state.currentRound.holes[currentHoleIndex];
            const newVal = (hole.putts || 0) + delta;
            if (newVal < 0 || newVal > 10) return;
            hole.putts = newVal;
            saveState();
            renderCurrentHole();
        }
        
        function adjustGettableMade(delta) {
            const hole = state.currentRound.holes[currentHoleIndex];
            const newVal = (hole.gettableMade || 0) + delta;
            if (newVal < 0 || newVal > 1) return;
            hole.gettableMade = newVal;
            
            // If made is 1, ensure total is at least 1
            if (newVal === 1 && hole.gettableTotal < 1) {
                hole.gettableTotal = 1;
            }
            
            saveState();
            renderCurrentHole();
        }
        
        function adjustGettableTotal(delta) {
            const hole = state.currentRound.holes[currentHoleIndex];
            const newVal = (hole.gettableTotal || 0) + delta;
            if (newVal < 0) return;
            
            // Can't reduce total below made
            if (newVal < hole.gettableMade) return;
            
            hole.gettableTotal = newVal;
            saveState();
            renderCurrentHole();
        }
        
        function setUpDownAttempt(value) {
            const hole = state.currentRound.holes[currentHoleIndex];
            hole.upDownAttempt = value;
            if (value === false || value === null) {
                hole.upDownMade = null;
                hole.fromBunker = false;
            }
            saveState();
            renderCurrentHole();
        }
        
        function toggleUpDownAttempt() {
            const hole = state.currentRound.holes[currentHoleIndex];
            // Toggle between true and null
            if (hole.upDownAttempt === true) {
                hole.upDownAttempt = null;
                hole.upDownMade = null;
                hole.fromBunker = false;
            } else {
                hole.upDownAttempt = true;
            }
            saveState();
            renderCurrentHole();
        }
        
        function setUpDownMade(value) {
            state.currentRound.holes[currentHoleIndex].upDownMade = value;
            saveState();
            renderCurrentHole();
        }
        
        function setFromBunker() {
            const hole = state.currentRound.holes[currentHoleIndex];
            hole.fromBunker = !hole.fromBunker;
            saveState();
            renderCurrentHole();
        }
        
        function updateLiveScore() {
            let total = 0, par = 0;
            state.currentRound.holes.forEach(h => {
                if (h.score > 0) {
                    total += h.score;
                    par += h.par;
                }
            });
            const diff = total - par;
            document.getElementById('liveScore').textContent = diff === 0 ? 'E' : (diff > 0 ? '+' + diff : diff);
        }
        
        function finishRound() {
            // Validate mandatory fields
            const incompleteHoles = [];
            state.currentRound.holes.forEach((h, idx) => {
                const issues = [];
                if (h.score === 0 || h.score === null) {
                    issues.push('score');
                } else {
                    // Only validate other fields if score has been entered
                    if (h.par >= 4 && h.fairway === null) issues.push('fairway');
                    if (h.upDownAttempt === true && h.upDownMade === null) issues.push('up&down made');
                }
                if (issues.length > 0) {
                    incompleteHoles.push({ hole: idx + 1, issues });
                }
            });
            
            if (incompleteHoles.length > 0) {
                finishAttempted = true;
                // Refresh scorecard to show red highlighting
                if (scorecardVisible) renderScorecard();
                showIncompleteModal(incompleteHoles);
                return;
            }
            
            const isEditing = editingRoundIndex !== null;
            
            let total = 0;
            state.currentRound.holes.forEach(h => total += h.score);
            state.currentRound.totalScore = total;
            
            const finishedRound = { ...state.currentRound };
            
            if (isEditing) {
                // Update existing round
                state.rounds[editingRoundIndex] = finishedRound;
                editingRoundIndex = null;
                state.editingRoundIndex = null;
            } else {
                // Add new round
                state.rounds.push(finishedRound);
            }
            
            state.currentRound = null;
            finishAttempted = false;
            
            saveState();
            
            document.getElementById('courseSelect').value = '';
            document.getElementById('startRoundBtn').disabled = true;
            
            // Show round summary
            showRoundSummary(finishedRound);
        }
        
        function showFinishConfirmation() {
            const m = document.getElementById('finishModal');
            m.classList.add('show');
            m.querySelector('.modal-btn.primary').focus();
        }
        
        function closeFinishModal() {
            document.getElementById('finishModal').classList.remove('show');
        }
        
        function confirmFinishRound() {
            closeFinishModal();
            finishRound();
        }
        
        function showIncompleteModal(incompleteHoles) {
            const modal = document.getElementById('incompleteModal');
            document.getElementById('incompleteHolesList').innerHTML = incompleteHoles.map(h => 
                `<div style="padding:8px 0;border-bottom:1px solid var(--border);"><strong>Hole ${h.hole}:</strong> ${h.issues.join(', ')}</div>`
            ).join('');
            document.getElementById('goToFirstIncomplete').onclick = () => {
                modal.classList.remove('show');
                currentHoleIndex = incompleteHoles[0].hole - 1;
                renderCurrentHole();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
            modal.classList.add('show');
            document.getElementById('goToFirstIncomplete').focus();
        }
        
        function closeIncompleteModal() {
            document.getElementById('incompleteModal').classList.remove('show');
        }
        
        function abandonRound() {
            const isEditing = editingRoundIndex !== null;
            const message = isEditing 
                ? 'Are you sure you want to discard your changes? The original round will be kept.'
                : 'Are you sure you want to abandon this round? All data will be deleted.';
            
            if (!confirm(message)) return;
            
            state.currentRound = null;
            finishAttempted = false;
            editingRoundIndex = null;
            state.editingRoundIndex = null;
            saveState();
            
            document.getElementById('courseSelect').value = '';
            document.getElementById('startRoundBtn').disabled = true;
            
            // Go back to appropriate tab
            if (isEditing) {
                showTab('historyTab');
            } else {
                showTab('homeTab');
            }
        }
        
        function showRoundSummary(round) {
            const course = state.courses.find(c => c.id === round.courseId);
            const coursePar = course ? course.pars.reduce((a,b)=>a+b,0) : 72;
            const toPar = round.totalScore - coursePar;
            const toParStr = toPar === 0 ? 'E' : (toPar > 0 ? '+' + toPar : toPar);
            const d = new Date(round.date);
            
            document.getElementById('summaryScore').textContent = round.totalScore;
            document.getElementById('summaryToPar').textContent = toParStr;
            document.getElementById('summaryCourse').textContent = `${round.courseName} · ${d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;
            
            const playerName = getPlayerLastName();
            const scorecardContent = generateScorecardTableContentSplit(round, course, playerName);
            document.getElementById('summaryScorecardFront').innerHTML = scorecardContent.front;
            document.getElementById('summaryScorecardBack').innerHTML = scorecardContent.back;
            
            const stats = calculateRoundStats(round);
            document.getElementById('summaryStats').innerHTML = generateStatsHTML(stats);
            
            // Hide everything else, show summary
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById('mainNav').style.display = 'none';
            document.getElementById('mainHeader').style.display = 'none';
            document.getElementById('roundBanner').classList.remove('show');
            document.getElementById('roundSummary').classList.add('active');
            
            // Allow scrolling on summary page
            document.body.classList.remove('play-active');
        }
        
        function closeSummary() {
            document.getElementById('roundSummary').classList.remove('active');
            document.getElementById('mainNav').style.display = 'flex';
            showTab('historyTab');
        }
        
        // ==================== CELEBRATION ====================
        function showCelebration(type) {
            // The visual popup always shows; only the sound respects the toggle.
            const soundOn = state.profile.soundEnabled !== false;
            const overlay = document.getElementById('celebration');
            const icon = document.getElementById('celebrationIcon');
            const text = document.getElementById('celebrationText');

            if (type === 'birdie') {
                icon.textContent = '🐦';
                text.textContent = '"Tweet tweet"';
                if (soundOn) document.getElementById('birdieSound').play().catch(() => {});
                overlay.classList.add('show');
                setTimeout(() => overlay.classList.remove('show'), 1200);
            } else if (type === 'eagle') {
                icon.textContent = '🦅';
                text.textContent = '"KREEEEE!"';
                if (soundOn) document.getElementById('eagleSound').play().catch(() => {});
                overlay.classList.add('show');
                setTimeout(() => overlay.classList.remove('show'), 2000);
            }
        }
        
        // ==================== SWIPE GESTURE HANDLING ====================
        let touchStartX = 0;
        let touchCurrentX = 0;
        let isDragging = false;
        let swipeDirection = null;
        const SWIPE_THRESHOLD = 20;
        
        // Animation interruption support
        let animationInProgress = false;
        let pendingAnimationTimeout = null;
        let pendingHoleChange = null;
        
        // Collapse the scorecard view if it's open (shared by hole navigation).
        function closeScorecardIfOpen() {
            if (!scorecardVisible) return;
            scorecardVisible = false;
            document.getElementById('scorecardContainer').classList.remove('show');
            document.getElementById('playActive').classList.remove('scorecard-open');
            document.getElementById('playTab').classList.remove('scorecard-open');
            document.getElementById('scorecardToggleBtn').textContent = 'View Scorecard';
        }

        function completePendingAnimation() {
            if (!animationInProgress || !pendingHoleChange) return;
            
            // Clear the pending timeout
            if (pendingAnimationTimeout) {
                clearTimeout(pendingAnimationTimeout);
                pendingAnimationTimeout = null;
            }
            
            // Immediately apply the pending hole change
            const { direction, celebration } = pendingHoleChange;
            
            if (celebration) {
                showCelebration(celebration);
            }
            
            if (direction === 'next') {
                currentHoleIndex++;
            } else if (direction === 'prev') {
                currentHoleIndex--;
            } else if (typeof direction === 'number') {
                currentHoleIndex = direction;
            }
            
            pendingCelebration = null;
            
            // Re-render panels instantly
            renderCarouselPanels();
            updateProgressBar();
            updateScorecard();
            
            closeScorecardIfOpen();
            
            // Reset animation state
            animationInProgress = false;
            pendingHoleChange = null;
        }
        
        function generateHoleContentHTML(holeIndex) {
            if (!state.currentRound || holeIndex < 0 || holeIndex > 17) return '';
            const hole = state.currentRound.holes[holeIndex];
            const score = hole.score;
            const displayScore = score === 0 ? '0' : score;
            
            let scoreLabel = '--', labelClass = '';
            if (score === 0) { scoreLabel = '--'; labelClass = ''; }
            else if (score === hole.par) { scoreLabel = 'Par'; labelClass = ''; }
            else {
                const diff = score - hole.par;
                if (diff <= -2) { scoreLabel = 'Eagle!'; labelClass = 'eagle'; }
                else if (diff === -1) { scoreLabel = 'Birdie!'; labelClass = 'birdie'; }
                else if (diff === 1) { scoreLabel = 'Bogey'; labelClass = 'bogey'; }
                else if (diff >= 2) { scoreLabel = 'Double'; labelClass = 'double-bogey'; }
            }
            
            const showFairway = hole.par >= 4;
            const fairwayYesClass = hole.fairway === true ? 'selected-yes' : '';
            const fairwayNoClass = hole.fairway === false ? 'selected-no' : '';
            
            const upDownAttemptClass = hole.upDownAttempt === true ? 'selected-yes' : '';
            const upDownDetailsShow = hole.upDownAttempt === true ? 'show' : '';
            const upDownMadeYesClass = hole.upDownMade === true ? 'selected-yes' : '';
            const upDownMadeNoClass = hole.upDownMade === false ? 'selected-no' : '';
            const fromBunkerClass = hole.fromBunker === true ? 'selected-yes' : '';
            
            return `
                <div class="scoring-header">
                    <div class="hole-label">Hole</div>
                    <div class="hole-number">${hole.hole}</div>
                    <div class="hole-par">Par ${hole.par}</div>
                </div>
                
                <div class="score-input">
                    <button class="score-btn" onclick="adjustScore(-1)">−</button>
                    <div class="score-current">
                        <div class="score-current-num">${displayScore}</div>
                        <div class="score-current-label ${labelClass}">${scoreLabel}</div>
                    </div>
                    <button class="score-btn" onclick="adjustScore(1)">+</button>
                </div>
                
                <div class="stats-container">
                    <!-- Fairway Card -->
                    <div class="stat-card stat-fairway" style="${showFairway ? '' : 'display:none;'}">
                        <div class="stat-card-title">Fairway Hit?</div>
                        <div class="yes-no-row">
                            <button class="yes-no-btn ${fairwayYesClass}" onclick="setFairway(true)">Yes</button>
                            <button class="yes-no-btn ${fairwayNoClass}" onclick="setFairway(false)">No</button>
                        </div>
                    </div>
                    
                    <!-- Putts Card (compact - shown on small screens) -->
                    <div class="stat-card stat-putts">
                        <div class="stat-card-title">Putts</div>
                        <div class="counter-controls">
                            <button class="counter-btn" onclick="adjustPutts(-1)">−</button>
                            <span class="counter-value">${hole.putts || 0}</span>
                            <button class="counter-btn" onclick="adjustPutts(1)">+</button>
                        </div>
                    </div>
                    
                    <!-- Up & Down Attempt Card (compact - shown on small screens) -->
                    <div class="stat-card stat-updown">
                        <div class="stat-card-title">Up & Down <span class="stat-card-subtitle">(&lt;15m)</span></div>
                        <div class="sub-option-label">Attempt?</div>
                        <div class="yes-no-row">
                            <button class="yes-no-btn ${upDownAttemptClass}" onclick="toggleUpDownAttempt()">Yes</button>
                        </div>
                    </div>
                    
                    <!-- Gettable Card (compact - shown on small screens) -->
                    <div class="stat-card stat-gettable">
                        <div class="stat-card-title">Gettable Putts <span class="stat-card-subtitle">(4-12ft)</span></div>
                        <div class="counter-row">
                            <span class="counter-label">Made</span>
                            <div class="counter-controls">
                                <button class="counter-btn" onclick="adjustGettableMade(-1)">−</button>
                                <span class="counter-value">${hole.gettableMade || 0}</span>
                                <button class="counter-btn" onclick="adjustGettableMade(1)">+</button>
                            </div>
                        </div>
                        <div class="counter-row">
                            <span class="counter-label">Total</span>
                            <div class="counter-controls">
                                <button class="counter-btn" onclick="adjustGettableTotal(-1)">−</button>
                                <span class="counter-value">${hole.gettableTotal || 0}</span>
                                <button class="counter-btn" onclick="adjustGettableTotal(1)">+</button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Up & Down Details Card (compact - shown on small screens when attempt=yes) -->
                    <div class="stat-card stat-updown-details ${upDownDetailsShow}">
                        <div class="updown-details-inner">
                            <div class="updown-made-section">
                                <div class="sub-option-label">Up & Down made?</div>
                                <div class="yes-no-row">
                                    <button class="yes-no-btn ${upDownMadeYesClass}" onclick="setUpDownMade(true)">Yes</button>
                                    <button class="yes-no-btn ${upDownMadeNoClass}" onclick="setUpDownMade(false)">No</button>
                                </div>
                            </div>
                            <div class="bunker-section">
                                <div class="sub-option-label">From bunker?</div>
                                <div class="yes-no-row">
                                    <button class="yes-no-btn ${fromBunkerClass}" onclick="setFromBunker()">Yes</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Original Putting Row (shown on large screens) -->
                    <div class="putting-row">
                        <div class="stat-card putting-card-small" style="display:flex;flex-direction:column;">
                            <div class="stat-card-title">Putts</div>
                            <div style="flex:1;display:flex;align-items:center;justify-content:center;">
                                <div class="counter-controls">
                                    <button class="counter-btn" onclick="adjustPutts(-1)">−</button>
                                    <span class="counter-value">${hole.putts || 0}</span>
                                    <button class="counter-btn" onclick="adjustPutts(1)">+</button>
                                </div>
                            </div>
                        </div>
                        <div class="stat-card putting-card-large">
                            <div class="stat-card-title">Gettable Putts <span class="stat-card-subtitle">(4-12ft)</span></div>
                            <div class="counter-row">
                                <span class="counter-label">Made</span>
                                <div class="counter-controls">
                                    <button class="counter-btn" onclick="adjustGettableMade(-1)">−</button>
                                    <span class="counter-value">${hole.gettableMade || 0}</span>
                                    <button class="counter-btn" onclick="adjustGettableMade(1)">+</button>
                                </div>
                            </div>
                            <div class="counter-row">
                                <span class="counter-label">Total attempts</span>
                                <div class="counter-controls">
                                    <button class="counter-btn" onclick="adjustGettableTotal(-1)">−</button>
                                    <span class="counter-value">${hole.gettableTotal || 0}</span>
                                    <button class="counter-btn" onclick="adjustGettableTotal(1)">+</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Original Up & Down Card (shown on large screens) -->
                    <div class="stat-card stat-updown-full">
                        <div class="stat-card-title">Up & Down <span class="stat-card-subtitle">(&lt;15m from green)</span></div>
                        <div class="up-down-row">
                            <div class="up-down-attempt">
                                <div class="sub-option-label">Up & Down attempt?</div>
                                <button class="yes-no-btn single ${upDownAttemptClass}" onclick="toggleUpDownAttempt()">Yes</button>
                            </div>
                            <div class="up-down-made ${upDownDetailsShow}">
                                <div class="sub-option-label">Up & Down made?</div>
                                <div class="yes-no-row">
                                    <button class="yes-no-btn ${upDownMadeYesClass}" onclick="setUpDownMade(true)">Yes</button>
                                    <button class="yes-no-btn ${upDownMadeNoClass}" onclick="setUpDownMade(false)">No</button>
                                </div>
                            </div>
                        </div>
                        <div class="conditional-section ${upDownDetailsShow}">
                            <div class="sub-option">
                                <div class="sub-option-label">From bunker?</div>
                                <button class="yes-no-btn single ${fromBunkerClass}" onclick="setFromBunker()">Yes</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        function setupSwipeListeners() {
            const swipeContainer = document.getElementById('holeSwipeContainer');
            if (!swipeContainer) return;
            
            swipeContainer.addEventListener('touchstart', (e) => {
                if (!state.currentRound) return;
                
                // Complete any pending animation immediately
                if (animationInProgress) {
                    completePendingAnimation();
                }
                
                touchStartX = e.touches[0].clientX;
                touchCurrentX = touchStartX;
                isDragging = true;
                swipeDirection = null;
                
                const track = document.getElementById('carouselTrack');
                track.classList.add('dragging');
            }, { passive: true });
            
            swipeContainer.addEventListener('touchmove', (e) => {
                if (!isDragging || !state.currentRound) return;
                
                touchCurrentX = e.touches[0].clientX;
                const deltaX = touchCurrentX - touchStartX;
                const containerWidth = swipeContainer.offsetWidth;
                
                // Determine swipe direction
                if (Math.abs(deltaX) > 10 && swipeDirection === null) {
                    swipeDirection = deltaX > 0 ? 'right' : 'left';
                }
                
                // Apply resistance at boundaries
                let adjustedDelta = deltaX;
                if ((swipeDirection === 'left' && currentHoleIndex >= 17) ||
                    (swipeDirection === 'right' && currentHoleIndex <= 0)) {
                    adjustedDelta = deltaX * 0.2;
                }
                
                // Convert pixel delta to percentage offset from center (-33.333%)
                // deltaX positive = swipe right = show prev panel = move track right
                const percentOffset = (adjustedDelta / containerWidth) * 33.333;
                const baseOffset = -33.333;
                
                const track = document.getElementById('carouselTrack');
                track.style.transform = `translateX(${baseOffset + percentOffset}%)`;
            }, { passive: true });
            
            swipeContainer.addEventListener('touchend', (e) => {
                if (!isDragging || !state.currentRound) return;
                isDragging = false;
                
                const track = document.getElementById('carouselTrack');
                const deltaX = touchCurrentX - touchStartX;
                
                track.classList.remove('dragging');
                
                const shouldComplete = Math.abs(deltaX) > SWIPE_THRESHOLD;
                
                if (shouldComplete && swipeDirection === 'left' && currentHoleIndex < 17) {
                    // Swipe left = go to next hole
                    track.style.transform = 'translateX(-66.666%)';
                    
                    // Set up pending animation
                    animationInProgress = true;
                    pendingHoleChange = { 
                        direction: 'next', 
                        celebration: pendingCelebration 
                    };
                    
                    pendingAnimationTimeout = setTimeout(() => {
                        if (pendingHoleChange && pendingHoleChange.celebration) {
                            showCelebration(pendingHoleChange.celebration);
                        }
                        
                        currentHoleIndex++;
                        pendingCelebration = null;
                        
                        renderCarouselPanels();
                        updateProgressBar();
                        updateScorecard();
                        
                        closeScorecardIfOpen();
                        
                        animationInProgress = false;
                        pendingHoleChange = null;
                        pendingAnimationTimeout = null;
                    }, 150);
                    
                } else if (shouldComplete && swipeDirection === 'left' && currentHoleIndex === 17) {
                    // On hole 18, swiping left = show finish confirmation
                    // Snap back to center first
                    track.style.transform = 'translateX(-33.333%)';
                    
                    // Trigger celebration if pending
                    if (pendingCelebration) {
                        showCelebration(pendingCelebration);
                        pendingCelebration = null;
                    }
                    
                    // Show finish confirmation
                    showFinishConfirmation();
                    
                } else if (shouldComplete && swipeDirection === 'right' && currentHoleIndex > 0) {
                    // Swipe right = go to previous hole
                    track.style.transform = 'translateX(0%)';
                    
                    // Set up pending animation
                    animationInProgress = true;
                    pendingHoleChange = { 
                        direction: 'prev', 
                        celebration: null 
                    };
                    
                    pendingAnimationTimeout = setTimeout(() => {
                        currentHoleIndex--;
                        pendingCelebration = null;
                        
                        renderCarouselPanels();
                        updateProgressBar();
                        updateScorecard();
                        
                        closeScorecardIfOpen();
                        
                        animationInProgress = false;
                        pendingHoleChange = null;
                        pendingAnimationTimeout = null;
                    }, 150);
                    
                } else {
                    // Snap back to center
                    track.style.transform = 'translateX(-33.333%)';
                }
                
                swipeDirection = null;
            }, { passive: true });
        }
        
        function updateProgressBar() {
            const progress = ((currentHoleIndex + 1) / 18) * 100;
            document.getElementById('progressFill').style.width = progress + '%';
            
            const isEditing = editingRoundIndex !== null;
            document.getElementById('progressText').textContent = isEditing 
                ? `Editing: Hole ${currentHoleIndex + 1} of 18`
                : `Hole ${currentHoleIndex + 1} of 18`;
            
            // Update live score
            let totalToPar = 0;
            state.currentRound.holes.forEach(h => {
                if (h.score > 0) totalToPar += h.score - h.par;
            });
            const liveScoreEl = document.getElementById('liveScore');
            if (totalToPar === 0) liveScoreEl.textContent = 'E';
            else if (totalToPar > 0) liveScoreEl.textContent = '+' + totalToPar;
            else liveScoreEl.textContent = totalToPar;
        }
        
        function updateScorecard() {
            const course = state.courses.find(c => c.id === state.currentRound.courseId);
            const scorecardContent = generatePlayScorecardContent(state.currentRound, course, state.profile.name || null);
            document.getElementById('classicScorecardFront').innerHTML = scorecardContent.front;
            document.getElementById('classicScorecardBack').innerHTML = scorecardContent.back;
        }
        
        // ==================== INIT ====================
        function init() {
            loadState();
            updateGreeting();
            updateProfileBtn();
            updateHomeTab();
            updateCourseSelect();
            
            // Setup swipe gestures
            setupSwipeListeners();
            
            // Check for in-progress round
            if (state.currentRound) {
                showTab('playTab');
            }
            
            // Register service worker
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('sw.js').catch(e => console.log('SW error:', e));
            }
        }
        
        init();
