// ============= CONFIGURATION =============
const CONFIG = {
    ARENA_WIDTH: 800,
    ARENA_HEIGHT: 500,
    PLAYER_RADIUS: 20,
    PLAYER_HEIGHT: 40,
    SNOWBALL_RADIUS: 8,
    SNOWBALL_SPEED_MIN: 4,
    SNOWBALL_SPEED_MAX: 12,
    PLAYER_SPEED: 2.5,
    MAX_SNOWBALLS: 3,
    LONG_PRESS_TIME: 200,
    MAX_CHARGE_TIME: 750,
    HIT_FLASH_DURATION: 200,
    ISO_ANGLE: 0.5,
    WALL_HEIGHT: 25,
    WALL_THICKNESS: 15,
    TAPS_TO_RELOAD: 10,
    TAP_WINDOW: 2000, // ms window for tap combo
};

// ============= OBSTACLES =============
const obstacles = [
    { type: 'tree', x: 200, y: 100, radius: 25 },
    { type: 'tree', x: 600, y: 350, radius: 25 },
    { type: 'snowhill', x: 400, y: 150, radiusX: 40, radiusY: 25 },
    { type: 'snowhill', x: 400, y: 300, radiusX: 40, radiusY: 25 },
];

// ============= GAME STATE =============
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = 'menu';
let players = [];
let snowballs = [];
let lastTime = 0;

// Multi-touch tracking: touchId -> { player, startTime, startPos, isCharging, chargeStart }
const activeTouches = new Map();

// ============= CANVAS SETUP =============
function resizeCanvas() {
    const container = document.getElementById('gameContainer');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Use full screen resolution
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
}

function toggleFullscreen() {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
            elem.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

// ============= COORDINATE CONVERSION =============
function getScale() {
    // Scale to fill the canvas, accounting for isometric squash on Y
    const effectiveArenaHeight = CONFIG.ARENA_HEIGHT * CONFIG.ISO_ANGLE + CONFIG.WALL_HEIGHT;
    return Math.min(canvas.width / CONFIG.ARENA_WIDTH, canvas.height / effectiveArenaHeight);
}

function toScreen(x, y, z = 0) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const scale = getScale();

    return {
        x: centerX + (x - CONFIG.ARENA_WIDTH / 2) * scale,
        y: centerY + (y - CONFIG.ARENA_HEIGHT / 2) * scale * CONFIG.ISO_ANGLE - z * scale
    };
}

function toGame(screenX, screenY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (screenX - rect.left) * scaleX;
    const canvasY = (screenY - rect.top) * scaleY;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const scale = getScale();

    return {
        x: (canvasX - centerX) / scale + CONFIG.ARENA_WIDTH / 2,
        y: (canvasY - centerY) / (scale * CONFIG.ISO_ANGLE) + CONFIG.ARENA_HEIGHT / 2
    };
}

// ============= OBSTACLE COLLISION =============
function checkObstacleCollision(x, y, radius) {
    for (let obs of obstacles) {
        if (obs.type === 'tree') {
            const dx = x - obs.x;
            const dy = y - obs.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < radius + obs.radius) {
                return obs;
            }
        } else if (obs.type === 'snowhill') {
            const dx = (x - obs.x) / obs.radiusX;
            const dy = (y - obs.y) / obs.radiusY;
            if (dx * dx + dy * dy < 1 + radius / Math.min(obs.radiusX, obs.radiusY)) {
                return obs;
            }
        }
    }
    return null;
}

// ============= PLAYER CLASS =============
function createPlayer(x, y, team, id) {
    return {
        id: id,
        x: x,
        y: y,
        targetX: null,
        targetY: null,
        team: team,
        health: 2,
        snowballs: 1, // Start with 1 snowball
        state: 'idle',
        hitFlash: 0,
        knockedOut: false,
        // Human control state
        controlledBy: null, // touchId or 'mouse'
        isCharging: false,
        chargeStart: 0,
        chargeProgress: 0,
        // Tap reload tracking
        tapTimes: [],
    };
}

// ============= GAME INITIALIZATION =============
function initGame() {
    players = [
        createPlayer(80, 250, 'blue', 0),
        createPlayer(720, 250, 'red', 1)
    ];
    snowballs = [];
    activeTouches.clear();
}

