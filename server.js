const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Increase timeouts to handle inactive tabs better
  pingTimeout: 60000,      // 60 seconds (default is 20s)
  pingInterval: 25000,     // 25 seconds (default)
  // Allow reconnection with same session
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true
  }
});

app.use(express.json());
app.use(cookieParser());

// Serve static files from Parcel's dist output
// Files are content-hashed by Parcel, so we can use long-term caching for assets
app.use(express.static(path.join(__dirname, 'dist'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // For HTML files, never cache
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      // For hashed assets (JS/CSS), use long-term caching
      // Parcel adds content hashes to filenames, so this is safe
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Serve bell.mp3 for the gong sound
app.get('/bell.mp3', (req, res) => {
  res.sendFile(path.join(__dirname, 'bell.mp3'));
});

// Load animal emojis
const emojis = fs.readFileSync(path.join(__dirname, 'animal_emojis.txt'), 'utf-8')
  .split('\n')
  .filter(e => e.trim().length > 0);

// Load all role sets from the roles/ folder
const roleSets = {};
const rolesDir = path.join(__dirname, 'roles');
const roleFiles = fs.readdirSync(rolesDir).filter(f => f.endsWith('.json'));

for (const file of roleFiles) {
  const setId = file.replace('.json', '');
  const data = JSON.parse(fs.readFileSync(path.join(rolesDir, file), 'utf-8'));
  roleSets[setId] = {
    id: setId,
    name: data['Role Set'] || setId,
    roles: data.Roles
  };
}

// Default role set for backwards compatibility
const defaultRoleSet = 'trouble_brewing';
const roles = roleSets[defaultRoleSet]?.roles || {};

// Load version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const version = packageJson.version;

// In-memory storage
const rooms = new Map();
const players = new Map();
const playerRoles = new Map(); // playerId -> { role, category }
const deadPlayers = new Map(); // roomCode -> Set of dead player IDs
const drunkPlayers = new Map(); // roomCode -> Set of drunk player IDs (host reminder only)
const playerOrder = new Map(); // roomCode -> Array of player IDs in circle order
const chatMessages = new Map(); // roomCode -> Array of chat messages

// Generate a random 4-letter room code
function generateRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluding I and O to avoid confusion
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  // Ensure uniqueness
  if (rooms.has(code)) {
    return generateRoomCode();
  }
  return code;
}

// Get random emoji
function getRandomEmoji() {
  return emojis[Math.floor(Math.random() * emojis.length)];
}

// API: Get or create player session
app.get('/api/session', (req, res) => {
  let playerId = req.cookies.playerId;
  
  if (!playerId || !players.has(playerId)) {
    playerId = uuidv4();
    const emoji = getRandomEmoji();
    players.set(playerId, {
      id: playerId,
      username: null,
      emoji: emoji,
      roomCode: null,
      isHost: false
    });
  }
  
  res.cookie('playerId', playerId, { 
    httpOnly: false, 
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
  
  res.json(players.get(playerId));
});

// API: Update username
app.post('/api/username', (req, res) => {
  const playerId = req.cookies.playerId;
  const { username } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const player = players.get(playerId);
  player.username = username;
  players.set(playerId, player);
  
  // If player is in a room, notify others
  if (player.roomCode && rooms.has(player.roomCode)) {
    io.to(player.roomCode).emit('playerUpdated', player);
  }
  
  res.json(player);
});

// API: Update emoji
app.post('/api/emoji', (req, res) => {
  const playerId = req.cookies.playerId;
  const { emoji } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!emoji) {
    return res.status(400).json({ error: 'Emoji is required' });
  }
  
  const player = players.get(playerId);
  player.emoji = emoji;
  players.set(playerId, player);
  
  // If player is in a room, notify others
  if (player.roomCode && rooms.has(player.roomCode)) {
    io.to(player.roomCode).emit('playerUpdated', player);
  }
  
  res.json(player);
});

// API: Create room
app.post('/api/room/create', (req, res) => {
  const playerId = req.cookies.playerId;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const player = players.get(playerId);
  
  // Leave current room if in one
  if (player.roomCode && rooms.has(player.roomCode)) {
    leaveRoom(playerId, player.roomCode);
  }
  
  // Special emoji for luc/lucas
  const lowerUsername = (player.username || '').toLowerCase();
  if (lowerUsername === 'luc' || lowerUsername === 'lucas') {
    player.emoji = '💩';
  }
  
  const roomCode = generateRoomCode();
  const room = {
    code: roomCode,
    hostId: playerId,
    players: [playerId],
    createdAt: Date.now(),
    selectedRoles: [], // Array of { name, description, category }
    rolesAssigned: false,
    roleSet: defaultRoleSet // Default to trouble brewing
  };
  
  rooms.set(roomCode, room);
  player.roomCode = roomCode;
  player.isHost = true;
  players.set(playerId, player);
  
  res.json({ room, player });
});

// API: Join room
app.post('/api/room/join', (req, res) => {
  const playerId = req.cookies.playerId;
  const { roomCode } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const code = roomCode.toUpperCase();
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const player = players.get(playerId);
  
  // Leave current room if in one
  if (player.roomCode && rooms.has(player.roomCode)) {
    leaveRoom(playerId, player.roomCode);
  }
  
  // Special emoji for luc/lucas
  const lowerUsername = (player.username || '').toLowerCase();
  if (lowerUsername === 'luc' || lowerUsername === 'lucas') {
    player.emoji = '💩';
  }
  
  const room = rooms.get(code);
  
  // Check if player is already in room
  if (!room.players.includes(playerId)) {
    room.players.push(playerId);
  }
  
  rooms.set(code, room);
  player.roomCode = code;
  player.isHost = room.hostId === playerId;
  players.set(playerId, player);
  
  // Notify other players
  io.to(code).emit('playerJoined', player);
  
  res.json({ room, player });
});

// API: Leave room
app.post('/api/room/leave', (req, res) => {
  const playerId = req.cookies.playerId;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const player = players.get(playerId);
  
  if (player.roomCode && rooms.has(player.roomCode)) {
    leaveRoom(playerId, player.roomCode);
  }
  
  res.json({ success: true });
});

// API: Get room data
app.get('/api/room/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  const roomDeadPlayers = deadPlayers.get(code) || new Set();
  
  // Get the ordered player list (or default to room.players order)
  const orderedPlayerIds = playerOrder.get(code) || room.players;
  
  // Filter to only include players still in the room
  const validOrderedIds = orderedPlayerIds.filter(id => room.players.includes(id));
  
  // Add any new players that aren't in the order yet
  const newPlayers = room.players.filter(id => !validOrderedIds.includes(id));
  const finalOrder = [...validOrderedIds, ...newPlayers];
  
  const roomPlayers = finalOrder
    .map(id => {
      const player = players.get(id);
      if (player) {
        return { ...player, isDead: roomDeadPlayers.has(id) };
      }
      return null;
    })
    .filter(p => p);
  
  // Include role set information
  const roleSetInfo = roleSets[room.roleSet] || roleSets[defaultRoleSet];
  res.json({ 
    room: {
      ...room,
      roleSetName: roleSetInfo?.name
    }, 
    players: roomPlayers, 
    playerOrder: finalOrder,
    roleSetRoles: roleSetInfo?.roles
  });
});

// API: Get available role sets
app.get('/api/role-sets', (req, res) => {
  const sets = Object.values(roleSets).map(set => ({
    id: set.id,
    name: set.name
  }));
  res.json(sets);
});

// API: Get roles for a specific role set
app.get('/api/roles/:setId', (req, res) => {
  const setId = req.params.setId;
  if (!roleSets[setId]) {
    return res.status(404).json({ error: 'Role set not found' });
  }
  res.json(roleSets[setId].roles);
});

// API: Get available roles (defaults to trouble brewing for backwards compatibility)
app.get('/api/roles', (req, res) => {
  res.json(roles);
});

// API: Get version
app.get('/api/version', (req, res) => {
  res.json({ version });
});

// API: Force all clients to reload (for development/deployment)
app.post('/api/force-reload', (req, res) => {
  console.log('🔄 Broadcasting force reload to all clients...');
  io.emit('forceReload');
  res.json({ success: true, message: 'Reload broadcast sent to all clients' });
});

// API: Update player order in circle (host only)
app.post('/api/room/:code/player-order', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { order } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can change player order' });
  }
  
  // Validate that all player IDs in order are actually in the room
  const validOrder = order.filter(id => room.players.includes(id));
  
  // Store the new order
  playerOrder.set(code, validOrder);
  
  // Notify all players of the new order
  io.to(code).emit('playerOrderChanged', validOrder);
  
  res.json({ success: true, order: validOrder });
});

