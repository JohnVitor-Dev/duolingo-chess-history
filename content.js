const chess = new Chess();

const api = globalThis.browser ?? globalThis.chrome;

console.log("[Duolingo Chess] Content script loaded.");

let lastRowCount = 0;
let historyMatchCount = 0;
let historyMatches = [];
let fallbackFetchTimer = null;
let fallbackAttempted = false;

// --------------------------------------------------
// Fonte primária de dados: interceptação de rede
//
// O network-interceptor.js (rodando no world MAIN) nos avisa toda
// vez que a PRÓPRIA página busca a lista de partidas - inclusive
// depois de uma partida nova terminar, já que o Duolingo precisa
// buscar os dados atualizados pra renderizar a nova row. Usamos
// exatamente essa resposta, sem fazer uma requisição paralela nossa
// e sem depender de "adivinhar" pela contagem de rows no DOM.
// --------------------------------------------------

window.addEventListener("duolingo-chess:matches", (event) => {
    const matches = event.detail?.data?.matchHistory ?? [];

    console.log(
        "[Duolingo Chess] Histórico interceptado da própria página:",
        matches.length,
        "partidas"
    );

    applyFreshHistory(matches);
});

function applyFreshHistory(matches) {
    historyMatches = mergeHistory(historyMatches, matches);
    historyMatchCount = historyMatches.length;
    fallbackAttempted = false;

    clearFallbackTimer();

    limitHistoryRows(historyMatchCount);
    attachMatchesToRows(historyMatches);
}

// --------------------------------------------------
// Mescla o histórico já conhecido com uma resposta nova.
//
// O endpoint de partidas é usado tanto pra buscar a lista
// completa (carregamento inicial, ou refetch depois de uma
// partida nova terminar) quanto pra buscar só a PRÓXIMA PÁGINA
// quando o usuário rola a lista pra baixo. Nesse segundo caso,
// a resposta interceptada tem só um lote, bem menor que o total
// de linhas já renderizadas no DOM.
//
// Se tratássemos toda resposta como "a lista inteira e definitiva"
// (substituindo historyMatches direto), uma resposta de paginação
// faria a gente achar que sobraram linhas "extras" no DOM e
// removê-las - é exatamente isso que causava a lista bugando ao
// rolar. Por isso: só substituímos quando a resposta nova já cobre
// tudo que tínhamos (ou seja, é de fato a fonte completa); caso
// contrário, só acrescentamos ao final os itens que ainda não
// conhecíamos.
// --------------------------------------------------

function mergeHistory(existing, incoming) {
    if (existing.length === 0) {
        return incoming;
    }

    const incomingIds = new Set(
        incoming.map((match) => match.matchId)
    );

    const coversExisting = existing.every(
        (match) => incomingIds.has(match.matchId)
    );

    if (coversExisting) {
        return incoming;
    }

    const existingIds = new Set(
        existing.map((match) => match.matchId)
    );

    const merged = existing.slice();

    for (const match of incoming) {
        if (!existingIds.has(match.matchId)) {
            merged.push(match);
        }
    }

    return merged;
}

function clearFallbackTimer() {
    if (fallbackFetchTimer) {
        clearTimeout(fallbackFetchTimer);
        fallbackFetchTimer = null;
    }
}

// --------------------------------------------------
// Rede de segurança: busca via background
//
// Só é usada se a interceptação de rede não trouxer dados a tempo
// (ex.: primeiro carregamento da página, extensão instalada depois
// da página já ter carregado, ou o Duolingo mudando a forma como
// busca os dados). Nunca reaplica dados velhos por cima de rows
// já deslocadas - só entra em ação quando os dados que temos estão
// desatualizados em relação ao DOM.
// --------------------------------------------------

async function fetchHistoryFallback() {
    if (fallbackAttempted) return;

    fallbackAttempted = true;

    try {
        console.log(
            "[Duolingo Chess] Fallback: buscando histórico via background..."
        );

        const history = await api.runtime.sendMessage({
            type: "GET_MATCH_HISTORY"
        });

        applyFreshHistory(history.matchHistory ?? []);

    } catch (error) {
        console.error(
            "[Duolingo Chess] Erro no fallback de histórico:",
            error
        );

        // Permite tentar de novo numa próxima mutação do DOM.
        fallbackAttempted = false;
    }
}

function scheduleFallbackIfStale() {
    if (fallbackFetchTimer || fallbackAttempted) return;

    fallbackFetchTimer = setTimeout(() => {
        fallbackFetchTimer = null;
        fetchHistoryFallback();
    }, 1500);
}

