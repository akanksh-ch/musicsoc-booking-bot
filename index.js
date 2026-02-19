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

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');

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

        // Ignore messages from self if desired, but user said "testing... only respond to messages where msg.key.fromMe is true"
        // Wait, user said: "Privacy: For testing, the bot is currently set to only respond to messages where msg.key.fromMe is true."
        // So we strictly enforce fromMe === true
        if (!msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!textMessage) return;

        console.log(`[${remoteJid}] (Self): ${textMessage}`);

        await handleCommand(sock, msg, textMessage);
    });
}

// Start
connectToWhatsApp();
