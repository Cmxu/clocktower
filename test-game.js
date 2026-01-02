#!/usr/bin/env node
/**
 * Blood on the Clocktower - Multi-Player Test Script
 * 
 * Launches n+1 browser instances:
 * - 1 host instance that creates a room
 * - n player instances that join the room
 * 
 * Each instance uses a separate browser context (no shared cookies/cache).
 * Each player's name is set to their randomly assigned animal emoji.
 * 
 * Usage: node test-game.js [options] [number-of-players]
 * 
 * Options:
 *   -p, --parallel    Join players in parallel (faster but may stress server)
 *   --headless        Run browsers in headless mode (no visible windows)
 *   -h, --help        Show help message
 * 
 * Examples:
 *   node test-game.js              # 5 players, sequential join
 *   node test-game.js 10           # 10 players, sequential join
 *   node test-game.js -p 8         # 8 players, parallel join
 *   node test-game.js --headless 5 # 5 players, headless mode
 */

const { chromium } = require('playwright');

const BASE_URL = 'https://clocktower.cmxu.io';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    parallel: false,
    headless: false,
    numPlayers: 5,
    help: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-p' || arg === '--parallel') {
      options.parallel = true;
    } else if (arg === '--headless') {
      options.headless = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (!isNaN(parseInt(arg))) {
      options.numPlayers = parseInt(arg);
    }
  }
  
  return options;
}

function showHelp() {
  console.log(`
Blood on the Clocktower - Multi-Player Test Script

Usage: node test-game.js [options] [number-of-players]

Options:
  -p, --parallel    Join players in parallel (faster but may stress server)
  --headless        Run browsers in headless mode (no visible windows)
  -h, --help        Show this help message

Examples:
  node test-game.js              # 5 players, sequential join
  node test-game.js 10           # 10 players, sequential join  
  node test-game.js -p 8         # 8 players, parallel join
  node test-game.js --headless 5 # 5 players, headless mode
  node test-game.js -p --headless 10  # 10 players, parallel, headless
`);
}

// Delay helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Wait for element to be visible and return it
async function waitForElement(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
  return page.locator(selector);
}

// Get the assigned emoji from the page
async function getAssignedEmoji(page) {
  const emojiElement = await waitForElement(page, '#preview-emoji');
  return await emojiElement.textContent();
}

// Create a room as host
async function createRoomAsHost(context) {
  const page = await context.newPage();
  
  console.log(`[Host] Opening page...`);
  await page.goto(BASE_URL);
  
  // Wait for the app to load (menu screen should be visible)
  await waitForElement(page, '#menu-screen.active', 15000);
  console.log(`[Host] Menu screen loaded`);
  
  // Get the randomly assigned emoji
  const emoji = await getAssignedEmoji(page);
  console.log(`[Host] Assigned emoji: ${emoji}`);
  
  // Set name to the emoji
  const usernameInput = await waitForElement(page, '#username-input');
  await usernameInput.fill(emoji);
  console.log(`[Host] Set name to: ${emoji}`);
  
  // Click create room button
  const createBtn = await waitForElement(page, '#create-room-btn');
  await createBtn.click();
  
  // Wait for room screen and get room code
  await waitForElement(page, '#room-screen.active', 10000);
  const roomCodeElement = await waitForElement(page, '#display-room-code');
  const roomCode = await roomCodeElement.textContent();
  
  console.log(`[Host] Created room with code: ${roomCode}`);
  
  return { page, roomCode, emoji };
}

// Join a room as a player
async function joinRoomAsPlayer(context, roomCode, playerNumber) {
  const page = await context.newPage();
  
  console.log(`[Player ${playerNumber}] Opening page...`);
  await page.goto(BASE_URL);
  
  // Wait for the app to load
  await waitForElement(page, '#menu-screen.active', 15000);
  console.log(`[Player ${playerNumber}] Menu screen loaded`);
  
  // Get the randomly assigned emoji
  const emoji = await getAssignedEmoji(page);
  console.log(`[Player ${playerNumber}] Assigned emoji: ${emoji}`);
  
  // Set name to the emoji
  const usernameInput = await waitForElement(page, '#username-input');
  await usernameInput.fill(emoji);
  console.log(`[Player ${playerNumber}] Set name to: ${emoji}`);
  
  // Enter room code
  const roomCodeInput = await waitForElement(page, '#room-code-input');
  await roomCodeInput.fill(roomCode);
  
  // Click join button
  const joinBtn = await waitForElement(page, '#join-room-btn');
  await joinBtn.click();
  
  // Wait for room screen
  await waitForElement(page, '#room-screen.active', 10000);
  console.log(`[Player ${playerNumber}] Joined room ${roomCode}`);
  
  return { page, emoji, playerNumber };
}

