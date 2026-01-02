// Blood on the Clocktower - Client Application

// Dynamic socket.io loader - loads from server before app init
function loadSocketIO() {
  return new Promise((resolve, reject) => {
    if (typeof io !== 'undefined') {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load socket.io'));
    document.head.appendChild(script);
  });
}

// Role distribution reference by player count
const ROLE_DISTRIBUTION = {
  5:  { Townsfolk: 3, Outsiders: 0, Minions: 1, Demons: 1 },
  6:  { Townsfolk: 3, Outsiders: 1, Minions: 1, Demons: 1 },
  7:  { Townsfolk: 5, Outsiders: 0, Minions: 1, Demons: 1 },
  8:  { Townsfolk: 5, Outsiders: 1, Minions: 1, Demons: 1 },
  9:  { Townsfolk: 5, Outsiders: 2, Minions: 1, Demons: 1 },
  10: { Townsfolk: 7, Outsiders: 0, Minions: 2, Demons: 1 },
  11: { Townsfolk: 7, Outsiders: 1, Minions: 2, Demons: 1 },
  12: { Townsfolk: 7, Outsiders: 2, Minions: 2, Demons: 1 },
  13: { Townsfolk: 9, Outsiders: 0, Minions: 3, Demons: 1 },
  14: { Townsfolk: 9, Outsiders: 1, Minions: 3, Demons: 1 },
  15: { Townsfolk: 9, Outsiders: 2, Minions: 3, Demons: 1 } // 15+ uses same distribution
};

class ClockTowerApp {
  constructor() {
    this.player = null;
    this.room = null;
    this.roomPlayers = [];
    this.playerOrder = []; // Array of player IDs in circle order
    this.socket = null;
    this.myRole = null;
    this.allRoles = {}; // Current role set's roles
    this.allRoleSets = []; // All available role sets
    this.currentRoleSet = 'trouble_brewing'; // Current role set ID
    this.currentRoleSetName = 'Trouble Brewing'; // Current role set display name
    this.selectedRoles = []; // Currently selected roles for the game
    this.grimoireData = []; // Host-only: all player roles
    this.isRoleCardHidden = false; // Track if player has hidden their role card
    this.isGrimoireHidden = false; // Track if host has hidden the grimoire
    this.isDead = false; // Track if this player is dead
    
    // Drag and drop state
    this.draggedPlayer = null;
    this.draggedElement = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    
    // Chat state
    this.chatMessages = []; // Array of chat messages
    this.hasUnreadMessages = false;
    this.isChatOpen = false;
    
    // Autocomplete state
    this.autocompleteItems = [];
    this.autocompleteSelectedIndex = 0;
    this.autocompleteType = null; // 'user' or 'role'
    this.autocompleteStartPos = 0; // Position in input where autocomplete started
    
    // Version tracking for auto-reload on updates
    this.clientVersion = null;
    
    // Emoji picker state
    this.isEmojiPickerOpen = false;
    this.animalEmojis = [
      '🐶', '🦊', '🐸', '🦋', '🐙', '🦈', '🐘', '🦒', '🐓', '🦜',
      '🐱', '🐻', '🐵', '🐌', '🦑', '🐊', '🦛', '🦘', '🦃', '🦢',
      '🐭', '🐼', '🐔', '🐞', '🦐', '🐅', '🦏', '🐃', '🦚', '🦩',
      '🐹', '🐨', '🐧', '🐜', '🦞', '🐆', '🐪', '🐂', '🐇', '🕊',
      '🐰', '🐯', '🐦', '🦟', '🦀', '🦓', '🐫', '🐄', '🦝', '🐁',
      '🦁', '🐤', '🦗', '🐡', '🦍', '🦌', '🐎', '🦨', '🐀', '🐮',
      '🦆', '🕷', '🐠', '🦧', '🐕', '🐖', '🦡', '🐿', '🐷', '🦅',
      '🦂', '🐟', '🐩', '🐏', '🦫', '🦔', '🦉', '🐢', '🐬', '🐋',
      '🐈', '🐑', '🦦', '🦎', '🦇', '🐍', '🐳', '🐐', '🦥', '🦖'
    ];

    this.init();
  }
  
  async init() {
    // Connect to socket
    this.socket = io();
    this.setupSocketListeners();

    // Fetch role sets list
    await this.fetchRoleSets();
    
    // Fetch default roles data
    await this.fetchRoles();

    // Fetch or create session
    await this.loadSession();

    // Fetch and display version
    await this.fetchVersion();

    // Setup UI event listeners
    this.setupEventListeners();
    
    // Populate emoji picker grid
    this.populateEmojiGrid();

    // Check if player was in a room
    if (this.player && this.player.roomCode) {
      await this.rejoinRoom(this.player.roomCode);
    } else {
      this.showScreen('menu-screen');
    }
  }
  
  async fetchRoleSets() {
    try {
      const response = await fetch('/api/role-sets');
      this.allRoleSets = await response.json();
    } catch (error) {
      console.error('Failed to fetch role sets:', error);
    }
  }
  
  async fetchRoles(roleSetId = null) {
    try {
      const setId = roleSetId || this.currentRoleSet;
      const response = await fetch(`/api/roles/${setId}`);
      if (response.ok) {
        this.allRoles = await response.json();
      } else {
        // Fallback to default
        const defaultResponse = await fetch('/api/roles');
        this.allRoles = await defaultResponse.json();
      }
    } catch (error) {
      console.error('Failed to fetch roles:', error);
    }
  }

  async fetchVersion() {
    try {
      const response = await fetch('/api/version');
      const data = await response.json();
      // Store the version we loaded with (for detecting updates)
      this.clientVersion = data.version;
      document.getElementById('version-display').textContent = `v${data.version}`;
    } catch (error) {
      console.error('Failed to fetch version:', error);
      document.getElementById('version-display').textContent = 'v?.?.?';
    }
  }
  
  async loadSession() {
    try {
      const response = await fetch('/api/session');
      this.player = await response.json();
      this.updatePlayerPreview();
      
      // Authenticate with socket
      this.socket.emit('authenticate', this.player.id);
    } catch (error) {
      console.error('Failed to load session:', error);
      this.showToast('Failed to connect to server', 'error');
    }
  }
  
  setupSocketListeners() {
    // Debug: log socket connection status
    this.socket.on('connect', () => {
      console.log('Socket connected! Socket ID:', this.socket.id);
      
      // Re-authenticate on reconnection (handles tab sleep, network drops, etc.)
      if (this.player && this.player.id) {
        console.log('Re-authenticating player:', this.player.id);
        this.socket.emit('authenticate', this.player.id);
        
        // Re-join room if we were in one
        if (this.room && this.room.code) {
          console.log('Re-joining room:', this.room.code);
          this.socket.emit('joinRoom', this.room.code);
        }
      }
    });
    
    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected! Reason:', reason);
    });
    
    // Handle tab visibility change - reconnect when user returns to tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('Tab became visible, checking connection...');
        
        // If socket is disconnected, it will auto-reconnect
        // If socket thinks it's connected but server dropped it, force reconnect
        if (this.socket.connected) {
          // Send a ping to verify connection is still alive
          // If we're in a room, re-join to ensure we're subscribed
          if (this.player && this.player.id) {
            this.socket.emit('authenticate', this.player.id);
            if (this.room && this.room.code) {
              this.socket.emit('joinRoom', this.room.code);
            }
          }
        } else {
          // Socket is disconnected, attempt to reconnect
          console.log('Socket disconnected, attempting reconnect...');
          this.socket.connect();
        }
      }
    });
    
    // Force reload handler
    this.socket.on('forceReload', () => {
      console.log('Server requested reload...');
      window.location.reload();
    });
    
    // Version check handler - reload if server version differs from client version
    this.socket.on('serverVersion', ({ version }) => {
      console.log(`Server version: ${version}, Client version: ${this.clientVersion}`);
      if (this.clientVersion && version !== this.clientVersion) {
        console.log('Version mismatch detected! Reloading to get new version...');
        this.showToast('New version available! Reloading...', 'info');
        // Small delay to show the toast before reloading
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    });

    this.socket.on('playerJoined', (player) => {
      this.showToast(`${player.emoji} ${player.username || 'A stranger'} has arrived`, 'success');
      this.refreshRoomPlayers();
    });
    
    this.socket.on('playerLeft', ({ playerId }) => {
      const player = this.roomPlayers.find(p => p.id === playerId);
      if (player) {
        this.showToast(`${player.emoji} ${player.username || 'A stranger'} has departed`, 'error');
      }
      this.refreshRoomPlayers();
    });
    
    this.socket.on('playerUpdated', (player) => {
      this.refreshRoomPlayers();
    });
    
    this.socket.on('hostChanged', (newHost) => {
      this.showToast(`${newHost.emoji} ${newHost.username || 'A stranger'} is now the host`, 'success');
      this.player.isHost = this.player.id === newHost.id;
      this.refreshRoomPlayers();
      this.updateHostUI();
    });
    
    this.socket.on('selectedRolesUpdated', (selectedRoles) => {
      this.selectedRoles = selectedRoles;
      this.updateRoleSelectionUI();
    });
    
    this.socket.on('roleSetChanged', ({ roleSet, roleSetName, roles }) => {
      this.currentRoleSet = roleSet;
      this.currentRoleSetName = roleSetName;
      this.allRoles = roles;
      this.updateRoleSetUI();
      this.renderRoleSelection();
      this.renderAlmanac();
      this.showToast(`Role set changed to ${roleSetName}`, 'info');
    });
    
    this.socket.on('rolesDistributed', async () => {
      if (this.player && this.player.isHost) {
        this.showToast('Roles have been assigned! View the Grimoire.', 'success');
        await this.fetchGrimoire();
      } else {
        this.showToast('Roles have been assigned! Check your role.', 'success');
        await this.fetchMyRole();
      }
      // Refresh room to get updated rolesAssigned status
      await this.refreshRoomPlayers();
    });
    
    this.socket.on('rolesReset', () => {
      this.showToast('Roles have been reset.', 'info');
      this.myRole = null;
      this.isRoleCardHidden = false;
      this.grimoireData = [];
      if (this.room) this.room.rolesAssigned = false;
      this.updateRoleDisplay();
      this.renderGrimoire();
      this.updateHostUI();
      this.clearChat();
    });
    
    this.socket.on('playerKilled', async ({ playerId }) => {
      console.log('playerKilled event received:', playerId);
      // If this player was killed, show the blood effect
      if (this.player && this.player.id === playerId) {
        this.showBloodEffect();
        this.showToast('You have been killed!', 'error');
      }
      
      // Refresh players list to show death status
      await this.refreshRoomPlayers();
      
      // Refresh grimoire to update dead status (for host)
      if (this.player && this.player.isHost && this.room && this.room.rolesAssigned) {
        await this.fetchGrimoire();
      }
    });
    
    this.socket.on('playerRevived', async ({ playerId }) => {
      // If this player was revived, show a message
      if (this.player && this.player.id === playerId) {
        this.showToast('You have been revived!', 'success');
      }
      
      // Refresh players list to show alive status
      await this.refreshRoomPlayers();
      
      // Refresh grimoire to update alive status (for host)
      if (this.player && this.player.isHost && this.room && this.room.rolesAssigned) {
        await this.fetchGrimoire();
      }
    });
    
    this.socket.on('playerMarkedDrunk', async ({ playerId }) => {
      // Refresh grimoire to update drunk status (for host)
      if (this.player && this.player.isHost && this.room && this.room.rolesAssigned) {
        await this.fetchGrimoire();
      }
    });
    
    this.socket.on('playerUnmarkedDrunk', async ({ playerId }) => {
      // Refresh grimoire to update drunk status (for host)
      if (this.player && this.player.isHost && this.room && this.room.rolesAssigned) {
        await this.fetchGrimoire();
      }
    });
    
    this.socket.on('playerOrderChanged', (order) => {
      this.playerOrder = order;
      this.renderPlayers();
    });
    
    // Chat message received
    this.socket.on('chatMessage', (message) => {
      this.handleChatMessage(message);
    });
    
    // Gong sound received
    this.socket.on('playGong', () => {
      this.playGongSound();
    });
  }
  
  setupEventListeners() {
    // Create room
    document.getElementById('create-room-btn').addEventListener('click', () => {
      this.createRoom();
    });
    
    // Join room
    document.getElementById('join-room-btn').addEventListener('click', () => {
      this.joinRoom();
    });
    
    document.getElementById('room-code-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.joinRoom();
      }
    });
    
    // Auto-uppercase room code
    document.getElementById('room-code-input').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
    
    // Copy room code
    document.getElementById('copy-code-btn').addEventListener('click', () => {
      this.copyRoomCode();
    });
    
    // Copy grimoire (host only)
    document.getElementById('copy-grimoire-btn').addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent grimoire hide/show toggle
      this.copyGrimoire();
    });
    
    // Leave room
    document.getElementById('leave-room-btn').addEventListener('click', () => {
      this.leaveRoom();
    });
    
    // Category headers (expand/collapse)
    document.querySelectorAll('.category-header').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.closest('.role-category-section');
        section.classList.toggle('collapsed');
      });
    });
    
    // Assign roles button
    document.getElementById('assign-roles-btn').addEventListener('click', () => {
      this.assignRoles();
    });
    
    // Reset roles button
    document.getElementById('reset-roles-btn').addEventListener('click', () => {
      this.resetRoles();
    });
    
    // Settings modal
    document.getElementById('settings-btn').addEventListener('click', () => {
      this.openSettingsModal();
    });
    
    document.getElementById('close-settings-btn').addEventListener('click', () => {
      this.closeSettingsModal();
    });
    
    // Gong button (host only)
    document.getElementById('gong-btn').addEventListener('click', () => {
      this.triggerGong();
    });
    
    // Close modal when clicking backdrop (use event delegation)
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) {
        this.closeSettingsModal();
      }
    });
    
    // Close modal/panel on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeSettingsModal();
        this.closeAlmanacPanel();
        this.closeChatPanel();
      }
    });

    // Toggle role card visibility
    document.getElementById('my-role-section').addEventListener('click', () => {
      this.toggleRoleCardVisibility();
    });

    // Toggle grimoire visibility (host only)
    document.getElementById('grimoire-section').addEventListener('click', (e) => {
      // Only toggle if clicking on the grimoire card itself, not buttons inside
      if (!e.target.closest('button') && !e.target.closest('.grimoire-actions')) {
        this.toggleGrimoireVisibility();
      }
    });

    // Info button (opens almanac side panel)
    document.getElementById('info-btn').addEventListener('click', () => {
      this.openAlmanacPanel();
    });

    document.getElementById('close-almanac-btn').addEventListener('click', () => {
      this.closeAlmanacPanel();
    });

    // Close side panel when clicking backdrop
    document.querySelector('.side-panel-backdrop').addEventListener('click', () => {
      this.closeAlmanacPanel();
    });
    
    // Role set selector in settings (host only)
    document.getElementById('role-set-select')?.addEventListener('change', (e) => {
      this.changeRoleSet(e.target.value);
    });
    
    // Role set selector in almanac (main menu only, when not in room)
    document.getElementById('almanac-role-set-select')?.addEventListener('change', (e) => {
      this.changeAlmanacRoleSet(e.target.value);
    });
    
    // Chat button
    document.getElementById('chat-btn').addEventListener('click', () => {
      this.openChatPanel();
    });
    
    document.getElementById('close-chat-btn').addEventListener('click', () => {
      this.closeChatPanel();
    });
    
    // Close chat panel when clicking backdrop
    document.querySelector('#chat-panel .side-panel-backdrop').addEventListener('click', () => {
      this.closeChatPanel();
    });
    
    // Send chat message
    document.getElementById('chat-send-btn').addEventListener('click', () => {
      this.sendChatMessage();
    });
    
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
      // Enter sends message, Shift+Enter adds newline
      if (e.key === 'Enter' && !e.shiftKey && !this.autocompleteItems.length) {
        e.preventDefault();
        this.sendChatMessage();
      }
    });
    
    // Auto-resize textarea as user types
    document.getElementById('chat-input').addEventListener('input', () => {
      const textarea = document.getElementById('chat-input');
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });
    
    // Chat autocomplete handlers
    document.getElementById('chat-input').addEventListener('input', (e) => {
      this.handleChatInputChange(e);
    });
    
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      this.handleChatInputKeydown(e);
    });
    
    // Close autocomplete when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.chat-input-wrapper')) {
        this.hideAutocomplete();
      }
    });
    
    // Emoji picker event listeners
    document.getElementById('emoji-picker-trigger').addEventListener('click', () => {
      this.toggleEmojiPicker();
    });
    
    document.getElementById('close-emoji-picker').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeEmojiPicker();
    });
    
    document.getElementById('save-emoji-btn').addEventListener('click', () => {
      this.saveCustomEmoji();
    });
    
    document.getElementById('custom-emoji-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.saveCustomEmoji();
      }
    });
    
    // Close emoji picker when clicking outside
    document.addEventListener('click', (e) => {
      if (this.isEmojiPickerOpen && 
          !e.target.closest('#emoji-picker-popup') && 
          !e.target.closest('#emoji-picker-trigger')) {
        this.closeEmojiPicker();
      }
    });
  }
  
  renderRoleSelection() {
    const categories = ['Townsfolk', 'Outsiders', 'Minions', 'Demons'];
    
    for (const category of categories) {
      const container = document.getElementById(`roles-${category}`);
      if (!container || !this.allRoles[category]) continue;
      
      container.innerHTML = this.allRoles[category].map(role => {
        const isSelected = this.selectedRoles.some(r => r.name === role.name);
        const isDisabled = role.name === 'Drunk';
        return `
          <div class="role-item ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}" data-role="${this.escapeHtml(role.name)}" data-category="${category}">
            <div class="role-checkbox"></div>
            <div class="role-details">
              <div class="role-name">${this.escapeHtml(role.name)}</div>
              <div class="role-desc">${this.escapeHtml(role.description)}</div>
            </div>
          </div>
        `;
      }).join('');
      
      // Add click handlers
      container.querySelectorAll('.role-item').forEach(item => {
        item.addEventListener('click', () => {
          if (item.classList.contains('disabled')) return;
          this.toggleRole(item.dataset.role, item.dataset.category);
        });
      });
    }
    
    this.updateRoleSelectionUI();
  }
  
  toggleRole(roleName, category) {
    if (!this.player.isHost || !this.room) return;
    
    const existingIndex = this.selectedRoles.findIndex(r => r.name === roleName);
    
    if (existingIndex >= 0) {
      // Remove role
      this.selectedRoles.splice(existingIndex, 1);
    } else {
      // Add role
      const role = this.allRoles[category].find(r => r.name === roleName);
      if (role) {
        this.selectedRoles.push({ ...role, category });
      }
    }
    
    this.updateRoleSelectionUI();
    this.saveSelectedRoles();
  }
  
  async saveSelectedRoles() {
    if (!this.player.isHost || !this.room) return;
    
    try {
      await fetch(`/api/room/${this.room.code}/selected-roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedRoles: this.selectedRoles })
      });
    } catch (error) {
      console.error('Failed to save selected roles:', error);
    }
  }
  
  getRoleDistribution(playerCount) {
    // Return the distribution for the given player count
    // Use 15 for any count >= 15, or null if below 5
    if (playerCount < 5) return null;
    if (playerCount >= 15) return ROLE_DISTRIBUTION[15];
    return ROLE_DISTRIBUTION[playerCount];
  }
  
  updateRoleSelectionUI() {
    const categories = ['Townsfolk', 'Outsiders', 'Minions', 'Demons'];
    const counts = { Townsfolk: 0, Outsiders: 0, Minions: 0, Demons: 0 };
    
    // Count selected roles per category
    for (const role of this.selectedRoles) {
      if (counts.hasOwnProperty(role.category)) {
        counts[role.category]++;
      }
    }
    
    // Get player count and role distribution reference
    const playerCount = this.room && this.room.hostId 
      ? this.roomPlayers.filter(p => p.id !== this.room.hostId).length 
      : this.roomPlayers.length;
    const distribution = this.getRoleDistribution(playerCount);
    
    // Update category counts and reference numbers
    for (const category of categories) {
      const countEl = document.getElementById(`count-${category}`);
      const refEl = document.getElementById(`ref-${category}`);
      
      if (countEl) {
        countEl.textContent = counts[category];
        
        // Add visual feedback if count matches reference
        if (distribution) {
          const refCount = distribution[category];
          if (counts[category] === refCount) {
            countEl.classList.add('matched');
            countEl.classList.remove('mismatched');
          } else {
            countEl.classList.remove('matched');
            if (counts[category] > 0) {
              countEl.classList.add('mismatched');
            } else {
              countEl.classList.remove('mismatched');
            }
          }
        } else {
          countEl.classList.remove('matched', 'mismatched');
        }
      }
      
      // Update reference count display
      if (refEl) {
        if (distribution) {
          refEl.textContent = `/ ${distribution[category]}`;
          refEl.classList.remove('hidden');
        } else {
          refEl.textContent = '';
          refEl.classList.add('hidden');
        }
      }
      
      // Update selection state of role items
      const container = document.getElementById(`roles-${category}`);
      if (container) {
        container.querySelectorAll('.role-item').forEach(item => {
          const isSelected = this.selectedRoles.some(r => r.name === item.dataset.role);
          item.classList.toggle('selected', isSelected);
        });
      }
    }
    
    // Update total roles count
    const totalRolesEl = document.getElementById('total-roles');
    if (totalRolesEl) {
      totalRolesEl.textContent = this.selectedRoles.length;
    }
    
    // Update total players count (excluding host who doesn't get a role)
    const totalPlayersEl = document.getElementById('total-players');
    const settingsSummary = document.querySelector('.settings-summary');
    if (totalPlayersEl) {
      totalPlayersEl.textContent = playerCount;
      
      // Show match/mismatch status
      if (settingsSummary) {
        if (this.selectedRoles.length === playerCount && playerCount > 0) {
          settingsSummary.classList.add('matched');
          settingsSummary.classList.remove('mismatched');
        } else if (this.selectedRoles.length > 0 || playerCount > 0) {
          settingsSummary.classList.add('mismatched');
          settingsSummary.classList.remove('matched');
        } else {
          settingsSummary.classList.remove('matched', 'mismatched');
        }
      }
    }
  }
  
  updatePlayerPreview() {
    if (!this.player) return;
    
    document.getElementById('preview-emoji').textContent = this.player.emoji;
    document.getElementById('username-input').value = this.player.username || '';
  }
  
  // Emoji Picker Methods
  populateEmojiGrid() {
    const grid = document.getElementById('emoji-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    this.animalEmojis.forEach(emoji => {
      const item = document.createElement('div');
      item.className = 'emoji-grid-item';
      item.textContent = emoji;
      item.addEventListener('click', () => this.selectEmoji(emoji));
      grid.appendChild(item);
    });
  }
  
  toggleEmojiPicker() {
    if (this.isEmojiPickerOpen) {
      this.closeEmojiPicker();
    } else {
      this.openEmojiPicker();
    }
  }
  
  openEmojiPicker() {
    const popup = document.getElementById('emoji-picker-popup');
    popup.classList.remove('hidden');
    this.isEmojiPickerOpen = true;
    
    // Update selected state in grid
    this.updateEmojiGridSelection();
    
    // Clear and focus input
    const input = document.getElementById('custom-emoji-input');
    input.value = '';
    input.focus();
  }
  
  closeEmojiPicker() {
    const popup = document.getElementById('emoji-picker-popup');
    popup.classList.add('hidden');
    this.isEmojiPickerOpen = false;
  }
  
  updateEmojiGridSelection() {
    const currentEmoji = this.player?.emoji;
    document.querySelectorAll('.emoji-grid-item').forEach(item => {
      if (item.textContent === currentEmoji) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });
  }
  
  selectEmoji(emoji) {
    this.saveEmoji(emoji);
    this.closeEmojiPicker();
  }
  
  saveCustomEmoji() {
    const input = document.getElementById('custom-emoji-input');
    const inputValue = input.value.trim();
    
    if (!inputValue) {
      this.showToast('Please enter an emoji', 'error');
      return;
    }
    
    // Extract the first valid emoji from the input
    // This regex matches emoji sequences including those with modifiers, ZWJ sequences, etc.
    const emojiRegex = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F?(?:\u200D\p{Emoji}\uFE0F?)*/gu;
    const matches = inputValue.match(emojiRegex);
    
    if (!matches || matches.length === 0) {
      this.showToast('Please enter a valid emoji', 'error');
      return;
    }
    
    // Use the first matched emoji
    const emoji = matches[0];
    
    this.saveEmoji(emoji);
    this.closeEmojiPicker();
  }
  
  async saveEmoji(emoji) {
    try {
      const response = await fetch('/api/emoji', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save emoji');
      }
      
      this.player = await response.json();
      this.updatePlayerPreview();
      this.showToast('Icon updated!', 'success');
      
      // Update room display if in room
      if (this.room) {
        this.refreshRoomPlayers();
      }
    } catch (error) {
      console.error('Failed to save emoji:', error);
      this.showToast('Failed to save icon', 'error');
    }
  }
  
  async saveUsername() {
    const input = document.getElementById('username-input');
    const username = input.value.trim();
    
    if (!username) {
      this.showToast('Please enter a name', 'error');
      return;
    }
    
    try {
      const response = await fetch('/api/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      
      this.player = await response.json();
      this.showToast('Name saved!', 'success');
      
      // Update room display if in room
      if (this.room) {
        this.refreshRoomPlayers();
      }
    } catch (error) {
      console.error('Failed to save username:', error);
      this.showToast('Failed to save name', 'error');
    }
  }
  
  async createRoom() {
    const username = document.getElementById('username-input').value.trim();

    if (!username) {
      this.showToast('Please enter your name first', 'error');
      document.getElementById('username-input').focus();
      return;
    }

    try {
      // Save username first
      await fetch('/api/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });

      const response = await fetch('/api/room/create', {
        method: 'POST'
      });

      const data = await response.json();
      this.room = data.room;
      this.player = data.player;
      this.selectedRoles = data.room.selectedRoles || [];
      
      // Set role set from room
      if (data.room.roleSet) {
        this.currentRoleSet = data.room.roleSet;
        this.currentRoleSetName = data.room.roleSetName || data.room.roleSet;
        await this.fetchRoles(data.room.roleSet);
      }

      // Clear role state for new room
      this.myRole = null;
      this.isRoleCardHidden = false;
      this.isDead = false;
      this.playerOrder = [];

      console.log('Emitting joinRoom for room:', this.room.code);
      this.socket.emit('joinRoom', this.room.code);
      await this.refreshRoomPlayers();

      this.showScreen('room-screen');
      this.updateRoomDisplay();
      this.updateHostUI();
      this.renderRoleSelection();
      this.updateRoleDisplay();
      this.updateRoleSetUI();
      this.showChatButton();
      this.clearChat();
      this.showToast('Room created! Share the code with others.', 'success');
    } catch (error) {
      console.error('Failed to create room:', error);
      this.showToast('Failed to create room', 'error');
    }
  }
  
  async joinRoom() {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();

    if (!code || code.length !== 4) {
      this.showToast('Please enter a 4-letter room code', 'error');
      return;
    }

    const username = document.getElementById('username-input').value.trim();

    if (!username) {
      this.showToast('Please enter your name first', 'error');
      document.getElementById('username-input').focus();
      return;
    }

    try {
      // Save username first
      await fetch('/api/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });

      const response = await fetch('/api/room/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: code })
      });

      if (!response.ok) {
        const error = await response.json();
        this.showToast(error.error || 'Room not found', 'error');
        return;
      }

      const data = await response.json();
      this.room = data.room;
      this.player = data.player;
      this.selectedRoles = data.room.selectedRoles || [];
      
      // Set role set from room
      if (data.room.roleSet) {
        this.currentRoleSet = data.room.roleSet;
        this.currentRoleSetName = data.room.roleSetName || data.room.roleSet;
        await this.fetchRoles(data.room.roleSet);
      }

      // Clear role state for new room
      this.myRole = null;
      this.isRoleCardHidden = false;
      this.isDead = false;
      this.playerOrder = [];

      console.log('Emitting joinRoom for room:', this.room.code);
      this.socket.emit('joinRoom', this.room.code);
      await this.refreshRoomPlayers();
      await this.fetchMyRole();

      this.showScreen('room-screen');
      this.updateRoomDisplay();
      this.updateHostUI();
      this.renderRoleSelection();
      this.updateRoleDisplay();
      this.updateRoleSetUI();
      this.showChatButton();
      this.clearChat();
      await this.fetchChatHistory();
      this.showToast('Joined the town!', 'success');
    } catch (error) {
      console.error('Failed to join room:', error);
      this.showToast('Failed to join room', 'error');
    }
  }
  
  async rejoinRoom(roomCode) {
    try {
      const response = await fetch(`/api/room/${roomCode}`);
      
      if (!response.ok) {
        // Room no longer exists
        this.player.roomCode = null;
        this.showScreen('menu-screen');
        return;
      }
      
      const data = await response.json();
      this.room = data.room;
      this.roomPlayers = data.players;
      this.playerOrder = data.playerOrder || [];
      this.selectedRoles = data.room.selectedRoles || [];
      
      // Update role set from room
      if (data.room.roleSet) {
        this.currentRoleSet = data.room.roleSet;
        this.currentRoleSetName = data.room.roleSetName || data.room.roleSet;
      }
      if (data.roleSetRoles) {
        this.allRoles = data.roleSetRoles;
      }
      
      // Check if we're the host
      this.player.isHost = this.room.hostId === this.player.id;
      
      console.log('Emitting joinRoom for room (rejoin):', roomCode);
      this.socket.emit('joinRoom', roomCode);
      
      // Host sees grimoire, players see their role
      if (this.player.isHost && this.room.rolesAssigned) {
        await this.fetchGrimoire();
      } else {
        await this.fetchMyRole();
      }
      
      this.showScreen('room-screen');
      this.updateRoomDisplay();
      this.updateHostUI();
      this.renderRoleSelection();
      this.renderPlayers();
      this.showChatButton();
      this.clearChat();
      await this.fetchChatHistory();
    } catch (error) {
      console.error('Failed to rejoin room:', error);
      this.showScreen('menu-screen');
    }
  }
  
  async leaveRoom() {
    try {
      await fetch('/api/room/leave', { method: 'POST' });

      this.socket.emit('leaveRoom');
      this.room = null;
      this.roomPlayers = [];
      this.playerOrder = [];
      this.player.roomCode = null;
      this.player.isHost = false;
      this.myRole = null;
      this.isRoleCardHidden = false;
      this.isDead = false;
      this.selectedRoles = [];
      this.grimoireData = [];

      this.hideChatButton();
      this.clearChat();
      this.updateRoleSetUI(); // Update almanac to show dropdown again
      this.showScreen('menu-screen');
      this.showToast('Left the town', 'success');
    } catch (error) {
      console.error('Failed to leave room:', error);
      this.showToast('Failed to leave room', 'error');
    }
  }
  
  async refreshRoomPlayers() {
    if (!this.room) return;
    
    try {
      const response = await fetch(`/api/room/${this.room.code}`);
      
      if (!response.ok) {
        // Room no longer exists
        this.room = null;
        this.roomPlayers = [];
        this.playerOrder = [];
        this.showScreen('menu-screen');
        this.showToast('Room has been closed', 'error');
        return;
      }
      
      const data = await response.json();
      this.room = data.room;
      this.roomPlayers = data.players;
      this.playerOrder = data.playerOrder || [];
      this.selectedRoles = data.room.selectedRoles || [];
      
      // Update role set if provided
      if (data.room.roleSet) {
        this.currentRoleSet = data.room.roleSet;
        this.currentRoleSetName = data.room.roleSetName || data.room.roleSet;
      }
      if (data.roleSetRoles) {
        this.allRoles = data.roleSetRoles;
      }
      
      this.renderPlayers();
      this.updateRoleSelectionUI();
      this.updateRoleSetUI();
      
      // Fetch grimoire if host and roles are assigned
      if (this.player && this.player.isHost && this.room.rolesAssigned) {
        await this.fetchGrimoire();
      }
      
      this.updateHostUI();
    } catch (error) {
      console.error('Failed to refresh players:', error);
    }
  }
  
  async fetchMyRole() {
    try {
      const response = await fetch('/api/my-role');
      const data = await response.json();
      this.myRole = data.role;
      this.updateRoleDisplay();
    } catch (error) {
      console.error('Failed to fetch role:', error);
    }
  }
  
  async fetchGrimoire() {
    if (!this.player || !this.player.isHost || !this.room) return;
    
    try {
      const response = await fetch(`/api/room/${this.room.code}/grimoire`);
      if (!response.ok) {
        console.error('Failed to fetch grimoire');
        return;
      }
      const data = await response.json();
      this.grimoireData = data.players;
      this.renderGrimoire();
    } catch (error) {
      console.error('Failed to fetch grimoire:', error);
    }
  }
  
  updateRoomDisplay() {
    if (!this.room) return;
    document.getElementById('display-room-code').textContent = this.room.code;
  }
  
  updateHostUI() {
    const settingsBtn = document.getElementById('settings-btn');
    const gongBtn = document.getElementById('gong-btn');
    const resetBtn = document.getElementById('reset-roles-btn');
    const assignBtn = document.getElementById('assign-roles-btn');
    
    if (this.player && this.player.isHost) {
      settingsBtn.classList.remove('hidden');
      gongBtn.classList.remove('hidden');
      
      if (this.room && this.room.rolesAssigned) {
        resetBtn.classList.remove('hidden');
        assignBtn.querySelector('.btn-icon').textContent = '🎭';
        assignBtn.childNodes[2].textContent = ' Reassign Roles';
      } else {
        resetBtn.classList.add('hidden');
        assignBtn.querySelector('.btn-icon').textContent = '🎭';
        assignBtn.childNodes[2].textContent = ' Assign Roles';
      }
      
      // Always try to render grimoire for host
      this.renderGrimoire();
    } else {
      settingsBtn.classList.add('hidden');
      gongBtn.classList.add('hidden');
    }
  }
  
  updateRoleDisplay() {
    const roleSection = document.getElementById('my-role-section');
    const categoryEl = document.getElementById('my-role-category');
    const nameEl = document.getElementById('my-role-name');
    const descEl = document.getElementById('my-role-description');

    // Host doesn't get a role - they see the Grimoire instead
    if (this.player && this.player.isHost) {
      roleSection.classList.add('hidden');
      return;
    }

    if (this.myRole) {
      roleSection.classList.remove('hidden');
      categoryEl.textContent = this.myRole.category;
      categoryEl.className = `role-category ${this.myRole.category}`;
      nameEl.textContent = this.myRole.name;
      descEl.textContent = this.myRole.description;

      // Apply hidden state if active
      if (this.isRoleCardHidden) {
        roleSection.classList.add('role-hidden');
      } else {
        roleSection.classList.remove('role-hidden');
      }
    } else {
      roleSection.classList.add('hidden');
    }
  }
  
  renderGrimoire() {
    const grimoireSection = document.getElementById('grimoire-section');
    const grimoireList = document.getElementById('grimoire-list');
    
    if (!grimoireSection || !grimoireList) return;
    
    if (!this.player || !this.player.isHost || !this.room || !this.room.rolesAssigned) {
      grimoireSection.classList.add('hidden');
      return;
    }
    
    grimoireSection.classList.remove('hidden');
    
    // Apply hidden state if active
    if (this.isGrimoireHidden) {
      grimoireSection.classList.add('grimoire-hidden');
    } else {
      grimoireSection.classList.remove('grimoire-hidden');
    }
    
    grimoireList.innerHTML = this.grimoireData.map(playerData => {
      const role = playerData.role;
      const categoryClass = role ? role.category : '';
      const deadClass = playerData.isDead ? 'is-dead' : '';
      const drunkClass = playerData.isDrunk ? 'is-drunk' : '';
      
      return `
        <div class="grimoire-player ${deadClass} ${drunkClass}" data-player-id="${playerData.playerId}">
          <div class="grimoire-player-info">
            <span class="emoji">${playerData.emoji}</span>
            <span class="name">${this.escapeHtml(playerData.username) || 'Unknown'}</span>
            ${playerData.isDead ? '<span class="dead-badge">💀 DEAD</span>' : ''}
          </div>
          <div class="grimoire-role ${categoryClass}">
            ${role ? `
              <span class="role-name">${this.escapeHtml(role.name)}${playerData.isDrunk ? ' 🍺' : ''}</span>
              <span class="role-category-tag">${role.category}</span>
            ` : '<span class="no-role">No role assigned</span>'}
          </div>
          <div class="grimoire-actions">
            <button class="grimoire-chat-btn" title="Message ${this.escapeHtml(playerData.username) || 'player'}">💬</button>
            <button class="drunk-btn ${playerData.isDrunk ? 'sober' : ''}" title="${playerData.isDrunk ? 'Mark as sober' : 'Mark as drunk'}">
              ${playerData.isDrunk ? '🚫' : '🍺'}
            </button>
            <button class="kill-btn ${playerData.isDead ? 'revive' : ''}" title="${playerData.isDead ? 'Revive player' : 'Kill player'}">
              ${playerData.isDead ? '💚' : '💀'}
            </button>
          </div>
        </div>
      `;
    }).join('');
    
    // Add click handlers for kill/revive buttons
    grimoireList.querySelectorAll('.kill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        console.log('Kill button clicked!');
        const playerId = btn.closest('.grimoire-player').dataset.playerId;
        console.log('Target player ID:', playerId);
        const isDead = btn.classList.contains('revive');
        if (isDead) {
          this.revivePlayer(playerId);
        } else {
          this.killPlayer(playerId);
        }
      });
    });
    
    // Add click handlers for drunk/sober buttons
    grimoireList.querySelectorAll('.drunk-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const playerId = btn.closest('.grimoire-player').dataset.playerId;
        const isDrunk = btn.classList.contains('sober');
        if (isDrunk) {
          this.unmarkDrunk(playerId);
        } else {
          this.markDrunk(playerId);
        }
      });
    });
    
    // Add click handlers for chat buttons
    grimoireList.querySelectorAll('.grimoire-chat-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const playerId = btn.closest('.grimoire-player').dataset.playerId;
        this.openChatWithPlayer(playerId);
      });
    });
  }
  
  
  async assignRoles() {
    if (!this.player.isHost || !this.room) return;
    
    const playerCount = this.roomPlayers.filter(p => p.id !== this.room.hostId).length;
    
    if (this.selectedRoles.length === 0) {
      this.showToast('Please select at least one role', 'error');
      return;
    }
    
    if (this.selectedRoles.length !== playerCount) {
      this.showToast(`Select exactly ${playerCount} roles for ${playerCount} players`, 'error');
      return;
    }
    
    try {
      const response = await fetch(`/api/room/${this.room.code}/assign-roles`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        const error = await response.json();
        this.showToast(error.error || 'Failed to assign roles', 'error');
        return;
      }
      
      const data = await response.json();
      this.showToast(`Roles assigned to ${data.totalAssigned} players!`, 'success');
      this.room.rolesAssigned = true;
      this.updateHostUI();
      await this.fetchGrimoire();
      this.closeSettingsModal();
    } catch (error) {
      console.error('Failed to assign roles:', error);
      this.showToast('Failed to assign roles', 'error');
    }
  }
  
  async resetRoles() {
    if (!this.player.isHost || !this.room) return;

    try {
      await fetch(`/api/room/${this.room.code}/reset-roles`, {
        method: 'POST'
      });

      this.room.rolesAssigned = false;
      this.myRole = null;
      this.isRoleCardHidden = false;
      this.isDead = false;
      this.grimoireData = [];
      this.updateHostUI();
      this.updateRoleDisplay();
      this.renderGrimoire();
      this.showToast('Roles have been reset', 'success');
    } catch (error) {
      console.error('Failed to reset roles:', error);
      this.showToast('Failed to reset roles', 'error');
    }
  }
  
  renderPlayers() {
    const container = document.getElementById('players-list');
    const hostCenter = document.getElementById('host-center');
    const countEl = document.getElementById('player-count');

    // Separate host from other players
    const hostPlayer = this.roomPlayers.find(p => this.room && this.room.hostId === p.id);
    const tablePlayers = this.roomPlayers.filter(p => !(this.room && this.room.hostId === p.id));

    // Player count should not include the host
    countEl.textContent = `(${tablePlayers.length})`;

    // Sort table players by the stored order
    let orderedPlayers = [...tablePlayers];
    if (this.playerOrder && this.playerOrder.length > 0) {
      orderedPlayers.sort((a, b) => {
        const indexA = this.playerOrder.indexOf(a.id);
        const indexB = this.playerOrder.indexOf(b.id);
        // Players not in order go to the end
        const orderA = indexA === -1 ? 999 : indexA;
        const orderB = indexB === -1 ? 999 : indexB;
        return orderA - orderB;
      });
    }

    // Clear and keep the table decoration
    container.innerHTML = '<div class="circle-table"></div><div class="host-center" id="host-center"></div>';
    const newHostCenter = document.getElementById('host-center');
    
    // Render host in center
    if (hostPlayer) {
      const isYou = this.player && this.player.id === hostPlayer.id;
      
      newHostCenter.innerHTML = `
        <div class="player-item is-host ${isYou ? 'is-you' : ''}">
          <div class="emoji">${hostPlayer.emoji}</div>
          <div class="name">${this.escapeHtml(hostPlayer.username) || 'Unknown'}</div>
          <div class="host-label">📖 Host</div>
        </div>
      `;
    }
    
    const numPlayers = orderedPlayers.length;
    const isHostView = this.player && this.player.isHost;
    
    // Calculate circle radius based on container size and player count
    const baseRadius = 44; // percentage from center
    
    orderedPlayers.forEach((player, index) => {
      const isYou = this.player && this.player.id === player.id;
      const isDead = player.isDead;

      const classes = ['player-item'];
      if (isYou) classes.push('is-you');
      if (isDead) classes.push('is-dead');
      if (isHostView) classes.push('is-host-view');

      let badges = '';

      // Calculate position on circle (starting from top, going clockwise)
      const angle = (index / numPlayers) * 2 * Math.PI - Math.PI / 2;
      const x = 50 + baseRadius * Math.cos(angle);
      const y = 50 + baseRadius * Math.sin(angle);

      const playerEl = document.createElement('div');
      playerEl.className = classes.join(' ');
      playerEl.dataset.playerId = player.id;
      playerEl.dataset.index = index;
      playerEl.style.left = `${x}%`;
      playerEl.style.top = `${y}%`;
      
      playerEl.innerHTML = `
        ${isDead ? '<div class="death-overlay">💀</div>' : ''}
        <div class="emoji">${player.emoji}</div>
        <div class="name">${this.escapeHtml(player.username) || 'Unknown'}</div>
        ${badges ? `<div class="badges">${badges}</div>` : ''}
      `;
      
      container.appendChild(playerEl);
      
      // Add drag-and-drop for host
      if (isHostView) {
        this.setupPlayerDragDrop(playerEl, player);
      }
    });
  }
  
  setupPlayerDragDrop(element, player) {
    // Mouse events
    element.addEventListener('mousedown', (e) => this.handleDragStart(e, element, player));
    
    // Touch events for mobile
    element.addEventListener('touchstart', (e) => this.handleTouchStart(e, element, player), { passive: false });
  }
  
  handleDragStart(e, element, player) {
    if (e.button !== 0) return; // Only left click
    
    e.preventDefault();
    this.draggedPlayer = player;
    this.draggedElement = element;
    element.classList.add('dragging');
    
    // Record initial offset between click position and element center
    const container = document.getElementById('players-list');
    const containerRect = container.getBoundingClientRect();
    const elementLeft = parseFloat(element.style.left) / 100 * containerRect.width + containerRect.left;
    const elementTop = parseFloat(element.style.top) / 100 * containerRect.height + containerRect.top;
    this.dragOffsetX = e.clientX - elementLeft;
    this.dragOffsetY = e.clientY - elementTop;
    
    const onMouseMove = (e) => this.handleDragMove(e);
    const onMouseUp = (e) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this.handleDragEnd(e);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }
  
  handleTouchStart(e, element, player) {
    if (e.touches.length !== 1) return;
    
    e.preventDefault();
    this.draggedPlayer = player;
    this.draggedElement = element;
    element.classList.add('dragging');
    
    // Record initial offset between touch position and element center
    const touch = e.touches[0];
    const container = document.getElementById('players-list');
    const containerRect = container.getBoundingClientRect();
    const elementLeft = parseFloat(element.style.left) / 100 * containerRect.width + containerRect.left;
    const elementTop = parseFloat(element.style.top) / 100 * containerRect.height + containerRect.top;
    this.dragOffsetX = touch.clientX - elementLeft;
    this.dragOffsetY = touch.clientY - elementTop;
    
    const onTouchMove = (e) => this.handleTouchMove(e);
    const onTouchEnd = (e) => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
      this.handleDragEnd(e);
    };
    
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);
  }
  
  handleDragMove(e) {
    if (!this.draggedElement) return;
    
    const container = document.getElementById('players-list');
    const rect = container.getBoundingClientRect();
    
    // Convert mouse position to percentage, accounting for initial click offset
    const x = ((e.clientX - this.dragOffsetX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - this.dragOffsetY - rect.top) / rect.height) * 100;
    
    this.draggedElement.style.left = `${x}%`;
    this.draggedElement.style.top = `${y}%`;
    
    // Find closest player to swap with
    this.updateDragOverState(e.clientX, e.clientY);
  }
  
  handleTouchMove(e) {
    if (!this.draggedElement || e.touches.length !== 1) return;
    
    e.preventDefault();
    const touch = e.touches[0];
    
    const container = document.getElementById('players-list');
    const rect = container.getBoundingClientRect();
    
    // Convert touch position to percentage, accounting for initial touch offset
    const x = ((touch.clientX - this.dragOffsetX - rect.left) / rect.width) * 100;
    const y = ((touch.clientY - this.dragOffsetY - rect.top) / rect.height) * 100;
    
    this.draggedElement.style.left = `${x}%`;
    this.draggedElement.style.top = `${y}%`;
    
    // Find closest player to swap with
    this.updateDragOverState(touch.clientX, touch.clientY);
  }
  
  updateDragOverState(clientX, clientY) {
    const container = document.getElementById('players-list');
    const playerElements = container.querySelectorAll('.player-item:not(.dragging)');
    
    let closestElement = null;
    let closestDistance = Infinity;
    
    playerElements.forEach(el => {
      el.classList.remove('drag-over');
      
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const distance = Math.sqrt(
        Math.pow(clientX - centerX, 2) + 
        Math.pow(clientY - centerY, 2)
      );
      
      if (distance < closestDistance && distance < 80) {
        closestDistance = distance;
        closestElement = el;
      }
    });
    
    if (closestElement) {
      closestElement.classList.add('drag-over');
    }
  }
  
  handleDragEnd(e) {
    if (!this.draggedElement || !this.draggedPlayer) {
      this.cleanupDrag();
      return;
    }
    
    const container = document.getElementById('players-list');
    const dragOverElement = container.querySelector('.player-item.drag-over');
    
    if (dragOverElement && dragOverElement !== this.draggedElement) {
      const targetPlayerId = dragOverElement.dataset.playerId;
      this.swapPlayers(this.draggedPlayer.id, targetPlayerId);
    }
    
    this.cleanupDrag();
    this.renderPlayers(); // Re-render to reset positions
  }
  
  cleanupDrag() {
    const container = document.getElementById('players-list');
    container.querySelectorAll('.player-item').forEach(el => {
      el.classList.remove('dragging', 'drag-over');
    });
    
    this.draggedPlayer = null;
    this.draggedElement = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
  }
  
  async swapPlayers(playerId1, playerId2) {
    if (!this.player || !this.player.isHost || !this.room) return;
    
    // Get current order or create from roomPlayers
    let currentOrder = this.playerOrder.length > 0 
      ? [...this.playerOrder]
      : this.roomPlayers.map(p => p.id);
    
    const index1 = currentOrder.indexOf(playerId1);
    const index2 = currentOrder.indexOf(playerId2);
    
    if (index1 === -1 || index2 === -1) return;
    
    // Swap positions
    [currentOrder[index1], currentOrder[index2]] = [currentOrder[index2], currentOrder[index1]];
    
    // Update locally first for responsiveness
    this.playerOrder = currentOrder;
    
    // Save to server
    try {
      await fetch(`/api/room/${this.room.code}/player-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: currentOrder })
      });
    } catch (error) {
      console.error('Failed to save player order:', error);
      this.showToast('Failed to save player positions', 'error');
    }
  }
  
  copyRoomCode() {
    if (!this.room) return;
    
    navigator.clipboard.writeText(this.room.code).then(() => {
      this.showToast('Code copied to clipboard!', 'success');
    }).catch(() => {
      this.showToast('Failed to copy code', 'error');
    });
  }
  
  copyGrimoire() {
    if (!this.grimoireData || this.grimoireData.length === 0) {
      this.showToast('No grimoire data to copy', 'error');
      return;
    }
    
    const lines = this.grimoireData.map(playerData => {
      const roleName = playerData.role ? playerData.role.name : 'No role';
      const drunkSuffix = playerData.isDrunk ? ' (drunk)' : '';
      return `@${playerData.username} is [[${roleName}]]${drunkSuffix}`;
    });
    
    const text = lines.join('\n');
    
    navigator.clipboard.writeText(text).then(() => {
      this.showToast('Grimoire copied to clipboard!', 'success');
    }).catch(() => {
      this.showToast('Failed to copy grimoire', 'error');
    });
  }
  
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
  }
  
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.4s ease-out forwards';
      setTimeout(() => {
        toast.remove();
      }, 400);
    }, 3000);
  }
  
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  openSettingsModal() {
    if (!this.player || !this.player.isHost) return;
    
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    
    // Populate role set selector
    this.populateRoleSetSelectors();
    
    // Render role selection in modal
    this.renderRoleSelection();
  }
  
  closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('hidden');
  }

  openAlmanacPanel() {
    const panel = document.getElementById('almanac-panel');
    panel.classList.remove('hidden');
    
    // Populate role set selector (for main menu)
    this.populateRoleSetSelectors();
    
    // Update role set display/selector visibility
    this.updateRoleSetUI();
    
    // Render all roles in the almanac
    this.renderAlmanac();
  }

  closeAlmanacPanel() {
    const panel = document.getElementById('almanac-panel');
    panel.classList.add('hidden');
  }

  renderAlmanac() {
    const categories = ['Townsfolk', 'Outsiders', 'Minions', 'Demons'];
    
    for (const category of categories) {
      const container = document.getElementById(`almanac-${category}`);
      if (!container || !this.allRoles[category]) continue;
      
      container.innerHTML = this.allRoles[category].map(role => `
        <div class="almanac-role-item ${category}">
          <div class="role-name">${this.escapeHtml(role.name)}</div>
          <div class="role-desc">${this.escapeHtml(role.description)}</div>
        </div>
      `).join('');
    }
  }
  
  updateRoleSetUI() {
    // Update role set selector in settings modal (if host)
    const settingsSelect = document.getElementById('role-set-select');
    if (settingsSelect) {
      settingsSelect.value = this.currentRoleSet;
    }
    
    // Update almanac panel based on whether user is in a room
    const almanacSelector = document.getElementById('almanac-role-set-selector');
    const almanacDisplay = document.getElementById('almanac-role-set-display');
    const almanacSelect = document.getElementById('almanac-role-set-select');
    const almanacRoleSetName = document.getElementById('almanac-role-set-name');
    
    if (this.room) {
      // In a room: show display, hide dropdown
      if (almanacSelector) almanacSelector.classList.add('hidden');
      if (almanacDisplay) almanacDisplay.classList.remove('hidden');
      if (almanacRoleSetName) almanacRoleSetName.textContent = this.currentRoleSetName;
    } else {
      // Not in a room: show dropdown, hide display
      if (almanacSelector) almanacSelector.classList.remove('hidden');
      if (almanacDisplay) almanacDisplay.classList.add('hidden');
      if (almanacSelect) almanacSelect.value = this.currentRoleSet;
    }
  }
  
  populateRoleSetSelectors() {
    // Populate settings modal selector (host only)
    const settingsSelect = document.getElementById('role-set-select');
    if (settingsSelect) {
      settingsSelect.innerHTML = this.allRoleSets.map(set => 
        `<option value="${set.id}">${this.escapeHtml(set.name)}</option>`
      ).join('');
      settingsSelect.value = this.currentRoleSet;
    }
    
    // Populate almanac panel selector (for main menu)
    const almanacSelect = document.getElementById('almanac-role-set-select');
    if (almanacSelect) {
      almanacSelect.innerHTML = this.allRoleSets.map(set => 
        `<option value="${set.id}">${this.escapeHtml(set.name)}</option>`
      ).join('');
      almanacSelect.value = this.currentRoleSet;
    }
  }
  
  async changeRoleSet(roleSetId) {
    if (!this.player.isHost || !this.room) {
      this.showToast('Only the host can change the role set', 'error');
      return;
    }
    
    try {
      const response = await fetch(`/api/room/${this.room.code}/role-set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleSet: roleSetId })
      });
      
      if (!response.ok) {
        const error = await response.json();
        this.showToast(error.error || 'Failed to change role set', 'error');
      }
    } catch (error) {
      console.error('Failed to change role set:', error);
      this.showToast('Failed to change role set', 'error');
    }
  }
  
  async changeAlmanacRoleSet(roleSetId) {
    // This is only used on the main menu (when not in a room)
    // Just fetch and display the roles locally
    try {
      const response = await fetch(`/api/roles/${roleSetId}`);
      if (response.ok) {
        this.allRoles = await response.json();
        this.currentRoleSet = roleSetId;
        const set = this.allRoleSets.find(s => s.id === roleSetId);
        if (set) {
          this.currentRoleSetName = set.name;
        }
        this.renderAlmanac();
      }
    } catch (error) {
      console.error('Failed to fetch roles:', error);
    }
  }
  

  toggleRoleCardVisibility() {
    // Only allow toggling if player has a role
    if (!this.myRole) return;

    this.isRoleCardHidden = !this.isRoleCardHidden;
    this.updateRoleDisplay();
  }

  toggleGrimoireVisibility() {
    // Only allow toggling if host has grimoire visible
    if (!this.player || !this.player.isHost || !this.room || !this.room.rolesAssigned) return;

    this.isGrimoireHidden = !this.isGrimoireHidden;
    const grimoireSection = document.getElementById('grimoire-section');
    if (this.isGrimoireHidden) {
      grimoireSection.classList.add('grimoire-hidden');
    } else {
      grimoireSection.classList.remove('grimoire-hidden');
    }
  }
  
  showBloodEffect() {
    // Create blood overlay container
    const overlay = document.createElement('div');
    overlay.className = 'blood-overlay';
    
    // Create multiple gooey blood streaks with variety
    const numDrips = 12;
    for (let i = 0; i < numDrips; i++) {
      const drip = document.createElement('div');
      
      // Add thickness variation
      const thicknessRoll = Math.random();
      if (thicknessRoll < 0.25) {
        drip.className = 'blood-drip-effect thick';
      } else if (thicknessRoll < 0.5) {
        drip.className = 'blood-drip-effect thin';
      } else {
        drip.className = 'blood-drip-effect';
      }
      
      // Distribute across screen with some clustering
      const basePos = (i / numDrips) * 100;
      const offset = (Math.random() - 0.5) * 20;
      drip.style.left = `${Math.max(2, Math.min(98, basePos + offset))}%`;
      
      // Stagger the start times for gooey cascade effect
      const delay = Math.random() * 1.2;
      drip.style.animationDelay = `${delay}s`;
      
      // Vary streak duration for different speeds (slower = more gooey)
      const duration = 2.5 + Math.random() * 2;
      drip.style.setProperty('--streak-duration', `${duration}s`);
      
      overlay.appendChild(drip);
    }
    
    // Add pool effect at bottom
    const pool = document.createElement('div');
    pool.className = 'blood-pool-effect';
    overlay.appendChild(pool);
    
    document.body.appendChild(overlay);
    
    // Remove after animation (longer duration for streaking effect)
    setTimeout(() => {
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 1500);
    }, 4500);
  }
  
  async killPlayer(targetPlayerId) {
    console.log('killPlayer called with:', targetPlayerId);
    if (!this.player || !this.player.isHost || !this.room) {
      console.log('Early return - no player/host/room');
      return;
    }
    
    try {
      console.log('Sending kill request...');
      const response = await fetch(`/api/room/${this.room.code}/kill-player`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPlayerId })
      });
      
      console.log('Kill response status:', response.status);
      if (!response.ok) {
        const error = await response.json();
        this.showToast(error.error || 'Failed to mark player as dead', 'error');
      }
    } catch (error) {
      console.error('Failed to kill player:', error);
      this.showToast('Failed to mark player as dead', 'error');
    }
  }
  
  async revivePlayer(targetPlayerId) {
    if (!this.player || !this.player.isHost || !this.room) return;
    
    try {
      const response = await fetch(`/api/room/${this.room.code}/revive-player`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPlayerId })
      });
      
      if (!response.ok) {
        const error = await response.json();
        this.showToast(error.error || 'Failed to revive player', 'error');
      }
    } catch (error) {
      console.error('Failed to revive player:', error);
      this.showToast('Failed to revive player', 'error');
    }
  }
  
  async markDrunk(targetPlayerId) {
    if (!this.player || !this.player.isHost || !this.room) return;
    
    try {
      const response = await fetch(`/api/room/${this.room.code}/mark-drunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPlayerId })
      });
      
      if (!response.ok) {
        const error = await response.json();
        this.showToast(error.error || 'Failed to mark player as drunk', 'error');
      }
    } catch (error) {
      console.error('Failed to mark player as drunk:', error);
      this.showToast('Failed to mark player as drunk', 'error');
    }
  }
  
  async unmarkDrunk(targetPlayerId) {
    if (!this.player || !this.player.isHost || !this.room) return;
    
    try {
      const response = await fetch(`/api/room/${this.room.code}/unmark-drunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPlayerId })
      });
      
      if (!response.ok) {
        const error = await response.json();
        this.showToast(error.error || 'Failed to unmark player as drunk', 'error');
      }
    } catch (error) {
      console.error('Failed to unmark player as drunk:', error);
      this.showToast('Failed to unmark player as drunk', 'error');
    }
  }
  
  // ===== CHAT FUNCTIONALITY =====
  
  openChatPanel(preselectedPlayerId = null) {
    const panel = document.getElementById('chat-panel');
    panel.classList.remove('hidden');
    this.isChatOpen = true;
    
    // Clear unread indicator
    this.hasUnreadMessages = false;
    document.getElementById('chat-btn').classList.remove('has-unread');
    
    // Update recipient selector with current players
    this.updateChatRecipientSelector();
    
    // Pre-select a player if specified
    if (preselectedPlayerId) {
      const select = document.getElementById('chat-recipient');
      if (select.querySelector(`option[value="${preselectedPlayerId}"]`)) {
        select.value = preselectedPlayerId;
      }
    }
    
    // Show composer for everyone (host and players can both send messages)
    const composer = document.getElementById('chat-composer');
    const recipientSelector = document.querySelector('.chat-recipient-selector');
    const chatInput = document.getElementById('chat-input');
    
    if (this.player && this.player.isHost) {
      // Host can choose recipients
      composer.classList.remove('hidden');
      recipientSelector.classList.remove('hidden');
      chatInput.placeholder = 'Type a message... (@ for mentions)';
      // Show temporary message option for host
      document.getElementById('chat-temp-option').classList.remove('hidden');
    } else {
      // Players can only message the host (no recipient selector needed)
      composer.classList.remove('hidden');
      recipientSelector.classList.add('hidden');
      chatInput.placeholder = 'Message the host...';
      // Hide temporary message option for non-hosts
      document.getElementById('chat-temp-option').classList.add('hidden');
    }
    
    // Scroll to bottom
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  openChatWithPlayer(playerId) {
    this.openChatPanel(playerId);
    // Focus the input for quick typing
    document.getElementById('chat-input').focus();
  }
  
  closeChatPanel() {
    const panel = document.getElementById('chat-panel');
    panel.classList.add('hidden');
    this.isChatOpen = false;
  }
  
  updateChatRecipientSelector() {
    const select = document.getElementById('chat-recipient');
    if (!select || !this.player || !this.player.isHost) return;
    
    // Keep the "Everyone" option and add players
    const currentValue = select.value;
    select.innerHTML = '<option value="all">👥 Everyone</option>';
    
    // Add all players except the host
    for (const player of this.roomPlayers) {
      if (player.id !== this.player.id) {
        const option = document.createElement('option');
        option.value = player.id;
        option.textContent = `${player.emoji} ${player.username || 'Unknown'} (DM)`;
        select.appendChild(option);
      }
    }
    
    // Restore selection if still valid
    if (currentValue && select.querySelector(`option[value="${currentValue}"]`)) {
      select.value = currentValue;
    }
  }
  
  async sendChatMessage() {
    if (!this.player || !this.room) return;
    
    const input = document.getElementById('chat-input');
    const recipientSelect = document.getElementById('chat-recipient');
    
    const content = input.value.trim();
    if (!content) return;
    
    // Non-host players always message the host
    // Host can choose recipients
    let recipientId;
    let isTemporary = false;
    
    if (this.player.isHost) {
      recipientId = recipientSelect.value === 'all' ? null : recipientSelect.value;
      // Check if temporary message is selected
      const tempCheckbox = document.getElementById('chat-temp-checkbox');
      isTemporary = tempCheckbox && tempCheckbox.checked;
    } else {
      // Players send to host
      recipientId = this.room.hostId;
    }
    
    try {
      const response = await fetch(`/api/room/${this.room.code}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          content,
          recipientId,
          isTemporary
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        this.showToast(error.error || 'Failed to send message', 'error');
        return;
      }
      
      // Clear input on success and reset height
      input.value = '';
      input.style.height = 'auto';
      this.hideAutocomplete();
    } catch (error) {
      console.error('Failed to send message:', error);
      this.showToast('Failed to send message', 'error');
    }
  }
  
  handleChatMessage(message) {
    // Filter DMs - only show if it's for everyone, or if it's for us, or if we're the sender (host)
    if (message._recipientOnly) {
      const isForMe = message._recipientOnly === this.player.id;
      const iAmSender = message.senderId === this.player.id;
      if (!isForMe && !iAmSender) {
        return; // This DM is not for us
      }
    }
    
    // Add message to our list
    this.chatMessages.push(message);
    
    // Render the message
    this.renderChatMessage(message);
    
    // Show unread indicator if chat is closed
    if (!this.isChatOpen) {
      this.hasUnreadMessages = true;
      document.getElementById('chat-btn').classList.add('has-unread');
    }
    
    // Scroll to bottom if chat is open
    if (this.isChatOpen) {
      const messagesContainer = document.getElementById('chat-messages');
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }
  
  renderChatMessage(message) {
    const container = document.getElementById('chat-messages');
    
    // Remove the empty state if it exists
    const emptyState = container.querySelector('.chat-empty');
    if (emptyState) {
      emptyState.remove();
    }
    
    const isDm = message.recipientId !== null;
    const isFromHost = message.isFromHost !== false; // Default to true for backwards compatibility
    const isTemporary = message.isTemporary === true;
    const messageClass = isDm ? 'is-dm' : 'is-group';
    const badgeClass = isDm ? 'dm' : 'group';
    const badgeText = isDm ? '🔒 Private' : '👥 Everyone';
    
    // Determine sender display name
    const senderName = isFromHost ? 'Host' : (message.senderUsername || 'Player');
    
    const time = new Date(message.timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    // Parse mentions in the content
    const parsedContent = this.parseMentions(this.escapeHtml(message.content));
    
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${messageClass} ${isFromHost ? 'from-host' : 'from-player'} ${isTemporary ? 'is-temporary' : ''}`;
    messageEl.dataset.senderId = message.senderId;
    messageEl.dataset.recipientId = message.recipientId || 'all';
    messageEl.dataset.isFromHost = isFromHost;
    
    // Build temp badge HTML if temporary
    const tempBadgeHtml = isTemporary ? '<span class="chat-message-badge temp">⏱️ <span class="temp-countdown">30</span>s</span>' : '';
    
    messageEl.innerHTML = `
      <div class="chat-message-header">
        <span class="chat-message-sender">${message.senderEmoji} ${this.escapeHtml(senderName)}</span>
        <span class="chat-message-badge ${badgeClass}">${badgeText}</span>
        ${tempBadgeHtml}
        <span class="chat-message-time">${time}</span>
      </div>
      <div class="chat-message-content">${parsedContent}</div>
    `;
    
    container.appendChild(messageEl);
    
    // Start countdown for temporary messages
    if (isTemporary) {
      this.startTempMessageCountdown(messageEl);
    }
    
    // Add click handler for host to quickly reply
    if (this.player && this.player.isHost) {
      messageEl.addEventListener('click', (e) => {
        // Don't trigger if clicking on a role mention
        if (e.target.closest('.role-mention')) return;
        
        this.selectRecipientFromMessage(messageEl);
      });
      messageEl.classList.add('clickable');
    }
    
    // Add click handlers for role mentions
    messageEl.querySelectorAll('.role-mention').forEach(mention => {
      mention.addEventListener('click', (e) => {
        e.stopPropagation();
        const roleName = mention.dataset.role;
        this.openAlmanacWithRole(roleName);
      });
    });
  }
  
  startTempMessageCountdown(messageEl) {
    let secondsLeft = 30;
    const countdownEl = messageEl.querySelector('.temp-countdown');
    
    const interval = setInterval(() => {
      secondsLeft--;
      
      if (countdownEl) {
        countdownEl.textContent = secondsLeft;
      }
      
      // Add warning class when time is low
      if (secondsLeft <= 10) {
        messageEl.classList.add('temp-warning');
      }
      if (secondsLeft <= 5) {
        messageEl.classList.add('temp-critical');
      }
      
      if (secondsLeft <= 0) {
        clearInterval(interval);
        // Fade out and remove
        messageEl.classList.add('temp-fading');
        setTimeout(() => {
          messageEl.remove();
          // Show empty state if no messages left
          const container = document.getElementById('chat-messages');
          if (container && container.querySelectorAll('.chat-message').length === 0) {
            container.innerHTML = '<div class="chat-empty">No messages yet</div>';
          }
        }, 500);
      }
    }, 1000);
  }
  
  selectRecipientFromMessage(messageEl) {
    const senderId = messageEl.dataset.senderId;
    const recipientId = messageEl.dataset.recipientId;
    const isFromHost = messageEl.dataset.isFromHost === 'true';
    
    const select = document.getElementById('chat-recipient');
    if (!select) return;
    
    let targetRecipient;
    
    if (isFromHost) {
      // Message is from us (host) - select the recipient we sent to
      targetRecipient = recipientId;
    } else {
      // Message is from a player - select that player to reply
      targetRecipient = senderId;
    }
    
    // Check if the option exists in the select
    if (select.querySelector(`option[value="${targetRecipient}"]`)) {
      select.value = targetRecipient;
      
      // Focus the input for quick typing
      document.getElementById('chat-input').focus();
      
      // Brief visual feedback
      messageEl.classList.add('selected-reply');
      setTimeout(() => messageEl.classList.remove('selected-reply'), 300);
    }
  }
  
  renderAllChatMessages() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    
    if (this.chatMessages.length === 0) {
      container.innerHTML = '<div class="chat-empty">No messages yet</div>';
      return;
    }
    
    for (const message of this.chatMessages) {
      this.renderChatMessage(message);
    }
  }
  
  showChatButton() {
    document.getElementById('chat-btn').classList.remove('hidden');
  }
  
  hideChatButton() {
    document.getElementById('chat-btn').classList.add('hidden');
    this.closeChatPanel();
  }
  
  clearChat() {
    this.chatMessages = [];
    this.hasUnreadMessages = false;
    document.getElementById('chat-btn').classList.remove('has-unread');
    this.renderAllChatMessages();
  }
  
  async fetchChatHistory() {
    if (!this.room) return;
    
    try {
      const response = await fetch(`/api/room/${this.room.code}/chat`);
      if (!response.ok) return;
      
      const data = await response.json();
      this.chatMessages = data.messages || [];
      this.renderAllChatMessages();
    } catch (error) {
      console.error('Failed to fetch chat history:', error);
    }
  }
  
  // ===== AUTOCOMPLETE FUNCTIONALITY =====
  
  handleChatInputChange(e) {
    const input = e.target;
    const value = input.value;
    const cursorPos = input.selectionStart;
    
    // Check for @ mention
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    
    if (atMatch) {
      const query = atMatch[1].toLowerCase();
      this.autocompleteStartPos = cursorPos - atMatch[0].length;
      this.showUserAutocomplete(query);
      return;
    }
    
    // Check for role trigger (3+ letters at start of word)
    const wordMatch = textBeforeCursor.match(/(?:^|\s)([a-zA-Z]{3,})$/);
    
    if (wordMatch) {
      const query = wordMatch[1].toLowerCase();
      this.autocompleteStartPos = cursorPos - wordMatch[1].length;
      this.showRoleAutocomplete(query);
      return;
    }
    
    // Hide autocomplete if no matches
    this.hideAutocomplete();
  }
  
  showUserAutocomplete(query) {
    // Get all players in the room except the current user (host)
    const players = this.roomPlayers.filter(p => 
      p.id !== this.player.id && 
      p.username && 
      p.username.toLowerCase().startsWith(query)
    );
    
    if (players.length === 0) {
      this.hideAutocomplete();
      return;
    }
    
    this.autocompleteItems = players.map(p => ({
      type: 'user',
      id: p.id,
      emoji: p.emoji,
      name: p.username,
      display: `@${p.username}`
    }));
    
    this.autocompleteType = 'user';
    this.autocompleteSelectedIndex = 0;
    this.renderAutocomplete();
  }
  
  showRoleAutocomplete(query) {
    // Search all roles for matches
    const matchingRoles = [];
    const categories = ['Townsfolk', 'Outsiders', 'Minions', 'Demons'];
    
    for (const category of categories) {
      if (!this.allRoles[category]) continue;
      
      for (const role of this.allRoles[category]) {
        if (role.name.toLowerCase().startsWith(query)) {
          matchingRoles.push({
            type: 'role',
            name: role.name,
            category: category,
            description: role.description,
            display: role.name
          });
        }
      }
    }
    
    if (matchingRoles.length === 0) {
      this.hideAutocomplete();
      return;
    }
    
    this.autocompleteItems = matchingRoles;
    this.autocompleteType = 'role';
    this.autocompleteSelectedIndex = 0;
    this.renderAutocomplete();
  }
  
  renderAutocomplete() {
    const container = document.getElementById('chat-autocomplete');
    if (!container) return;
    
    const headerText = this.autocompleteType === 'user' 
      ? 'Mention a player' 
      : 'Insert a role';
    
    let html = `<div class="chat-autocomplete-header">${headerText} <span style="float:right;opacity:0.5">Tab to select</span></div>`;
    
    html += this.autocompleteItems.map((item, index) => {
      const selectedClass = index === this.autocompleteSelectedIndex ? 'selected' : '';
      
      if (item.type === 'user') {
        return `
          <div class="chat-autocomplete-item ${selectedClass}" data-index="${index}">
            <span class="autocomplete-emoji">${item.emoji}</span>
            <span class="autocomplete-name">@${this.escapeHtml(item.name)}</span>
          </div>
        `;
      } else {
        return `
          <div class="chat-autocomplete-item role-item ${item.category} ${selectedClass}" data-index="${index}">
            <span class="autocomplete-name">${this.escapeHtml(item.name)}</span>
            <span class="autocomplete-category">${item.category}</span>
          </div>
        `;
      }
    }).join('');
    
    container.innerHTML = html;
    container.classList.remove('hidden');
    
    // Add click handlers
    container.querySelectorAll('.chat-autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        this.autocompleteSelectedIndex = index;
        this.acceptAutocomplete();
      });
    });
    
    // Scroll selected item into view
    this.scrollAutocompleteItemIntoView();
  }
  
  scrollAutocompleteItemIntoView() {
    const container = document.getElementById('chat-autocomplete');
    const selected = container?.querySelector('.chat-autocomplete-item.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }
  
  hideAutocomplete() {
    const container = document.getElementById('chat-autocomplete');
    if (container) {
      container.classList.add('hidden');
    }
    this.autocompleteItems = [];
    this.autocompleteType = null;
  }
  
  handleChatInputKeydown(e) {
    if (this.autocompleteItems.length === 0) return;
    
    switch (e.key) {
      case 'Tab':
      case 'Enter':
        e.preventDefault();
        this.acceptAutocomplete();
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        this.autocompleteSelectedIndex = 
          (this.autocompleteSelectedIndex + 1) % this.autocompleteItems.length;
        this.renderAutocomplete();
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        this.autocompleteSelectedIndex = 
          (this.autocompleteSelectedIndex - 1 + this.autocompleteItems.length) % this.autocompleteItems.length;
        this.renderAutocomplete();
        break;
        
      case 'Escape':
        e.preventDefault();
        this.hideAutocomplete();
        break;
    }
  }
  
  acceptAutocomplete() {
    const item = this.autocompleteItems[this.autocompleteSelectedIndex];
    if (!item) return;
    
    const input = document.getElementById('chat-input');
    const value = input.value;
    const cursorPos = input.selectionStart;
    
    // Build the replacement text
    let replacement;
    if (item.type === 'user') {
      replacement = `@${item.name} `;
    } else {
      replacement = `[[${item.name}]] `;
    }
    
    // Replace from autocompleteStartPos to cursorPos
    const newValue = value.slice(0, this.autocompleteStartPos) + replacement + value.slice(cursorPos);
    input.value = newValue;
    
    // Set cursor position after the replacement
    const newCursorPos = this.autocompleteStartPos + replacement.length;
    input.setSelectionRange(newCursorPos, newCursorPos);
    input.focus();
    
    this.hideAutocomplete();
  }
  
  // ===== MENTION RENDERING IN MESSAGES =====
  
  parseMentions(content) {
    // Replace @username mentions
    let parsed = content.replace(/@(\w+)/g, (match, username) => {
      // Find the player
      const player = this.roomPlayers.find(p => 
        p.username && p.username.toLowerCase() === username.toLowerCase()
      );
      
      if (player) {
        return `<span class="chat-mention user-mention"><span class="mention-emoji">${player.emoji}</span><span class="mention-name">${this.escapeHtml(player.username)}</span></span>`;
      }
      return match;
    });
    
    // Replace [[RoleName]] role mentions
    parsed = parsed.replace(/\[\[([^\]]+)\]\]/g, (match, roleName) => {
      // Find the role
      let foundRole = null;
      let foundCategory = null;
      
      const categories = ['Townsfolk', 'Outsiders', 'Minions', 'Demons'];
      for (const category of categories) {
        if (!this.allRoles[category]) continue;
        const role = this.allRoles[category].find(r => 
          r.name.toLowerCase() === roleName.toLowerCase()
        );
        if (role) {
          foundRole = role;
          foundCategory = category;
          break;
        }
      }
      
      if (foundRole) {
        return `<span class="chat-mention role-mention ${foundCategory}" data-role="${this.escapeHtml(foundRole.name)}">${this.escapeHtml(foundRole.name)}</span>`;
      }
      return match;
    });
    
    // Convert newlines to <br> tags
    parsed = parsed.replace(/\n/g, '<br>');
    
    return parsed;
  }
  
  // ===== ALMANAC ROLE HIGHLIGHT =====
  
  openAlmanacWithRole(roleName) {
    // Close the chat panel first
    this.closeChatPanel();
    
    this.openAlmanacPanel();
    
    // Wait for panel to render, then find and highlight the role
    setTimeout(() => {
      // Remove any existing highlights
      document.querySelectorAll('.almanac-role-item.highlighted').forEach(el => {
        el.classList.remove('highlighted');
      });
      
      // Find the role item
      const roleItems = document.querySelectorAll('.almanac-role-item');
      for (const item of roleItems) {
        const nameEl = item.querySelector('.role-name');
        if (nameEl && nameEl.textContent.toLowerCase() === roleName.toLowerCase()) {
          item.classList.add('highlighted');
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
          break;
        }
      }
    }, 100);
  }
  
  // ===== GONG FUNCTIONALITY =====
  
  async triggerGong() {
    if (!this.player || !this.player.isHost || !this.room) return;
    
    // Add visual feedback to the button
    const gongBtn = document.getElementById('gong-btn');
    gongBtn.classList.add('ringing');
    setTimeout(() => gongBtn.classList.remove('ringing'), 500);
    
    // Emit gong event to server
    this.socket.emit('triggerGong', this.room.code);
  }
  
  playGongSound() {
    // Play the bell sound twice
    const playBell = (delay = 0) => {
      setTimeout(() => {
        const audio = new Audio('/bell.mp3');
        audio.volume = 0.8;
        audio.play().catch(err => {
          console.log('Could not play bell sound:', err);
        });
      }, delay);
    };
    
    // Play first bell immediately
    playBell(0);
    
    // Play second bell after a delay (adjust timing as needed)
    playBell(2000);
    
    // Show visual feedback
    this.showGongVisual();
  }
  
  showGongVisual() {
    // Create a visual overlay for the gong effect
    const overlay = document.createElement('div');
    overlay.className = 'gong-overlay';
    overlay.innerHTML = `
      <div class="gong-icon">🔔</div>
      <div class="gong-ripple"></div>
      <div class="gong-ripple delay-1"></div>
      <div class="gong-ripple delay-2"></div>
    `;
    document.body.appendChild(overlay);
    
    // Remove after animation
    setTimeout(() => {
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.remove(), 500);
    }, 2000);
  }
}

// Analog Clock functionality
function updateClock() {
  const now = new Date();
  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const millis = now.getMilliseconds();
  
  // Calculate precise rotation angles (including milliseconds for smooth movement)
  const secondDeg = (seconds * 6) + (millis * 0.006); // 6 degrees per second
  const minuteDeg = (minutes * 6) + (seconds * 0.1); // 6 degrees per minute + smooth movement
  const hourDeg = (hours * 30) + (minutes * 0.5) + (seconds * (0.5/60)); // 30 degrees per hour
  
  // Apply rotations
  const hourHand = document.getElementById('hour-hand');
  const minuteHand = document.getElementById('minute-hand');
  const secondHand = document.getElementById('second-hand');
  
  if (hourHand) hourHand.style.transform = `rotate(${hourDeg}deg)`;
  if (minuteHand) minuteHand.style.transform = `rotate(${minuteDeg}deg)`;
  if (secondHand) secondHand.style.transform = `rotate(${secondDeg}deg)`;
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize and run the analog clock (update frequently for smooth second hand)
  updateClock();
  setInterval(updateClock, 50);
  
  try {
    await loadSocketIO();
    window.app = new ClockTowerApp();
  } catch (error) {
    console.error('Failed to initialize app:', error);
    document.body.innerHTML = '<div style="color:white;text-align:center;padding:50px;">Failed to connect to server. Please refresh the page.</div>';
  }
});
