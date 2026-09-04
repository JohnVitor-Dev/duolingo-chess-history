const chess = new Chess();

const api = globalThis.browser ?? globalThis.chrome;

console.log("[Duolingo Chess] Content script loaded.");

let lastRowCount = 0;
let historyRequested = false;
let historyMatchCount = 0;
let historyMatches = [];

async function loadMatchHistory() {
    if (historyRequested) return;
    historyRequested = true;

    try {
        console.log("[Duolingo Chess] Solicitando histórico...");

        const history = await browser.runtime.sendMessage({
            type: "GET_MATCH_HISTORY"
        });

        const matches = history.matchHistory ?? [];

        // Guarda as partidas para podermos reassociá-las
        // sempre que o Duolingo recriar as linhas.
        historyMatches = matches;
        historyMatchCount = matches.length;

        console.log(
            "[Duolingo Chess] Histórico recebido:",
            matches.length,
            "partidas"
        );

        attachMatchesToRows(matches);
        limitHistoryRows(historyMatchCount);

    } catch (error) {
        historyRequested = false;

        console.error(
            "[Duolingo Chess] Erro ao carregar histórico:",
            error
        );
    }
}

function attachMatchesToRows(matches) {
    const rows = document.querySelectorAll(
        '[data-test="chess-match-history-row"]'
    );

    rows.forEach((row, index) => {
        const match = matches[index];

        if (!match?.matchId) return;

        row.dataset.matchId = match.matchId;
        row.dataset.opponentName =
            match.opponentName || "Duolingo Bot";

        addExportButton(row);
    });
}

function addExportButton(row) {
    if (row.dataset.pgnButtonAdded === "true") return;

    const exportButton = document.createElement("button");
    exportButton.textContent = "Exportar PGN";
    exportButton.type = "button";

    exportButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await handleExportClick(row, exportButton);
    });

    const copyButton = document.createElement("button");
    copyButton.textContent = "Copiar PGN";
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

        button.textContent = "Erro";

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
        console.error("[Duolingo Chess] Linha não possui matchId.");
        return;
    }

    console.log("[Duolingo Chess] Copiando partida:", matchId);

    button.disabled = true;
    button.textContent = "Carregando...";

    try {
        const pgn = await generatePGN(row);

        await navigator.clipboard.writeText(pgn);

        console.log("[Duolingo Chess] PGN copiado:\n" + pgn);

        button.textContent = "Copiado!";

    } catch (error) {
        console.error(
            "[Duolingo Chess] Erro ao copiar PGN:",
            error
        );

        button.textContent = "Erro";

    } finally {
        setTimeout(() => {
            button.disabled = false;
            button.textContent = "Copiar PGN";
        }, 1500);
    }
}

async function generatePGN(row) {
    const matchId = row.dataset.matchId;

    const response = await browser.runtime.sendMessage({
        type: "GET_MATCH",
        matchId
    });

    const match = response.match;

    if (!match) {
        throw new Error("Dados da partida não encontrados.");
    }

    if (!Array.isArray(match.moveHistory)) {
        throw new Error("moveHistory não encontrado.");
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
            throw new Error(`Movimento inválido: ${uciMove}`);
        }

        sanMoves.push(move.san);
    }

    const result = getPGNResult(match.outcome);

    const opponentName =
        row.dataset.opponentName || "Duolingo Player";

    let whiteName;
    let blackName;

    if (match.playerColor === "white") {
        whiteName = "Você";
        blackName = opponentName;
    } else {
        whiteName = opponentName;
        blackName = "Você";
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

    if (rows.length !== lastRowCount) {
        lastRowCount = rows.length;

        console.log(
            "[Duolingo Chess] Partidas encontradas:",
            rows.length
        );
    }

    if (!historyRequested) {
        loadMatchHistory();
        return;
    }

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

const observer = new MutationObserver(() => {
    if (historyMatchCount > 0) {
        limitHistoryRows(historyMatchCount);
        attachMatchesToRows(historyMatches);
    }

    inspectMatches();
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

inspectMatches();