import { addBooking, getBookings, removeBooking } from './store.js';

const COMMANDS = {
    'ping': {
        description: 'Check bot connectivity',
        usage: '/ping',
        handler: async (sock, msg, args) => {
            await sock.sendMessage(msg.key.remoteJid, { text: 'Pong.' }, { quoted: msg });
        }
    },
    'book': {
        description: 'Add a new booking',
        usage: '/book DD-MM HH:MM-HH:MM',
        handler: async (sock, msg, args) => {
            const remoteJid = msg.key.remoteJid;
            const reply = async (text) => sock.sendMessage(remoteJid, { text }, { quoted: msg });

            // Regex for DD-MM HH:MM-HH:MM
            // Example: 25-12 10:00-12:00
            const dateRegex = /^(\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;
            const match = args.trim().match(dateRegex);

            if (!match) {
                await reply(`Usage: ${COMMANDS['book'].usage}\nExample: /book 25-12 10:00-12:00`);
                return;
            }

            const [_, dateStr, startTime, endTime] = match;
            const bookingEntry = `${dateStr} ${startTime}-${endTime}`;

            await addBooking(remoteJid, bookingEntry);
            await reply(`Booking confirmed: ${bookingEntry}`);
        }
    },
    'list': {
        description: 'List all your bookings',
        usage: '/list',
        handler: async (sock, msg, args) => {
            const remoteJid = msg.key.remoteJid;
            const reply = async (text) => sock.sendMessage(remoteJid, { text }, { quoted: msg });

            const bookings = await getBookings(remoteJid);
            if (bookings.length === 0) {
                await reply('No bookings found.');
                return;
            }

            const listText = bookings.map((b, i) => `${i + 1}. ${b.booking}`).join('\n');
            await reply(`Your Bookings:\n${listText}`);
        }
    },
    'cancel': {
        description: 'Cancel a booking by index',
        usage: '/cancel <index>',
        handler: async (sock, msg, args) => {
            const remoteJid = msg.key.remoteJid;
            const reply = async (text) => sock.sendMessage(remoteJid, { text }, { quoted: msg });

            const index = parseInt(args.trim(), 10);

            if (isNaN(index)) {
                await reply(`Usage: ${COMMANDS['cancel'].usage}\nUse /list to see your booking numbers.`);
                return;
            }

            const removed = await removeBooking(remoteJid, index);
            if (removed) {
                await reply(`Booking removed: ${removed.booking}`);
            } else {
                await reply(`Booking #${index} not found.`);
            }
        }
    },
    'help': {
        description: 'Show this help message',
        usage: '/help',
        handler: async (sock, msg, args) => {
            const remoteJid = msg.key.remoteJid;
            let helpText = 'MusicSoc Booking Bot\n\n';

            for (const [cmd, def] of Object.entries(COMMANDS)) {
                helpText += `[${cmd.charAt(0).toUpperCase() + cmd.slice(1)}]\n`;
                helpText += `${def.description}\n`;
                helpText += `Usage: ${def.usage}\n\n`;
            }

            await sock.sendMessage(remoteJid, { text: helpText }, { quoted: msg });
        }
    }
};

export async function handleCommand(sock, msg, text) {
    if (!text.startsWith('/')) return;

    const [cmdName, ...argsArray] = text.slice(1).split(/\s+/);
    const command = COMMANDS[cmdName.toLowerCase()];
    const args = argsArray.join(' ');

    if (command) {
        try {
            await command.handler(sock, msg, args);
        } catch (error) {
            console.error(error);
            await sock.sendMessage(msg.key.remoteJid, { text: '❌ An error occurred while processing your command.' }, { quoted: msg });
        }
    }
}