function startGame() {
    document.getElementById('startScreen').classList.remove('active');
    document.getElementById('winScreen').classList.remove('active');
    document.getElementById('loseScreen').classList.remove('active');
    document.getElementById('hud').style.display = 'flex';
    document.getElementById('instructions').style.display = 'block';

    initGame();
    gameState = 'playing';
}

function endGame(won) {
    gameState = won ? 'win' : 'lose';
    document.getElementById('hud').style.display = 'none';
    document.getElementById('instructions').style.display = 'none';

    // Release all touches
    activeTouches.clear();
    players.forEach(p => {
        p.controlledBy = null;
        p.isCharging = false;
    });

    if (won) {
        document.getElementById('winScreen').classList.add('active');
    } else {
        document.getElementById('loseScreen').classList.add('active');
    }
}

// ============= INPUT HANDLING =============
function findPlayerAtPos(gamePos, excludeTouchId = null) {
    for (let player of players) {
        if (player.knockedOut) continue;
        // Skip players already controlled by another touch
        if (player.controlledBy !== null && player.controlledBy !== excludeTouchId) continue;

        const dx = player.x - gamePos.x;
        const dy = player.y - gamePos.y;
        if (Math.sqrt(dx * dx + dy * dy) < CONFIG.PLAYER_RADIUS * 2.5) {
            return player;
        }
    }
    return null;
}

function handleTouchStart(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();

    for (let touch of e.changedTouches) {
        const pos = { x: touch.clientX, y: touch.clientY };
        const gamePos = toGame(pos.x, pos.y);
        const player = findPlayerAtPos(gamePos);

        if (player) {
            // Claim this player with this touch
            player.controlledBy = touch.identifier;
            player.state = 'idle';
            player.targetX = null;
            player.targetY = null;

            activeTouches.set(touch.identifier, {
                player: player,
                startTime: performance.now(),
                startPos: gamePos,
                currentPos: gamePos,
            });
        }
    }
}

function handleTouchMove(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();

    for (let touch of e.changedTouches) {
        const touchData = activeTouches.get(touch.identifier);
        if (!touchData) continue;

        const pos = { x: touch.clientX, y: touch.clientY };
        const gamePos = toGame(pos.x, pos.y);
        touchData.currentPos = gamePos;

        const player = touchData.player;
        if (!player || player.knockedOut) continue;

        const elapsed = performance.now() - touchData.startTime;

        // After long press threshold, start charging if has snowballs
        if (elapsed > CONFIG.LONG_PRESS_TIME && player.snowballs > 0 && !player.isCharging) {
            player.isCharging = true;
            player.chargeStart = performance.now();
        }

        // Always set movement target (player follows finger, can move while charging)
        const minBound = CONFIG.WALL_THICKNESS + CONFIG.PLAYER_RADIUS;
        const maxBoundX = CONFIG.ARENA_WIDTH - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS;
        const maxBoundY = CONFIG.ARENA_HEIGHT - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS;

        player.targetX = Math.max(minBound, Math.min(maxBoundX, gamePos.x));
        player.targetY = Math.max(minBound, Math.min(maxBoundY, gamePos.y));
        player.state = player.isCharging ? 'aiming' : 'walking';
    }
}

function handleTouchEnd(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();

    for (let touch of e.changedTouches) {
        const touchData = activeTouches.get(touch.identifier);
        if (!touchData) continue;

        const player = touchData.player;
        const elapsed = performance.now() - touchData.startTime;

        if (player && !player.knockedOut) {
            if (player.isCharging && player.snowballs > 0) {
                // Throw snowball
                const chargeTime = performance.now() - player.chargeStart;
                const chargePower = Math.min(1, chargeTime / CONFIG.MAX_CHARGE_TIME);
                throwSnowball(player, chargePower);
                player.isCharging = false;
                player.chargeProgress = 0;
                player.state = 'idle';
            } else if (elapsed < CONFIG.LONG_PRESS_TIME) {
                // Quick tap - count for reload
                const now = performance.now();
                player.tapTimes.push(now);
                // Remove old taps outside window
                player.tapTimes = player.tapTimes.filter(t => now - t < CONFIG.TAP_WINDOW);

                if (player.tapTimes.length >= CONFIG.TAPS_TO_RELOAD) {
                    if (player.snowballs < CONFIG.MAX_SNOWBALLS) {
                        player.snowballs++;
                    }
                    player.tapTimes = []; // Reset combo
                }
            }

            // Release player control
            player.controlledBy = null;
            player.targetX = null;
            player.targetY = null;
            if (player.state === 'walking') {
                player.state = 'idle';
            }
        }

        activeTouches.delete(touch.identifier);
    }
}

