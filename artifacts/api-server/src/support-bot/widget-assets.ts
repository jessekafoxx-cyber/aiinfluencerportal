// Embeddable support widget assets, served directly from the bundle.
// The widget JS deliberately avoids backticks and dollar-brace so it
// can live inside these template literals unescaped.

export const WIDGET_JS = `(function() {
    if (document.getElementById('r30-support-widget')) return;

    var BASE = window.R30_SUPPORT_URL;
    if (typeof BASE !== 'string') {
        var cs = document.currentScript;
        if (cs && cs.src) {
            BASE = cs.src.replace(/\\/api\\/support-bot\\/widget\\.js.*$/, '');
        } else {
            BASE = '';
        }
    }
    var API = BASE + '/api/support-bot';
    var sessionId = null;
    try { sessionId = localStorage.getItem('r30_session_id'); } catch (e) {}
    var isOpen = false;
    var isLoading = false;
    var escalateShown = false;

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = API + '/widget.css';
    document.head.appendChild(link);

    var container = document.createElement('div');
    container.id = 'r30-support-widget';
    container.innerHTML =
        '<div id="r30-bubble" onclick="R30Support.toggle()">' +
            '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2">' +
                '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
            '</svg>' +
        '</div>' +
        '<div id="r30-window" style="display:none">' +
            '<div id="r30-header">' +
                '<div id="r30-header-info">' +
                    '<div id="r30-avatar">S</div>' +
                    '<div>' +
                        '<div id="r30-title">Alana</div>' +
                        '<div id="r30-subtitle">AI Influencer Portfolio Support</div>' +
                    '</div>' +
                '</div>' +
                '<button id="r30-close" onclick="R30Support.toggle()">&times;</button>' +
            '</div>' +
            '<div id="r30-messages">' +
                '<div class="r30-msg r30-bot"><div class="r30-bubble">Hey, I\\'m Alana, the AI support here. I can do everything you need. If at any point you do want to escalate this to the team, I\\'ll pass the whole chat straight over to them, but most things I can sort out here instantly for you.</div></div>' +
            '</div>' +
            '<div id="r30-input-area">' +
                '<textarea id="r30-input" placeholder="Type a message..." rows="1"></textarea>' +
                '<button id="r30-send" onclick="R30Support.send()">' +
                    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<line x1="22" y1="2" x2="11" y2="13"/>' +
                        '<polygon points="22 2 15 22 11 13 2 9 22 2"/>' +
                    '</svg>' +
                '</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(container);

    var input = document.getElementById('r30-input');
    input.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            R30Support.send();
        }
    });

    window.R30Support = {
        toggle: function() {
            var win = document.getElementById('r30-window');
            var bubble = document.getElementById('r30-bubble');
            isOpen = !isOpen;
            win.style.display = isOpen ? 'flex' : 'none';
            bubble.style.display = isOpen ? 'none' : 'flex';
            if (isOpen) input.focus();
        },

        send: function() {
            var self = this;
            if (isLoading) return;
            var msg = input.value.trim();
            if (!msg) return;

            this._addMessage(msg, 'user');
            input.value = '';
            input.style.height = 'auto';
            isLoading = true;

            var typing = this._addTyping();

            fetch(API + '/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    message: msg,
                    page_url: window.location.href
                })
            }).then(function(res) {
                return res.json();
            }).then(function(data) {
                if (data.session_id) {
                    sessionId = data.session_id;
                    try { localStorage.setItem('r30_session_id', sessionId); } catch (e) {}
                }
                typing.remove();
                self._addMessage(data.response, 'bot');
                if (data.escalate && !escalateShown) {
                    self._showEscalateForm();
                }
                isLoading = false;
            }).catch(function() {
                typing.remove();
                self._addMessage('Sorry, something went wrong. Please try again in a moment :)', 'bot');
                isLoading = false;
            });
        },

        _showEscalateForm: function() {
            escalateShown = true;
            var self = this;
            var messages = document.getElementById('r30-messages');
            var wrap = document.createElement('div');
            wrap.className = 'r30-msg r30-bot';
            wrap.innerHTML =
                '<div class="r30-bubble r30-escalate">' +
                    '<div class="r30-escalate-label">Want the team to pick this up? Drop your email and we will send this conversation over to a human.</div>' +
                    '<div class="r30-escalate-row">' +
                        '<input type="email" class="r30-escalate-input" placeholder="you@email.com">' +
                        '<button class="r30-escalate-btn">Send</button>' +
                    '</div>' +
                '</div>';
            messages.appendChild(wrap);
            messages.scrollTop = messages.scrollHeight;

            var emailInput = wrap.querySelector('.r30-escalate-input');
            var btn = wrap.querySelector('.r30-escalate-btn');
            var submit = function() {
                var email = emailInput.value.trim();
                if (!email || email.indexOf('@') < 1) {
                    emailInput.focus();
                    return;
                }
                btn.disabled = true;
                btn.textContent = '...';
                fetch(API + '/escalate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: sessionId, email: email })
                }).then(function(res) {
                    return res.json();
                }).then(function(data) {
                    wrap.remove();
                    if (data && data.success) {
                        self._addMessage('Done, sent this chat over to the team. Someone will email you back, usually within a few hours.', 'bot');
                    } else {
                        self._addMessage('Could not send that just now. Please try again in a moment and the team will help.', 'bot');
                    }
                }).catch(function() {
                    wrap.remove();
                    self._addMessage('Could not send that just now. Please try again in a moment and the team will help.', 'bot');
                });
            };
            btn.addEventListener('click', submit);
            emailInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                }
            });
            emailInput.focus();
        },

        _addMessage: function(text, sender) {
            var messages = document.getElementById('r30-messages');
            var div = document.createElement('div');
            div.className = 'r30-msg r30-' + sender;
            var html = this._escapeHtml(text).replace(/\\n/g, '<br>');
            if (sender === 'bot') html = this._linkify(html);
            div.innerHTML = '<div class="r30-bubble">' + html + '</div>';
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
            return div;
        },

        _linkify: function(escaped) {
            var re = /(https?:\\/\\/[^\\s<]+)|((?:partner\\.|www\\.)?(?:room30\\.ai|gohighlevel\\.com|gregorycooke\\.io|loom\\.com)\\/[^\\s<]*)/g;
            return escaped.replace(re, function(match) {
                var trimmed = match.replace(/(?:&quot;|&#39;|[).,!?:;'])+$/, '');
                var trail = match.slice(trimmed.length);
                if (!trimmed) return match;
                var href = trimmed.indexOf('http') === 0 ? trimmed : 'https://' + trimmed;
                return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + trimmed + '</a>' + trail;
            });
        },

        _addTyping: function() {
            var messages = document.getElementById('r30-messages');
            var div = document.createElement('div');
            div.className = 'r30-msg r30-bot r30-typing';
            div.innerHTML = '<div class="r30-bubble"><span class="r30-dot"></span><span class="r30-dot"></span><span class="r30-dot"></span></div>';
            messages.appendChild(div);
            messages.scrollTop = messages.scrollHeight;
            return div;
        },

        _escapeHtml: function(text) {
            var div = document.createElement('div');
            div.textContent = text == null ? '' : String(text);
            return div.innerHTML;
        }
    };
})();
`;