function attachMatchesToRows(matches) {
    const rows = document.querySelectorAll(
        '[data-test="chess-match-history-row"]'
    );

    rows.forEach((row, index) => {
        const match = matches[index];

        if (!match?.matchId) {
            delete row.dataset.matchId;
            delete row.dataset.opponentName;
            return;
        }

        row.dataset.matchId = String(match.matchId);
        row.dataset.opponentName =
            match.opponentName || "Duolingo Bot";

        addExportButton(row);
    });
}

function addExportButton(row) {
    if (row.dataset.pgnButtonAdded === "true") return;

    const exportButton = document.createElement("button");
    exportButton.textContent = "Export PGN";
    exportButton.type = "button";

    exportButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await handleExportClick(row, exportButton);
    });

    const copyButton = document.createElement("button");
    copyButton.textContent = "Copy PGN";
    copyButton.type = "button";

    copyButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await handleCopyClick(row, copyButton);
    });

    row.appendChild(exportButton);
    row.appendChild(copyButton);

    row.dataset.pgnButtonAdded = "true";

    console.log(
        "[Duolingo Chess] Botões adicionados:",
        row.dataset.matchId
    );
}

async function handleExportClick(row, button) {
    const matchId = row.dataset.matchId;

    if (!matchId) {
        console.error(
            "[Duolingo Chess] Line does not have a matchId."
        );

        return;
    }

    console.log(
        "[Duolingo Chess] Exporting match:",
        matchId
    );

    button.disabled = true;
    button.textContent = "Loading...";

    try {
        // 1. Busca os dados completos da partida
        const response = await api.runtime.sendMessage({
            type: "GET_MATCH",
            matchId
        });

        const match = response.match;

        if (!match) {
            throw new Error("Match data not found.");
        }

        if (!Array.isArray(match.moveHistory)) {
            throw new Error("moveHistory not found.");
        }

        console.log(
            "[Duolingo Chess] Movements UCI:",
            match.moveHistory
        );

        // 2. Converte UCI -> SAN
        const chess = new Chess();
        const sanMoves = [];

        for (const uciMove of match.moveHistory) {
            const from = uciMove.substring(0, 2);
            const to = uciMove.substring(2, 4);
            const promotion = uciMove.substring(4, 5);

            const move = chess.move({
                from,
                to,
                ...(promotion ? { promotion } : {})
            });

            if (!move) {
                throw new Error(
                    `Invalid move: ${uciMove}`
                );
            }

            sanMoves.push(move.san);
        }

        console.log(
            "[Duolingo Chess] Movements SAN:",
            sanMoves
        );

        // 3. Determina o resultado
        const result = getPGNResult(match.outcome);

        // 4. Determina jogadores
        const opponentName =
            row.dataset.opponentName || "Duolingo Player";

        let whiteName;
        let blackName;

        if (match.playerColor === "white") {
            whiteName = "You";
            blackName = opponentName;
        } else {
            whiteName = opponentName;
            blackName = "You";
        }

        // 5. Monta o texto dos movimentos
        const moveText = buildMoveText(
            sanMoves,
            result
        );

        // 6. Monta o PGN completo
        const pgn = buildPGN({
            match,
            whiteName,
            blackName,
            result,
            moveText
        });

        console.log(
            "[Duolingo Chess] PGN generated:\n" + pgn
        );

        // 7. Baixa o arquivo
        downloadPGN(
            pgn,
            createPGNFilename(opponentName, matchId)
        );

        button.textContent = "Downloaded!";

    } catch (error) {
        console.error(
            "[Duolingo Chess] Error exporting PGN:",
            error
        );

        button.textContent = "Error";

    } finally {
        setTimeout(() => {
            button.disabled = false;
            button.textContent = "Export PGN";
        }, 1500);
    }
}

async function handleCopyClick(row, button) {
    const matchId = row.dataset.matchId;

    if (!matchId) {
        console.error("[Duolingo Chess] The row does not have a matchId.");
        return;
    }

    console.log("[Duolingo Chess] Copying a game:", matchId);

    button.disabled = true;
    button.textContent = "Loading...";

    try {
        const pgn = await generatePGN(row);

        await navigator.clipboard.writeText(pgn);

        console.log("[Duolingo Chess] PGN Copied:\n" + pgn);

        button.textContent = "Copied!";

    } catch (error) {
        console.error(
            "[Duolingo Chess] Error copying PGN:",
            error
        );

        button.textContent = "Error";

    } finally {
        setTimeout(() => {
            button.disabled = false;
            button.textContent = "Copy PGN";
        }, 1500);
    }
}