// Mouse support (single player)
let mouseDown = false;
let mousePlayer = null;
let mouseStartTime = 0;

function handleMouseDown(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();

    const pos = { x: e.clientX, y: e.clientY };
    const gamePos = toGame(pos.x, pos.y);
    const player = findPlayerAtPos(gamePos);

    if (player && player.controlledBy === null) {
        mouseDown = true;
        mousePlayer = player;
        mouseStartTime = performance.now();
        player.controlledBy = 'mouse';
    }
}

function handleMouseMove(e) {
    if (gameState !== 'playing' || !mouseDown || !mousePlayer) return;
    e.preventDefault();

    const pos = { x: e.clientX, y: e.clientY };
    const gamePos = toGame(pos.x, pos.y);
    const player = mousePlayer;
    const elapsed = performance.now() - mouseStartTime;

    if (player.knockedOut) return;

    // After long press threshold, start charging
    if (elapsed > CONFIG.LONG_PRESS_TIME && player.snowballs > 0 && !player.isCharging) {
        player.isCharging = true;
        player.chargeStart = performance.now();
    }

    // Always allow movement (can move while charging)
    const minBound = CONFIG.WALL_THICKNESS + CONFIG.PLAYER_RADIUS;
    const maxBoundX = CONFIG.ARENA_WIDTH - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS;
    const maxBoundY = CONFIG.ARENA_HEIGHT - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS;

    player.targetX = Math.max(minBound, Math.min(maxBoundX, gamePos.x));
    player.targetY = Math.max(minBound, Math.min(maxBoundY, gamePos.y));
    player.state = player.isCharging ? 'aiming' : 'walking';
}

function handleMouseUp(e) {
    if (gameState !== 'playing' || !mouseDown || !mousePlayer) return;
    e.preventDefault();

    const player = mousePlayer;
    const elapsed = performance.now() - mouseStartTime;

    if (player && !player.knockedOut) {
        if (player.isCharging && player.snowballs > 0) {
            const chargeTime = performance.now() - player.chargeStart;
            const chargePower = Math.min(1, chargeTime / CONFIG.MAX_CHARGE_TIME);
            throwSnowball(player, chargePower);
            player.isCharging = false;
            player.chargeProgress = 0;
            player.state = 'idle';
        } else if (elapsed < CONFIG.LONG_PRESS_TIME) {
            // Quick tap for reload
            const now = performance.now();
            player.tapTimes.push(now);
            player.tapTimes = player.tapTimes.filter(t => now - t < CONFIG.TAP_WINDOW);

            if (player.tapTimes.length >= CONFIG.TAPS_TO_RELOAD) {
                if (player.snowballs < CONFIG.MAX_SNOWBALLS) {
                    player.snowballs++;
                }
                player.tapTimes = [];
            }
        }

        player.controlledBy = null;
        player.targetX = null;
        player.targetY = null;
        if (player.state === 'walking') {
            player.state = 'idle';
        }
    }

    mouseDown = false;
    mousePlayer = null;
}

// ============= SNOWBALL MECHANICS =============
function throwSnowball(player, chargePower) {
    if (player.snowballs <= 0) return;

    player.snowballs--;
    const direction = player.team === 'blue' ? 1 : -1;
    const speed = CONFIG.SNOWBALL_SPEED_MIN + (CONFIG.SNOWBALL_SPEED_MAX - CONFIG.SNOWBALL_SPEED_MIN) * chargePower;

    snowballs.push({
        x: player.x + direction * (CONFIG.PLAYER_RADIUS + 10),
        y: player.y,
        z: CONFIG.PLAYER_HEIGHT * 0.5,
        vx: direction * speed,
        vy: 0,
        vz: 0,
        team: player.team,
        owner: player.id
    });
}