export const WIDGET_CSS = `#r30-support-widget {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.45;
}

#r30-bubble {
    width: 56px; height: 56px; border-radius: 50%;
    background-image: linear-gradient(90deg, #8C6A1F 0%, #B8902F 8%, #E8CC78 18%, #F4E0A0 25%, #C9A44C 38%, #F2DC9A 50%, #C9A44C 62%, #F4E0A0 75%, #E8CC78 82%, #B8902F 92%, #8C6A1F 100%);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.3);
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
    transition: transform 0.2s;
}
#r30-bubble:hover { transform: scale(1.08); }

#r30-window {
    width: 380px; height: 560px; background: #fff;
    border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,.18);
    flex-direction: column; overflow: hidden;
    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
}

#r30-header {
    background: #0a0a0a; color: #fff; padding: 16px;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 2px solid #C9A44C;
}
#r30-header-info { display: flex; align-items: center; gap: 12px; }
#r30-avatar {
    width: 36px; height: 36px; border-radius: 50%;
    background-image: linear-gradient(90deg, #8C6A1F 0%, #B8902F 8%, #E8CC78 18%, #F4E0A0 25%, #C9A44C 38%, #F2DC9A 50%, #C9A44C 62%, #F4E0A0 75%, #E8CC78 82%, #B8902F 92%, #8C6A1F 100%);
    color: #111;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: 700;
}
#r30-title { font-weight: 600; font-size: 15px; }
#r30-subtitle { font-size: 12px; color: #C9A44C; }
#r30-close {
    background: none; border: none; color: #fff;
    font-size: 22px; cursor: pointer; padding: 0 4px;
}

#r30-messages {
    flex: 1; overflow-y: auto; padding: 16px;
    display: flex; flex-direction: column; gap: 12px;
}

.r30-msg { display: flex; }
.r30-msg.r30-user { justify-content: flex-end; }

.r30-bubble {
    max-width: 80%; padding: 10px 14px;
    border-radius: 16px; font-size: 14px; line-height: 1.45;
}
.r30-bot .r30-bubble {
    background: #f1f1f1; color: #1a1a1a;
    border-bottom-left-radius: 4px;
}
.r30-bot .r30-bubble a {
    color: #8C6A1F; font-weight: 600;
    text-decoration: underline; word-break: break-all;
}
.r30-user .r30-bubble {
    background: #0a0a0a; color: #fff;
    border-bottom-right-radius: 4px;
}

.r30-typing .r30-bubble {
    display: flex; gap: 4px; padding: 14px 18px;
}
.r30-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #999; animation: r30bounce 1.4s infinite ease-in-out;
}
.r30-dot:nth-child(2) { animation-delay: .2s; }
.r30-dot:nth-child(3) { animation-delay: .4s; }
@keyframes r30bounce {
    0%, 80%, 100% { transform: translateY(0); }
    40% { transform: translateY(-6px); }
}

#r30-input-area {
    padding: 12px 16px; border-top: 1px solid #eee;
    display: flex; align-items: flex-end; gap: 8px;
}
#r30-input {
    flex: 1; border: 1px solid #ddd; border-radius: 20px;
    padding: 10px 16px; font-size: 14px; resize: none;
    outline: none; font-family: inherit; max-height: 120px;
}
#r30-input:focus { border-color: #999; }
#r30-send {
    width: 36px; height: 36px; border-radius: 50%;
    background-image: linear-gradient(90deg, #8C6A1F 0%, #B8902F 8%, #E8CC78 18%, #F4E0A0 25%, #C9A44C 38%, #F2DC9A 50%, #C9A44C 62%, #F4E0A0 75%, #E8CC78 82%, #B8902F 92%, #8C6A1F 100%);
    color: #111; border: none;
    cursor: pointer; display: flex; align-items: center;
    justify-content: center; flex-shrink: 0;
}
#r30-send:hover { filter: brightness(1.05); }

.r30-escalate { width: 100%; max-width: 90%; }
.r30-escalate-label { margin-bottom: 8px; }
.r30-escalate-row { display: flex; gap: 6px; }
.r30-escalate-input {
    flex: 1; border: 1px solid #ccc; border-radius: 8px;
    padding: 8px 10px; font-size: 13px; outline: none;
    font-family: inherit; min-width: 0;
}
.r30-escalate-input:focus { border-color: #666; }
.r30-escalate-btn {
    background-image: linear-gradient(90deg, #8C6A1F 0%, #B8902F 8%, #E8CC78 18%, #F4E0A0 25%, #C9A44C 38%, #F2DC9A 50%, #C9A44C 62%, #F4E0A0 75%, #E8CC78 82%, #B8902F 92%, #8C6A1F 100%);
    color: #111; border: none; font-weight: 600;
    border-radius: 8px; padding: 8px 14px; font-size: 13px;
    cursor: pointer; flex-shrink: 0;
}
.r30-escalate-btn:disabled { opacity: .6; cursor: default; }

@media (max-width: 480px) {
    #r30-window {
        width: calc(100vw - 24px) !important;
        height: calc(100vh - 80px) !important;
        bottom: 12px !important;
        right: 12px !important;
        border-radius: 12px !important;
    }
}
`;

export const DEMO_HTML = `<!DOCTYPE html>
<html>
<head>
    <title>Support Widget Demo</title>
    <style>
        body { font-family: sans-serif; padding: 60px; background: #f5f5f5; }
        h1 { color: #1a1a1a; }
        p { color: #666; max-width: 600px; line-height: 1.6; }
    </style>
</head>
<body>
    <h1>Support Widget</h1>
    <p>The chat widget should appear in the bottom-right corner. Click it to start a conversation.</p>
    <p>This is a demo page. In production, add the embed code to any page on your site.</p>

    <script>window.R30_SUPPORT_URL = '';</script>
    <script src="/api/support-bot/widget.js" defer></script>
</body>
</html>
`;
