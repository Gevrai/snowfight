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
    SNOWBALL_PREP_TIME: 1000,
    MAX_SNOWBALLS: 3,
    LONG_PRESS_TIME: 200,
    MAX_CHARGE_TIME: 750,
    HIT_FLASH_DURATION: 200,
    ISO_ANGLE: 0.5,
    WALL_HEIGHT: 25,
    WALL_THICKNESS: 15,
};

// ============= OBSTACLES =============
const obstacles = [
    // Trees (type, x, y, radius)
    { type: 'tree', x: 200, y: 100, radius: 25 },
    { type: 'tree', x: 600, y: 100, radius: 25 },
    { type: 'tree', x: 200, y: 350, radius: 25 },
    { type: 'tree', x: 600, y: 350, radius: 25 },
    // Snow hills (type, x, y, radiusX, radiusY)
    { type: 'snowhill', x: 400, y: 150, radiusX: 40, radiusY: 25 },
    { type: 'snowhill', x: 400, y: 300, radiusX: 40, radiusY: 25 },
];

// ============= GAME STATE =============
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameState = 'menu'; // menu, playing, win, lose
let players = [];
let snowballs = [];
let selectedPlayer = null;
let aimingPlayer = null;
let chargeStartTime = 0;
let currentCharge = 0; // 0 to 1
let longPressTimer = null;
let touchStartPos = null;
let lastTime = 0;

// ============= CANVAS SETUP =============
function resizeCanvas() {
    const container = document.getElementById('gameContainer');
    const aspectRatio = 16 / 9;

    let width = container.clientWidth;
    let height = container.clientHeight;

    if (width / height > aspectRatio) {
        width = height * aspectRatio;
    } else {
        height = width / aspectRatio;
    }

    canvas.width = 960;
    canvas.height = 540;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
}

// ============= COORDINATE CONVERSION =============
// Convert game coordinates to screen (isometric-ish projection)
function toScreen(x, y, z = 0) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2 + 20; // Offset down slightly for walls
    const scale = Math.min(canvas.width / CONFIG.ARENA_WIDTH, canvas.height / CONFIG.ARENA_HEIGHT) * 0.95;

    return {
        x: centerX + (x - CONFIG.ARENA_WIDTH / 2) * scale,
        y: centerY + (y - CONFIG.ARENA_HEIGHT / 2) * scale * CONFIG.ISO_ANGLE - z * scale
    };
}

// Convert screen coordinates to game coordinates
function toGame(screenX, screenY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const canvasX = (screenX - rect.left) * scaleX;
    const canvasY = (screenY - rect.top) * scaleY;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2 + 20;
    const scale = Math.min(canvas.width / CONFIG.ARENA_WIDTH, canvas.height / CONFIG.ARENA_HEIGHT) * 0.95;

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
            // Ellipse collision approximation
            const dx = (x - obs.x) / obs.radiusX;
            const dy = (y - obs.y) / obs.radiusY;
            if (dx * dx + dy * dy < 1 + radius / Math.min(obs.radiusX, obs.radiusY)) {
                return obs;
            }
        }
    }
    return null;
}

function pushOutOfObstacle(entity, obs) {
    if (obs.type === 'tree') {
        const dx = entity.x - obs.x;
        const dy = entity.y - obs.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            const pushDist = obs.radius + CONFIG.PLAYER_RADIUS - dist + 1;
            entity.x += (dx / dist) * pushDist;
            entity.y += (dy / dist) * pushDist;
        }
    } else if (obs.type === 'snowhill') {
        const dx = entity.x - obs.x;
        const dy = entity.y - obs.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            entity.x += (dx / dist) * 5;
            entity.y += (dy / dist) * 5;
        }
    }
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
        snowballs: 0,
        prepTimer: 0,
        state: 'idle', // idle, walking, aiming
        isSelected: false,
        hitFlash: 0,
        knockedOut: false
    };
}

// ============= GAME INITIALIZATION =============
function initGame() {
    players = [
        // Blue team (player) - left side
        createPlayer(80, 150, 'blue', 0),
        createPlayer(80, 300, 'blue', 1),
        // Red team (AI) - right side
        createPlayer(720, 150, 'red', 2),
        createPlayer(720, 300, 'red', 3)
    ];
    snowballs = [];
    selectedPlayer = null;
    aimingPlayer = null;
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

    if (won) {
        document.getElementById('winScreen').classList.add('active');
    } else {
        document.getElementById('loseScreen').classList.add('active');
    }
}