// ============= UPDATE FUNCTIONS =============
function updatePlayer(player, deltaTime) {
    if (player.knockedOut) return;

    if (player.hitFlash > 0) {
        player.hitFlash -= deltaTime;
    }

    // Update charge progress for human-controlled players
    if (player.isCharging && player.chargeStart > 0) {
        const chargeTime = performance.now() - player.chargeStart;
        player.chargeProgress = Math.min(1, chargeTime / CONFIG.MAX_CHARGE_TIME);
    }

    // Movement
    if (player.targetX !== null && player.targetY !== null) {
        const dx = player.targetX - player.x;
        const dy = player.targetY - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 5) {
            const newX = player.x + (dx / dist) * CONFIG.PLAYER_SPEED;
            const newY = player.y + (dy / dist) * CONFIG.PLAYER_SPEED;

            const obs = checkObstacleCollision(newX, newY, CONFIG.PLAYER_RADIUS);
            if (obs) {
                const obsCollisionX = checkObstacleCollision(newX, player.y, CONFIG.PLAYER_RADIUS);
                const obsCollisionY = checkObstacleCollision(player.x, newY, CONFIG.PLAYER_RADIUS);

                if (!obsCollisionX) {
                    player.x = newX;
                } else if (!obsCollisionY) {
                    player.y = newY;
                }
            } else {
                player.x = newX;
                player.y = newY;
            }

            player.x = Math.max(CONFIG.WALL_THICKNESS + CONFIG.PLAYER_RADIUS,
                Math.min(CONFIG.ARENA_WIDTH - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS, player.x));
            player.y = Math.max(CONFIG.WALL_THICKNESS + CONFIG.PLAYER_RADIUS,
                Math.min(CONFIG.ARENA_HEIGHT - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS, player.y));
        } else if (player.controlledBy === null) {
            // Only clear target if not being controlled
            player.targetX = null;
            player.targetY = null;
            if (player.state === 'walking') {
                player.state = 'idle';
            }
        }
    }
}

function updateSnowball(snowball, index) {
    snowball.x += snowball.vx;
    snowball.y += snowball.vy;
    snowball.z += snowball.vz;
    snowball.vz -= 0.15;

    // Check player collision (only when in the air)
    if (snowball.z > 0) {
        for (let player of players) {
            if (player.knockedOut) continue;
            if (player.team === snowball.team) continue;

            const dx = player.x - snowball.x;
            const dy = player.y - snowball.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < CONFIG.PLAYER_RADIUS + CONFIG.SNOWBALL_RADIUS) {
                player.health--;
                player.hitFlash = CONFIG.HIT_FLASH_DURATION;
                snowballs.splice(index, 1);

                if (player.health <= 0) {
                    player.knockedOut = true;
                    checkWinCondition();
                }
                return;
            }
        }
    }

    // Snowball stays on the ground where it falls
    if (snowball.z <= 0) {
        snowball.z = 0;
        snowball.vx = 0;
        snowball.vy = 0;
        snowball.vz = 0;
    }
}

function checkWinCondition() {
    const blueAlive = players.filter(p => p.team === 'blue' && !p.knockedOut).length;
    const redAlive = players.filter(p => p.team === 'red' && !p.knockedOut).length;

    if (blueAlive === 0) {
        setTimeout(() => endGame(false), 500);
    } else if (redAlive === 0) {
        setTimeout(() => endGame(true), 500);
    }
}

// ============= RENDERING =============
function drawArena() {
    const scale = getScale();

    ctx.fillStyle = '#e8f4f8';
    const topLeft = toScreen(0, 0);
    const topRight = toScreen(CONFIG.ARENA_WIDTH, 0);
    const bottomRight = toScreen(CONFIG.ARENA_WIDTH, CONFIG.ARENA_HEIGHT);
    const bottomLeft = toScreen(0, CONFIG.ARENA_HEIGHT);

    ctx.beginPath();
    ctx.moveTo(topLeft.x, topLeft.y);
    ctx.lineTo(topRight.x, topRight.y);
    ctx.lineTo(bottomRight.x, bottomRight.y);
    ctx.lineTo(bottomLeft.x, bottomLeft.y);
    ctx.closePath();
    ctx.fill();

    const midTop = toScreen(CONFIG.ARENA_WIDTH / 2, CONFIG.WALL_THICKNESS);
    const midBottom = toScreen(CONFIG.ARENA_WIDTH / 2, CONFIG.ARENA_HEIGHT - CONFIG.WALL_THICKNESS);
    ctx.strokeStyle = 'rgba(100, 150, 200, 0.3)';
    ctx.lineWidth = 3 * scale;
    ctx.setLineDash([15 * scale, 10 * scale]);
    ctx.beginPath();
    ctx.moveTo(midTop.x, midTop.y);
    ctx.lineTo(midBottom.x, midBottom.y);
    ctx.stroke();
    ctx.setLineDash([]);

    drawWall(0, 0, CONFIG.ARENA_WIDTH, 0, 'top');
    drawWall(0, 0, 0, CONFIG.ARENA_HEIGHT, 'left');
    drawWall(CONFIG.ARENA_WIDTH, 0, CONFIG.ARENA_WIDTH, CONFIG.ARENA_HEIGHT, 'right');
}