// API: Update role set (host only)
app.post('/api/room/:code/role-set', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { roleSet } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can change settings' });
  }
  
  if (!roleSets[roleSet]) {
    return res.status(400).json({ error: 'Invalid role set' });
  }
  
  room.roleSet = roleSet;
  room.selectedRoles = []; // Clear selected roles when changing set
  rooms.set(code, room);
  
  // Notify all players about the role set change
  io.to(code).emit('roleSetChanged', { 
    roleSet,
    roleSetName: roleSets[roleSet].name,
    roles: roleSets[roleSet].roles
  });
  
  // Also notify about cleared selected roles
  io.to(code).emit('selectedRolesUpdated', []);
  
  res.json({ roleSet, roleSetName: roleSets[roleSet].name });
});

// API: Update selected roles (host only)
app.post('/api/room/:code/selected-roles', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { selectedRoles } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can change settings' });
  }
  
  // Validate selected roles against the room's role set
  const validRoles = [];
  const validCategories = ['Townsfolk', 'Outsiders', 'Minions', 'Demons'];
  const roomRoles = roleSets[room.roleSet]?.roles || roles;
  
  for (const role of selectedRoles) {
    // Check if role exists in the room's role set
    for (const cat of validCategories) {
      if (!roomRoles[cat]) continue;
      const foundRole = roomRoles[cat].find(r => r.name === role.name);
      if (foundRole) {
        validRoles.push({ ...foundRole, category: cat });
        break;
      }
    }
  }
  
  room.selectedRoles = validRoles;
  rooms.set(code, room);
  
  // Notify all players
  io.to(code).emit('selectedRolesUpdated', room.selectedRoles);
  
  res.json({ selectedRoles: room.selectedRoles });
});