// ============= INPUT HANDLING =============
function getInputPos(e) {
    if (e.touches) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

function findPlayerAtPos(gamePos) {
    for (let player of players) {
        if (player.knockedOut) continue;
        const dx = player.x - gamePos.x;
        const dy = player.y - gamePos.y;
        if (Math.sqrt(dx * dx + dy * dy) < CONFIG.PLAYER_RADIUS * 2) {
            return player;
        }
    }
    return null;
}

function handleInputStart(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();

    const pos = getInputPos(e);
    touchStartPos = pos;
    const gamePos = toGame(pos.x, pos.y);
    const clickedPlayer = findPlayerAtPos(gamePos);

    if (clickedPlayer && clickedPlayer.team === 'blue') {
        // Select this player
        players.forEach(p => p.isSelected = false);
        clickedPlayer.isSelected = true;
        selectedPlayer = clickedPlayer;

        // Start long-press timer for charging
        longPressTimer = setTimeout(() => {
            if (selectedPlayer && selectedPlayer.snowballs > 0) {
                aimingPlayer = selectedPlayer;
                selectedPlayer.state = 'aiming';
                chargeStartTime = performance.now();
                currentCharge = 0;
            }
        }, CONFIG.LONG_PRESS_TIME);
    }
}

function handleInputMove(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();
    // No direction tracking - throw is always horizontal
}

function handleInputEnd(e) {
    if (gameState !== 'playing') return;
    e.preventDefault();

    clearTimeout(longPressTimer);

    if (aimingPlayer && aimingPlayer.snowballs > 0) {
        // Throw snowball with current charge
        throwSnowball(aimingPlayer, currentCharge);
        aimingPlayer.state = 'idle';
        aimingPlayer = null;
        currentCharge = 0;
    } else if (selectedPlayer && touchStartPos) {
        // Move to position
        const endPos = e.changedTouches ?
            { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY } :
            { x: e.clientX, y: e.clientY };

        const gamePos = toGame(endPos.x, endPos.y);
        const clickedPlayer = findPlayerAtPos(gamePos);

        // Only move if we didn't click on a player and it's within bounds
        if (!clickedPlayer || clickedPlayer.team !== 'blue') {
            const minBound = CONFIG.WALL_THICKNESS + CONFIG.PLAYER_RADIUS;
            const maxBoundX = CONFIG.ARENA_WIDTH - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS;
            const maxBoundY = CONFIG.ARENA_HEIGHT - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS;

            selectedPlayer.targetX = Math.max(minBound, Math.min(maxBoundX, gamePos.x));
            selectedPlayer.targetY = Math.max(minBound, Math.min(maxBoundY, gamePos.y));
            selectedPlayer.state = 'walking';
        }
    }

    touchStartPos = null;
}

// ============= SNOWBALL MECHANICS =============
function throwSnowball(player, chargePower) {
    if (player.snowballs <= 0) return;

    player.snowballs--;

    // Direction is fixed: blue team throws right, red team throws left
    const direction = player.team === 'blue' ? 1 : -1;

    // Speed based on charge power (0 to 1)
    const speed = CONFIG.SNOWBALL_SPEED_MIN + (CONFIG.SNOWBALL_SPEED_MAX - CONFIG.SNOWBALL_SPEED_MIN) * chargePower;

    snowballs.push({
        x: player.x,
        y: player.y,
        z: CONFIG.PLAYER_HEIGHT * 0.7,
        vx: direction * speed,
        vy: 0, // Straight horizontal
        vz: 0,
        team: player.team,
        owner: player.id
    });
}

// ============= AI LOGIC =============
function updateAI(player, deltaTime) {
    if (player.knockedOut) return;

    // Find closest enemy
    let closestEnemy = null;
    let closestDist = Infinity;

    for (let p of players) {
        if (p.team === player.team || p.knockedOut) continue;
        const dist = Math.sqrt((p.x - player.x) ** 2 + (p.y - player.y) ** 2);
        if (dist < closestDist) {
            closestDist = dist;
            closestEnemy = p;
        }
    }

    if (!closestEnemy) return;

    // State machine
    if (player.state === 'idle') {
        // Check if roughly aligned with enemy (within Y tolerance for horizontal throw)
        const yDiff = Math.abs(player.y - closestEnemy.y);
        const isAligned = yDiff < 50; // Allow some tolerance

        // Decide what to do
        if (player.snowballs > 0 && isAligned && Math.random() < 0.025) {
            // Start aiming (only if aligned)
            player.state = 'aiming';
            player.totalAimTime = 400 + Math.random() * 600; // Aim for 0.4-1 sec
            player.aimTimer = player.totalAimTime;
            player.chargeProgress = 0;
            player.targetEnemy = closestEnemy;
        } else if (Math.random() < 0.015) {
            // Move to align with enemy (since throws are horizontal)
            // Try to match enemy's Y position with some randomness
            const targetY = closestEnemy.y + (Math.random() - 0.5) * 60;
            const minX = CONFIG.ARENA_WIDTH / 2 + 50;
            const maxX = CONFIG.ARENA_WIDTH - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS - 10;
            const minY = CONFIG.WALL_THICKNESS + CONFIG.PLAYER_RADIUS + 10;
            const maxY = CONFIG.ARENA_HEIGHT - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS - 10;

            player.targetX = Math.max(minX, Math.min(maxX, player.x + (Math.random() - 0.5) * 80));
            player.targetY = Math.max(minY, Math.min(maxY, targetY));
            player.state = 'walking';
        }
    } else if (player.state === 'aiming') {
        player.aimTimer -= deltaTime;
        // Calculate and store charge progress for visual display
        const totalAimTime = player.totalAimTime || 800;
        player.chargeProgress = Math.min(1, 1 - (player.aimTimer / totalAimTime));

        if (player.aimTimer <= 0 && player.snowballs > 0) {
            // Throw with calculated charge based on enemy distance
            const enemy = player.targetEnemy;
            if (enemy && !enemy.knockedOut) {
                // Calculate charge based on horizontal distance to enemy
                const distX = Math.abs(enemy.x - player.x);
                const maxDist = CONFIG.ARENA_WIDTH * 0.8;
                let chargePower = Math.min(1, distX / maxDist);
                // Add some randomness
                chargePower = Math.max(0.2, Math.min(1, chargePower + (Math.random() - 0.5) * 0.3));
                throwSnowball(player, chargePower);
            }
            player.state = 'idle';
            player.chargeProgress = 0;
        }
    } else if (player.state === 'walking') {
        // Continue walking (handled in updatePlayer)
    }
}

// ============= UPDATE FUNCTIONS =============
function updatePlayer(player, deltaTime) {
    if (player.knockedOut) return;

    // Update hit flash
    if (player.hitFlash > 0) {
        player.hitFlash -= deltaTime;
    }

    // Movement
    if (player.targetX !== null && player.targetY !== null) {
        const dx = player.targetX - player.x;
        const dy = player.targetY - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 5) {
            const newX = player.x + (dx / dist) * CONFIG.PLAYER_SPEED;
            const newY = player.y + (dy / dist) * CONFIG.PLAYER_SPEED;

            // Check obstacle collision before moving
            const obs = checkObstacleCollision(newX, newY, CONFIG.PLAYER_RADIUS);
            if (obs) {
                // Try to slide around the obstacle
                const obsCollisionX = checkObstacleCollision(newX, player.y, CONFIG.PLAYER_RADIUS);
                const obsCollisionY = checkObstacleCollision(player.x, newY, CONFIG.PLAYER_RADIUS);

                if (!obsCollisionX) {
                    player.x = newX;
                } else if (!obsCollisionY) {
                    player.y = newY;
                }
                // If both blocked, don't move
            } else {
                player.x = newX;
                player.y = newY;
            }

            // Keep within arena bounds (inside walls)
            player.x = Math.max(CONFIG.WALL_THICKNESS + CONFIG.PLAYER_RADIUS,
                Math.min(CONFIG.ARENA_WIDTH - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS, player.x));
            player.y = Math.max(CONFIG.WALL_THICKNESS + CONFIG.PLAYER_RADIUS,
                Math.min(CONFIG.ARENA_HEIGHT - CONFIG.WALL_THICKNESS - CONFIG.PLAYER_RADIUS, player.y));
        } else {
            player.targetX = null;
            player.targetY = null;
            if (player.state === 'walking') {
                player.state = 'idle';
            }
        }
    }

    // Snowball preparation (when idle) - pauses but doesn't reset when moving
    if (player.state === 'idle' && player.snowballs < CONFIG.MAX_SNOWBALLS) {
        player.prepTimer += deltaTime;
        if (player.prepTimer >= CONFIG.SNOWBALL_PREP_TIME) {
            player.snowballs++;
            player.prepTimer = 0;
        }
    }
    // Note: prepTimer is NOT reset when walking, so it resumes when idle
}

