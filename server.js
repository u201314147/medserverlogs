const fs = require('fs');
const readline = require('readline');
const express = require('express');

const LOG_FILE = './nohup.out';
const OUTPUT_FILE = './games.json';
const PORT = 3000;

const app = express();

let games = {};
let finishedGames = [];
let fileSize = 0;

// Regex
const gameAddedRegex = /Game (\d+) added on (.+)$/;
const assignedRegex = /assigned to game (\d+) .* <(.+?)> -/;
const disconnectedRegex = /Client \d+, <(.+?)> disconnected from game (\d+)/;
const gameDestroyedRegex = /Game (\d+) destroyed on (.+)$/;

function saveJSON() {
    fs.writeFileSync(
        OUTPUT_FILE,
        JSON.stringify(finishedGames, null, 2),
        'utf8'
    );
}

function parseDate(dateString) {
    return new Date(dateString);
}

function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return [
        hrs.toString().padStart(2, '0'),
        mins.toString().padStart(2, '0'),
        secs.toString().padStart(2, '0')
    ].join(':');
}

function processLine(line) {
    let match;

    // Game added
    match = line.match(gameAddedRegex);
    if (match) {
        const gameId = match[1];

        games[gameId] = {
            gameId: Number(gameId),
            createdAt: match[2],
            createdAtDate: parseDate(match[2]),
            players: [],
            listPlayed: []
        };
        return;
    }

    // Player assigned
    match = line.match(assignedRegex);
    if (match) {
        const gameId = match[1];
        const playerName = match[2];

        if (games[gameId] && !games[gameId].players.includes(playerName)) {
            games[gameId].players.push(playerName);
        }
        return;
    }

    // Player disconnected
    match = line.match(disconnectedRegex);
    if (match) {
        const playerName = match[1];
        const gameId = match[2];

        if (games[gameId]) {
            games[gameId].players = games[gameId].players.filter(
                p => p !== playerName
            );

            if (!games[gameId].listPlayed.includes(playerName)) {
                games[gameId].listPlayed.push(playerName);
            }
        }
        return;
    }

    // Game destroyed
    match = line.match(gameDestroyedRegex);
    if (match) {
        const gameId = match[1];
        const endDateStr = match[2];

        if (games[gameId]) {

            // Agregar jugadores restantes a listPlayed
            games[gameId].players.forEach(player => {
                if (!games[gameId].listPlayed.includes(player)) {
                    games[gameId].listPlayed.push(player);
                }
            });

            const endDate = parseDate(endDateStr);
            const startDate = games[gameId].createdAtDate;

            const durationSeconds = Math.floor((endDate - startDate) / 1000);

            const finishedGame = {
                gameId: games[gameId].gameId,
                createdAt: games[gameId].createdAt,
                gameEnd: endDateStr,
                durationSeconds,
                durationFormatted: formatDuration(durationSeconds),
                listPlayed: games[gameId].listPlayed
            };

            finishedGames.push(finishedGame);
            delete games[gameId];

            saveJSON();
        }
    }
}

async function readInitialFile() {
    if (!fs.existsSync(LOG_FILE)) return;

    const rl = readline.createInterface({
        input: fs.createReadStream(LOG_FILE),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        processLine(line);
    }

    fileSize = fs.statSync(LOG_FILE).size;
}

function watchFile() {
    fs.watch(LOG_FILE, (eventType) => {
        if (eventType !== 'change') return;

        const stats = fs.statSync(LOG_FILE);

        if (stats.size < fileSize) {
            fileSize = 0;
        }

        const stream = fs.createReadStream(LOG_FILE, {
            start: fileSize,
            end: stats.size
        });

        const rl = readline.createInterface({
            input: stream,
            crlfDelay: Infinity
        });

        rl.on('line', processLine);
        rl.on('close', () => {
            fileSize = stats.size;
        });
    });
}

/* ==========================
   🔥 API REST
========================== */

app.get('/games/active', (req, res) => {
    const active = Object.values(games).map(g => ({
        gameId: g.gameId,
        createdAt: g.createdAt,
        players: g.players
    }));

    res.json(active);
});

app.get('/games/finished', (req, res) => {
    res.json(finishedGames);
});

app.get('/games/:id', (req, res) => {
    const id = req.params.id;

    if (games[id]) {
        return res.json({
            gameId: games[id].gameId,
            createdAt: games[id].createdAt,
            players: games[id].players
        });
    }

    const finished = finishedGames.find(g => g.gameId == id);
    if (finished) {
        return res.json(finished);
    }

    res.status(404).json({ error: 'Game not found' });
});

app.get('/stats', (req, res) => {
    const avgDuration =
        finishedGames.length === 0
            ? 0
            : Math.floor(
                  finishedGames.reduce((acc, g) => acc + g.durationSeconds, 0) /
                  finishedGames.length
              );

    res.json({
        activeGames: Object.keys(games).length,
        finishedGames: finishedGames.length,
        totalPlayersActive: Object.values(games)
            .reduce((acc, g) => acc + g.players.length, 0),
        averageGameDuration: formatDuration(avgDuration)
    });
});

async function start() {
    await readInitialFile();
    watchFile();

    app.listen(PORT, () => {
        console.log(`🚀 API corriendo en http://localhost:${PORT}`);
    });
}
app.get('/games/finished/table', (req, res) => {
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>Games Finished</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background: #f5f5f5;
                padding: 20px;
            }
            table {
                border-collapse: collapse;
                width: 100%;
                background: #fff;
            }
            th, td {
                border: 1px solid #ddd;
                padding: 8px;
                text-align: left;
            }
            th {
                background: #333;
                color: white;
            }
            tr:nth-child(even) {
                background: #f2f2f2;
            }
            .players {
                font-size: 0.9em;
                color: #444;
            }
        </style>
    </head>
    <body>
        <h1>🎮 Games Finalizados</h1>
        <table>
            <thead>
                <tr>
                    <th>Game ID</th>
                    <th>Inicio</th>
                    <th>Fin</th>
                    <th>Duración</th>
                    <th>Jugadores</th>
                </tr>
            </thead>
            <tbody>
    `;

    finishedGames.forEach(game => {
        html += `
            <tr>
                <td>${game.gameId}</td>
                <td>${game.createdAt}</td>
                <td>${game.gameEnd}</td>
                <td>${game.durationFormatted}</td>
                <td class="players">${game.listPlayed.join(', ')}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});
start();