import makeWASocket, { useMultiFileAuthState, DisconnectReason } from 'baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleCommand } from './lib/commands.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Silent Logger
const logger = {
    info: () => { },
    warn: () => { },
    error: () => { },
    debug: () => { },
    trace: () => { },
    child: () => logger
};

const isRailway = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT_ID;
const dataDir = isRailway ? '/data' : process.cwd();
const authDir = path.join(dataDir, 'auth_session');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
        logger,
        auth: state,
        defaultQueryTimeoutMs: undefined, // Keep connection alive
        browser: ['Ubuntu', 'Chrome', '20.0.04'] // Required for pairing code
    });

    sock.ev.on('creds.update', saveCreds);

    let pairingCodeRequested = false;

    // Pairing code logic
    if (process.env.PAIRING_NUMBER && !sock.authState.creds.registered) {
        setTimeout(async () => {
            if (!pairingCodeRequested) {
                pairingCodeRequested = true;
                try {
                    const code = await sock.requestPairingCode(process.env.PAIRING_NUMBER);
                    console.log(`\n=======================================================\nPAIRING CODE: ${code}\nEnter this code in WhatsApp -> Linked Devices -> Link with phone number\n=======================================================\n`);
                } catch (err) {
                    console.error('Failed to request pairing code:', err);
                    pairingCodeRequested = false;
                }
            }
        }, 5000); // Wait 5 seconds for connection to explicitly establish websocket
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);

            // If we are trying to pair, don't rapid-fire reconnects immediately on 401
            const isPairingFailure = statusCode === 401 || statusCode === 428;

            if (shouldReconnect) {
                const backoff = isPairingFailure ? 5000 : 2000;
                setTimeout(connectToWhatsApp, backoff);
            } else {
                console.log('Logged out from WhatsApp. Deleting old session and restarting...');
                fs.rmSync(authDir, { recursive: true, force: true });
                setTimeout(connectToWhatsApp, 2000);
            }
        } else if (connection === 'open') {
            console.log('Opened connection to WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || m.type !== 'notify') return;

        const remoteJid = msg.key.remoteJid;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!textMessage) return;

        const sender = msg.key.fromMe ? 'Self' : (msg.key.participant || remoteJid);
        console.log(`[${remoteJid}] (${sender}): ${textMessage}`);

        await handleCommand(sock, msg, textMessage);
    });
}

// Start
connectToWhatsApp();
