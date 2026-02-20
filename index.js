import makeWASocket, { useMultiFileAuthState, DisconnectReason } from 'baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
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
        defaultQueryTimeoutMs: undefined // Keep connection alive
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });

            // Railway logs often distort terminal QR codes. Provide a clickable link as a fallback.
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(qr)}`;
            console.log(`\n\n[RAILWAY FALLBACK] If the QR code above is distorted, click this link to view it:\n${qrImageUrl}\n\n`);
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                // simple backoff
                setTimeout(connectToWhatsApp, 2000);
            } else {
                console.log('Provide a new session by deleting the auth_session folder.');
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
