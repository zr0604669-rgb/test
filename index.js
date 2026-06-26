const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    jidNormalizedUser,
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================
const ADMINS = [
    '923xxxxxxxxx@s.whatsapp.net',
    '923xxxxxxxxy@s.whatsapp.net', 
    '923xxxxxxxxz@s.whatsapp.net'
];

const { bug1 } = require('./msg/bug1.js');
const { bug2 } = require('./msg/bug2.js');
const { bug3 } = require('./msg/bug3.js');
const { bug4 } = require('./msg/bug4.js');
const { bug5 } = require('./msg/bug5.js');
const { bug6 } = require('./msg/bug6.js');
const { bug7 } = require('./msg/bug7.js');
require('./msg/bug8.js');
const { ios } = require('./msg/ios.js');
const TEXT_CONSTANTS = {
    '1': bug1,
    '2': bug2,
    '3': bug3,
    '4': bug4,
    '5': bug5,
    '6': bug6,
    '7': bug7,
    '8': bug8,
    '9': ios
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false, 
            logger: pino({ level: 'silent' }), 
            browser: ['Ubuntu', 'Chrome', '111.0'] 
        });

        // ==========================================
        // 2. PAIRING CODE LOGIC (Protected)
        // ==========================================
        if (!sock.authState?.creds?.registered) {
            setTimeout(async () => {
                try {
                    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                    rl.question('Enter your phone number with country code (e.g., 12345678900): ', async (phoneNumber) => {
                        rl.close();
                        if (!phoneNumber) return console.log('Empty number provided. Restart to try again.');
                        
                        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
                        try {
                            const code = await sock.requestPairingCode(cleanNumber);
                            const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                            console.log(`\n> Your pairing code is: \x1b[32m${formattedCode}\x1b[0m`);
                        } catch (err) {
                            console.error('Failed to request pairing code:', err.message);
                        }
                    });
                } catch (e) {
                    console.error('Error during pairing input interface:', e.message);
                }
            }, 2000);
        }

        // ==========================================
        // 3. CREDENTIALS UPDATE
        // ==========================================
        sock.ev.on('creds.update', async () => {
            try {
                await saveCreds();
            } catch (err) {
                console.error('Failed to save session credentials:', err.message);
            }
        });

        // ==========================================
        // 4. CONNECTION HANDLING (Anti-Crash Reconnect)
        // ==========================================
        sock.ev.on('connection.update', async (update) => {
            try {
                const { connection, lastDisconnect } = update;
                
                if (connection === 'close') {
                    // Extract network or server closure status code safely
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = lastDisconnect?.error?.message || 'Unknown Reason';
                    
                    console.log(`Connection closed (Code: ${statusCode}). Reason: ${reason}`);

                    // Don't reconnect if explicitly logged out by the user/WhatsApp
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    if (shouldReconnect) {
                        console.log('Attempting automated reconnection in 5 seconds...');
                        await delay(5000);
                        startBot(); 
                    } else {
                        console.log('Session expired or logged out. Please clear "auth_info_baileys" and pair again.');
                    }
                } else if (connection === 'open') {
                    console.log('\n✅ Successfully connected to WhatsApp!');
                }
            } catch (err) {
                console.error('Error handling connection status update:', err.message);
            }
        });

        // ==========================================
        // 5. INCOMING MESSAGE PROCESSING (Fully Defended)
        // ==========================================
        sock.ev.on('messages.upsert', async (m) => {
            try {
                // Safeguard against malformed payloads or empty message arrays
                if (!m?.messages || m.messages.length === 0) return;
                
                const msg = m.messages[0];
                if (!msg?.message) return; 

                // Ensure remoteJid exists before attempting normalization
                if (!msg.key?.remoteJid) return;
                const chatId = jidNormalizedUser(msg.key.remoteJid);
                
                // Extract raw sender ID safely
                const rawSenderId = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);

                // Safe LID Resolution Workaround
                let resolvedSenderId = rawSenderId;
                if (rawSenderId && rawSenderId.endsWith('@lid')) {
                    try {
                        // Check if mapping function is available on the initialized socket instance
                        if (sock.signalRepository?.lidMapping?.getPNForLID) {
                            const mappedPn = await sock.signalRepository.lidMapping.getPNForLID(rawSenderId);
                            if (mappedPn) {
                                resolvedSenderId = jidNormalizedUser(mappedPn);
                            }
                        }
                    } catch (error) {
                        // Catch silent mapping errors (e.g., identity record not synced yet)
                    }
                }

                // Check administrator authorization status
                const isAuthorized = msg.key.fromMe || ADMINS.includes(resolvedSenderId);

                // Safely extract text input across multi-variant Baileys payload types
                const messageType = Object.keys(msg.message)[0];
                let text = '';
                if (messageType === 'conversation') {
                    text = msg.message.conversation;
                } else if (messageType === 'extendedTextMessage') {
                    text = msg.message.extendedTextMessage?.text || '';
                }

                if (!text || typeof text !== 'string') return;

                // --- COMMAND: ./id ---
                if (text === './id') {
                    if (!isAuthorized) return;
                    
                    const isGroup = chatId.endsWith('@g.us');
                    let chatName = 'Unknown Chat';
                    
                    try {
                        if (isGroup) {
                            const groupMetadata = await sock.groupMetadata(chatId);
                            chatName = groupMetadata?.subject || 'Unknown Group';
                        } else {
                            chatName = msg.pushName || 'Private Chat';
                        }
                        
                        const replyMessage = `*Chat Name:* ${chatName}\n*Chat ID:* ${chatId}`;
                        await sock.sendMessage(chatId, { text: replyMessage }, { quoted: msg });
                    } catch (error) {
                        console.error('Error running ./id execution:', error.message);
                    }
                    return;
                }

                // --- COMMANDS: ./1 to ./9 ---
                if (text.startsWith('./')) {
                    if (!isAuthorized) return;

                    const args = text.split(/\s+/);
                    if (!args[0]) return;
                    
                    const commandKey = args[0].replace('./', '');

                    if (TEXT_CONSTANTS.hasOwnProperty(commandKey)) {
                        let amount = parseInt(args[1], 10) || 1;
                        let targetJid = args[2];

                        if (!targetJid) {
                            targetJid = chatId;
                        } else {
                            // Ensure manual target text matches formatting rules
                            if (!targetJid.includes('@')) {
                                targetJid = targetJid.includes('-') ? `${targetJid}@g.us` : `${targetJid}@s.whatsapp.net`;
                            }
                            targetJid = jidNormalizedUser(targetJid);
                        }

                        // Bounds enforcement limits
                        if (amount > 20) amount = 20;
                        if (amount < 1) amount = 1;

                        const payloadText = TEXT_CONSTANTS[commandKey];

                        for (let i = 0; i < amount; i++) {
                            try {
                                await sock.sendMessage(targetJid, { text: payloadText });
                                if (i < amount - 1) await delay(1000); 
                            } catch (error) {
                                console.error(`Failed to dispatch message context index ${i}:`, error.message);
                                break; // Halt execution loop if target fails completely
                            }
                        }
                    }
                }
            } catch (msgError) {
                console.error('Error occurred in internal message processing loop:', msgError.message);
            }
        });

    } catch (bootError) {
        console.error('Critical initialization routine error:', bootError.message);
        console.log('Attempting overall execution restart in 10 seconds...');
        await delay(3000);
        startBot();
    }
}

// ==========================================
// 6. GLOBAL PROCESS FAIL-SAFE CHANNELS
// ==========================================
// Captures general synchronous exceptions anywhere in the file runtime context
process.on('uncaughtException', (err) => {
    console.error('CRITICAL: Caught unhandled exception error:', err.stack || err.message);
    // Process stays alive because exception is handled here
});

// Captures broken async operations or unhandled Promise failures
process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: Unhandled Promise rejection at:', promise, 'reason:', reason);
    // Process stays alive
});

startBot();
