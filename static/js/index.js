$(document).ready(() => {
    function getMainDomain() {
        const url = window.location.hostname;
        
        try {
          const urlWithoutProtocol = url.replace(/^(https?:\/\/)?(www\.)?/, '');
          const domain = urlWithoutProtocol.split('/')[0];
          
          if (domain.includes('localhost')) {
            const localParts = domain.split('.');
            const localhostIndex = localParts.findIndex(part => part === 'localhost');
            if (localhostIndex !== -1) {
              return localParts.slice(localhostIndex, localhostIndex + 2).join('.');
            }
          }
          
          const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
          if (ipRegex.test(domain)) {
            return domain;
          }
          
          const parts = domain.split('.');
          if (parts.length <= 2) return domain;
          
          return parts.slice(-2).join('.');
        } catch (error) {
          return '';
        }
      }

    const CONSTANTS = {
        WS_URL: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//ws-dk.${getMainDomain()}`,
        MIN_TOKEN_LENGTH: 15,
        COUNTDOWN_TIME: 30,
        RECONNECT_DELAY: 5000,
        PARTY_COLORS: [
            "rgba(108, 92, 231, 0.25)",   // Purple
            "rgba(255, 159, 67, 0.25)",   // Orange
            "rgba(72, 219, 251, 0.25)",   // Light Blue
            "rgba(29, 209, 161, 0.25)",   // Mint Green
            "rgba(255, 107, 107, 0.25)",  // Soft Red
            "rgba(255, 210, 63, 0.25)",   // Golden Yellow
            "rgba(52, 172, 224, 0.25)",   // Sky Blue
            "rgba(11, 232, 129, 0.25)",   // Bright Green
            "rgba(224, 86, 253, 0.25)",   // Magenta
            "rgba(156, 136, 255, 0.25)",  // Periwinkle
            "rgba(251, 197, 49, 0.25)",   // Marigold
            "rgba(76, 209, 55, 0.25)",    // Lime Green
            "rgba(232, 65, 24, 0.25)",    // Coral
            "rgba(126, 214, 223, 0.25)",  // Turquoise
            "rgba(224, 130, 131, 0.25)",  // Dusty Rose
            "rgba(83, 82, 237, 0.25)",    // Royal Blue
            "rgba(255, 127, 80, 0.25)",   // Salmon
            "rgba(46, 134, 222, 0.25)",   // Ocean Blue
            "rgba(184, 233, 148, 0.25)"   // Light Green
        ]
    };

    let socket = null;

    const elements = {
        token: $("#token"),
        goBtn: $("#go-btn"),
        teamTable: $("#team-table"),
        enemyTable: $("#enemy-table"),
        teamCaption: $("#team-caption"),
        enemyCaption: $("#enemy-caption"),
        tokenExpiration: $("#token-expiration"),
        autoReady: $("#autoReady"),
        showEnemyOnly: $("#showEnemyOnly"),
        showBattleCount: $("#showBattleCount"),
        winRatesOption: $("#win-rates-option"),
        eyeShow: $("#eye-show"),
        eyeOff: $("#eye-off"),
        heroMmrTableBody: $("#hero-mmr-table-body"),
        asHost: $("#asHost"),
    };

    const alertSound = new Audio('/static/ogg/alert.ogg');
    alertSound.preload = 'auto';

    const templates = {
        skeleton: () => `
            <tr>
                <td><div class="skeleton"></div></td>
                <td><div class="skeleton"></div></td>
                <td><div class="skeleton"></div></td>
                <td><div class="skeleton"></div></td>
                <td><div class="skeleton"></div></td>
                <td><div class="skeleton"></div></td>
            </tr>
        `,
        waiting: () => `
            <tr>
                <td class="text-center" colspan="6">Waiting for data...</td>
            </tr>
        `
    };

    const startCountdown = (countdown) => {
        const countDownAlert = addAlert(
            `Game will start in ${countdown} second(s)...`,
            "info",
            countdown * 1000
        );

        const countdownInterval = setInterval(() => {
            countdown--;
            const alertText = countDownAlert.querySelector(".alert-text");
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                closeAlert(countDownAlert);
                return;
            }
            alertText.textContent = `Game will start in ${countdown} second(s)...`;
        }, 1000);
    };

    const updateTokenExpiration = () => {
        $.ajax({
            url: "/api/get-token-expiration",
            type: "GET",
            data: {
                token: elements.token.val()
            },
            success: (response) => {
                elements.tokenExpiration.text(
                    `Token will be expired at ${response.expired_at}.`
                );
            },
            error: (response) => {
                elements.tokenExpiration.text(response.responseJSON.message);
            }
        });
    };

    const uiHandlers = {
        toggleTokenBlur: () => {
            const hasBlur = elements.token.hasClass("blur-sm");
            elements.token.toggleClass("blur-sm", !hasBlur);
            elements.eyeShow.toggleClass("hidden", !hasBlur);
            elements.eyeOff.toggleClass("hidden", hasBlur);
        },

        handleTokenFocus: (e) => {
            $(e.target).parent().toggleClass("border-2 border-blue-500", e.type === "focus");
        },

        saveSettings: () => {
            const settings = {
                showEnemyOnly: elements.showEnemyOnly.prop("checked"),
                autoReady: elements.autoReady.prop("checked"),
                showBattleCount: elements.showBattleCount.prop("checked"),
                winRatesOption: elements.winRatesOption.val(),
                asHost: elements.asHost.prop("checked")
            };

            Object.entries(settings).forEach(([key, value]) => {
                localStorage.setItem(key, value);
            });

            new HSOverlay.close("#hs-setting-modal");
        }, 

        updateTableLayout: () => {
            elements.teamTable.toggle(!elements.showEnemyOnly.prop("checked"));
        }
    };

    const roomColorMap = {};
    const dataProcessors = {
        getPartyColor: (roomId) => {
            if (!roomId) return "";
            if (!roomColorMap[roomId]) {
                const availableColors = CONSTANTS.PARTY_COLORS.filter(
                    color => !Object.values(roomColorMap).includes(color)
                );

                var rng = new RNG(roomId);
                roomColorMap[roomId] = availableColors.length > 0
                    ? availableColors[0]
                    : CONSTANTS.PARTY_COLORS[rng.nextInt() % CONSTANTS.PARTY_COLORS.length];
            }
            return roomColorMap[roomId];
        },
        formatWinRates: (player, showBattleCount, winRatesOption) => {
            if (!player.win_rates) {
                let win_rate;
                if (player.battle_count >= player.battle_win_count) {
                    win_rate = (player.battle_win_count / player.battle_count) * 100;
                    return showBattleCount ? 
                    `Total Win Rates (All Season): ${win_rate.toFixed(2)}% (${player.battle_win_count}/${player.battle_count})` : 
                    `Total Win Rates (All Season): ${win_rate.toFixed(2)}%`;
                } else {
                    win_rate = (player.battle_count / player.battle_win_count) * 100;
                    return showBattleCount ? 
                    `Total Win Rates: ${win_rate.toFixed(2)}% (${player.battle_win_count}/${player.battle_count})` : 
                    `Total Win Rates: ${win_rate.toFixed(2)}%`;
                }
            }

            const formatRate = (type) => {
                const wr = player.win_rates[`${type}_wr`].toFixed(2);
                return showBattleCount ? 
                    `${type.charAt(0).toUpperCase() + type.slice(1)}: ${wr}% (${player.win_rates[type]})` :
                    `${type.charAt(0).toUpperCase() + type.slice(1)}: ${wr}%`;
            };

            if (winRatesOption === "all") {
                return ["classic", "ranked", "brawl", "total"]
                    .map(type => formatRate(type))
                    .join(", ");
            }
            
            return formatRate(winRatesOption);
        }
    };

    const getHeroDetails = (gameId) => {
        const player = globalThis.battleDetails.find(hero => hero.game_id === gameId);
        if (!player) return [];
        return player.heroes;
    };

    const showHeroMmrDetails = (gameId) => {
        const heroData = getHeroDetails(gameId);
        if (heroData.length === 0) {
            addAlert("No hero data found!", "error");
            return;
        }

        elements.heroMmrTableBody.empty();

        let playerInfo = "";
        const teamPlayer = globalThis.team.find(p => p.game_id === gameId);
        const enemyPlayer = globalThis.enemy.find(p => p.game_id === gameId);
        const player = teamPlayer || enemyPlayer;

        if (player) {
            playerInfo = `${player.game_id} (${player.server_id}) - ${player.nickname}`;
            $("#hero-player-info").text(playerInfo);
        } else {
            $("#hero-player-info").text("");
        }

        heroData.forEach(hero => {
            elements.heroMmrTableBody.append(`
                <tr>
                    <td class="px-4 py-2">${hero.hero}</td>
                    <td class="px-4 py-2">${hero.mmr} (Highest: ${hero.highest_mmr})</td>
                    <td class="px-4 py-2">${hero.wr}</td>
                </tr>
            `);
        });

        HSOverlay.open("#hs-hero-modal");
    };

    const wsHandlers = {
        connect: () => {
            if (socket) socket.close();
            
            socket = new WebSocket(CONSTANTS.WS_URL);
            socket.onopen = wsHandlers.onConnect;
            socket.onclose = wsHandlers.onDisconnect;
            socket.onerror = wsHandlers.onError;
            socket.onmessage = wsHandlers.onMessage;
        },

        onConnect: () => {
            elements.goBtn.prop("disabled", false);
            addAlert("Connected to Main Server!", "success", 3000);
        },

        onDisconnect: () => {
            elements.goBtn.prop("disabled", true);
            addAlert("Reconnecting...", "error");
            setTimeout(wsHandlers.connect, CONSTANTS.RECONNECT_DELAY);
        },

        onError: (error) => {
            if (error !== undefined && error.message !== undefined) {
                addAlert(error.message, "error");
            }
            
            elements.token.prop("disabled", false);
            elements.goBtn.prop("disabled", false);
        },

        onMessage: (event) => {
            const data = JSON.parse(event.data);
            wsHandlers.handleResponse(data);
        },

        handleResponse: (response) => {
            if (response.error !== undefined) {
                addAlert(response.error, "error");
                elements.token.prop("disabled", false);
                elements.goBtn.prop("disabled", false);
                return;
            }

            if (response.room_info !== undefined && response.room_info != null) {
                wsHandlers.handleRoomInfo(response.room_info);
            } else if (response.hero_details !== undefined && response.hero_details != null) {
                wsHandlers.handleHeroDetails(response.hero_details);
            } else if (response.result !== undefined && response.result != null) {
                // Abaikan respons result karena sudah ditangani oleh room_info
                return;
            } else {
                addAlert("No data received!", "error");
                elements.token.prop("disabled", false);
                elements.goBtn.prop("disabled", false);
                return;
            }
        },

        handleRoomInfo: (data) => {
            try {
                if (!document.hasFocus()) {
                    alertSound.play().catch(e => console.log('Error playing sound:', e));
                }
                
                globalThis.team = data.team;
                globalThis.enemy = data.enemy;

                localStorage.setItem("token", elements.token.val());
                updateTokenExpiration();

                const now = Math.floor(Date.now() / 1000);
                startCountdown(CONSTANTS.COUNTDOWN_TIME - (now - data.timestamp));

                const renderPlayers = (players, tableElement) => {
                    tableElement.find("tbody").empty();

                    players.forEach(player => {
                        const color = player.room_id ? dataProcessors.getPartyColor(player.room_id) : "";
                        let rank = player.rank;
                        if (player.highest_rank != '') {
                            rank = `${player.rank} (Highest: ${player.highest_rank})`;
                        }

                        const wr = dataProcessors.formatWinRates(
                            player,
                            elements.showBattleCount.prop("checked"),
                            elements.winRatesOption.val()
                        );

                        tableElement.find("tbody").append(`
                            <tr style="background-color: ${color}">
                                <td>${player.game_id} (${player.server_id})</td>
                                <td>${player.nickname}</td>
                                <td>${player.squad}</td>
                                <td>${rank}</td>
                                <td>${wr}</td>
                                <td class="text-center" id="hero-details-${player.game_id}">Loading...</td>
                            </tr>
                        `);
                    });
                };

                renderPlayers(data.team, elements.teamTable);
                renderPlayers(data.enemy, elements.enemyTable);

                uiHandlers.updateTableLayout();
                elements.token.prop("disabled", false);
                elements.goBtn.prop("disabled", false);
            } catch (error) {
                addAlert("Error: " + error.message, "error");
                elements.token.prop("disabled", false);
                elements.goBtn.prop("disabled", false);
            }
        },
        handleWinRateDetails: (data) => {
            try {
                globalThis.winRateDetails = data;
                if (data.length === 0) {
                    addAlert("No winrate details found!", "error");
                    return;
                }

                for (let i = 0; i < data.length; i++) {
                    $(`#win-rate-${data[i].game_id}`).text(`
                        Ranked: ${data[i].ranked_wr.toFixed(2)}% (${data[i].ranked})
                    `);
                }
            } catch (error) {
                addAlert("Error: " + error.message, "error");
            }
        },
        handleHeroDetails: (data) => {
            try {
                globalThis.battleDetails = data;
                if (data.length === 0) {
                    addAlert("No hero details found!", "error");
                    return;
                }

                for (let i = 0; i < data.length; i++) {
                    $(`#hero-details-${data[i].game_id}`).html(`
                        <button class="btn btn-primary btn-xs">
                            View
                        </button>
                    `).find("button").on("click", function(e) {
                        e.preventDefault();
                        $(document).trigger('show-hero-mmr', [data[i].game_id]);
                    });
                }
            } catch (error) {
                addAlert("Error: " + error.message, "error");
            }
        }
    };

    const init = () => {
        if (localStorage.getItem("token")) {
            elements.token.val(localStorage.getItem("token"));
            updateTokenExpiration();
        }

        if (localStorage.getItem("asHost") === null) {
            localStorage.setItem("asHost", "true");
        }

        ["autoReady", "showEnemyOnly", "showBattleCount", "asHost"].forEach(setting => {
            const saved = localStorage.getItem(setting);
            if (saved) {
                $(`#${setting}`).prop("checked", saved === "true");
            }
        });

        const winRatesOption = localStorage.getItem("winRatesOption");
        if (winRatesOption) {
            elements.winRatesOption.val(winRatesOption);
        }

        elements.goBtn.on("click", () => {
            const token = elements.token.val();
            
            if (!token) {
                addAlert("Token is required!", "error", 3000);
                return;
            }

            if (token.length < CONSTANTS.MIN_TOKEN_LENGTH) {
                addAlert("Invalid token!", "error", 3000);
                return;
            }

            elements.teamTable.find('tbody').html(
                Array(6).fill(templates.skeleton()).join('')
            );
            elements.enemyTable.find('tbody').html(
                Array(6).fill(templates.skeleton()).join('')
            );

            const asHostValue = elements.asHost.prop("checked");
            
            localStorage.setItem("asHost", asHostValue.toString());

            socket.send(JSON.stringify({
                type: "go",
                token: token,
                autoReady: elements.autoReady.prop("checked"),
                asHost: asHostValue
            }));

            elements.goBtn.prop("disabled", true);
            elements.token.prop("disabled", true);
        });

        elements.asHost.on("change", function() {
            const isChecked = $(this).prop("checked");
            localStorage.setItem("asHost", isChecked.toString());
            addAlert(`Mode As Host ${isChecked ? 'diaktifkan' : 'dinonaktifkan'}`, "info", 3000);
        });

        $("#blur-token").on("click", uiHandlers.toggleTokenBlur);
        elements.token.on("focus blur", uiHandlers.handleTokenFocus);
        $("#save-setting").on("click", uiHandlers.saveSettings);
        elements.showEnemyOnly.on("change", uiHandlers.updateTableLayout);

        $(document).on('show-hero-mmr', (event, gameId) => {
            showHeroMmrDetails(gameId);
        });

        wsHandlers.connect();
        uiHandlers.updateTableLayout();
    };

    init();
});