async function main() {
  const options = parseArgs();
  
  if (options.help) {
    showHelp();
    process.exit(0);
  }
  
  const { numPlayers, parallel, headless } = options;
  
  console.log('='.repeat(60));
  console.log(`Blood on the Clocktower - Test Script`);
  console.log(`Creating ${numPlayers + 1} browser instances (1 host + ${numPlayers} players)`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Mode: ${parallel ? 'Parallel' : 'Sequential'} join${headless ? ', Headless' : ''}`);
  console.log('='.repeat(60));
  console.log('');
  
  // Launch browser - no fixed viewport allows resizable windows
  const browser = await chromium.launch({
    headless: headless,
  });
  
  const contexts = [];
  const pages = [];
  
  try {
    // Create host context and room
    console.log('--- Creating Host ---');
    const hostContext = await browser.newContext();
    contexts.push(hostContext);
    
    const { page: hostPage, roomCode, emoji: hostEmoji } = await createRoomAsHost(hostContext);
    pages.push({ page: hostPage, role: 'Host', emoji: hostEmoji });
    
    console.log('');
    console.log(`Room Code: ${roomCode}`);
    console.log('');
    
    // Small delay to let the room stabilize
    await delay(1000);
    
    // Create player contexts and join room
    console.log('--- Creating Players ---');
    
    if (parallel) {
      // Parallel mode: create all contexts first, then join all at once
      console.log(`[Parallel] Creating ${numPlayers} browser contexts...`);
      
      const playerContexts = [];
      for (let i = 1; i <= numPlayers; i++) {
        const playerContext = await browser.newContext();
        contexts.push(playerContext);
        playerContexts.push({ context: playerContext, playerNumber: i });
      }
      
      console.log(`[Parallel] Launching all players simultaneously...`);
      
      // Join all players in parallel
      const joinPromises = playerContexts.map(({ context, playerNumber }) => 
        joinRoomAsPlayer(context, roomCode, playerNumber)
      );
      
      const results = await Promise.all(joinPromises);
      
      for (const { page, emoji, playerNumber } of results) {
        pages.push({ page, role: `Player ${playerNumber}`, emoji });
      }
    } else {
      // Sequential mode: create and join one at a time
      for (let i = 1; i <= numPlayers; i++) {
        // Create new isolated browser context for each player
        const playerContext = await browser.newContext();
        contexts.push(playerContext);
        
        const { page: playerPage, emoji: playerEmoji } = await joinRoomAsPlayer(playerContext, roomCode, i);
        pages.push({ page: playerPage, role: `Player ${i}`, emoji: playerEmoji });
        
        // Small delay between player joins to avoid overwhelming the server
        await delay(500);
      }
    }
    
    console.log('');
    console.log('='.repeat(60));
    console.log('All instances created successfully!');
    console.log('='.repeat(60));
    console.log('');
    console.log('Participants:');
    pages.forEach(({ role, emoji }) => {
      console.log(`  ${role}: ${emoji}`);
    });
    console.log('');
    
    if (headless) {
      console.log('Running in headless mode. Press Ctrl+C to exit.');
    } else {
      console.log('Browser windows are now open and resizable.');
      console.log('Press Ctrl+C to close all browsers and exit.');
    }
    console.log('');
    
    // Keep the script running until interrupted
    await new Promise((resolve) => {
      process.on('SIGINT', () => {
        console.log('\nClosing browsers...');
        resolve();
      });
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    // Cleanup
    for (const context of contexts) {
      await context.close();
    }
    await browser.close();
    console.log('All browsers closed.');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
