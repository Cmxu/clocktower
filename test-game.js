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
 * Usage: node test-game.js [number-of-players]
 * Default: 5 players (so 6 total browser windows including host)
 */

const { chromium } = require('playwright');

const BASE_URL = 'https://clocktower.cmxu.io';

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
async function createRoomAsHost(context, playerNumber) {
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
  
  return { page, emoji };
}

async function main() {
  // Get number of players from command line (default: 5)
  const numPlayers = parseInt(process.argv[2]) || 5;
  
  console.log('='.repeat(60));
  console.log(`Blood on the Clocktower - Test Script`);
  console.log(`Creating ${numPlayers + 1} browser instances (1 host + ${numPlayers} players)`);
  console.log(`Target: ${BASE_URL}`);
  console.log('='.repeat(60));
  console.log('');
  
  // Launch browser
  const browser = await chromium.launch({
    headless: false, // Show the browsers
    args: [
      '--window-size=800,600',
    ]
  });
  
  const contexts = [];
  const pages = [];
  
  try {
    // Create host context and room
    console.log('--- Creating Host ---');
    const hostContext = await browser.newContext({
      viewport: { width: 800, height: 600 },
    });
    contexts.push(hostContext);
    
    const { page: hostPage, roomCode, emoji: hostEmoji } = await createRoomAsHost(hostContext, 0);
    pages.push({ page: hostPage, role: 'Host', emoji: hostEmoji });
    
    console.log('');
    console.log(`Room Code: ${roomCode}`);
    console.log('');
    
    // Small delay to let the room stabilize
    await delay(1000);
    
    // Create player contexts and join room
    console.log('--- Creating Players ---');
    for (let i = 1; i <= numPlayers; i++) {
      // Create new isolated browser context for each player
      const playerContext = await browser.newContext({
        viewport: { width: 800, height: 600 },
      });
      contexts.push(playerContext);
      
      const { page: playerPage, emoji: playerEmoji } = await joinRoomAsPlayer(playerContext, roomCode, i);
      pages.push({ page: playerPage, role: `Player ${i}`, emoji: playerEmoji });
      
      // Small delay between player joins to avoid overwhelming the server
      await delay(500);
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
    console.log('Press Ctrl+C to close all browsers and exit.');
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

