console.log("[Duolingo Chess] Background started.");

const api = globalThis.browser ?? globalThis.chrome;
let detectedUserId = null;


// --------------------------------------------------
// Salva o User ID
// --------------------------------------------------

async function saveUserId(userId) {
    detectedUserId = userId;

    await api.storage.local.set({
        duolingoUserId: userId
    });

    console.log(
        "[Duolingo Chess] User ID detected:",
        userId
    );
}


// --------------------------------------------------
// Recupera o User ID salvo
// --------------------------------------------------

async function getUserId() {
    if (detectedUserId) {
        return detectedUserId;
    }

    const data = await api.storage.local.get(
        "duolingoUserId"
    );

    if (data.duolingoUserId) {
        detectedUserId = data.duolingoUserId;

        console.log(
            "[Duolingo Chess] User ID retrieved:",
            detectedUserId
        );

        return detectedUserId;
    }

    return null;
}


// --------------------------------------------------
// Detecta o User ID através das requisições do Duolingo
// --------------------------------------------------

api.webRequest.onBeforeRequest.addListener(
    (details) => {
        const match = details.url.match(
            /\/chess\/1\/(\d+)\/matches(?:[/?]|$)/
        );

        if (!match) {
            return;
        }

        const userId = match[1];

        saveUserId(userId).catch((error) => {
            console.error(
                "[Duolingo Chess] Error saving User ID:",
                error
            );
        });
    },
    {
        urls: [
            "https://www.duolingo.com/chess/*",
            "https://pt.duolingo.com/chess/*"
        ]
    }
);


// --------------------------------------------------
// Comunicação com o Content Script
// --------------------------------------------------

api.runtime.onMessage.addListener(
    async (message) => {

        const userId = await getUserId();

        // ----------------------------------------------
        // GET_USER_ID
        // ----------------------------------------------

        if (message.type === "GET_USER_ID") {

            if (!userId) {
                throw new Error(
                    "User ID has not yet been detected."
                );
            }

            return {
                userId
            };
        }


        // ----------------------------------------------
        // Verifica User ID
        // ----------------------------------------------

        if (!userId) {
            throw new Error(
                "User ID has not yet been detected."
            );
        }


        // ----------------------------------------------
        // GET_MATCH_HISTORY
        // ----------------------------------------------

        if (message.type === "GET_MATCH_HISTORY") {

            const url =
                `https://www.duolingo.com/chess/1/${userId}/matches` +
                `?matchesLimit=10000`;

            const response = await fetch(url, { credentials: "include" });

            if (!response.ok) {
                throw new Error(
                    `Error fetching match history: HTTP ${response.status}`
                );
            }

            return await response.json();
        }


        // ----------------------------------------------
        // GET_MATCH
        // ----------------------------------------------

        if (message.type === "GET_MATCH") {

            if (!message.matchId) {
                throw new Error(
                    "matchId not specified."
                );
            }

            const encodedMatchId =
                encodeURIComponent(message.matchId);

            const url =
                `https://www.duolingo.com/chess/1/${userId}/matches/${encodedMatchId}`;

            const response = await fetch(url, { credentials: "include" });

            if (!response.ok) {
                throw new Error(
                    `Error fetching match: HTTP ${response.status}`
                );
            }

            return await response.json();
        }


        // ----------------------------------------------
        // Mensagem desconhecida
        // ----------------------------------------------

        throw new Error(
            `Type of unknown message: ${message.type}`
        );
    }
);