// API: Assign roles (host only)
app.post('/api/room/:code/assign-roles', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can assign roles' });
  }
  
  const { selectedRoles } = room;
  
  if (!selectedRoles || selectedRoles.length === 0) {
    return res.status(400).json({ error: 'No roles selected' });
  }
  
  // Exclude host from players who receive roles
  const eligiblePlayers = room.players.filter(pid => pid !== room.hostId);
  
  if (eligiblePlayers.length !== selectedRoles.length) {
    return res.status(400).json({ 
      error: `Role count must match player count. You have ${eligiblePlayers.length} players but ${selectedRoles.length} roles selected.` 
    });
  }
  
  // Clear previous role assignments for this room's players
  for (const pid of room.players) {
    playerRoles.delete(pid);
  }
  
  // Shuffle eligible players (excluding host)
  const shuffledPlayers = [...eligiblePlayers].sort(() => Math.random() - 0.5);
  
  // Shuffle selected roles
  const shuffledRoles = [...selectedRoles].sort(() => Math.random() - 0.5);
  
  // Assign roles to players (1:1 mapping, everyone gets a role)
  for (let i = 0; i < shuffledRoles.length; i++) {
    const pid = shuffledPlayers[i];
    playerRoles.set(pid, shuffledRoles[i]);
  }
  
  room.rolesAssigned = true;
  rooms.set(code, room);
  
  // Notify each player of their own role only
  for (const pid of eligiblePlayers) {
    const role = playerRoles.get(pid);
    io.to(code).emit('roleAssigned', { playerId: pid, hasRole: true });
  }
  
  // Send individual role to each connected socket
  io.to(code).emit('rolesDistributed');
  
  res.json({ success: true, totalAssigned: shuffledRoles.length });
});

// API: Get my role
app.get('/api/my-role', (req, res) => {
  const playerId = req.cookies.playerId;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const role = playerRoles.get(playerId);
  
  if (!role) {
    return res.json({ role: null });
  }
  
  res.json({ role });
});

// API: Get all player roles (host/Grimoire view only)
app.get('/api/room/:code/grimoire', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  // Only the host can see the Grimoire
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can view the Grimoire' });
  }
  
  // Get all players (excluding host) with their roles, in circle order
  const roomDeadPlayers = deadPlayers.get(code) || new Set();
  const roomDrunkPlayers = drunkPlayers.get(code) || new Set();
  const orderedPlayerIds = playerOrder.get(code) || room.players;
  
  // Filter to only include players still in the room (excluding host)
  const validOrderedIds = orderedPlayerIds.filter(id => room.players.includes(id) && id !== room.hostId);
  
  // Add any new players that aren't in the order yet
  const newPlayers = room.players.filter(id => !validOrderedIds.includes(id) && id !== room.hostId);
  const finalOrder = [...validOrderedIds, ...newPlayers];
  
  const grimoireData = finalOrder
    .map(pid => {
      const player = players.get(pid);
      const role = playerRoles.get(pid);
      return {
        playerId: pid,
        username: player ? player.username : 'Unknown',
        emoji: player ? player.emoji : '❓',
        role: role || null,
        isDead: roomDeadPlayers.has(pid),
        isDrunk: roomDrunkPlayers.has(pid)
      };
    });
  
  res.json({ players: grimoireData, rolesAssigned: room.rolesAssigned });
});