function updateSnowball(snowball, index, deltaTime) {
    snowball.x += snowball.vx;
    snowball.y += snowball.vy;
    snowball.z += snowball.vz;
    snowball.vz -= 0.15; // Gravity

    // Check if hit ground
    if (snowball.z <= 0) {
        snowballs.splice(index, 1);
        return;
    }

    // Check collision with players
    for (let player of players) {
        if (player.knockedOut) continue;
        if (player.team === snowball.team) continue; // Can't hit teammates

        const dx = player.x - snowball.x;
        const dy = player.y - snowball.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONFIG.PLAYER_RADIUS + CONFIG.SNOWBALL_RADIUS) {
            // Hit!
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

    // Check collision with obstacles (snowballs blocked by trees/hills)
    const obs = checkObstacleCollision(snowball.x, snowball.y, CONFIG.SNOWBALL_RADIUS);
    if (obs) {
        snowballs.splice(index, 1);
        return;
    }

    // Check if out of bounds (hit walls)
    if (snowball.x < CONFIG.WALL_THICKNESS || snowball.x > CONFIG.ARENA_WIDTH - CONFIG.WALL_THICKNESS ||
        snowball.y < CONFIG.WALL_THICKNESS || snowball.y > CONFIG.ARENA_HEIGHT - CONFIG.WALL_THICKNESS) {
        snowballs.splice(index, 1);
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
    // Snow ground (full arena)
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

    // Draw rink markings
    const midTop = toScreen(CONFIG.ARENA_WIDTH / 2, CONFIG.WALL_THICKNESS);
    const midBottom = toScreen(CONFIG.ARENA_WIDTH / 2, CONFIG.ARENA_HEIGHT - CONFIG.WALL_THICKNESS);
    ctx.strokeStyle = 'rgba(100, 150, 200, 0.3)';
    ctx.lineWidth = 3;
    ctx.setLineDash([15, 10]);
    ctx.beginPath();
    ctx.moveTo(midTop.x, midTop.y);
    ctx.lineTo(midBottom.x, midBottom.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw back wall (top edge - drawn first for depth)
    drawWall(0, 0, CONFIG.ARENA_WIDTH, 0, 'top');

    // Draw left wall
    drawWall(0, 0, 0, CONFIG.ARENA_HEIGHT, 'left');

    // Draw right wall
    drawWall(CONFIG.ARENA_WIDTH, 0, CONFIG.ARENA_WIDTH, CONFIG.ARENA_HEIGHT, 'right');
}

function drawWall(x1, y1, x2, y2, side) {
    const height = CONFIG.WALL_HEIGHT;
    const thickness = CONFIG.WALL_THICKNESS;

    if (side === 'top') {
        // Back wall
        const left = toScreen(x1, y1);
        const right = toScreen(x2, y2);
        const leftTop = toScreen(x1, y1, height);
        const rightTop = toScreen(x2, y2, height);

        // Wall face
        ctx.fillStyle = '#8b4513';
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.lineTo(rightTop.x, rightTop.y);
        ctx.lineTo(leftTop.x, leftTop.y);
        ctx.closePath();
        ctx.fill();

        // Top edge
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

        // Wall face
        ctx.fillStyle = '#6b3510';
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bottom.x, bottom.y);
        ctx.lineTo(bottomUp.x, bottomUp.y);
        ctx.lineTo(topUp.x, topUp.y);
        ctx.closePath();
        ctx.fill();

        // Top edge
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

        // Wall face
        ctx.fillStyle = '#5b2500';
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bottom.x, bottom.y);
        ctx.lineTo(bottomUp.x, bottomUp.y);
        ctx.lineTo(topUp.x, topUp.y);
        ctx.closePath();
        ctx.fill();

        // Top edge
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
    // Bottom wall (drawn after everything else for proper depth)
    const height = CONFIG.WALL_HEIGHT;
    const thickness = CONFIG.WALL_THICKNESS;

    const left = toScreen(0, CONFIG.ARENA_HEIGHT);
    const right = toScreen(CONFIG.ARENA_WIDTH, CONFIG.ARENA_HEIGHT);
    const leftTop = toScreen(0, CONFIG.ARENA_HEIGHT, height);
    const rightTop = toScreen(CONFIG.ARENA_WIDTH, CONFIG.ARENA_HEIGHT, height);

    // Wall face
    ctx.fillStyle = '#a0522d';
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(rightTop.x, rightTop.y);
    ctx.lineTo(leftTop.x, leftTop.y);
    ctx.closePath();
    ctx.fill();

    // Top edge
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
    const radius = obs.radius;

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 5, radius * 1.2, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Trunk
    const trunkHeight = 60;
    const trunkPos = toScreen(obs.x, obs.y, 0);
    const trunkTop = toScreen(obs.x, obs.y, trunkHeight);

    ctx.fillStyle = '#5d4037';
    ctx.beginPath();
    ctx.moveTo(trunkPos.x - 8, trunkPos.y);
    ctx.lineTo(trunkPos.x + 8, trunkPos.y);
    ctx.lineTo(trunkTop.x + 6, trunkTop.y);
    ctx.lineTo(trunkTop.x - 6, trunkTop.y);
    ctx.closePath();
    ctx.fill();

    // Foliage layers (3 triangles)
    const layers = [
        { z: 30, size: 35 },
        { z: 50, size: 28 },
        { z: 70, size: 20 }
    ];

    layers.forEach(layer => {
        const base = toScreen(obs.x, obs.y, layer.z);
        const top = toScreen(obs.x, obs.y, layer.z + 30);

        // Dark side
        ctx.fillStyle = '#2e7d32';
        ctx.beginPath();
        ctx.moveTo(base.x - layer.size, base.y);
        ctx.lineTo(base.x, base.y + layer.size * 0.3);
        ctx.lineTo(top.x, top.y);
        ctx.closePath();
        ctx.fill();

        // Light side
        ctx.fillStyle = '#4caf50';
        ctx.beginPath();
        ctx.moveTo(base.x + layer.size, base.y);
        ctx.lineTo(base.x, base.y + layer.size * 0.3);
        ctx.lineTo(top.x, top.y);
        ctx.closePath();
        ctx.fill();

        // Front
        ctx.fillStyle = '#388e3c';
        ctx.beginPath();
        ctx.moveTo(base.x - layer.size, base.y);
        ctx.lineTo(base.x + layer.size, base.y);
        ctx.lineTo(top.x, top.y);
        ctx.closePath();
        ctx.fill();
    });

    // Snow on top
    ctx.fillStyle = '#fff';
    const snowTop = toScreen(obs.x, obs.y, 95);
    ctx.beginPath();
    ctx.arc(snowTop.x, snowTop.y, 6, 0, Math.PI * 2);
    ctx.fill();
}

function drawSnowHill(obs) {
    const pos = toScreen(obs.x, obs.y);

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 8, obs.radiusX * 1.3, obs.radiusY * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hill body
    const hillHeight = 20;
    const top = toScreen(obs.x, obs.y, hillHeight);

    // Main mound
    ctx.fillStyle = '#f5f9fc';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, obs.radiusX, obs.radiusY * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(top.x - 5, top.y, obs.radiusX * 0.5, obs.radiusY * 0.3, -0.2, 0, Math.PI * 2);
    ctx.fill();

    // Shade
    ctx.fillStyle = 'rgba(180, 200, 220, 0.4)';
    ctx.beginPath();
    ctx.ellipse(pos.x + 10, pos.y + 5, obs.radiusX * 0.4, obs.radiusY * 0.25, 0.3, 0, Math.PI * 2);
    ctx.fill();
}


function drawPlayer(player) {
    const pos = toScreen(player.x, player.y);
    const radius = CONFIG.PLAYER_RADIUS;
    const height = CONFIG.PLAYER_HEIGHT;

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 5, radius * 1.2, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (player.knockedOut) {
        // Draw knocked out player (lying down)
        ctx.fillStyle = player.team === 'blue' ? '#6699cc' : '#cc6666';
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y - 10, radius * 1.5, radius * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
    }

    // Body (cylinder - draw as ellipse + rectangle + ellipse)
    const baseColor = player.team === 'blue' ? '#4a90d9' : '#d94a4a';
    const lightColor = player.team === 'blue' ? '#6ab0f9' : '#f96a6a';
    const darkColor = player.team === 'blue' ? '#2a70b9' : '#b92a2a';

    // Hit flash
    let fillColor = baseColor;
    if (player.hitFlash > 0) {
        fillColor = '#ffffff';
    }

    // Body cylinder
    const bodyTop = pos.y - height * CONFIG.ISO_ANGLE;

    // Side of cylinder
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, radius, radius * 0.35, 0, 0, Math.PI);
    ctx.lineTo(pos.x - radius, bodyTop);
    ctx.ellipse(pos.x, bodyTop, radius, radius * 0.35, 0, Math.PI, 0, true);
    ctx.lineTo(pos.x + radius, pos.y);
    ctx.fill();

    // Light side
    ctx.fillStyle = lightColor;
    ctx.beginPath();
    ctx.ellipse(pos.x, bodyTop, radius, radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    const headY = bodyTop - radius * 0.8;
    ctx.fillStyle = '#ffe0bd';
    ctx.beginPath();
    ctx.arc(pos.x, headY, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Selection indicator
    if (player.isSelected) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y + 5, radius * 1.4, radius * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Snowball count indicator
    if (player.snowballs > 0) {
        for (let i = 0; i < player.snowballs; i++) {
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#ccc';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(pos.x - 15 + i * 12, pos.y + 15, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }

    // Preparation indicator - always visible unless snowballs are full
    if (player.snowballs < CONFIG.MAX_SNOWBALLS) {
        const progress = player.prepTimer / CONFIG.SNOWBALL_PREP_TIME;
        // Background circle
        ctx.strokeStyle = 'rgba(100, 100, 200, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y - height * CONFIG.ISO_ANGLE - radius, 8, 0, Math.PI * 2);
        ctx.stroke();
        // Progress arc
        if (progress > 0) {
            ctx.strokeStyle = player.state === 'idle' ? '#88f' : '#668'; // Dimmer when paused
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y - height * CONFIG.ISO_ANGLE - radius, 8, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
            ctx.stroke();
        }
    }

    // Health indicator
    for (let i = 0; i < 2; i++) {
        ctx.fillStyle = i < player.health ? '#ff6b6b' : '#444';
        ctx.beginPath();
        ctx.arc(pos.x - 8 + i * 16, pos.y - height * CONFIG.ISO_ANGLE - radius * 1.8, 5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawSnowball(snowball) {
    const pos = toScreen(snowball.x, snowball.y, snowball.z);

    // Shadow
    const shadowPos = toScreen(snowball.x, snowball.y, 0);
    const shadowScale = Math.max(0.3, 1 - snowball.z / 100);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.beginPath();
    ctx.ellipse(shadowPos.x, shadowPos.y, CONFIG.SNOWBALL_RADIUS * shadowScale, CONFIG.SNOWBALL_RADIUS * 0.3 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Snowball
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, CONFIG.SNOWBALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(pos.x - 2, pos.y - 2, CONFIG.SNOWBALL_RADIUS * 0.4, 0, Math.PI * 2);
    ctx.fill();
}

function drawAimLine() {
    // Draw player's aim line
    if (aimingPlayer) {
        drawAimLineForPlayer(aimingPlayer, currentCharge, true);
    }

    // Draw AI aim lines (fainter)
    players.forEach(player => {
        if (player.team === 'red' && player.state === 'aiming' && !player.knockedOut) {
            drawAimLineForPlayer(player, player.chargeProgress || 0, false);
        }
    });
}

function drawAimLineForPlayer(player, charge, isPlayerControlled) {
    const pos = toScreen(player.x, player.y, CONFIG.PLAYER_HEIGHT * 0.7);
    const direction = player.team === 'blue' ? 1 : -1;

    // Draw trajectory line (fixed horizontal direction)
    const minLength = 50;
    const maxLength = 200;
    const lineLength = minLength + (maxLength - minLength) * charge;

    // Different colors for player vs AI
    const lineAlpha = isPlayerControlled ? 0.6 : 0.3;
    const arrowAlpha = isPlayerControlled ? 0.8 : 0.4;
    const lineColor = isPlayerControlled ? `rgba(255, 255, 0, ${lineAlpha})` : `rgba(255, 100, 100, ${lineAlpha})`;
    const arrowColor = isPlayerControlled ? `rgba(255, 255, 0, ${arrowAlpha})` : `rgba(255, 100, 100, ${arrowAlpha})`;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = isPlayerControlled ? 3 : 2;
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineTo(pos.x + direction * lineLength, pos.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrow head
    const arrowX = pos.x + direction * lineLength;
    const arrowY = pos.y;
    ctx.fillStyle = arrowColor;
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(arrowX - direction * 15, arrowY - 8);
    ctx.lineTo(arrowX - direction * 15, arrowY + 8);
    ctx.closePath();
    ctx.fill();

    // Only draw charge bar for player-controlled
    if (isPlayerControlled) {
        const barWidth = 50;
        const barHeight = 8;
        const barX = pos.x - barWidth / 2;
        const barY = pos.y - 60;

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        // Fill based on charge
        const gradient = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
        gradient.addColorStop(0, '#4CAF50');
        gradient.addColorStop(0.5, '#FFC107');
        gradient.addColorStop(1, '#F44336');
        ctx.fillStyle = gradient;
        ctx.fillRect(barX, barY, barWidth * charge, barHeight);

        // Border
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(barX, barY, barWidth, barHeight);

        // "POWER" label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('POWER', pos.x, barY - 5);
    }
}

function updateHUD() {
    const blueHealth = document.getElementById('blueHealth');
    const redHealth = document.getElementById('redHealth');

    blueHealth.innerHTML = players
        .filter(p => p.team === 'blue')
        .map((p, i) => `<div class="player-health">P${i + 1}: ${
            '<span class="heart' + (p.health < 1 ? ' empty' : '') + '"></span>' +
            '<span class="heart' + (p.health < 2 ? ' empty' : '') + '"></span>'
        }${p.knockedOut ? ' (KO)' : ''}</div>`)
        .join('');

    redHealth.innerHTML = players
        .filter(p => p.team === 'red')
        .map((p, i) => `<div class="player-health">E${i + 1}: ${
            '<span class="heart' + (p.health < 1 ? ' empty' : '') + '"></span>' +
            '<span class="heart' + (p.health < 2 ? ' empty' : '') + '"></span>'
        }${p.knockedOut ? ' (KO)' : ''}</div>`)
        .join('');
}

// ============= GAME LOOP =============
function gameLoop(currentTime) {
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameState === 'playing') {
        // Update charge if aiming
        if (aimingPlayer && chargeStartTime > 0) {
            const elapsed = performance.now() - chargeStartTime;
            currentCharge = Math.min(1, elapsed / CONFIG.MAX_CHARGE_TIME);
        }

        // Update
        players.forEach(p => {
            updatePlayer(p, deltaTime);
            if (p.team === 'red') {
                updateAI(p, deltaTime);
            }
        });

        for (let i = snowballs.length - 1; i >= 0; i--) {
            updateSnowball(snowballs[i], i, deltaTime);
        }

        updateHUD();
    }

    // Render
    drawArena();

    // Sort all drawable objects by Y for proper depth
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

    // Draw front wall last (always in front)
    drawFrontWall();

    drawAimLine();

    requestAnimationFrame(gameLoop);
}

// ============= EVENT LISTENERS =============
canvas.addEventListener('mousedown', handleInputStart);
canvas.addEventListener('mousemove', handleInputMove);
canvas.addEventListener('mouseup', handleInputEnd);
canvas.addEventListener('touchstart', handleInputStart, { passive: false });
canvas.addEventListener('touchmove', handleInputMove, { passive: false });
canvas.addEventListener('touchend', handleInputEnd, { passive: false });

window.addEventListener('resize', resizeCanvas);

// ============= START =============
resizeCanvas();
requestAnimationFrame(gameLoop);