function drawWall(x1, y1, x2, y2, side) {
    const height = CONFIG.WALL_HEIGHT;
    const thickness = CONFIG.WALL_THICKNESS;

    if (side === 'top') {
        const left = toScreen(x1, y1);
        const right = toScreen(x2, y2);
        const leftTop = toScreen(x1, y1, height);
        const rightTop = toScreen(x2, y2, height);

        ctx.fillStyle = '#8b4513';
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.lineTo(rightTop.x, rightTop.y);
        ctx.lineTo(leftTop.x, leftTop.y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#a0522d';
        const innerLeft = toScreen(x1, y1 + thickness, height);
        const innerRight = toScreen(x2, y2 + thickness, height);
        ctx.beginPath();
        ctx.moveTo(leftTop.x, leftTop.y);
        ctx.lineTo(rightTop.x, rightTop.y);
        ctx.lineTo(innerRight.x, innerRight.y);
        ctx.lineTo(innerLeft.x, innerLeft.y);
        ctx.closePath();
        ctx.fill();
    } else if (side === 'left') {
        const top = toScreen(x1, y1);
        const bottom = toScreen(x2, y2);
        const topUp = toScreen(x1, y1, height);
        const bottomUp = toScreen(x2, y2, height);

        ctx.fillStyle = '#6b3510';
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bottom.x, bottom.y);
        ctx.lineTo(bottomUp.x, bottomUp.y);
        ctx.lineTo(topUp.x, topUp.y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#8b4513';
        const innerTop = toScreen(x1 + thickness, y1, height);
        const innerBottom = toScreen(x2 + thickness, y2, height);
        ctx.beginPath();
        ctx.moveTo(topUp.x, topUp.y);
        ctx.lineTo(bottomUp.x, bottomUp.y);
        ctx.lineTo(innerBottom.x, innerBottom.y);
        ctx.lineTo(innerTop.x, innerTop.y);
        ctx.closePath();
        ctx.fill();
    } else if (side === 'right') {
        const top = toScreen(x1, y1);
        const bottom = toScreen(x2, y2);
        const topUp = toScreen(x1, y1, height);
        const bottomUp = toScreen(x2, y2, height);

        ctx.fillStyle = '#5b2500';
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bottom.x, bottom.y);
        ctx.lineTo(bottomUp.x, bottomUp.y);
        ctx.lineTo(topUp.x, topUp.y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#6b3510';
        const innerTop = toScreen(x1 - thickness, y1, height);
        const innerBottom = toScreen(x2 - thickness, y2, height);
        ctx.beginPath();
        ctx.moveTo(topUp.x, topUp.y);
        ctx.lineTo(bottomUp.x, bottomUp.y);
        ctx.lineTo(innerBottom.x, innerBottom.y);
        ctx.lineTo(innerTop.x, innerTop.y);
        ctx.closePath();
        ctx.fill();
    }
}

function drawFrontWall() {
    const height = CONFIG.WALL_HEIGHT;
    const thickness = CONFIG.WALL_THICKNESS;

    const left = toScreen(0, CONFIG.ARENA_HEIGHT);
    const right = toScreen(CONFIG.ARENA_WIDTH, CONFIG.ARENA_HEIGHT);
    const leftTop = toScreen(0, CONFIG.ARENA_HEIGHT, height);
    const rightTop = toScreen(CONFIG.ARENA_WIDTH, CONFIG.ARENA_HEIGHT, height);

    ctx.fillStyle = '#a0522d';
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(rightTop.x, rightTop.y);
    ctx.lineTo(leftTop.x, leftTop.y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#cd853f';
    const innerLeft = toScreen(0, CONFIG.ARENA_HEIGHT - thickness, height);
    const innerRight = toScreen(CONFIG.ARENA_WIDTH, CONFIG.ARENA_HEIGHT - thickness, height);
    ctx.beginPath();
    ctx.moveTo(leftTop.x, leftTop.y);
    ctx.lineTo(rightTop.x, rightTop.y);
    ctx.lineTo(innerRight.x, innerRight.y);
    ctx.lineTo(innerLeft.x, innerLeft.y);
    ctx.closePath();
    ctx.fill();
}

function drawTree(obs) {
    const pos = toScreen(obs.x, obs.y);
    const scale = getScale();
    const radius = obs.radius * scale;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 5 * scale, radius * 1.2, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    const trunkHeight = 60;
    const trunkPos = toScreen(obs.x, obs.y, 0);
    const trunkTop = toScreen(obs.x, obs.y, trunkHeight);

    ctx.fillStyle = '#5d4037';
    ctx.beginPath();
    ctx.moveTo(trunkPos.x - 8 * scale, trunkPos.y);
    ctx.lineTo(trunkPos.x + 8 * scale, trunkPos.y);
    ctx.lineTo(trunkTop.x + 6 * scale, trunkTop.y);
    ctx.lineTo(trunkTop.x - 6 * scale, trunkTop.y);
    ctx.closePath();
    ctx.fill();

    const layers = [
        { z: 30, size: 35 },
        { z: 50, size: 28 },
        { z: 70, size: 20 }
    ];

    layers.forEach(layer => {
        const base = toScreen(obs.x, obs.y, layer.z);
        const top = toScreen(obs.x, obs.y, layer.z + 30);
        const layerSize = layer.size * scale;

        ctx.fillStyle = '#2e7d32';
        ctx.beginPath();
        ctx.moveTo(base.x - layerSize, base.y);
        ctx.lineTo(base.x, base.y + layerSize * 0.3);
        ctx.lineTo(top.x, top.y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#4caf50';
        ctx.beginPath();
        ctx.moveTo(base.x + layerSize, base.y);
        ctx.lineTo(base.x, base.y + layerSize * 0.3);
        ctx.lineTo(top.x, top.y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#388e3c';
        ctx.beginPath();
        ctx.moveTo(base.x - layerSize, base.y);
        ctx.lineTo(base.x + layerSize, base.y);
        ctx.lineTo(top.x, top.y);
        ctx.closePath();
        ctx.fill();
    });

    ctx.fillStyle = '#fff';
    const snowTop = toScreen(obs.x, obs.y, 95);
    ctx.beginPath();
    ctx.arc(snowTop.x, snowTop.y, 6 * scale, 0, Math.PI * 2);
    ctx.fill();
}

function drawSnowHill(obs) {
    const pos = toScreen(obs.x, obs.y);
    const scale = getScale();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 8 * scale, obs.radiusX * 1.3 * scale, obs.radiusY * 0.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f5f9fc';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, obs.radiusX * scale, obs.radiusY * 0.6 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    const top = toScreen(obs.x, obs.y, 20);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(top.x - 5 * scale, top.y, obs.radiusX * 0.5 * scale, obs.radiusY * 0.3 * scale, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(180, 200, 220, 0.4)';
    ctx.beginPath();
    ctx.ellipse(pos.x + 10 * scale, pos.y + 5 * scale, obs.radiusX * 0.4 * scale, obs.radiusY * 0.25 * scale, 0.3, 0, Math.PI * 2);
    ctx.fill();
}

function drawPlayer(player) {
    const pos = toScreen(player.x, player.y);
    const scale = getScale();
    const radius = CONFIG.PLAYER_RADIUS * scale;
    const height = CONFIG.PLAYER_HEIGHT * scale;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 5 * scale, radius * 1.2, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (player.knockedOut) {
        ctx.fillStyle = player.team === 'blue' ? '#6699cc' : '#cc6666';
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y - 10 * scale, radius * 1.5, radius * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
    }

    const baseColor = player.team === 'blue' ? '#4a90d9' : '#d94a4a';
    const lightColor = player.team === 'blue' ? '#6ab0f9' : '#f96a6a';

    let fillColor = baseColor;
    if (player.hitFlash > 0) {
        fillColor = '#ffffff';
    }

    const bodyTop = pos.y - height * CONFIG.ISO_ANGLE;

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, radius, radius * 0.35, 0, 0, Math.PI);
    ctx.lineTo(pos.x - radius, bodyTop);
    ctx.ellipse(pos.x, bodyTop, radius, radius * 0.35, 0, Math.PI, 0, true);
    ctx.lineTo(pos.x + radius, pos.y);
    ctx.fill();

    ctx.fillStyle = lightColor;
    ctx.beginPath();
    ctx.ellipse(pos.x, bodyTop, radius, radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const headY = bodyTop - radius * 0.8;
    ctx.fillStyle = '#ffe0bd';
    ctx.beginPath();
    ctx.arc(pos.x, headY, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

}

function drawSnowball(snowball) {
    const pos = toScreen(snowball.x, snowball.y, snowball.z);
    const scale = getScale();

    // Draw shadow at ground level - always small like other decorations
    const shadowPos = toScreen(snowball.x, snowball.y, 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(shadowPos.x, shadowPos.y + 5 * scale, CONFIG.SNOWBALL_RADIUS * scale * 1.1, CONFIG.SNOWBALL_RADIUS * scale * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, CONFIG.SNOWBALL_RADIUS * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(pos.x - 2 * scale, pos.y - 2 * scale, CONFIG.SNOWBALL_RADIUS * scale * 0.4, 0, Math.PI * 2);
    ctx.fill();
}

function drawAimLine() {
    players.forEach(player => {
        if (player.knockedOut) return;

        const isHumanAiming = player.isCharging && player.controlledBy !== null;
        const isAIAiming = player.state === 'aiming' && player.controlledBy === null;

        if (isHumanAiming || isAIAiming) {
            const charge = isHumanAiming ? player.chargeProgress : (player.chargeProgress || 0);
            drawAimLineForPlayer(player, charge, isHumanAiming);
        }
    });
}

function drawAimLineForPlayer(player, charge, isPlayerControlled) {
    const scale = getScale();
    const direction = player.team === 'blue' ? 1 : -1;
    const aimStartX = player.x + direction * (CONFIG.PLAYER_RADIUS + 10);
    const pos = toScreen(aimStartX, player.y, CONFIG.PLAYER_HEIGHT * 0.5);

    const minLength = 50 * scale;
    const maxLength = 200 * scale;
    const lineLength = minLength + (maxLength - minLength) * charge;

    const lineAlpha = isPlayerControlled ? 0.6 : 0.3;
    const arrowAlpha = isPlayerControlled ? 0.8 : 0.4;
    const lineColor = isPlayerControlled ? `rgba(255, 255, 0, ${lineAlpha})` : `rgba(255, 100, 100, ${lineAlpha})`;
    const arrowColor = isPlayerControlled ? `rgba(255, 255, 0, ${arrowAlpha})` : `rgba(255, 100, 100, ${arrowAlpha})`;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = isPlayerControlled ? 3 * scale : 2 * scale;
    ctx.setLineDash([10 * scale, 5 * scale]);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x + direction * lineLength, pos.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const arrowX = pos.x + direction * lineLength;
    const arrowY = pos.y;
    ctx.fillStyle = arrowColor;
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(arrowX - direction * 15 * scale, arrowY - 8 * scale);
    ctx.lineTo(arrowX - direction * 15 * scale, arrowY + 8 * scale);
    ctx.closePath();
    ctx.fill();

}

function updateHUD() {
    const blueHealth = document.getElementById('blueHealth');
    const redHealth = document.getElementById('redHealth');
    const blueSnowballs = document.getElementById('blueSnowballs');
    const redSnowballs = document.getElementById('redSnowballs');
    const blueReload = document.getElementById('blueReload');
    const redReload = document.getElementById('redReload');

    const now = performance.now();

    // Blue team
    const bluePlayers = players.filter(p => p.team === 'blue');
    blueHealth.innerHTML = bluePlayers
        .map(p => `<div class="player-health">${
            '<span class="heart' + (p.health < 1 || p.knockedOut ? ' empty' : '') + '"></span>' +
            '<span class="heart' + (p.health < 2 || p.knockedOut ? ' empty' : '') + '"></span>'
        }</div>`)
        .join('');

    // Blue snowballs
    const bluePlayer = bluePlayers[0];
    if (bluePlayer && !bluePlayer.knockedOut) {
        let snowballHtml = '';
        for (let i = 0; i < bluePlayer.snowballs; i++) {
            snowballHtml += '<div class="snowball"></div>';
        }
        blueSnowballs.innerHTML = snowballHtml;

        // Blue reload progress
        const blueRecentTaps = bluePlayer.tapTimes.filter(t => now - t < CONFIG.TAP_WINDOW).length;
        if (blueRecentTaps > 0 && bluePlayer.snowballs < CONFIG.MAX_SNOWBALLS) {
            const progress = blueRecentTaps / CONFIG.TAPS_TO_RELOAD;
            blueReload.innerHTML = `
                <div>${blueRecentTaps}/${CONFIG.TAPS_TO_RELOAD}</div>
                <div class="reload-bar"><div class="reload-progress" style="width: ${progress * 100}%"></div></div>
            `;
        } else {
            blueReload.innerHTML = '';
        }
    } else {
        blueSnowballs.innerHTML = '';
        blueReload.innerHTML = '';
    }

    // Red team
    const redPlayers = players.filter(p => p.team === 'red');
    redHealth.innerHTML = redPlayers
        .map(p => `<div class="player-health">${
            '<span class="heart' + (p.health < 1 || p.knockedOut ? ' empty' : '') + '"></span>' +
            '<span class="heart' + (p.health < 2 || p.knockedOut ? ' empty' : '') + '"></span>'
        }</div>`)
        .join('');

    // Red snowballs
    const redPlayer = redPlayers[0];
    if (redPlayer && !redPlayer.knockedOut) {
        let snowballHtml = '';
        for (let i = 0; i < redPlayer.snowballs; i++) {
            snowballHtml += '<div class="snowball"></div>';
        }
        redSnowballs.innerHTML = snowballHtml;

        // Red reload progress
        const redRecentTaps = redPlayer.tapTimes.filter(t => now - t < CONFIG.TAP_WINDOW).length;
        if (redRecentTaps > 0 && redPlayer.snowballs < CONFIG.MAX_SNOWBALLS) {
            const progress = redRecentTaps / CONFIG.TAPS_TO_RELOAD;
            redReload.innerHTML = `
                <div>${redRecentTaps}/${CONFIG.TAPS_TO_RELOAD}</div>
                <div class="reload-bar"><div class="reload-progress" style="width: ${progress * 100}%"></div></div>
            `;
        } else {
            redReload.innerHTML = '';
        }
    } else {
        redSnowballs.innerHTML = '';
        redReload.innerHTML = '';
    }
}

// ============= GAME LOOP =============
function gameLoop(currentTime) {
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameState === 'playing') {
        players.forEach(p => {
            updatePlayer(p, deltaTime);
        });

        for (let i = snowballs.length - 1; i >= 0; i--) {
            updateSnowball(snowballs[i], i);
        }

        updateHUD();
    }

    drawArena();

    const allObjects = [
        ...snowballs.map(s => ({ type: 'snowball', obj: s, y: s.y })),
        ...players.map(p => ({ type: 'player', obj: p, y: p.y })),
        ...obstacles.map(o => ({ type: o.type, obj: o, y: o.y }))
    ].sort((a, b) => a.y - b.y);

    allObjects.forEach(item => {
        if (item.type === 'snowball') {
            drawSnowball(item.obj);
        } else if (item.type === 'player') {
            drawPlayer(item.obj);
        } else if (item.type === 'tree') {
            drawTree(item.obj);
        } else if (item.type === 'snowhill') {
            drawSnowHill(item.obj);
        }
    });

    drawFrontWall();
    drawAimLine();

    requestAnimationFrame(gameLoop);
}

// ============= EVENT LISTENERS =============
canvas.addEventListener('mousedown', handleMouseDown);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseup', handleMouseUp);
canvas.addEventListener('mouseleave', handleMouseUp);
canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

window.addEventListener('resize', resizeCanvas);
document.addEventListener('fullscreenchange', resizeCanvas);
document.addEventListener('webkitfullscreenchange', resizeCanvas);

// ============= START =============
resizeCanvas();
requestAnimationFrame(gameLoop);