async function generatePGN(row) {
    const matchId = row.dataset.matchId;

    const response = await api.runtime.sendMessage({
        type: "GET_MATCH",
        matchId
    });

    const match = response.match;

    if (!match) {
        throw new Error("Match data not found.");
    }

    if (!Array.isArray(match.moveHistory)) {
        throw new Error("moveHistory not found.");
    }

    const chess = new Chess();
    const sanMoves = [];

    for (const uciMove of match.moveHistory) {
        const from = uciMove.substring(0, 2);
        const to = uciMove.substring(2, 4);
        const promotion = uciMove.substring(4, 5);

        const move = chess.move({
            from,
            to,
            ...(promotion ? { promotion } : {})
        });

        if (!move) {
            throw new Error(`Invalid move: ${uciMove}`);
        }

        sanMoves.push(move.san);
    }

    const result = getPGNResult(match.outcome);

    const opponentName =
        row.dataset.opponentName || "Duolingo Player";

    let whiteName;
    let blackName;

    if (match.playerColor === "white") {
        whiteName = "You";
        blackName = opponentName;
    } else {
        whiteName = opponentName;
        blackName = "You";
    }

    const moveText = buildMoveText(sanMoves, result);

    return buildPGN({
        match,
        whiteName,
        blackName,
        result,
        moveText
    });
}

function getPGNResult(outcome) {
    switch (outcome) {
        case "white":
            return "1-0";

        case "black":
            return "0-1";

        case "draw":
            return "1/2-1/2";

        default:
            return "*";
    }
}


function buildMoveText(sanMoves, result) {
    const moves = [];

    for (let i = 0; i < sanMoves.length; i += 2) {
        const moveNumber = Math.floor(i / 2) + 1;

        let move = `${moveNumber}. ${sanMoves[i]}`;

        if (sanMoves[i + 1]) {
            move += ` ${sanMoves[i + 1]}`;
        }

        moves.push(move);
    }

    return `${moves.join(" ")} ${result}`;
}


function buildPGN({
    match,
    whiteName,
    blackName,
    result,
    moveText
}) {
    const headers = [
        `[Event "Duolingo Chess"]`,
        `[Site "Duolingo"]`,
        `[White "${escapePGNValue(whiteName)}"]`,
        `[Black "${escapePGNValue(blackName)}"]`,
        `[Result "${result}"]`
    ];

    return `${headers.join("\n")}\n\n${moveText}\n`;
}


function escapePGNValue(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, " ");
}


function downloadPGN(pgn, filename) {
    const blob = new Blob(
        [pgn],
        {
            type: "application/x-chess-pgn;charset=utf-8"
        }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);

    link.click();

    link.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}



function createPGNFilename(opponentName, matchId) {
    const safeName = String(opponentName || "opponent")
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
        .replace(/\s+/g, "_")
        .substring(0, 50);

    const safeMatchId = String(matchId)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");

    return `duolingo-chess-${safeName}-${safeMatchId}.pgn`;
}

function inspectMatches() {
    const rows = document.querySelectorAll(
        '[data-test="chess-match-history-row"]'
    );

    if (rows.length === 0) return;

    const rowCountChanged = rows.length !== lastRowCount;

    if (rowCountChanged) {
        console.log(
            "[Duolingo Chess] Match history changed:",
            lastRowCount,
            "→",
            rows.length
        );

        lastRowCount = rows.length;
    }

    // Ainda não recebemos nenhum histórico (nem por interceptação de
    // rede, nem pelo fallback). Agenda uma tentativa via background.
    if (historyMatches.length === 0) {
        scheduleFallbackIfStale();
        return;
    }

    // O DOM já mudou (nova partida apareceu ou sumiu) mas ainda não
    // recebemos o histórico atualizado via interceptação de rede.
    // NÃO mexe nas rows com dados velhos - só espera os dados
    // corretos chegarem. Se demorar demais, aciona o fallback.
    if (rows.length !== historyMatchCount) {
        scheduleFallbackIfStale();
        return;
    }

    limitHistoryRows(historyMatchCount);
    attachMatchesToRows(historyMatches);
}

function limitHistoryRows(maxRows) {
    const rows = document.querySelectorAll(
        '[data-test="chess-match-history-row"]'
    );

    if (rows.length <= maxRows) return;

    rows.forEach((row, index) => {
        if (index >= maxRows) {
            row.remove();
        }
    });
}

let inspectDebounceTimer = null;

function scheduleInspectMatches() {
    if (inspectDebounceTimer) {
        clearTimeout(inspectDebounceTimer);
    }

    inspectDebounceTimer = setTimeout(() => {
        inspectDebounceTimer = null;
        inspectMatches();
    }, 100);
}

const observer = new MutationObserver(() => {
    scheduleInspectMatches();
});

// Alguns navegadores podem carregar o content script depois que a
// interceptação já perdeu a primeira requisição de histórico (ex.:
// extensão instalada com a página já aberta). Se isso acontecer, o
// próprio inspectMatches() vai acionar o fallback via background
// assim que perceber que ainda não tem dados.

observer.observe(document.body, {
    childList: true,
    subtree: true
});

inspectMatches();