// API: Reset roles (host only)
app.post('/api/room/:code/reset-roles', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can reset roles' });
  }
  
  // Clear role assignments
  for (const pid of room.players) {
    playerRoles.delete(pid);
  }
  
  // Clear dead players
  deadPlayers.delete(code);
  
  // Clear drunk players
  drunkPlayers.delete(code);
  
  // Clear chat messages
  chatMessages.delete(code);
  
  room.rolesAssigned = false;
  rooms.set(code, room);
  
  io.to(code).emit('rolesReset');
  
  res.json({ success: true });
});

// API: Mark player as dead (host only)
app.post('/api/room/:code/kill-player', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { targetPlayerId } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can mark players as dead' });
  }
  
  if (!room.players.includes(targetPlayerId)) {
    return res.status(400).json({ error: 'Player not in room' });
  }
  
  // Initialize dead players set for this room if needed
  if (!deadPlayers.has(code)) {
    deadPlayers.set(code, new Set());
  }
  
  const roomDeadPlayers = deadPlayers.get(code);
  roomDeadPlayers.add(targetPlayerId);
  
  // Emit death event to the room
  console.log('Emitting playerKilled to room:', code, 'targetPlayerId:', targetPlayerId);
  io.to(code).emit('playerKilled', { playerId: targetPlayerId });
  
  res.json({ success: true });
});

// API: Revive player (host only)
app.post('/api/room/:code/revive-player', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { targetPlayerId } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can revive players' });
  }
  
  if (deadPlayers.has(code)) {
    deadPlayers.get(code).delete(targetPlayerId);
  }
  
  // Emit revive event to the room
  io.to(code).emit('playerRevived', { playerId: targetPlayerId });
  
  res.json({ success: true });
});

// API: Mark player as drunk (host only - for host's reference)
app.post('/api/room/:code/mark-drunk', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { targetPlayerId } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can mark players as drunk' });
  }
  
  if (!room.players.includes(targetPlayerId)) {
    return res.status(400).json({ error: 'Player not in room' });
  }
  
  // Initialize drunk players set for this room if needed
  if (!drunkPlayers.has(code)) {
    drunkPlayers.set(code, new Set());
  }
  
  const roomDrunkPlayers = drunkPlayers.get(code);
  roomDrunkPlayers.add(targetPlayerId);
  
  // Emit event only to host (grimoire update)
  io.to(code).emit('playerMarkedDrunk', { playerId: targetPlayerId });
  
  res.json({ success: true });
});

// API: Unmark player as drunk (host only)
app.post('/api/room/:code/unmark-drunk', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { targetPlayerId } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  if (room.hostId !== playerId) {
    return res.status(403).json({ error: 'Only the host can unmark players as drunk' });
  }
  
  if (drunkPlayers.has(code)) {
    drunkPlayers.get(code).delete(targetPlayerId);
  }
  
  // Emit event for grimoire update
  io.to(code).emit('playerUnmarkedDrunk', { playerId: targetPlayerId });
  
  res.json({ success: true });
});

// API: Send chat message (host can message anyone, players can only message host)
app.post('/api/room/:code/chat', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  const { content, recipientId } = req.body;
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  // Validate sender is in the room
  if (!room.players.includes(playerId)) {
    return res.status(403).json({ error: 'You are not in this room' });
  }
  
  const sender = players.get(playerId);
  const isHost = room.hostId === playerId;
  
  // Validate content
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }
  
  if (content.length > 500) {
    return res.status(400).json({ error: 'Message too long (max 500 characters)' });
  }
  
  // Non-host players can only message the host
  if (!isHost) {
    if (recipientId !== room.hostId) {
      return res.status(403).json({ error: 'Players can only message the host' });
    }
  } else {
    // Host: validate recipient if provided
    if (recipientId && !room.players.includes(recipientId)) {
      return res.status(400).json({ error: 'Invalid recipient' });
    }
  }
  
  // Create message object
  const message = {
    id: Date.now().toString(),
    senderId: playerId,
    senderEmoji: sender.emoji,
    senderUsername: sender.username,
    isFromHost: isHost,
    recipientId: recipientId || null, // null means "everyone" (host only)
    content: content.trim(),
    timestamp: Date.now()
  };
  
  // Store message
  if (!chatMessages.has(code)) {
    chatMessages.set(code, []);
  }
  chatMessages.get(code).push(message);
  
  // Emit to appropriate recipients
  if (recipientId) {
    // DM: Send to the specific recipient and the sender
    io.to(code).emit('chatMessage', {
      ...message,
      _recipientOnly: recipientId // Client will filter based on this
    });
  } else {
    // Group message (host only): Send to everyone in the room
    io.to(code).emit('chatMessage', message);
  }
  
  res.json({ success: true, message });
});

