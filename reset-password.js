        (function() {
            'use strict';

            // ─── Supabase ───
            const SUPABASE_URL = 'https://api.freeupper.com';
            const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptanRxaWRpcnBtbmVnenZtaWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4ODk0OTAsImV4cCI6MjA5OTQ2NTQ5MH0.Lfxtyexew35L3uzy3bxPcBHogsnlMcAVOE-Ho50FZpk';

            const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: { detectSessionInUrl: true, persistSession: true, storageKey: 'sb-jmjtqidirpmnegzvmiaq-auth-token' }
            });

            // ─── DOM refs ───
            const pwNew = document.getElementById('pwNew');
            const pwConf = document.getElementById('pwConf');
            const strFill = document.getElementById('strFill');
            const strLbl = document.getElementById('strLbl');
            const matchHint = document.getElementById('matchHint');
            const submitBtn = document.getElementById('submitBtn');
            const formWrap = document.getElementById('formWrap');
            const successWrap = document.getElementById('successWrap');

            // ─── Toggle password visibility ───
            window.toggleEye = function(id) {
                const inp = document.getElementById(id);
                inp.type = inp.type === 'password' ? 'text' : 'password';
            };

            // ─── Password strength & validation ───
            window.onPasswordInput = function() {
                const pw = pwNew.value;
                const len = pw.length >= 8;
                const upper = /[A-Z]/.test(pw);
                const num = /[0-9]/.test(pw);
                const spec = /[^a-zA-Z0-9]/.test(pw);
                const score = (len?1:0)+(upper?1:0)+(num?1:0)+(spec?1:0)+(pw.length>=14?1:0);
                const levels = [
                    { w: '0%', c: 'transparent', t: '' },
                    { w: '25%', c: '#f87171', t: 'Weak' },
                    { w: '50%', c: '#fb923c', t: 'Fair' },
                    { w: '75%', c: '#facc15', t: 'Good' },
                    { w: '100%', c: '#4ade80', t: 'Strong' }
                ];
                const l = levels[Math.min(score, 4)];
                strFill.style.cssText = 'width:' + l.w + ';background:' + l.c;
                strLbl.textContent = l.t;
                strLbl.style.color = l.c;

                // Update requirement indicators
                document.getElementById('req-len').classList.toggle('met', len);
                document.getElementById('req-upper').classList.toggle('met', upper);
                document.getElementById('req-num').classList.toggle('met', num);
                document.getElementById('req-special').classList.toggle('met', spec);

                // Match confirmation
                const conf = pwConf.value;
                if (conf) {
                    const match = pw === conf;
                    matchHint.textContent = match ? '✓ Passwords match' : '✗ Passwords do not match';
                    matchHint.style.color = match ? 'var(--ok)' : 'var(--danger)';
                } else {
                    matchHint.textContent = '';
                }
                updateSubmitButton();
            };

            let recoveryUserId = null;
            let updating = false;
            const recoveryStatus = document.getElementById('recoveryStatus');
            const markerKey = 'freeupper_password_recovery';
            let recoveryExpires = 0;
            let recoverySessionId = null;
            // This decoded ID only binds a UI marker to one session. Supabase
            // authenticates every update; decoded claims never authorize it.
            function sessionId(session) {
                try {
                    const payload = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
                    const id = JSON.parse(atob(payload)).session_id;
                    return typeof id === 'string' && id ? id : null;
                } catch (_) { return null; }
            }
            const invalidCallback = new URLSearchParams(location.hash.slice(1)).has('error') || new URLSearchParams(location.search).has('error');
            let ready;
            const recoveryReady = new Promise(resolve => { ready = resolve; });
            function rememberRecovery(session, expires = Date.now() + 15 * 60 * 1000) {
                const id = sessionId(session);
                if (!session?.user || !id || invalidCallback || expires <= Date.now()) { rejectRecovery(); return; }
                recoveryUserId = session.user.id;
                recoveryExpires = expires;
                recoverySessionId = id;
                try {
                    if (id) sessionStorage.setItem(markerKey, JSON.stringify({ id: recoveryUserId, sessionId: id, expires }));
                    else sessionStorage.removeItem(markerKey);
                } catch (_) {}
                pwNew.disabled = false;
                pwConf.disabled = false;
                recoveryStatus.textContent = 'Choose your new password.';
                updateSubmitButton();
            }
            function rejectRecovery() {
                recoveryUserId = null;
                recoveryExpires = 0;
                recoverySessionId = null;
                pwNew.disabled = true;
                pwConf.disabled = true;
                submitBtn.disabled = true;
                recoveryStatus.textContent = 'This reset link is invalid or expired. Request another reset link below.';
                try { sessionStorage.removeItem(markerKey); } catch (_) {}
            }
            function updateSubmitButton() {
                const valid = recoveryUserId && pwNew.value.length >= 8 && pwNew.value === pwConf.value;
                submitBtn.disabled = updating || !valid;
            }

            // Subscribe before waiting for SDK initialization, rather than guessing a delay.
            sb.auth.onAuthStateChange((event, session) => {
                if (event === 'PASSWORD_RECOVERY') rememberRecovery(session);
                if (event === 'SIGNED_OUT' || (session?.user && recoveryUserId && session.user.id !== recoveryUserId)) rejectRecovery();
            });
            (async function init() {
                try {
                    let { data, error } = await sb.auth.getSession();
                    if (error) throw error;
                    // A recovery event may arrive while the initial read resolves.
                    if (recoveryUserId && !data.session) {
                        const current = await sb.auth.getSession();
                        if (current.error) throw current.error;
                        data = current.data;
                    }
                    let marker;
                    try { marker = JSON.parse(sessionStorage.getItem(markerKey)); } catch (_) {}
                    if (invalidCallback) rejectRecovery();
                    else if (data.session && recoveryUserId === data.session.user.id) rememberRecovery(data.session, recoveryExpires);
                    else if (data.session && marker?.id === data.session.user.id && marker.sessionId && marker.sessionId === sessionId(data.session) && marker.expires > Date.now()) rememberRecovery(data.session, marker.expires);
                    else rejectRecovery();
                } catch (_) { rejectRecovery(); }
                finally { ready(); }
            })();

            window.submitNewPassword = async function() {
                await recoveryReady;
                if (updating) return;
                const pw = pwNew.value;
                if (!recoveryUserId || recoveryExpires <= Date.now()) { rejectRecovery(); return; }
                if (pw.length < 8 || pw !== pwConf.value) {
                    recoveryStatus.textContent = 'Enter matching passwords with at least 8 characters.';
                    return;
                }
                updating = true;
                updateSubmitButton();
                try {
                    const { data, error: sessionError } = await sb.auth.getSession();
                    if (sessionError || !data.session || data.session.user.id !== recoveryUserId || sessionId(data.session) !== recoverySessionId) { rejectRecovery(); return; }
                    const { error } = await sb.auth.updateUser({ password: pw });
                    if (error) throw error;
                    try { sessionStorage.removeItem(markerKey); } catch (_) {}
                    formWrap.classList.add('hide');
                    successWrap.classList.add('show');
                    pwNew.value = '';
                    pwConf.value = '';
                    // Clear this browser's recovery session, not other devices.
                    try { await sb.auth.signOut({ scope: 'local' }); } catch (_) {}
                } catch (error) {
                    recoveryStatus.textContent = error.status === 429 ? 'Too many attempts. Wait before trying again.' : error.code === 'weak_password' ? 'Choose a stronger password that meets the account password requirements.' : 'Your password could not be updated. Please retry or request another reset link.';
                } finally { updating = false; updateSubmitButton(); }
            };

        })();
