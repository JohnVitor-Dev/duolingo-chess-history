// --------------------------------------------------
// Duolingo Chess - Network Interceptor
//
// Este script roda no "world: MAIN" (contexto real da página),
// ou seja, no mesmo mundo em que o próprio React do Duolingo faz
// suas requisições. Isso permite capturar a resposta EXATA que o
// site usa pra renderizar a lista de partidas, no exato momento
// em que ela é buscada - eliminando qualquer corrida entre "nosso"
// fetch e o DOM sendo atualizado pelo site.
//
// Os dados capturados são repassados ao content script (mundo
// isolado) via CustomEvent, já que os dois mundos não compartilham
// variáveis diretamente.
// --------------------------------------------------

(() => {
    const MATCHES_LIST_URL_RE = /\/chess\/1\/\d+\/matches(?:\?|$)/;
    const EVENT_NAME = "duolingo-chess:matches";

    function broadcast(url, data) {
        window.dispatchEvent(
            new CustomEvent(EVENT_NAME, {
                detail: { url, data }
            })
        );
    }

    // ---------------- fetch ----------------

    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);

        try {
            const input = args[0];
            const url =
                typeof input === "string"
                    ? input
                    : input?.url ?? "";

            if (MATCHES_LIST_URL_RE.test(url)) {
                response
                    .clone()
                    .json()
                    .then((data) => broadcast(url, data))
                    .catch(() => {
                        // Resposta não era JSON ou já foi consumida; ignora.
                    });
            }
        } catch (_) {
            // Nunca deixa a interceptação quebrar a requisição real.
        }

        return response;
    };

    // ---------------- XMLHttpRequest ----------------

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__duoChessUrl = url;
        return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        this.addEventListener("load", () => {
            try {
                if (
                    this.__duoChessUrl &&
                    MATCHES_LIST_URL_RE.test(this.__duoChessUrl)
                ) {
                    const data = JSON.parse(this.responseText);
                    broadcast(this.__duoChessUrl, data);
                }
            } catch (_) {
                // Resposta não era JSON esperado; ignora.
            }
        });

        return originalSend.apply(this, args);
    };
})();