// API: Get chat history
app.get('/api/room/:code/chat', (req, res) => {
  const playerId = req.cookies.playerId;
  const code = req.params.code.toUpperCase();
  
  if (!playerId || !players.has(playerId)) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  if (!rooms.has(code)) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  const room = rooms.get(code);
  
  // Check if player is in the room
  if (!room.players.includes(playerId)) {
    return res.status(403).json({ error: 'Not in room' });
  }
  
  const allMessages = chatMessages.get(code) || [];
  
  // Filter messages: show all group messages, but only DMs addressed to this player (or sent by host)
  const visibleMessages = allMessages.filter(msg => {
    // Group messages are visible to everyone
    if (!msg.recipientId) return true;
    
    // DMs are visible to the recipient or the sender (host)
    return msg.recipientId === playerId || msg.senderId === playerId;
  });
  
  res.json({ messages: visibleMessages });
});

// Helper function to leave a room
function leaveRoom(playerId, roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.players = room.players.filter(id => id !== playerId);

  const player = players.get(playerId);
  if (player) {
    player.roomCode = null;
    player.isHost = false;
    players.set(playerId, player);
  }

  // Clear player's role assignment when leaving
  playerRoles.delete(playerId);

  if (room.players.length === 0) {
    // Delete empty room
    rooms.delete(roomCode);
    deadPlayers.delete(roomCode);
    drunkPlayers.delete(roomCode);
    playerOrder.delete(roomCode);
    chatMessages.delete(roomCode);
  } else {
    // Transfer host if needed
    if (room.hostId === playerId) {
      room.hostId = room.players[0];
      const newHost = players.get(room.hostId);
      if (newHost) {
        newHost.isHost = true;
        players.set(room.hostId, newHost);
        io.to(roomCode).emit('hostChanged', newHost);
      }
    }
    rooms.set(roomCode, room);
    io.to(roomCode).emit('playerLeft', { playerId });
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New socket connection:', socket.id);
  let currentPlayerId = null;
  let currentRoomCode = null;
  
  // Send current server version to the client on connection
  socket.emit('serverVersion', { version });
  
  socket.on('authenticate', (playerId) => {
    console.log('Socket authenticated:', socket.id, 'playerId:', playerId);
    currentPlayerId = playerId;
    const player = players.get(playerId);
    if (player && player.roomCode) {
      currentRoomCode = player.roomCode;
      console.log('Auto-joining room from authenticate:', player.roomCode);
      socket.join(player.roomCode);
    }
  });
  
  socket.on('joinRoom', (roomCode) => {
    console.log('Socket joining room:', roomCode, 'playerId:', currentPlayerId);
    if (currentRoomCode) {
      socket.leave(currentRoomCode);
    }
    currentRoomCode = roomCode;
    socket.join(roomCode);
  });
  
  socket.on('leaveRoom', () => {
    if (currentRoomCode) {
      socket.leave(currentRoomCode);
      currentRoomCode = null;
    }
  });
  
  // Gong event - host triggers a gong sound for all players
  socket.on('triggerGong', (roomCode) => {
    if (!currentPlayerId || !roomCode) return;
    
    const room = rooms.get(roomCode);
    if (!room) return;
    
    // Only the host can trigger the gong
    if (room.hostId !== currentPlayerId) return;
    
    console.log(`🔔 Gong triggered by host in room ${roomCode}`);
    
    // Broadcast gong to all players in the room (including the host)
    io.to(roomCode).emit('playGong');
  });
  
  socket.on('disconnect', () => {
    // Player remains in room even if socket disconnects
    // They can reconnect with their cookie
  });
});

const PORT = process.env.PORT || 7105;
server.listen(PORT, () => {
  console.log(`🩸 Blood on the Clocktower server running on http://localhost:${PORT}`);
});

